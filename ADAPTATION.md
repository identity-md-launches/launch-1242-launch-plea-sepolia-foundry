# PLEA launch adaptation

The imported project supports the requested six-contract launch. The initial accepted adaptation fixed replay and ranking defects, as recorded below. This revision adds the reproduced corrections described in the revision section; it retains those accepted fixes. The supplied `launch.json`, constructor signatures, deployment order, ownership model, scripts, dependencies and build configuration remain unchanged. No network deployment or wallet access was performed.

## Initial accepted changes and evidence

| File | Change | Reason and regression coverage |
| --- | --- | --- |
| `src/CabalGate.sol` | Call `_consume(a.requestId)` immediately after signature verification, before applying a verdict. | Imported finding `086c805fd12655f8bfab0872e1eeca565df6daad11211583aed71ee5dbcfc63e`: one signed request settled multiple pending pleas. Reproduced against the original code. `test/OracleReplay.t.sol` checks both delivery orders, approvals and denials, reuse with a different signature for an appeal, rollback on invalid panel data, and no heartbeat update on replay. |
| `src/Seasons.sol` | Compare equal-scoring pleas by ascending plea ID, including the fifth-place cutoff. Track the IDs corresponding to each wallet's best three scores and use their maximum as the wallet tie key. Equal scores retain the older pleas. | Imported finding `a5955f8d0740357054380d721d1d7a9fbef929a9460638934ec2391de577a973`: reverse recording changed Laureate ranks and wallet prize ranks. Reproduced against the original code. Tracking the three selected IDs is necessary: a maximum over all historical submissions would retain discarded pleas, and using the last recorded ID would preserve the original bug. Scores, number of counted pleas and prize percentages are unchanged. |
| `test/OracleReplay.t.sol` | Add three replay regressions. | All three fail against the original gate and pass with consumption enabled. Uses the existing Intake mock's actual 200,000-gas callback path. |
| `test/SeasonRanking.t.sol` | Add five deterministic ranking/payout regressions and a randomized recording-order test. | All six fail against the original Seasons. Covers first/fifth Laureate slots, wallet ties, equal-score replacement, discarding a lower score, and actual prize/NFT recipients through `closeSeason`. The independent batch model sorts all 60 approved results from 12 wallets and compares the online top ten and top five after shuffling the recording order. |
| `test/LaunchManifest.t.sol` | Add an ordered CREATE2 factory rehearsal using the manifest's exact static arguments and locally resolved `$owner`/earlier-contract references. | Checks wiring, explicit ownership, empty external dependency addresses, init/runtime size limits, forbidden runtime opcodes, the same-block rehearsal fallback, rejection in a later block, the accepted deployment-block takeover assumption, and a later committed hook deployment with the fixed mint split. Test factories and mock addresses are test scaffolding only; they are not launch entries. |
| `ADAPTATION.md` | Add this record. | Required change list, finding dispositions, validation and remaining assumptions. |

## Oracle finding: scope of the fix

The repeated-use vulnerability reproduces and is fixed: an attestation's signed oracle request ID can produce at most one successful verdict in this gate, even if the Intake presents it under another intake ID or obtains a new signature for that same oracle request ID. Reverting any later validation also rolls back consumption.

**This is replay prevention, not full request binding.** The imported `OracleAttestation.sol` defines `a.requestId` as an off-chain UUID, while `IIntake.request` returns a separate intake identifier. No mapping between them is provided. `questionHash` is described as the hash of a canonical question document, but the canonicalization/schema is not supplied; the raw `question(id)` string and JSON `body(id)` cannot safely be assumed to be that document. The existing conformance vectors verify signatures/digests, not this canonicalization. Consequently, no guessed request-ID equality or question hash was introduced.

The trusted Intake must still bind the first delivery to the correct paid request. A malicious Intake could misapply one previously unused signed answer to one different pending plea; it can no longer reuse that request for additional verdicts. The imported audit's live-Intake exploit precondition remains unverified. Full independent binding needs the protocol's canonical question definition or an authenticated mapping of oracle UUIDs to intake IDs. This implements the audit's stated minimal mitigation while preserving the imported protocol ABI and request format.

