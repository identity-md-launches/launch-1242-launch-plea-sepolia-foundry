# Independent test contribution

Production contracts, `launch.json`, dependencies and Foundry configuration are unchanged. The
existing exact-manifest deployment and rehearsal tests remain in place. New operational tests use
5-hour seasons, the 33-hour dead-man and a 1,300,000-gas Stacker credit budget. Both AMM currency
orders are explicitly constructed and checked in the fixture.

## Added coverage

| Suite | Checks |
| --- | --- |
| `DistributorAdversarial.t.sol` | Root authority and immutability; altered leaf/proof rejection; relayed claims; bitmap indices 0, 1, 254, 255, 256, 257, 65535 and uint256 max; full and zero allocations; failed payout rollback and retry. |
| `GateAdversarial.t.sol` | Pending, execution, appeal, cooldown and dead-man boundaries; oracle signature/domain/panel/type/range/time failures; no consumption or heartbeat changes on rejection; slippage and fee-transfer rollback; UTF-8 rejection and JSON round trips; callback authorization. |
| `HookAdversarial.t.sol` | Callback/pool/liquidity authorization; zero and one-wei buys; launch fee/cap boundaries; failed reserve funding; keeper work/cooldown; actual credit gas and exhausted-credit fallback; partial-fill cash and ERC-6909 refunds; exact-output buys after death; no-profit round trips including cashback. |
| `SeasonAdversarial.t.sol` | Close grace and batch rollback; duplicate/denied/late records; blocked prize recipients returning false or reverting; minimum points, rounding dust and final flush; NFT mint/transfer authorization; names and JSON/SVG escaping. |

The adversarial stateless fuzz suites use 256 runs. The four stateful campaigns each use 128 runs of depth 64,
with `fail-on-revert = true` and explicit target selectors. Expected failures are checked inside
handlers; unexpected reverts are failures, not discarded actions. Smoke tests exercise complete
trade/verdict/sell/rebalance/death and season-close/flush sequences.

| Stateful campaign | Independent properties |
| --- | --- |
| Distribution | All PLEA balances sum to supply; initial supply equals live supply plus tracked burns; distributor balance plus paid claims equals allocation plus donations; each bitmap bit matches its ghost claim; transfer/allowance effects and fixed wiring. |
| Trading, IMD first | Real v4 swaps, oracle submissions/verdicts, gate sells, free sells, funding, donations, rebalances, cashback pauses, claim redemptions and time advances. Supply/burn conservation, quote conservation, cash/claim fee receipts, backing of all beneficiaries' claims, cap monotonicity/floor and elapsed-time decay budget. |
| Trading, PLEA first | The same properties in the opposite currency order, with its own explicit inline invariant configuration. |
| Seasons and Laureates | Cash and claim funding equals recipient balances plus pot plus wall; each season spends only its funding plus previous unpaid shares; delayed donations are attributed when observed; redemptions preserve exact backing; closes and payouts occur once; NFT supply/ownership survives transfers; online rankings match an independent batch-sort model; closed rankings never change. |

## Previously reported defect, now fixed

**Low: fractional cap-decay budget could be reused by consecutive swaps.** In the previous
implementation, `_applyCap` recorded fractional time consumption in `capDecayRemainder`, but
calculated the next allowance from whole elapsed seconds without subtracting that remainder.
Two buys at the same timestamp could therefore exceed the 300,000 PLEA/day decay budget. The
excess is bounded by less than one second of decay, about 3.47223 PLEA.

In the previous round, the self-contained failing proof was run under
`test/scratch/CapDecayProof.t.sol`, then preserved in that task's `.imd-findings.json` report.
At 91 minutes after seeding, buying
with 1e12 quote wei and then 100e18 quote wei reduced the cap by
18958505549857848571824 PLEA wei, exceeding the elapsed-time maximum of
18958333333333333333333. The proof asserted the intended bound and failed on that implementation.
The accepted implementation revision subtracts the remainder from the available budget. Its
regressions in `AuditRevision.t.sol` remain intact. The trading invariants now additionally check
the cumulative elapsed-time bound and fractional consumption identity after every random action
in both currency orders; they no longer omit this property as an unresolved finding.

## Test revision for the accepted fixes

The original suites are retained. Targeted changes align them with the accepted implementation:

- A lapsed approval still rejects execution after seven minutes, but a replacement submission must
  wait four hours from its verdict. Failed submissions preserve pending state and oracle fees.
- Season fixtures use the real local v4 PoolManager now that `pot()` includes claims. Donations
  intended for an earlier season are checkpointed when made. Existing payout assertions remain.
- The season handler tracks funding inputs independently of production balances, including
  unobserved donations, claim funding before settlement, late closes, rollover and post-flush
  donations. It compares the ledger with each on-chain bucket and checks claim backing.
- The trading handler accounts for claim payouts even with Stacker paused, redeems claims with
  holder approval, and checks all fee recipients and cap decay. Deterministic smoke cases ensure
  the new claim and delayed-close paths are exercised even if a random sequence misses them.

## Limits

Operational tests use local quote, Intake and Stacker doubles with the real application
contracts and real v4 PoolManager. The season campaign isolates rankings/payouts using a
controllable verdict source and a wall funding sink; the trading campaigns separately exercise
the actual gate and hook. This does not verify live Sepolia dependency behavior, oracle question
canonicalization or first-delivery request binding. The pre-existing report in `ADAPTATION.md`
describes those request-binding and atomic-deployment trust assumptions. No new assumption
about that missing protocol mapping is asserted here.

There are no forks, environment mutations, network-dependent tests, FFI calls or broadcasts.
The owner-selected Merkle root remains a post-launch operational responsibility; test roots
and actors are test data, not changes to the launch manifest.

## Previous-round validation

- `forge build --offline --force`: clean compilation of 134 files succeeds with Solidity 0.8.26.
- `forge test --offline`: 184 tests pass across 25 suites, with zero failures or skips. This
  includes all 119 pre-existing tests and four invariant campaigns containing twelve invariant
  functions, with 32,768 handler calls and zero unexpected reverts.
- The standalone cap-decay proof fails at its intended rate-bound assertion; its exact tested
  source is preserved in the findings report and is absent from the passing suite.
- `git diff --check` passes. Scope checks confirm production sources, dependencies, manifest
  and configuration match the starting commit. No dependency was installed.

## Revision validation

- `forge build --offline --out test/scratch/out --cache-path test/scratch/cache` passes. The
  initial clean build compiled 136 files; the revised test files also compile successfully.
- `forge test --offline --out test/scratch/out --cache-path test/scratch/cache` passes **219 tests
  across 28 suites**, with zero failures or skips. This includes all four invariant campaigns
  (128 runs, depth 64, 32,768 total handler calls, zero unexpected reverts), their twelve
  invariant functions, the exact-manifest launch rehearsal and the accepted audit regressions.
- New claim-redemption smoke cases run with both live and paused Stacker behavior and both
  currency orders. The boolean fuzz cases retain the repository's default 32 runs; the existing
  adversarial fuzz suites retain their inline 256-run configuration.
- `git diff --check` passes. Only this report and four existing test files changed. Sources,
  scripts, manifest, dependencies and configuration match the starting commit. Build artifacts
  and logs are confined to disposable `test/scratch/`; no dependency was added.
- No new contract defect was established in this revision. The remaining live-dependency and
  request-binding limits above still apply; these local tests do not verify Sepolia services.
