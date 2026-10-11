/** Isolated Sepolia replay. Never sends to a public RPC. Run Anvil on 127.0.0.1:8545 first. */
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  keccak256,
  encodeAbiParameters,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { writeFileSync } from "node:fs";
import {
  addresses,
  abis,
  client as live,
  sepolia,
  tokenAbi,
} from "../src/contracts";
import { gasLimit, minimumOut, type Plea } from "../src/domain";
import { quoteExecute, quoteSwap, swapArgs } from "../src/swaps";
import { loadSnapshot, type Snapshot } from "../src/data";
import { explainError } from "../src/errors";
import assert from "node:assert/strict";
const rpcURL = "http://127.0.0.1:8545";
const rpc = createPublicClient({
  chain: sepolia,
  transport: http(rpcURL, { timeout: 30000 }),
});
let account: Address;
const results: any[] = [];
const request = async (method: string, params: any[] = []) =>
  rpc.request({ method, params } as never) as any;
const r = async <T = bigint>(
  contract: string,
  fn: string,
  args: readonly unknown[] = [],
) =>
  rpc.readContract({
    address: addresses[contract],
    abi: abis[contract],
    functionName: fn,
    args,
  }) as Promise<T>;
async function reset(block: bigint, who: Address) {
  await request("anvil_reset", [
    {
      forking: {
        jsonRpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
        blockNumber: Number(block),
      },
    },
  ]);
  account = who;
  await request("anvil_impersonateAccount", [who]);
  await request("anvil_setBalance", [who, "0x56bc75e2d63100000"]);
}
async function send(
  contract: string,
  fn: string,
  args: readonly unknown[] = [],
  swap = false,
) {
  const req = {
    account,
    address: addresses[contract],
    abi: abis[contract],
    functionName: fn,
    args,
  };
  const estimate = await rpc.estimateContractGas({ ...req, gas: 12_000_000n });
  const credit = await r("PleaHook", "creditGas");
  const gas = gasLimit(estimate, swap, credit);
  const wc = createWalletClient({
    account,
    chain: sepolia,
    transport: http(rpcURL),
  });
  const hash = await wc.writeContract({ ...req, gas });
  const receipt = await rpc.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success");
  const entry = {
    contract,
    fn,
    gas: String(gas),
    estimate: String(estimate),
    gasUsed: String(receipt.gasUsed),
    status: receipt.status,
  };
  results.push(entry);
  console.log(`${contract}.${fn}: success, gas ${receipt.gasUsed}/${gas}`);
  return hash;
}
const approve = async (token: string, spender: string, amount: bigint) =>
  send(token, "approve", [addresses[spender], amount]);
const jump = async (timestamp: bigint) => {
  await request("evm_setNextBlockTimestamp", [Number(timestamp)]);
  await request("evm_mine");
};
const snapshot = await loadSnapshot();
// Public RPCs prune historical state. Restore the approval window of an actual approved
// plea on the isolated fork. No oracle signature or live state is altered.
const approval =
  snapshot.pleas.find((p) => p.id === 5n) ??
  snapshot.pleas.find((p) => p.id === 4n)!;
const approvalReceipt = { blockNumber: snapshot.block };
const slotOf = (id: bigint) =>
  BigInt(
    keccak256(
      encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [id, 6n]),
    ),
  );
const mapOf = (who: Address, slot: bigint) =>
  keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [who, slot],
    ),
  );
const writeSlot = async (slot: bigint | Hex, value: bigint) =>
  request("anvil_setStorageAt", [
    addresses.CabalGate,
    typeof slot === "bigint" ? toHex(slot, { size: 32 }) : slot,
    toHex(value, { size: 32 }),
  ]);
