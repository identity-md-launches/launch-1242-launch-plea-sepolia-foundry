import { test } from "node:test";
import assert from "node:assert/strict";
import {
  amountOf,
  bytes,
  gasLimit,
  minimumOut,
  pleaState,
  standings,
  validateName,
  validatePlea,
  type Plea,
} from "../src/domain";
import { swapArgs } from "../src/swaps";
import { addresses } from "../src/contracts";
import { encodeAbiParameters } from "viem";
import type { Snapshot } from "../src/data";

test("Gate text rules accept ordinary UTF-8 prose, but count bytes rather than characters", () => {
  for (const value of [
    "Cabal, this is my case.",
    "é".repeat(140),
    "庭审",
    'A "quote" and a \\ slash.',
    "😀",
    "\u00a0",
    "[PLEx]",
  ])
    assert.equal(validatePlea(value), undefined, value);
  assert.equal(bytes("é"), 2);
  assert.ok(validatePlea("é".repeat(141)));
  assert.ok(validatePlea(""));
  assert.equal(validatePlea("a".repeat(280)), undefined);
  assert.ok(validatePlea("a".repeat(281)));
});
test("Gate excludes marker prefixes, ASCII and Unicode control/invisible ranges exactly", () => {
  for (const value of [
    "[PLEA]",
    "[/plea]",
    "[pLeAsure",
    "[PLEA",
    "[plea anything",
    "\n",
    "\t",
    "\r",
    "\u0000",
    "\u001f",
    "\u007f",
    "\u0080",
    "\u009f",
    "\u00ad",
    "\u061c",
    "\u200b",
    "\u200f",
    "\u2028",
    "\u202e",
    "\u2060",
    "\u2064",
    "\u2066",
    "\u2069",
    "\ufeff",
    "\ufe00",
    "\ufe0f",
    "\u180e",
    String.fromCodePoint(0xe0000),
    String.fromCodePoint(0xe01ef),
    String.fromCodePoint(0xe0fff),
  ])
    assert.ok(validatePlea(value), JSON.stringify(value));
  for (const value of [
    "[ple",
    "[ /plea",
    "\u200a",
    "\u2010",
    "\u2027",
    "\u202f",
    "\u2065",
    "\u206a",
    "\ufe10",
    String.fromCodePoint(0xe1000),
  ])
    assert.equal(validatePlea(value), undefined, JSON.stringify(value));
});
test("Name rules, clearing and reserved names mirror Laureates", () => {
  for (const n of ["", "abc", "case_123", "a".repeat(20)])
    assert.equal(validateName(n), undefined);
  for (const n of [
    "ab",
    "a".repeat(21),
    "SomeName",
    "a b",
    "a-b",
    "ééé",
    "cabal",
    "admin",
    "imd",
    "plea",
    "owner",
  ])
    assert.ok(validateName(n), n);
});
test("Amounts reject malformed, negative and over-precision inputs without rounding", () => {
  assert.equal(amountOf("0.1"), 100000000000000000n);
  assert.equal(amountOf("1.000000000000000001"), 1000000000000000001n);
  for (const value of [
    "",
    "-1",
    "1e2",
    "NaN",
    "1.0000000000000000001",
    "1,000",
  ])
    assert.equal(amountOf(value), 0n);
});
test("Gas limits round up, reserve enough for hook credit gas, and scale other writes", () => {
  assert.equal(gasLimit(100n, false), 150n);
  assert.equal(gasLimit(101n, false), 152n);
  assert.equal(gasLimit(100000n, true, 1300000n), 2600000n);
  assert.equal(gasLimit(3000000n, true, 1300000n), 3900000n);
  assert.equal(gasLimit(100000n, true, 2000000n), 3300000n);
});
test("Min-out slippage is bounded and uses integer arithmetic", () => {
  assert.equal(minimumOut(100000n, "1"), 99000n);
  assert.equal(minimumOut(101n, "0.1"), 100n);
  for (const value of ["0", "5.01", "-1", "bad", ""])
    assert.throws(() => minimumOut(100n, value));
});
const base = {
  id: 1n,
  seller: addresses.PLEA,
  status: 1,
  submittedAt: 1000n,
  verdictAt: 0n,
  completed: false,
  recorded: false,
  factScore: 37,
  need: 33,
  score: 38,
  isAppeal: false,
  appealed: false,
  amount: 100n,
  originalId: 0n,
  intakeId: "0x",
  text: "A case.",
  tx: "0x",
} as Plea;
test("Pending and approval transitions respect exact Gate boundary seconds", () => {
  assert.equal(pleaState(base, 2200n, 1200n, 420n), "Pending");
  assert.equal(pleaState(base, 2201n, 1200n, 420n), "No verdict");
  assert.equal(
    pleaState({ ...base, completed: true }, 1001n, 1200n, 420n),
    "No verdict",
  );
  const p = { ...base, status: 2, verdictAt: 1100n };
  assert.equal(pleaState(p, 1520n, 1200n, 420n), "Approved");
  assert.equal(pleaState(p, 1521n, 1200n, 420n), "Lapsed");
  for (const [status, label] of [
    [3, "Denied"],
    [4, "Executed"],
    [5, "Lapsed"],
    [6, "Expired"],
  ] as const)
    assert.equal(pleaState({ ...base, status }, 3000n, 1200n, 420n), label);
});
test("Rank uses three best recorded scores, with earliest plea ids winning ties", () => {
  const p = (id: bigint, score: number, seller = addresses.PLEA) => ({
    ...base,
    id,
    score,
    seller,
    status: 4,
    recorded: true,
    verdictAt: 2000n,
  });
  const ranking = standings(
    [
      p(1n, 38),
      p(2n, 35),
      p(3n, 34),
      p(4n, 40),
      p(5n, 40, addresses.CabalGate),
      p(6n, 38, addresses.CabalGate),
      p(7n, 35, addresses.CabalGate),
      { ...p(8n, 45), recorded: false },
    ],
    1000n,
    18000n,
    0n,
  );
  assert.equal(ranking[0].points, 113);
  assert.equal(ranking[0].wallet, addresses.PLEA.toLowerCase());
  assert.deepEqual(ranking[0].scores, [40, 38, 35]);
});
test("Swaps are exact input, use hook direction and include buyer hookData in both directions", () => {
  for (const pleaIsZero of [true, false])
    for (const buy of [true, false]) {
      const data = { pleaIsZero, poolKey: {} } as Snapshot;
      const a = swapArgs(data, addresses.PLEA, 10n, buy);
      assert.equal(a[1].zeroForOne, buy ? !pleaIsZero : pleaIsZero);
      assert.equal(a[1].amountSpecified, -10n);
      assert.deepEqual(a[2], { takeClaims: false, settleUsingBurn: false });
      assert.equal(
        a[3],
        encodeAbiParameters([{ type: "address" }], [addresses.PLEA]),
      );
    }
});