## Other imported findings

- **Deployment-block registration (`04f018b8c98b61876a3340d610559ab2baeeb7518a5ed8422f2c55af78692aeb`): reproduced and intentionally retained.** `RehearsalManifestTest` deploys PLEA in `setUp`, so transient storage clears before each test. Registration succeeds in that deployment block, fails in the next block, and an arbitrary caller can win registration if PLEA is exposed before PleaLaunch. The requested real launch must deploy all six constructors atomically. `PLEA.setLauncher` still accepts either its transient deploy-transaction flag or its deployment block. No authorization redesign was made.
- **Post-launch setup and owner powers (`b684645e8bec4dbe31c4c8d444cf76aae41dbe1685f162c94c70660bd6efad86`): confirmed, retained as the specifically requested design.** Supply remains zero after the six constructors. The committed `deployHook` step mints exactly 1,000,000,000 PLEA once: 900,000,000 to the hook and 100,000,000 to the distributor; the later-deployment test verifies this and rejects a second hook deployment. The distributor owner selects its nonzero Merkle root once; claims cannot proceed without it. PLEA's owner has the add-only sender exemption, which does not let exempt wallets send directly to the PoolManager or gate. The hook's immutable owner receives the existing 0.5% IMD fee. PLEA and the distributor retain inherited ownership transfer/renunciation; the launch/hook owner is captured at construction. None of these accepted powers was removed or broadened.
- **Coverage (`379556c3b99638cd31f5b58cbf7e528fb2e66aa20960f867cd4d825acd9a7976`): a coverage statement, not a defect.** Reviewed all eight application source files, both interface files, scripts, README, manifest, the original tests/fixtures, and relevant vendored token/ownership/signature helpers. The supplied protected checks and pinned security references were read. The original suite passed 105 tests. The local factory test applies the protected floor's PUSH-aware forbidden-opcode scanner to all six deployed runtimes. No additional concrete application defect was established during this pass. The earlier contributor's live bytecode observations were not independently repeated and are not represented as new verification.

Neither actionable code finding was dismissed as non-reproducing. The unknown live Intake behavior and undefined question canonicalization are explicitly unresolved; the other three entries are launch assumptions or coverage information, not requests to redesign the project.

## Preserved launch contract

