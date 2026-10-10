# PLEA

A sell-gated meme token on Uniswap v4. Buying is open. Selling needs a plea approved by **the Cabal**: a panel of 30 IdentityMD oracle judges that scores each plea 0-45. This repository holds **PLEA v10 (Seasons)**, launched through the IMD swarm from this repo (`launch.open` with `repoUrl` + `baseCommit`). It builds on PLEA v2 (IMD launch #1148).

## How it works

**Pleading.** A holder asks to sell up to 2.5M PLEA (at most 35% of their balance) with a plea of up to 280 bytes, and pays the 0.5 IMD oracle fee. The gate pays the IdentityMD Intake itself; the judges' signed score comes back through the Intake's callback. The contract computes a fact score (0-55) from the share sold, the buy-weighted holding time, profit or loss and the 24h price; the seller's **need** is 70 minus the fact score. A score at or above the need opens a 7-minute window to sell through the gate. A denial means a 4-hour wait, with one appeal (0.85 IMD, same or smaller amount) inside those 4 hours. A plea with no verdict expires after 20 minutes, or at once when the Intake reports the request finished without one.

**Eras and moods.** Each Cabal (an era) lives two seasons. Its mood follows a fixed cycle: The Classic Cabal, The Rekt Cabal (pleas from people who lost money to scams, with optional on-chain proof), The Jester's Cabal, The Loyal Cabal. A Cabal dies early if 33 hours pass without a signed verdict. While a Cabal lives, PLEA can only leave a wallet through the gate; when it dies, PLEA trades freely.

**Seasons.** Every approved plea earns its score as points; each wallet's best three count. When a season ends (15 days, or earlier if its Cabal dies), anyone calls `closeSeason`: the top 10 with at least 60 points are paid 25/18/14/11/9/7/6/4/3/3 % of the prize pot in IMD (unpaid shares roll over), and the season's five best pleas become **Laureate** NFTs, rendered on chain.

**Ransom.** After a Cabal dies, PLEA trades freely for 72 hours. Then the ransom opens: if holders put 500 IMD in within 72 hours, a 24-hour warning starts and the next Cabal (with the next mood) returns. The ransom becomes that season's extra prizes, and every contributor of at least 6 IMD holds a soulbound relic worth +10% on that season's points. If the target is missed, contributors take their IMD back and anyone can start a new round.

**Fees** (every trade, paid in the same swap): 0.5% cashback to the trader as staked IMD through imd/acc's Stacker, 0.5% to the owner, 0.25% to the prize pot, 0.25% to pool liquidity, and 0.25% of the PLEA leg burned. The first 90 minutes after trading opens add a launch fee falling from 70% to 0% and cap buys at 5M PLEA.

## Contracts

| Contract | Role |
|---|---|
| `PLEA` | ERC-20, 1e9 supply. Its transfer rule switches on while a Cabal lives. `registerExit(pool)` lets genuine Uniswap v2/v3 pools send PLEA (LP exits, buys) but never receive it from wallets. |
| `CabalGate` | Pleas, the Intake request and callback, appeals, sells, and the era clock (`cabalAlive()` is computed, never stored). |
| `MoodBook` | The four Cabals' question wording and definitions (constants). |
| `Seasons` | Points, leaderboard, `closeSeason` payouts, ransom rounds, refunds, relics. |
| `Laureates` | ERC-721 for the top 5 pleas of each season; display names (`setName`). |
| `PleaHook` | The only liquidity provider (fork of POOL4's CappedBurnHook, IMD side): fees, cap/trim burns, IMD buy wall. Deployed after launch. |
| `PleaLaunch` | Registers the contracts at launch and commits to the hook's init code; `deployHook(salt, initCode)` and `seed()` afterwards. |
| `PleaDistributor` | Merkle claims for the 10% swarm share. |

Timings (season, dead-man, break, ransom window, warning) are constructor values so a testnet can run a fast clock. On Ethereum mainnet the constructors refuse anything below 15 days, 33 hours, 72 hours, 72 hours and 24 hours.

## Build and test

Foundry 1.8.3:

```
forge build
forge test
```

`launch.json` is the Sepolia launch (fast clock: 1 day = 20 minutes; plea timings stay real). After the launch:

1. `forge script script/MineSalt.s.sol --rpc-url $RPC --private-key $KEY --broadcast` with `LAUNCH`, `POOL_MANAGER`, `IMD`, `STACKER`, `SEASONS` and `CREDIT_GAS` set: mines the hook salt and calls `deployHook`.
2. `PleaLaunch.seed()` opens trading (the owner any time, anyone after `START`).

## Known limits

- PLEA held as ERC-6909 claims inside the Uniswap v4 PoolManager (only possible while trading is free) can still be spent in a hookless v4 pool after a Cabal returns. The gate cannot see inside the PoolManager.
- The oracle callback has 200k gas, so it stores the score only. Points are recorded by `Seasons.record(pleaId)` (anyone) or by `closeSeason`, which takes a list of plea ids; a season can be closed one hour after it ends.
- On the very first buy after trading opens the PoolManager holds no IMD yet, so that trade's cashback, owner and prize shares go to pool liquidity instead.
