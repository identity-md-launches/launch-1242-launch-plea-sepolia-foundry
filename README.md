# PLEA

A sell-gated meme token: buying is open, selling needs a plea approved by the IdentityMD oracle panel ("the Cabal").

This repository holds **PLEA v10** (Seasons: 15-day seasons with a top-10 leaderboard, 30-day eras with a Cabal mood each, ransom revival, Laureate NFTs) and later versions (v11, v12, …). It is launched through the IMD swarm from this repo (`launch.open` with `repoUrl` + `baseCommit`).

**Status:** starting point only. `src/` and `test/` are PLEA v2's audited code (IMD launch #1148, https://github.com/identity-md-launches/launch-1148-build-plea-sepolia-test, commit `1ef27b4`), copied as the base for v10. v10 changes are not written yet.

Build: Foundry 1.8.3, `forge build && forge test`.