The six entries remain, in order: `PLEA`, `CabalGate`, `Seasons`, `Laureates`, `PleaDistributor`, `PleaLaunch`. Their nonpayable constructors have respectively 1, 7, 3, 1, 2 and 10 static arguments. Constructors only consult earlier entries (`Seasons` reads the gate's season length; `PleaLaunch` reads/registers PLEA), and do not require the external Sepolia dependencies to exist during the rehearsal. Application library calls remain internally linked.

All manifest addresses and numbers are preserved, including Sepolia chain ID 11155111, season 18,000 seconds, dead-man 118,800 seconds, panel 30, quorum 17, START 1791817200, credit gas 1300000, every plea timing/limit, every fee and every prize share. `PleaHook` is still deployed after launch by `PleaLaunch.deployHook(salt, initCode)`, with a salt mined off chain against the committed init-code hash. Trading is opened separately by `seed` under its existing owner/START rule.

`foundry.toml` remains intact: Solidity 0.8.26, Cancun, optimizer/via-IR settings, `bytecode_hash = "none"`, and `[lint] lint_on_build = false`. No dependency was added, fetched, removed or changed; the vendored `lib/` remains ordinary tracked files. No new launch token, proxy, administrative capability or manifest entry was added.

## Initial-round validation and limits

- Before production edits: `forge test` passed all 105 original tests; the new oracle and ranking suites then failed against the unchanged production code with the reproduced replay, tie-order and payout failures.
- After edits: the oracle regression suite, ranking regression suite and exact-manifest rehearsal all pass with the project's own configuration. Default Foundry fuzzing uses 32 runs per fuzz test.
- The exact-manifest factory test deploys successfully with no code at the Intake, oracle asset, IMD, PoolManager or Stacker addresses. Its measured deployment section uses 15,868,055 gas (including loading test bytecodes from storage), below its 16,777,216 limit. This is a local rehearsal, not the deployment service's final signed-transaction gas simulation.
- Final `forge build` succeeds with Foundry 1.8.3 and Solidity 0.8.26. Final `forge test` passes **119 tests across 15 suites, with 0 failures and 0 skips**, including all 105 original tests. The existing approval/denial stipend tests pass in both currency orientations and still enforce their stricter 120,000-gas bound within the 200,000-gas callback budget.
- Built constructor ABIs match all six manifest entries: nonpayable, supported static types, at most 16 arguments, and only backward contract references. All six artifacts have no unresolved library links. `git diff --check` passes.

| Contract | Runtime bytes | Init-code bytes including constructor arguments |
| --- | ---: | ---: |
| PLEA | 4,275 | 5,301 |
| CabalGate | 19,430 | 21,241 |
| Seasons | 7,966 | 8,504 |
| Laureates | 10,274 | 11,187 |
| PleaDistributor | 1,310 | 1,649 |
| PleaLaunch | 1,962 | 26,120 |

Every runtime is below 24,576 bytes and every complete init code is below 49,152 bytes. These are the application artifacts, not the larger test harnesses.

Testing uses local mocks for operational external dependencies; it does not prove live Intake, Stacker, token or PoolManager behavior. The existing suite covers both currency orientations and simulated normal/fast clocks; no wall-clock waiting or live broadcast was used. Hook liquidity math received no new exhaustive fuzz campaign. Slither, Mythril, explorer verification and live deployment were not run. The launch service still owns final transaction simulation and execution; the owner still supplies the Merkle root and the deployer still mines the hook salt.


## Revision: reproduced findings and changes

All 119 accepted tests passed on the starting tree. Before editing production code, the supplied proof was copied unchanged to `test/scratch/Proof_b4aab24b9b24.t.sol`: it failed with `owner fee not paid: 0 != 24630541871921182266`. Eight new regression cases per suite failed against the starting implementation with the reported cooldown, future-season payout, fee loss, appeal, recipient, cap-budget and dust-basis defects. Six additional scratch cases confirmed the advisory observations described below. The complete disposition of all 19 reports is in `.imd-responses.json`.

| File | Revision and reason | Coverage |
| --- | --- | --- |
| `src/CabalGate.sol` | Track `lastLapsedAt` from the approval's verdict time and apply the existing four-hour cooldown when clearing an expired sell window. Approved/lapsed pleas still score; abandoning the sell cannot accelerate submissions. | `AuditRevision.t.sol`: rejection after seven minutes and immediately before the cooldown boundary; acceptance at exactly four hours; preserved season score. |
| `src/CabalGate.sol` | Reset the original plea's `appealed` flag only when its appeal expires without a verdict. Clear stale requests before testing that flag on retry. A scored appeal still consumes the sole appeal, and retry still pays both fees within the original four-hour window. | Explicit no-verdict completion, automatic twenty-minute expiry, late callback, retry denial, and unchanged original deadline. |
| `src/CabalGate.sol` | Require the hook's tracked PLEA to cover the proposed amount before using its holding-time and profit/loss components. A tiny bought position no longer supplies those points to a much larger untracked distribution. | Distribution plus dust buy, immediately and after seven days; existing ordinary-buy scoring and sale tests. This does not invent a cost basis for gifted/distributed tokens. |
| `src/PleaHook.sol` | Restrict the documented unfunded-payout exception to the first buy. A later PoolManager shortage allocates ERC-6909 IMD claims directly to the owner, Seasons and trader. Count claims in the existing fee totals, emit `CashbackPaidClaims`, and reserve only the existing pool share for the wall. Normal funded cashback still goes through Stacker. | Supplied unchanged proof; exact fee conservation; holder-approved claim redemption; normal stacking on the next buy; real season prize redemption. |
| `src/PleaHook.sol` | Require buy recipient data even after Cabal death, for both exact-input and exact-output buys. | Empty data reverts and valid recipient data credits the buyer, without crediting the router. Free selling after death remains covered by the existing suite. |
| `src/PleaHook.sol` | Subtract `capDecayRemainder` from the available decay numerator. | The reported same-second two-buy sequence and randomized sequences checked against cumulative elapsed-time budget. The 300,000 PLEA/day rate and 900,000 floor are unchanged. |
| `src/Seasons.sol`, `src/interfaces/IPleaParts.sol`, `src/PleaHook.sol` | Account prize assets in season buckets. The hook calls `checkpoint()` in the fee-paying swap, including payments in claims. A close uses that season's fees plus unpaid rollover from earlier closes. Seasons redeems its IMD claims through a guarded PoolManager unlock callback before paying or flushing. | Real late-close regression; boundary timestamps; multiple delayed closes; ordinary-token and claim funding; failed-recipient rollover; conservation fuzzing; death at a boundary or mid-season; final flush; callback access checks. |
| `test/AuditRevision.t.sol`, `test/SeasonFunds.t.sol` | Add regressions and integration/accounting coverage for the changes above. Revision swap suites explicitly force opposite currency orderings. | Tests use the real vendored v4 PoolManager and local oracle/token/Stacker mocks. Funds-only tests isolate the leaderboard results to exercise accounting. |
| `test/Seasons.t.sol`, `test/SeasonRanking.t.sol` | Main-clock scoring fixtures now wait the real four-hour lapse cooldown. Five-hour ranking unit cases use approved-result mocks because four pleas from one wallet no longer fit that window. Direct test donations are checkpointed when made. | The existing assertions remain; new integration tests exercise two actual paced approvals within the manifest's five-hour season. No production timing was shortened for a test. |
| `README.md`, `ADAPTATION.md`, `.imd-responses.json` | Describe corrected behavior, claim payouts, donation accounting, evidence and report dispositions. | Required launch handoff and revision responses. |

### Season accounting details

`pot()` reports all held prize assets (ERC-20 IMD plus PoolManager IMD claims), including future seasons. A season's distributable budget is `seasonFees[season] + rollover` when it becomes the oldest open season. Every hook prize fee is checkpointed in the same swap, so neither a late closer nor an absent keeper can move later trading fees backwards. Bucketing and closing need no loop over elapsed seasons beyond the existing one-season-per-close API. Unpaid shares and payout rounding stay in rollover for the next close. The leaderboard, five Laureate slots, 60-point threshold and all prize percentages are unchanged.

An unsolicited ERC-20 or claim transfer cannot reveal its historical transfer timestamp to Seasons. Such donations are assigned when first observed by `checkpoint()`; a donor can transfer and checkpoint together. Closing also checkpoints, assigning previously unobserved assets to the current season, never to an already-ended earlier season. After death, new donations belong to the final season, or its remaining rollover if already closed. Claim redemption changes the form of assets, not their season. The final flush clears the accounting and can also flush later donations.

### Advisory decisions retained without redesign

- **Whole-order execution (`ee3aab4e…`): disputed as a defect.** The starting-tree reproduction reaches `PartialFill` and rolls back the entire sale, including token movement. `executeSell` explicitly promises the entire approved amount in one swap; the oracle fee pays for judgment and never guarantees liquidity. Adding partial fills or editable approved amounts would change that policy. The later basis-coverage correction prevents the report's dust-funded setup from opening that particular oversized plea, but does not change execution semantics.
- **Gross-cost loss score (`bfc69ac0…`): disputed as a defect.** The reported buy spends 50 IMD and its hourly-checkpoint value is about 48.673 IMD. Fees, the token burn and the hourly price explain a real shortfall against actual gross cost. Profit/loss points intentionally compare actual cost with checkpoint value. Even a neutral/non-loss position can earn nine points under the existing table, so the proposed expected score of 23 is not implied by this design. No fee exclusion or new loss threshold was introduced.
- **Recording deadline (`75b7c738…`): disputed as a defect.** An unrecorded approval is excluded once someone closes after the expressly documented one-hour grace. The holder or any other caller can record before then or include it in the close. The test confirms exclusion at the boundary. Reopening paid rankings or extending the fixed grace would redesign settlement.
- **External Stacker (`d970e4be…`): confirmed trust assumption.** A local impersonation demonstrates that its unlimited allowance covers retained wall IMD; this is not evidence that the live Stacker has an arbitrary-pull entry point. The accepted dependency allowance remains. Live dependency behavior was not independently verified in this revision.
- **Privileges and post-launch setup (`b1646eff…`, `04f018b8…`, `b684645e…`): confirmed accepted assumptions.** The owner exemptions, one-shot distributor root, immutable fee/seed beneficiary, signer dependency, deployment-block registration fallback and later fixed-supply hook initialization remain exactly as documented above. All six launch constructors must run atomically.
- **Intake request routing (`6af90e91…`): confirmed dependency assumption.** A malicious Intake can direct one unused answer to the wrong plea; a second delivery is rejected. The original repeated-use finding remains fixed by consumption. No canonical question schema or authenticated intake-ID/oracle-UUID mapping has been supplied, so none was guessed.
- **Cap economics (`831feb67…`): confirmed numerical observation.** `(initialCap - CAP_FLOOR) / CAP_DECAY_PER_DAY` is 2,996 whole days. That long horizon is part of the numbers the brief explicitly preserves; the fractional-budget correction changes no parameter.
- **Earlier audit coverage (`379556c3…`): coverage information, not a defect.** This revision independently ran local tests and read the affected source paths, protected floor, supplied proof and pinned references. It does not claim to have repeated the earlier contributor's live Sepolia bytecode checks.

### Revision validation

The project uses its original compiler, optimizer, Cancun settings, vendored dependencies and disabled build linter throughout. The exact six-constructor manifest rehearsal and the deployment-block fallback tests remain in the suite. No RPC, keys, broadcast, deployment, dependency installation, Slither or Mythril was used. Final `forge build` succeeds, including the deployment scripts. Final `forge test -vv` passes **158 tests across 20 suites, with no failures or skips**: **151 submitted tests across 18 suites**, plus the unchanged supplied proof and six scratch evidence cases. Default fuzzing remains 32 runs. The proof copy was compared byte-for-byte with its pinned input. Oracle callbacks use 58,694 gas for approval and 83,293 for denial in the existing stipend test, below its 120,000 bound and the Intake's 200,000 stipend.

The unchanged exact-manifest factory rehearsal passes all wiring, explicit-owner, opcode, init-size and runtime-size assertions. Its deployment section measures **16,622,688 gas**, including loading the test bytecodes from storage, below the existing 16,777,216 test bound. This remains a local rehearsal, not a claim about the service's final transaction simulation. The separate-constructor same-block tests and later committed hook deployment also pass.

| Contract | Final runtime bytes | Complete init-code bytes (arguments included) |
| --- | ---: | ---: |
| PLEA | 4,275 | 5,301 |
| CabalGate | 19,652 | 21,463 |
| Seasons | 10,199 | 10,786 |
| Laureates | 10,274 | 11,187 |
| PleaDistributor | 1,310 | 1,649 |
| PleaLaunch | 1,962 | 26,722 |

PleaHook's later-deployed runtime is 22,265 bytes. All six manifest artifacts retain the exact supported, nonpayable constructor ABIs with no unresolved links. A comparison against the starting revision confirms every source constant and the complete manifest/configuration/dependency paths are unchanged. `git diff --check` passes. `.imd-responses.json` parses with 19 distinct, complete finding responses. Remaining live-dependency and launch-owner assumptions are documented above; no live transaction was sent.
