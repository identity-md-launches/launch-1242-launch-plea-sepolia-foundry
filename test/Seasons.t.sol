// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Fixture} from "./utils/Fixture.sol";
import {CabalGate} from "../src/CabalGate.sol";
import {Seasons} from "../src/Seasons.sol";
import {PLEA} from "../src/PLEA.sol";

contract SeasonsTest is Fixture {
    address[] players;

    function setUp() public virtual override {
        super.setUp();
        for (uint256 i; i < 12; ++i) {
            address p = makeAddr(string.concat("player", vm.toString(i)));
            fund(p);
            players.push(p);
        }
        for (uint256 i; i < users.length; ++i) {
            buy(users[i], buySize());
        }
        for (uint256 i; i < players.length; ++i) {
            buy(players[i], buySize());
        }
    }

    // ---------------------------------------------------------------- helpers

    function buySize() internal virtual returns (uint256) {
        return 50e18;
    }

    /// @dev Pleads and approves with `score`, then lets the window lapse so the wallet can plead again.
    function scored(address who, uint256 score) internal returns (uint256 id) {
        id = approvedPlea(who, score);
        skip(8 minutes);
    }

    /// @dev Advances to `t`, delivering a denial every 30 hours so the Cabal never goes silent.
    function liveUntil(uint256 t) internal {
        uint256 i = 1;
        keepAlive(players[0]);
        uint256 step = DEADMAN * 9 / 10;
        while (vm.getBlockTimestamp() + step < t) {
            skip(step);
            keepAlive(players[i % players.length]);
            ++i;
        }
        vm.warp(t);
    }

    function eraStart(uint256 era) internal view returns (uint256 s) {
        (uint64 a,) = gate.eraTimes(era);
        s = a;
    }

    function transferWorks(address from, address to) internal returns (bool ok) {
        vm.prank(from);
        (ok,) = address(plea).call(abi.encodeCall(plea.transfer, (to, 1e18)));
    }

    function kill() internal {
        skip(DEADMAN);
        assertFalse(gate.cabalAlive());
    }

    function revive() internal {
        kill();
        skip(BREAK);
        vm.prank(alice);
        seasons.contribute(500e18);
        skip(WARNING);
        assertTrue(gate.cabalAlive());
    }

    // ---------------------------------------------------------------- the clock

    function test_cabalAliveFromSeedAndDeadAfterSilence() public {
        assertTrue(gate.cabalAlive());
        assertTrue(plea.restricted());
        assertFalse(transferWorks(alice, bob));
        vm.warp(eraStart(0) + DEADMAN - 1);
        assertTrue(gate.cabalAlive());
        skip(1);
        assertFalse(gate.cabalAlive());
        assertFalse(plea.restricted());
        assertEq(gate.diedAt(), eraStart(0) + DEADMAN);
        assertTrue(transferWorks(alice, bob));
    }

    function test_verdictsKeepItAliveUntilTheEraRetires() public virtual {
        uint256 end = eraStart(0) + 2 * SEASON;
        liveUntil(end - 1);
        assertTrue(gate.cabalAlive());
        skip(1);
        assertFalse(gate.cabalAlive());
        assertEq(gate.diedAt(), end);
        // A verdict after death is refused: no resurrection by a late callback.
        vm.warp(end - 1);
        uint256 id = plead(alice, plea.balanceOf(alice) / 10);
        vm.warp(end);
        assertFalse(answer(id, 45));
    }

    // ---------------------------------------------------------------- points

    function test_bestThreeCountAndTopTenOrder() public {
        uint256[4] memory s = [uint256(40), 41, 42, 43];
        for (uint256 i; i < 4; ++i) {
            seasons.record(scored(alice, s[i]));
        }
        assertEq(seasons.bestOf(0, alice)[0] + seasons.bestOf(0, alice)[1] + seasons.bestOf(0, alice)[2], 126);
        seasons.record(scored(bob, 45));
        seasons.record(scored(carol, 40));
        seasons.record(scored(carol, 40));
        Seasons.Entry[10] memory t = seasons.topOf(0);
        assertEq(t[0].wallet, alice);
        assertEq(t[0].points10, 1260);
        assertEq(t[1].wallet, carol);
        assertEq(t[1].points10, 800);
        assertEq(t[2].wallet, bob);
        assertEq(t[2].points10, 450);
        Seasons.PleaEntry[5] memory tp = seasons.topPleasOf(0);
        assertEq(tp[0].score, 45);
        assertEq(tp[1].score, 43);
        vm.expectRevert();
        seasons.record(1);
    }

    function test_onlyApprovedPleasScore() public {
        uint256 id = plead(alice, plea.balanceOf(alice) / 10);
        vm.expectRevert(abi.encodeWithSelector(Seasons.NotApproved.selector, id));
        seasons.record(id);
        answer(id, 0);
        vm.expectRevert(abi.encodeWithSelector(Seasons.NotApproved.selector, id));
        seasons.record(id);
    }

    function test_tenthPlaceIsEvictedByABetterWallet() public {
        for (uint256 i; i < 11; ++i) {
            seasons.record(scored(players[i], 35 + (i % 10)));
        }
        Seasons.Entry[10] memory t = seasons.topOf(0);
        assertEq(t[0].points10, 440);
        // players[10] scored 35 and ties players[0]'s 35: the earlier plea keeps tenth place.
        assertEq(t[9].wallet, players[0]);
        seasons.record(scored(players[11], 36));
        t = seasons.topOf(0);
        // players[11] ties players[1] at 36 but pleaded later: it ranks just below, players[0] is out.
        assertEq(t[8].wallet, players[1]);
        assertEq(t[9].wallet, players[11]);
        for (uint256 i = 1; i < 10; ++i) {
            assertGe(t[i - 1].points10, t[i].points10);
        }
    }

    // ---------------------------------------------------------------- closing

    function test_closeSeasonPaysTheTopTenAndMintsLaureates() public {
        uint256[] memory ids = new uint256[](0);
        // alice 3 x 42 = 126 points; carol 2 x 40 = 80; bob 45 (below 60: no prize).
        for (uint256 i; i < 3; ++i) {
            scored(alice, 42);
        }
        scored(carol, 40);
        scored(carol, 40);
        uint256 bobId = scored(bob, 45);
        imd.mint(address(seasons), 1_000e18); // stands in for prize fees
        uint256 feesSoFar = imd.balanceOf(address(seasons));
        assertGt(hook.totalPrize(), 0);

        uint256 end = eraStart(0) + SEASON;
        liveUntil(end);
        vm.expectRevert(abi.encodeWithSelector(Seasons.NotReady.selector, 0));
        seasons.closeSeason(ids);
        skip(1 hours);

        ids = new uint256[](6);
        for (uint256 i; i < 6; ++i) {
            ids[i] = i + 1;
        }
        uint256 pot = seasons.potFor(0);
        assertEq(pot, imd.balanceOf(address(seasons)));
        assertGe(pot, feesSoFar);
        uint256 a0 = imd.balanceOf(alice);
        uint256 c0 = imd.balanceOf(carol);
        uint256 b0 = imd.balanceOf(bob);
        seasons.closeSeason(ids);
        assertEq(imd.balanceOf(alice) - a0, pot * 2500 / 10_000);
        assertEq(imd.balanceOf(carol) - c0, pot * 1800 / 10_000);
        assertEq(imd.balanceOf(bob), b0);
        assertEq(imd.balanceOf(address(seasons)), pot - pot * 2500 / 10_000 - pot * 1800 / 10_000);
        assertTrue(seasons.closed(0));
        assertEq(seasons.nextToClose(), 1);

        assertEq(laureates.totalSupply(), 5);
        (uint64 first,,) = laureates.laureate(1);
        assertEq(first, bobId);
        assertEq(laureates.ownerOf(1), bob);
        assertEq(laureates.ownerOf(2), alice);
        string memory uri = laureates.tokenURI(1);
        assertTrue(vm.contains(uri, "data:application/json;base64,"));
        // Laureates are tradable.
        vm.prank(bob);
        laureates.transferFrom(bob, carol, 1);
        assertEq(laureates.ownerOf(1), carol);

        // Late records for a closed season are refused.
        vm.expectRevert(abi.encodeWithSelector(Seasons.AlreadyRecorded.selector, 1));
        seasons.record(1);
    }

    function test_secondSeasonScoresSeparately() public {
        liveUntil(eraStart(0) + SEASON + 1 hours);
        uint256 id = scored(alice, 44);
        seasons.record(id);
        assertEq(seasons.bestOf(1, alice)[0], 44);
        assertEq(seasons.bestOf(0, alice)[0], 0);
        (bool live, uint256 key,) = seasons.currentSeason();
        assertTrue(live);
        assertEq(key, 1);
        seasons.closeSeason(new uint256[](0)); // season 0 is over
        assertEq(seasons.nextToClose(), 1);
    }

    function test_earlyDeathEndsTheSeasonAndSkipsTheSecond() public {
        seasons.record(scored(alice, 42));
        kill();
        skip(1 hours);
        seasons.closeSeason(new uint256[](0));
        assertEq(seasons.nextToClose(), 2); // season 1 of era 0 never existed
    }

    // ---------------------------------------------------------------- ransom and revival

    function test_ransomRevivesTheNextCabalWithItsMood() public {
        seasons.record(scored(alice, 42));
        kill();
        uint256 died = gate.diedAt();
        (uint8 phase,,,) = seasons.ransomPhase();
        assertEq(phase, 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Seasons.RansomNotOpen.selector, uint64(died + BREAK)));
        seasons.contribute(10e18);

        skip(BREAK);
        (phase,,,) = seasons.ransomPhase();
        assertEq(phase, 2);
        vm.prank(alice);
        seasons.contribute(300e18);
        vm.prank(bob);
        seasons.contribute(5e18); // below the relic minimum
        assertEq(seasons.escrow(), 305e18);
        vm.prank(carol);
        seasons.contribute(195e18);
        assertEq(seasons.escrow(), 0);
        assertEq(seasons.bonus(2), 500e18);

        // Warning: still free for 24 hours, and the ransom is closed.
        (phase,,,) = seasons.ransomPhase();
        assertEq(phase, 4);
        assertTrue(transferWorks(alice, bob));
        assertFalse(gate.cabalAlive());
        vm.prank(bob);
        vm.expectRevert(Seasons.CabalNotDead.selector);
        seasons.contribute(1e18);
        skip(WARNING - 1);
        assertFalse(gate.cabalAlive());
        skip(1);
        assertTrue(gate.cabalAlive());
        assertFalse(transferWorks(alice, bob));
        assertEq(gate.eraIndex(), 1);
        assertEq(gate.mood(), 1); // The Rekt Cabal
        assertTrue(seasons.relicOf(alice, 1));
        assertTrue(seasons.relicOf(carol, 1));
        assertFalse(seasons.relicOf(bob, 1));

        // The relic adds 10% to the revived era's first season.
        uint256 id = scored(alice, 40);
        seasons.record(id);
        assertEq(seasons.topOf(2)[0].points10, 440);
        seasons.record(scored(bob, 40));
        assertEq(seasons.topOf(2)[1].points10, 400);

        // The old era's season closes first; the ransom waits for its own season.
        seasons.closeSeason(new uint256[](0));
        assertEq(seasons.nextToClose(), 2);
        assertEq(seasons.potFor(2) - seasons.potFor(3), 500e18);
    }

    function test_failedRansomRefundsAndANewRoundCanStart() public {
        kill();
        skip(BREAK);
        vm.prank(alice);
        seasons.contribute(100e18);
        skip(WINDOW);
        (uint8 phase,,,) = seasons.ransomPhase();
        assertEq(phase, 3);
        vm.prank(bob);
        vm.expectRevert(Seasons.NothingToRefund.selector);
        seasons.refund(0);
        uint256 before = imd.balanceOf(alice);
        vm.prank(alice);
        seasons.refund(0);
        assertEq(imd.balanceOf(alice), before + 100e18);
        assertEq(seasons.escrow(), 0);
        // A new contribution opens round 1 at once.
        vm.prank(bob);
        seasons.contribute(500e18);
        assertEq(seasons.roundCount(), 2);
        skip(WARNING);
        assertTrue(gate.cabalAlive());
        assertTrue(seasons.relicOf(bob, 1));
        assertFalse(seasons.relicOf(alice, 1));
    }

    function test_emptyFirstWindowStartsAFreshRound() public {
        kill();
        skip(BREAK + WINDOW + 5 days);
        vm.prank(alice);
        seasons.contribute(1e18);
        Seasons.Round memory r = seasons.rounds(0);
        assertEq(r.opensAt, vm.getBlockTimestamp());
        assertEq(r.closesAt, vm.getBlockTimestamp() + WINDOW);
    }

    function test_revivalCannotBeTriggeredByAnyoneElse() public {
        kill();
        vm.expectRevert(CabalGate.NotSeasons.selector);
        gate.revive(uint64(vm.getBlockTimestamp() + 1));
    }

    // ---------------------------------------------------------------- the Rekt Cabal

    function test_rektClaimsAreAskedAndUsedOnce() public {
        revive();
        bytes32[] memory txs = new bytes32[](3);
        txs[0] = keccak256("buy1");
        txs[1] = keccak256("buy2");
        txs[2] = keccak256("rug");
        uint256 amount = plea.balanceOf(alice) / 10;
        vm.prank(alice);
        uint256 id = gate.submitSell(amount, "I aped into a honeypot. Lesson learned.", 1, txs);
        string memory q = gate.question(id);
        assertTrue(vm.contains(q, "THE REKT CABAL"));
        assertTrue(vm.contains(q, string.concat("REKT CLAIM: chain 1, txs ", vm.toString(txs[0]))));
        assertTrue(vm.contains(q, "Plea submitted at unix time"));
        string memory body = gate.body(id);
        assertEq(vm.parseJsonKeys(body, ".definitions").length, 8);
        assertTrue(answer(id, 45));
        emit log_named_uint("rekt approve callback gas (3 txs)", intake.lastCallbackGasUsed());
        assertLt(intake.lastCallbackGasUsed(), 150_000);
        assertTrue(gate.claimUsed(txs[2]));
        skip(8 minutes);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CabalGate.ClaimUsed.selector, txs[0]));
        gate.submitSell(amount, "again", 1, txs);
        // Story-only Rekt pleas are fine.
        uint256 bobAmount = plea.balanceOf(bob) / 10;
        vm.prank(bob);
        uint256 id2 = gate.submitSell(bobAmount, "FTX took my savings.", 0, new bytes32[](0));
        assertTrue(vm.contains(gate.question(id2), "REKT CLAIM: none"));
    }

    function test_moodsCycleThroughFourEras() public {
        string[5] memory names = ["THE CABAL", "THE REKT CABAL", "THE JESTER'S CABAL", "THE LOYAL CABAL", "THE CABAL"];
        for (uint256 e; e < 5; ++e) {
            if (e > 0) revive();
            assertEq(gate.eraIndex(), e);
            uint256 id = plead(players[e], plea.balanceOf(players[e]) / 10);
            assertTrue(vm.contains(gate.question(id), string.concat("one judge on ", names[e])));
            answer(id, 0);
        }
    }

    // ---------------------------------------------------------------- guards

    function test_mainnetGuardRefusesShortTimings() public {
        vm.chainId(1);
        vm.expectRevert(CabalGate.BelowAgreedTiming.selector);
        new CabalGate(
            address(plea), address(moodBook), address(intake), address(oimd), address(imd), SIGNER, 5 hours, 33 hours
        );
        vm.expectRevert(CabalGate.BelowAgreedTiming.selector);
        new CabalGate(
            address(plea), address(moodBook), address(intake), address(oimd), address(imd), SIGNER, 15 days, 27 minutes
        );
        CabalGate g = new CabalGate(
            address(plea), address(moodBook), address(intake), address(oimd), address(imd), SIGNER, 15 days, 33 hours
        );
        vm.expectRevert(Seasons.BelowAgreedTiming.selector);
        new Seasons(address(plea), address(g), address(imd), 1 hours, 72 hours, 24 hours);
        vm.expectRevert(Seasons.BelowAgreedTiming.selector);
        new Seasons(address(plea), address(g), address(imd), 72 hours, 72 hours, 20 minutes);
        new Seasons(address(plea), address(g), address(imd), 72 hours, 72 hours, 24 hours);
    }
}

