# PLEA

A sell-gated meme token on Uniswap v4. Buying is open. Selling needs a plea approved by **the Cabal**: a panel of 30 IdentityMD oracle judges that scores each plea 0-45. While the Cabal lives, pleas also compete in **seasons** for prizes and Laureate NFTs. The live Sepolia deployment uses 5-hour seasons; mainnet requires at least 15 days. When the Cabal dies, PLEA trades freely forever.

Launched through the IMD swarm from this repository (`launch.open` with `repoUrl` + `baseCommit`). It builds on PLEA v2 (IMD launch #1148) and the v4 fixes.

## PLEA v10 website

The complete static export is in [`dist/`](dist/index.html), with Vite, React, TypeScript and viem source and the npm lockfile in [`web/`](web/). It includes Overview, Buy, Plead, Wall, plea permalinks, Seasons, Profile and Status. The previous site's source/export was absent from this checkout, so this delivery supplies them. This work deployed nothing, changed no contract source and did not publish a site. IdentityMD member-site hosting is closed.

Use Node 22.12+ (validated with Node 24.21.0 and npm 11.19.0):

```sh
cd web
npm ci
npm run dev
```

For a production rebuild and preview:

```sh
cd web
npm run typecheck
npm test
npm run build
npm run preview -- --port 4173
```

The build writes the repository-root `dist/`. To preview that export at a subpath, run `python3 -m http.server 4173` from the repository root and open `http://localhost:4173/dist/`. Serve over HTTP; `file://` does not support the module application.

To publish later, copy the **contents of `dist/`**, including `assets/`, the favicon, share image and license notices, to a static host. The host does not rebuild. Vite uses `base: './'`; pages use hash routes such as `#/plea/3`, so no server rewrites are needed. There is no configured hosting destination. Use HTTPS for a public wallet site. A host requiring absolute Open Graph image URLs can resolve `./og-image.png` against its chosen public URL.

### Live contracts and transactions

The site uses Sepolia chain 11155111 and indexes Gate/Seasons events from launch block **11885684**. The six addresses, ABI hashes, source commit and network parameters are preserved from the supplied deployment inputs in `web/src/deployment.json`. Task-supplied auxiliary addresses are in `contracts.ts`. Trading opened at the live `startedAt` value, **2026-10-10 17:02:24 UTC**; `START` is the later permissionless seed deadline, not the actual open time. All live fees, caps, clocks, supply, pool direction, cost basis, stacking and season state come from contract reads.

Public RPCs use viem fallback and batching. Visible pages refresh every 30 seconds. Event scans use adaptive ranges and a 12-block overlap. ABI hashes match the pinned source; normalized runtime bytecode for the six contracts and PleaHook, chain ID, PLEA references and auxiliary deployed code are checked before writes. A verification failure disables transactions.

One top-bar Connect uses an injected EIP-1193 wallet. Reads work without a wallet. Writes switch/add Sepolia as needed and show approvals, wallet confirmation, pending receipts and decoded errors. Every write supplies explicit gas: swaps use `ceil(estimate × 1.3)`, at least `max(2,600,000, creditGas + 1,300,000)`; others use `ceil(estimate × 1.5)`. The resulting transaction is simulated before sending. Account changes and stale data stop the action.

PoolSwapTest trades are exact input, derive direction from `pleaIsZero()` and always supply `abi.encode(wallet)` hook data. Since the hook delivers some output directly, previews measure actual balance changes with **eth_call-only state overrides** at the connected account. `web/simulation/BalancePreview.sol` is simulation bytecode; it is never deployed or sent in a transaction. The public RPC must support these overrides; a failed preview prevents trading. Approved sales compute `executeSell(minOut)` from the Gate's returned output, excluding plain-IMD cashback. PoolSwapTest has no minimum-output parameter; this limitation appears beside the plain buy/sell forms.

The Gate's byte rules and Laureates' name rules are mirrored in client validation. Oracle reasons/splits come from the public API. The Intake HTTP lookup currently lacks CORS headers, so its canonical oracle URL is resolved from the verified `Completed` event (or Gate verdict UUID), then fetched from the CORS-enabled oracle endpoint. Both API records are linked. Laureates render the live tokenURI SVG as an image; plea text and judge reasons are rendered as text. No private keys or service credentials are used.

### Validation and maintenance

The production build, explicit TypeScript check, 11 focused tests, live ABI/runtime verification and isolated-fork transaction checks passed. Browser review covered all seven pages plus a plea permalink at 360, 768 and 1280 px, light and dark. After fixes, all 48 combinations had no horizontal overflow, axe WCAG A/AA violations, undersized controls or console errors. The PLEA wordmark and Buy PLEA action are visible on the first screen at 390 px. `npx impeccable detect web/src web/index.html --json` returned no findings.

See [`artifacts/validation.md`](artifacts/validation.md) for commands, actual results, fixes, six-domain Better Interface coverage and limitations; [`DESIGN.md`](DESIGN.md) describes the final design. Wallet transactions were exercised only on an isolated fork through an injected provider. No live transaction or external oracle callback was commissioned. Native extension/mobile-wallet dialogs and screen-reader testing remain unperformed. Impeccable's URL scanner could not launch a usable browser in this environment; rendered review used the supplied real-browser tool and axe.

Useful checks from the repository root:

```sh
npm --prefix web run check:live
forge build --skip test --skip script
node web/scripts/abis.mjs
node web/scripts/check-runtime.mjs
node web/scripts/check-preview.mjs
```

The last three regenerate frontend ABI/runtime/simulation artifacts; rebuild afterwards. To repeat the browser review, install Chromium (`cd web && npx playwright install chromium`), serve the root directory, then run `npm --prefix web run check:browser`. It defaults to `http://127.0.0.1:4173/dist/`. `PLEA_QA_URL`, `PLEA_QA_RUN` and optional `PLEA_CHROME` select the served export, report name or browser executable.

For transaction regression, start an isolated Sepolia Anvil fork on `127.0.0.1:8545`, then run `web/node_modules/.bin/tsx web/scripts/check-fork.ts` from the root. Writes are fixed to localhost. The script impersonates existing holders locally, advances fork time instantly and restores expired plea windows in local storage to test approvals/appeals. The validation record describes this setup.

Only `web/package.json` and `web/package-lock.json` are frontend package files. Exclude `node_modules/` at every nesting level, caches and scratch outputs when packaging; none are delivered. Keep complete `dist/` alongside source and lockfile. Existing Foundry configuration and dependencies are unchanged.

## How it works

**Pleading.** A holder asks to sell up to 2.5M PLEA (at most 35% of their balance) with a plea of up to 280 bytes, and pays the 0.5 IMD oracle fee. The gate pays the IdentityMD Intake itself; the judges' signed score comes back through the Intake's callback. The contract computes a fact score (0-55) from the share sold, the buy-weighted holding time, profit or loss and the 24h price; the seller's **need** is 70 minus the fact score. A score at or above the need opens a 7-minute window to sell through the gate. An executed sale or lapsed approval means a 4-hour wait (from execution or the approval verdict, respectively). A denial also means a 4-hour wait, with one appeal (0.85 IMD, same or smaller amount) inside those 4 hours. A plea with no verdict expires after 20 minutes, or at once when the Intake reports the request finished without one. An unanswered appeal can be retried within the original appeal window, paying its fees again. Holding-time and profit/loss points require the hook-tracked position to cover the proposed sale.

**The dead-man.** The Cabal lives from the moment trading opens until 33 hours pass without a signed verdict. Then it is dead for good: no plea can be submitted, and every transfer restriction ends. There is no way back.

**Seasons.** Seasons run back to back from launch (5 hours on this Sepolia deployment, at least 15 days on mainnet); the last one ends when the Cabal dies. Every approved plea earns its score as points; each wallet's best three count. When a season ends, anyone calls `closeSeason`: the top 10 with at least 60 points are paid 25/18/14/11/9/7/6/4/3/3 % of that season's prize fees plus earlier rollover in IMD (unpaid shares roll forward), and the season's five best pleas become **Laureate** NFTs, rendered on chain. After the last season is closed, anything left in the pot goes to the buy wall.

**Fees** (every trade, allocated in the same swap): 0.5% cashback to the trader as staked IMD through imd/acc's Stacker, 0.5% to the owner, 0.25% to the prize pot (to pool liquidity once the Cabal is dead), 0.25% to pool liquidity, and 0.25% of the PLEA leg burned. The first 90 minutes after trading opens add a launch fee falling from 70% to 0% and cap buys at 5M PLEA.

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

`launch.json` is the Sepolia launch: 5-hour seasons for testing, the real 33-hour dead-man and real plea timings. After the launch:

1. `forge script script/MineSalt.s.sol --rpc-url $RPC --private-key $KEY --broadcast` with `LAUNCH`, `POOL_MANAGER`, `IMD`, `STACKER`, `SEASONS` and `CREDIT_GAS` set: mines the hook salt and calls `deployHook`.
2. `PleaLaunch.seed()` opens trading (the owner any time, anyone after `START`).

## Notes

- The oracle callback has 200k gas, so it stores the score only. Points are recorded by `Seasons.record(pleaId)` (anyone) or by `closeSeason`, which takes a list of plea ids; a season can be closed one hour after it ends.
- On the very first buy after trading opens the PoolManager may hold no IMD yet, so that trade's cashback, owner and prize shares go to pool liquidity instead. If a later buy exceeds the PoolManager's available IMD before input settlement, those shares are paid to their intended recipients as redeemable ERC-6909 IMD claims. Seasons redeems its claims when closing or flushing; owners and traders can redeem theirs through an approved PoolManager unlock caller. Funded cashback still uses Stacker, with the existing plain-IMD fallback if credit fails.
- Every prize fee is assigned to the trading season in the swap itself, so delayed closes cannot spend later seasons' fees. `pot()` includes all seasons' assets and claims. Direct donations are assigned when first checkpointed; call `Seasons.checkpoint()` immediately after donating to select the current season.
- Buy calls always provide `abi.encode(recipient)` in hook data, including after Cabal death, so cashback and cost basis do not accrue to the router.

## Credits

PLEA is inspired by **TokenWorks** and their CabalCoin (2025), the original "plead to the Cabal to sell" token. Thank you for the idea.