async function restoreWindow(p: Plea, status: number) {
  const slot = slotOf(p.id);
  const flags = BigInt(
    (await rpc.getStorageAt({
      address: addresses.CabalGate,
      slot: toHex(slot, { size: 32 }),
    }))!,
  );
  const time = (await rpc.getBlock()).timestamp;
  await writeSlot(
    slot,
    (flags & ~(255n << 184n) & ~(255n << 192n)) | (BigInt(status) << 184n),
  );
  const timing = BigInt(
    (await rpc.getStorageAt({
      address: addresses.CabalGate,
      slot: toHex(slot + 1n, { size: 32 }),
    }))!,
  );
  await writeSlot(slot + 1n, (timing & ((1n << 192n) - 1n)) | (time << 192n));
  await writeSlot(mapOf(p.seller, 8n), status === 2 ? p.id : 0n);
  results.push({
    setup: "Local fork only: restore an existing plea window",
    plea: String(p.id),
    status,
  });
}
await reset(snapshot.block, approval.seller);
await restoreWindow(approval, 2);
assert.equal((await r<Plea>("CabalGate", "getPlea", [approval.id])).status, 2);
const quote = await quoteExecute(account, approval.amount, rpc);
assert.ok(quote > 0n);
results.push({ check: "Approved sale eth_call preview", out: String(quote) });
await approve("PLEA", "CabalGate", approval.amount);
await send("CabalGate", "executeSell", [minimumOut(quote, "1")], true);
assert.equal((await r<Plea>("CabalGate", "getPlea", [approval.id])).status, 4);
const recordedSlot = keccak256(
  encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }],
    [approval.id, 1n],
  ),
);
// The recorded mapping's slot is extracted from the pinned source artifact below.
const { execFileSync } = await import("node:child_process");
const layout = JSON.parse(
  execFileSync("forge", ["inspect", "Seasons", "storage-layout", "--json"], {
    encoding: "utf8",
  }),
);
const recordBase = BigInt(
  layout.storage.find((v: any) => v.label === "recorded").slot,
);
const slot = keccak256(
  encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }],
    [approval.id, recordBase],
  ),
);
await request("anvil_setStorageAt", [
  addresses.Seasons,
  slot,
  toHex(0n, { size: 32 }),
]);
await send("Seasons", "record", [approval.id]);
assert.equal(await r<boolean>("Seasons", "recorded", [approval.id]), true);
try {
  await rpc.simulateContract({
    account,
    address: addresses.Seasons,
    abi: abis.Seasons,
    functionName: "record",
    args: [approval.id],
  });
  throw Error("Expected AlreadyRecorded");
} catch (e) {
  assert.match(explainError(e), /AlreadyRecorded/);
  results.push({ check: "Duplicate points", message: explainError(e) });
}
// Faucet, exact-input buy, cashback and display-name actions.
await send("TestIMD", "faucet");
await send("OracleIMD", "mint", [account, await r("CabalGate", "ORACLE_FEE")]);
const buy = await quoteSwap(snapshot, account, parseEther("0.1"), true, rpc);
assert.ok(buy[0] > 0n);
const before = await r("PLEA", "balanceOf", [account]);
await approve("TestIMD", "PoolSwapTest", parseEther("0.1"));
await send(
  "PoolSwapTest",
  "swap",
  swapArgs(snapshot, account, parseEther("0.1"), true),
  true,
);
assert.ok((await r("PLEA", "balanceOf", [account])) > before);
await send("Laureates", "setName", ["court_review"]);
assert.equal(await r<string>("Laureates", "nameOf", [account]), "court_review");
await send("Laureates", "setName", [""]);
assert.equal(await r<string>("Laureates", "nameOf", [account]), "");
// Fund the isolated fork's reserve through its real interface to make rebalance available.
const wallFunding = await r("PleaHook", "WALL_THRESHOLD");
try {
  await rpc.simulateContract({
    account,
    address: addresses.TestIMD,
    abi: abis.TestIMD,
    functionName: "faucet",
  });
  throw Error("Expected FaucetCooldown");
} catch (e) {
  assert.match(explainError(e), /FaucetCooldown/);
  results.push({ check: "Faucet cooldown", message: explainError(e) });
}
await approve("TestIMD", "PleaHook", wallFunding);
await send("PleaHook", "fundWall", [wallFunding]);
assert.equal(await r<boolean>("PleaHook", "pendingRebalance"), true);
await send("PleaHook", "rebalance");
assert.equal(await r<boolean>("PleaHook", "pendingRebalance"), false);
// Pending expiry and clear, with chain time advanced instantaneously.
const latest = await rpc.getBlock({ blockTag: "latest" });
await jump(latest.timestamp + (await r("CabalGate", "COOLDOWN")) + 1n);
const fee = await r("CabalGate", "ORACLE_FEE");
await approve("OracleIMD", "CabalGate", fee);
const id = await r("CabalGate", "nextId");
await send("CabalGate", "submitSell", [
  parseEther("1000"),
  "Cabal, I ask for a small sale and keep the rest of my position for future seasons.",
]);
const pending = await r<Plea>("CabalGate", "getPlea", [id]);
assert.equal(pending.status, 1);
await jump(pending.submittedAt + (await r("CabalGate", "PENDING_EXPIRY")) + 1n);
await send("CabalGate", "expire", [id]);
assert.equal((await r<Plea>("CabalGate", "getPlea", [id])).status, 6);
// Close ended seasons, render the actual on-chain NFT, then final flush and free sale.
const last = await r("CabalGate", "lastVerdictAt"),
  deadman = await r("CabalGate", "DEADMAN"),
  grace = await r("Seasons", "CLOSE_GRACE");
