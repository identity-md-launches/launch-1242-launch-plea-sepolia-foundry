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

New stateless fuzz tests use 256 runs. The four stateful campaigns each use 128 runs of depth 64,
with `fail-on-revert = true` and explicit target selectors. Expected failures are checked inside
handlers; unexpected reverts are failures, not discarded actions. Smoke tests exercise complete
trade/verdict/sell/rebalance/death and season-close/flush sequences.

| Stateful campaign | Independent properties |
| --- | --- |
| Distribution | All PLEA balances sum to supply; initial supply equals live supply plus tracked burns; distributor balance plus paid claims equals allocation plus donations; each bitmap bit matches its ghost claim; transfer/allowance effects and fixed wiring. |
| Trading, IMD first | Real v4 swaps, oracle submissions/verdicts, gate sells, free sells, funding, donations, rebalances, cashback pauses and time advances. Supply/burn conservation, quote conservation, actual fee receipts, cash reserve backing, ERC-6909 claim backing, and cap monotonicity/floor. |
| Trading, PLEA first | The same properties in the opposite currency order, with its own explicit inline invariant configuration. |
| Seasons and Laureates | Prize funding equals recipient balances plus pot plus wall; closes and payouts occur once; NFT supply/ownership survives transfers; online rankings match an independent batch-sort model; closed rankings never change. |

## Reproduced defect

**Low: fractional cap-decay budget can be reused by consecutive swaps.** In
`src/PleaHook.sol`, `_applyCap` records fractional time consumption in `capDecayRemainder`, but
calculates the next allowance from whole elapsed seconds without subtracting that remainder.
Two buys at the same timestamp can therefore exceed the 300,000 PLEA/day decay budget. The
excess is bounded by less than one second of decay, about 3.47223 PLEA.

The self-contained failing proof was run under `test/scratch/CapDecayProof.t.sol`, then preserved
in the `proof` field of the task's `.imd-findings.json` report. At 91 minutes after seeding, buying
with 1e12 quote wei and then 100e18 quote wei reduced the cap by
18958505549857848571824 PLEA wei, exceeding the elapsed-time maximum of
18958333333333333333333. The proof asserts the intended bound and fails on the current code.
It is not included as a passing test that endorses the excess. The delivered trading invariants
continue to check conservation and cap monotonicity independently of this reported defect.

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

## Final validation

- `forge build --offline --force`: clean compilation of 134 files succeeds with Solidity 0.8.26.
- `forge test --offline`: 184 tests pass across 25 suites, with zero failures or skips. This
  includes all 119 pre-existing tests and four invariant campaigns containing twelve invariant
  functions, with 32,768 handler calls and zero unexpected reverts.
- The standalone cap-decay proof fails at its intended rate-bound assertion; its exact tested
  source is preserved in the findings report and is absent from the passing suite.
- `git diff --check` passes. Scope checks confirm production sources, dependencies, manifest
  and configuration match the starting commit. No dependency was installed.