test("Approved-sale minimum uses Gate return value, excluding any plain-IMD cashback", async () => {
  const { quoteExecute } = await import("../src/swaps");
  const { encodeFunctionResult } = await import("viem");
  const { abis, client } = await import("../src/contracts");
  const preview = (await import("../src/abi/BalancePreview.json")).default;
  const returned = encodeFunctionResult({
    abi: abis.CabalGate,
    functionName: "executeSell",
    result: 100n,
  });
  const data = encodeFunctionResult({
    abi: preview.abi,
    functionName: "preview",
    result: [105n, 1000n, returned],
  });
  const mock = { call: async () => ({ data }) } as unknown as typeof client;
  assert.equal(await quoteExecute(addresses.PLEA, 1000n, mock), 100n);
});

test("Nested hook custom errors name the problem and a recovery", async () => {
  const { encodeErrorResult } = await import("viem");
  const { explainError } = await import("../src/errors");
  const { abis, routerAbi } = await import("../src/contracts");
  const reason = encodeErrorResult({
    abi: abis.CabalGate,
    errorName: "CannotPass",
    args: [46n],
  });
  const wrapped = encodeErrorResult({
    abi: routerAbi,
    errorName: "WrappedError",
    args: [addresses.PleaHook, "0x00000000", reason, "0x"],
  });
  assert.match(
    explainError({ data: wrapped }),
    /CannotPass: This plea cannot pass: lower the amount/,
  );
});