await jump(last + deadman + grace + 1n);
assert.equal(await r<boolean>("CabalGate", "cabalAlive"), false);
let closes = 0;
while (!(await r<boolean>("Seasons", "finished"))) {
  await send("Seasons", "closeSeason", [[]]);
  if (++closes > 20) throw Error("Unexpected season count");
}
assert.ok(
  (await r<string>("Laureates", "tokenURI", [1n])).startsWith(
    "data:application/json;base64,",
  ),
);
results.push({ check: "Laureate tokenURI after close", success: true });
if ((await r("Seasons", "pot")) > 0n) await send("Seasons", "flushToWall");
assert.equal(await r("Seasons", "pot"), 0n);
const sale = await quoteSwap(snapshot, account, parseEther("1000"), false, rpc);
assert.ok(sale[0] > 0n);
await approve("PLEA", "PoolSwapTest", parseEther("1000"));
await send(
  "PoolSwapTest",
  "swap",
  swapArgs(snapshot, account, parseEther("1000"), false),
  true,
);
if (await r<boolean>("PleaHook", "pendingRebalance"))
  await send("PleaHook", "rebalance");
// A historical denial, a paid appeal, an expired appeal, and retry within the same window.
const denial = snapshot.pleas.find((p) => p.id === 1n)!;
const denialReceipt = await live.getTransactionReceipt({
  hash: denial.verdictTx!,
});
await reset(snapshot.block, denial.seller);
await restoreWindow(denial, 3);
await send("OracleIMD", "mint", [account, fee * 2n]);
await approve("OracleIMD", "CabalGate", fee * 2n);
await approve(
  "TestIMD",
  "CabalGate",
  (await r("CabalGate", "APPEAL_POOL_SHARE")) * 2n,
);
await send("CabalGate", "appeal", [
  1n,
  parseEther("100000"),
  "Cabal, I ask for less on appeal. I will keep the rest and accept the court’s decision.",
]);
const appealId = (await r("CabalGate", "nextId")) - 1n;
const appeal = await r<Plea>("CabalGate", "getPlea", [appealId]);
await jump(appeal.submittedAt + (await r("CabalGate", "PENDING_EXPIRY")) + 1n);
await send("CabalGate", "expire", [appealId]);
assert.equal((await r<Plea>("CabalGate", "getPlea", [1n])).appealed, false);
await send("CabalGate", "appeal", [
  1n,
  parseEther("90000"),
  "Cabal, the last hearing ended without a verdict. My smaller request remains, with the rest held.",
]);
writeFileSync(
  "artifacts/fork-interactions.json",
  JSON.stringify(
    {
      network: "isolated local Sepolia fork; no live writes",
      sourceBlock: String(approvalReceipt.blockNumber),
      tests: results,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Passed ${results.length} local-fork checks.`);
