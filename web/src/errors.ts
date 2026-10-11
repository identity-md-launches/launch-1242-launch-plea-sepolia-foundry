import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  type Hex,
} from "viem";
import { abis, routerAbi, tokenAbi } from "./contracts";
const explanations: Record<string, string> = {
  FaucetCooldown:
    "Your tIMD faucet cooldown is still running. Wait for the faucet countdown to end, then try again.",
  ActionNotSold:
    "The Intake is not accepting this oracle action and fee asset. Check its service status before retrying.",
  PriceNotMet:
    "The Intake fee changed. Refresh the fee information before requesting another hearing.",
  CallbackGasShort:
    "The oracle callback needs more gas. Open the Intake record for delivery status.",
  SafeERC20FailedOperation:
    "The token transfer failed. Check your balance and approval, then retry.",
  CannotPass:
    "This plea cannot pass: lower the amount or wait for better facts.",
  BadPleaText:
    "The Gate rejected this text. Use 1–280 UTF-8 bytes without line breaks, invisible characters or [PLEA markers.",
  AmountTooLarge:
    "The amount exceeds your plea limit. Lower it to the limit shown above.",
  PendingExists:
    "You already have an open plea. Execute an approval or clear a plea with no verdict first.",
  Cooldown:
    "Your four-hour cooldown is still running. Wait until the countdown ends.",
  CabalNotWatching:
    "The Cabal is no longer watching. Open Buy and use Sell PLEA.",
  NotStale:
    "This plea can still receive a verdict. Wait for its pending countdown to end.",
  NotPending:
    "This plea is no longer pending. Refresh to see its latest state.",
  WindowLapsed:
    "The seven-minute sale window has ended. Wait for your cooldown, then submit another plea.",
  NotApproved:
    "There is no active approval for this wallet. Open your latest plea.",
  NotSeller: "Use the wallet that submitted this plea.",
  AppealClosed:
    "The four-hour appeal window has ended. Submit a new plea when your cooldown ends.",
  AlreadyAppealed:
    "This denial already has an appeal. Clear an expired unanswered appeal before retrying.",
  NotDenied:
    "Only an original denied plea can be appealed. Open that plea first.",
  SlippageExceeded:
    "The sale would pay less than your minimum. Refresh the preview or adjust slippage.",
  PartialFill:
    "The pool cannot fill the entire approved amount. Try again when liquidity is available.",
  NotEnoughGas:
    "The hook needs more gas for cashback. Retry; the transaction includes the required gas reserve.",
  BuyTooLarge:
    "This buy exceeds the launch cap. Lower the amount or wait for the launch window to end.",
  SellsOnlyViaGate:
    "The Cabal is alive. Submit a plea and execute an approval to sell.",
  NotReady:
    "The season or its one-hour grace has not ended. Wait for the close countdown.",
  AlreadyRecorded:
    "These points have already been recorded. Refresh the leaderboard.",
  SeasonClosed:
    "This season has already closed. Its points can no longer be recorded.",
  NotFinished:
    "Close the remaining seasons after the Cabal dies, then send leftovers to the wall.",
  BadName:
    "Use 3–20 lowercase letters, digits or underscores, and choose a name that is not reserved.",
  NameTaken: "This display name is taken. Choose another.",
  ERC20InsufficientBalance:
    "Your token balance is too low. Use the appropriate faucet or lower the amount.",
  ERC20InsufficientAllowance:
    "Approve this token for the indicated contract, then retry.",
  RebalanceNotNeeded: "The pool no longer needs rebalancing. Refresh Status.",
  PriceMoved: "The pool price changed. Refresh the preview and try again.",
  NotSeeded: "Trading has not opened. Refresh after the pool is seeded.",
  RecipientRequired:
    "The swap recipient was missing. Refresh the site before retrying.",
  ExactOutputBuyRefused:
    "Use an exact-input buy: enter the tIMD you want to spend.",
};
export function explainError(error: unknown): string {
  const decode = (data: Hex, depth = 0): string | undefined => {
    if (depth > 4) return;
    try {
      const d = decodeErrorResult({
        abi: [...Object.values(abis).flat(), ...routerAbi, ...tokenAbi],
        data,
      });
      if (d.errorName === "WrappedError") {
        for (const arg of d.args ?? [])
          if (typeof arg === "string" && arg.startsWith("0x")) {
            const nested = decode(arg as Hex, depth + 1);
            if (nested) return nested;
          }
      }
      if (explanations[d.errorName])
        return `${d.errorName}: ${explanations[d.errorName]}`;
      if (d.errorName === "Error")
        return `${d.args?.[0]}. Check the amount, balance and allowance, then retry.`;
      return `${d.errorName}: refresh the current contract state and check your amount and permissions before retrying.`;
    } catch {
      return;
    }
  };
  if (error instanceof BaseError) {
    const revert = error.walk(
      (e) => e instanceof ContractFunctionRevertedError,
    ) as ContractFunctionRevertedError;
    if (revert?.data) {
      const name = revert.data.errorName;
      if (name === "WrappedError")
        for (const arg of revert.data.args ?? [])
          if (typeof arg === "string" && arg.startsWith("0x")) {
            const nested = decode(arg as Hex);
            if (nested) return nested;
          }
      if (explanations[name]) return `${name}: ${explanations[name]}`;
    }
  }
  let cursor: any = error;
  for (let i = 0; i < 8 && cursor; i++, cursor = cursor.cause) {
    if (typeof cursor.data === "string") {
      const decoded = decode(cursor.data);
      if (decoded) return decoded;
    }
    if (cursor.code === 4001)
      return "Request declined in your wallet. Try again when ready; earlier confirmed steps remain on chain.";
  }
  const message = error instanceof Error ? error.message : String(error);
  for (const [name, explanation] of Object.entries(explanations))
    if (message.includes(name)) return `${name}: ${explanation}`;
  if (/User rejected|user denied/i.test(message))
    return "Request declined in your wallet. Try again when ready; earlier confirmed steps remain on chain.";
  if (/insufficient funds/i.test(message))
    return "Not enough Sepolia ETH for gas. Add test ETH to your wallet and retry.";
  if (/timeout|fetch|HTTP|network|rate limit/i.test(message))
    return "The Sepolia RPC could not complete this request. Wait a moment and retry; fallback providers are configured.";
  return (
    message.split("\n")[0].slice(0, 220) ||
    "Unable to complete this action. Refresh and retry."
  );
}
