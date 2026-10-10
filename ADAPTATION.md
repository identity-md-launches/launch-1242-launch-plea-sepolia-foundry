# PLEA launch adaptation

The imported project already supports the requested six-contract launch. Production changes are limited to the two reproduced audit defects below. The supplied `launch.json`, constructor signatures, deployment order, ownership model, scripts, hook, dependencies and build configuration are unchanged. No network deployment or wallet access was performed.

## Changes and evidence

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

## Validation and limits

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
