# PLEA

A sell-gated meme token on Uniswap v4. Buying is open. Selling needs a plea approved by **the Cabal**: a panel of 30 IdentityMD oracle judges that scores each plea 0-45. While the Cabal lives, pleas also compete in 15-day **seasons** for prizes and Laureate NFTs. When the Cabal dies, it's over: PLEA trades freely forever.

Launched through the IMD swarm from this repository (`launch.open` with `repoUrl` + `baseCommit`). It builds on PLEA v2 (IMD launch #1148) and the v4 fixes.

## How it works

**Pleading.** A holder asks to sell up to 2.5M PLEA (at most 35% of their balance) with a plea of up to 280 bytes, and pays the 0.5 IMD oracle fee. The gate pays the IdentityMD Intake itself; the judges' signed score comes back through the Intake's callback. The contract computes a fact score (0-55) from the share sold, the buy-weighted holding time, profit or loss and the 24h price; the seller's **need** is 70 minus the fact score. A score at or above the need opens a 7-minute window to sell through the gate. A denial means a 4-hour wait, with one appeal (0.85 IMD, same or smaller amount) inside those 4 hours. A plea with no verdict expires after 20 minutes, or at once when the Intake reports the request finished without one.

**The dead-man.** The Cabal lives from the moment trading opens until 33 hours pass without a signed verdict. Then it is dead for good: no plea can be submitted, and every transfer restriction ends. There is no way back.

**Seasons.** Seasons of 15 days run back to back from launch; the last one ends when the Cabal dies. Every approved plea earns its score as points; each wallet's best three count. When a season ends, anyone calls `closeSeason`: the top 10 with at least 60 points are paid 25/18/14/11/9/7/6/4/3/3 % of the prize pot in IMD (unpaid shares roll over), and the season's five best pleas become **Laureate** NFTs, rendered on chain. After the last season is closed, anything left in the pot goes to the buy wall.

**Fees** (every trade, paid in the same swap): 0.5% cashback to the trader as staked IMD through imd/acc's Stacker, 0.5% to the owner, 0.25% to the prize pot (to pool liquidity once the Cabal is dead), 0.25% to pool liquidity, and 0.25% of the PLEA leg burned. The first 90 minutes after trading opens add a launch fee falling from 70% to 0% and cap buys at 5M PLEA.

## Contracts

| Contract | Role |
|---|---|
| `PLEA` | ERC-20, 1e9 supply. While the Cabal lives, PLEA leaves a wallet only through the gate. |
| `CabalGate` | Pleas, the Intake request and callback, appeals, sells, and the dead-man (`cabalAlive()` is computed, never stored). |
| `Seasons` | Points, leaderboard, `closeSeason` payouts, the final flush to the buy wall. |
| `Laureates` | ERC-721 for the top 5 pleas of each season; display names (`setName`). |
| `PleaHook` | The only liquidity provider (fork of POOL4's CappedBurnHook, IMD side): fees, cap/trim burns, IMD buy wall. Deployed after launch. |
| `PleaLaunch` | Registers the contracts at launch and commits to the hook's init code; `deployHook(salt, initCode)` and `seed()` afterwards. |
| `PleaDistributor` | Merkle claims for the 10% swarm share. |

The season length and the dead-man are constructor values so a testnet can run a fast clock. On Ethereum mainnet the gate refuses anything below 15 days and 33 hours.

## Build and test

Foundry 1.8.3:

```
forge build
forge test
```

`launch.json` is the Sepolia launch (fast clock: 1 day = 20 minutes; plea timings stay real). After the launch:

1. `forge script script/MineSalt.s.sol --rpc-url $RPC --private-key $KEY --broadcast` with `LAUNCH`, `POOL_MANAGER`, `IMD`, `STACKER`, `SEASONS` and `CREDIT_GAS` set: mines the hook salt and calls `deployHook`.
2. `PleaLaunch.seed()` opens trading (the owner any time, anyone after `START`).

## Notes

- The oracle callback has 200k gas, so it stores the score only. Points are recorded by `Seasons.record(pleaId)` (anyone) or by `closeSeason`, which takes a list of plea ids; a season can be closed one hour after it ends.
- On the very first buy after trading opens the PoolManager may hold no IMD yet, so that trade's cashback, owner and prize shares go to pool liquidity instead.

## Credits

PLEA is inspired by **TokenWorks** and their CabalCoin (2025), the original "plead to the Cabal to sell" token. Thank you for the idea.