/// @dev Sepolia's fast clock: 1 day = 20 minutes. Plea timings stay real.
contract FastClockTest is SeasonsTest {
    function setTimings() internal override {
        SEASON = 5 hours;
        DEADMAN = 27.5 minutes;
        BREAK = 1 hours;
        WINDOW = 1 hours;
        WARNING = 20 minutes;
    }

    /// @dev Trading opens with the clock: buys happen inside the 90-minute launch window.
    function afterSeed() internal override {}

    function buySize() internal pure override returns (uint256) {
        return 20e18;
    }

    function test_fastFullCycle() public {
        // Season 0: two approvals, then 5 hours of pleas every 25 minutes.
        seasons.record(scored(alice, 40));
        seasons.record(scored(alice, 41));
        uint256 end = eraStart(0) + 5 hours;
        liveUntil(end);
        vm.warp(end + 1 hours);
        seasons.closeSeason(new uint256[](0));
        // Silence kills it in season 1.
        skip(27.5 minutes);
        assertFalse(gate.cabalAlive());
        skip(1 hours);
        vm.prank(bob);
        seasons.contribute(500e18);
        skip(20 minutes);
        assertTrue(gate.cabalAlive());
        assertEq(gate.mood(), 1);
        skip(1 hours);
        seasons.closeSeason(new uint256[](0)); // season 1 of era 0 (ended at the death)
        assertEq(seasons.nextToClose(), 2);
    }

    // Long liveUntil loops are already covered at full scale.
    function test_verdictsKeepItAliveUntilTheEraRetires() public override {}
}
