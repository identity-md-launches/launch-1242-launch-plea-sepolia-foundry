import {
  encodeAbiParameters,
  encodeFunctionData,
  decodeFunctionResult,
  type Address,
  type Abi,
} from "viem";
import { addresses, client, routerAbi, abis } from "./contracts";
import type { Snapshot } from "./data";
import preview from "./abi/BalancePreview.json";
export function swapArgs(
  data: Snapshot,
  account: Address,
  amount: bigint,
  buy: boolean,
) {
  const zeroForOne = buy ? !data.pleaIsZero : data.pleaIsZero;
  return [
    data.poolKey,
    {
      zeroForOne,
      amountSpecified: -amount,
      sqrtPriceLimitX96: zeroForOne
        ? 4295128740n
        : 1461446703485210103287273052203988822378723970341n,
    },
    { takeClaims: false, settleUsingBurn: false },
    encodeAbiParameters([{ type: "address" }], [account]),
  ] as const;
}
export async function quoteSwap(
  data: Snapshot,
  account: Address,
  amount: bigint,
  buy: boolean,
  rpc: typeof client = client,
) {
  const call = encodeFunctionData({
    abi: routerAbi,
    functionName: "swap",
    args: swapArgs(data, account, amount, buy),
  });
  // This is eth_call only. No helper is deployed; the account and balances are real.
  const result = await rpc.call({
    account,
    to: account,
    gas: 12_000_000n,
    data: encodeFunctionData({
      abi: preview.abi as Abi,
      functionName: "preview",
      args: [
        addresses.PoolSwapTest,
        buy ? addresses.TestIMD : addresses.PLEA,
        buy ? addresses.PLEA : addresses.TestIMD,
        amount,
        call,
      ],
    }),
    stateOverride: [
      { address: account, code: preview.bytecode as `0x${string}` },
    ],
  });
  if (!result.data)
    throw Error("No swap result was returned. Retry the preview.");
  return decodeFunctionResult({
    abi: preview.abi as Abi,
    functionName: "preview",
    data: result.data,
  }) as readonly [bigint, bigint];
}
export async function quoteExecute(
  account: Address,
  amount: bigint,
  rpc: typeof client = client,
) {
  const call = encodeFunctionData({
    abi: abis.CabalGate,
    functionName: "executeSell",
    args: [0n],
  });
  const result = await rpc.call({
    account,
    to: account,
    gas: 12_000_000n,
    data: encodeFunctionData({
      abi: preview.abi as Abi,
      functionName: "preview",
      args: [
        addresses.CabalGate,
        addresses.PLEA,
        addresses.TestIMD,
        amount,
        call,
      ],
    }),
    stateOverride: [
      { address: account, code: preview.bytecode as `0x${string}` },
    ],
  });
  if (!result.data)
    throw Error("No sale result was returned. Retry the preview.");
  const [, , returned] = decodeFunctionResult({
    abi: preview.abi as Abi,
    functionName: "preview",
    data: result.data,
  }) as readonly [bigint, bigint, `0x${string}`];
  return decodeFunctionResult({
    abi: abis.CabalGate,
    functionName: "executeSell",
    data: returned,
  }) as bigint;
}
