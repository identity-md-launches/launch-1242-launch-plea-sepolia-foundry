// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PLEA} from "src/PLEA.sol";
import {Seasons} from "src/Seasons.sol";
import {Laureates} from "src/Laureates.sol";
import {PleaDistributor} from "src/PleaDistributor.sol";
import {MockIMD} from "./utils/Mocks.sol";
import {SeasonResults, SeasonWallSink, SeasonModel} from "./utils/SeasonModel.sol";

contract SeasonHandler is Test {
    Seasons public seasons;
    Laureates public laureates;
    SeasonResults public results;
    SeasonWallSink public wall;
    MockIMD public imd;
    address[12] public actors;
    SeasonModel.Approval[] internal approvals;
    mapping(uint256 => bytes32) public frozenRankings;
    uint256 public funded;
    uint256 public paid;
    uint256 public flushed;
    uint256 public minted;
    uint256 public closes;

    constructor(
        Seasons seasons_,
        Laureates laureates_,
        SeasonResults results_,
        SeasonWallSink wall_,
        MockIMD imd_,
        address[12] memory actors_
    ) {
        seasons = seasons_;
        laureates = laureates_;
        results = results_;
        wall = wall_;
        imd = imd_;
        actors = actors_;
    }

    function approvePlea(uint256 actorSeed, uint256 scoreSeed, bool recordNow) external {
        if (results.diedAt() != 0) return;
        uint256 id = approvals.length + 1;
        uint256 season = (vm.getBlockTimestamp() - results.startedAt()) / 18000;
        uint8 score = uint8(bound(scoreSeed, 15, 45)); // actual approved scores can reach 70 - 55
        uint256 actor = actorSeed % 12;
        results.setResult(id, actors[actor], score, true, uint64(vm.getBlockTimestamp()));
        approvals.push(SeasonModel.Approval(id, season, actor, score, recordNow));
        if (recordNow) seasons.record(id);
    }

    function record(uint256 seed) external {
        if (approvals.length == 0) return;
        SeasonModel.Approval storage a = approvals[seed % approvals.length];
        bool already = a.recorded;
        bool closed = seasons.closed(a.season);
        if (already) vm.expectRevert(abi.encodeWithSelector(Seasons.AlreadyRecorded.selector, a.id));
        else if (closed) vm.expectRevert(abi.encodeWithSelector(Seasons.SeasonClosed.selector, a.season));
        seasons.record(a.id);
        if (!already && !closed) a.recorded = true;
    }

    function donate(uint256 raw) external {
        uint256 amount = bound(raw, 0, 1_000_000e18);
        imd.mint(address(this), amount);
        imd.transfer(address(seasons), amount);
        funded += amount;
    }

    function closeOldest() external {
        uint256 season = seasons.nextToClose();
        (bool exists,, uint64 end, bool ended) = seasons.seasonBounds(season);
        bool ready = exists && ended && vm.getBlockTimestamp() >= uint256(end) + 1 hours;
        if (!ready) {
            vm.expectRevert(abi.encodeWithSelector(Seasons.NotReady.selector, season));
            seasons.closeSeason(new uint256[](0));
            return;
        }
        (SeasonModel.Approval[] memory list, uint256 n) = SeasonModel.sorted(approvals, season);
        SeasonModel.Wallet[12] memory ranking = SeasonModel.wallets(list, n);
        uint256[12] memory before;
        for (uint256 i; i < 12; ++i) {
            before[i] = imd.balanceOf(actors[i]);
        }
        uint256 pot = imd.balanceOf(address(seasons));
        uint256[10] memory percentages = [uint256(25), 18, 14, 11, 9, 7, 6, 4, 3, 3];
        seasons.closeSeason(new uint256[](0));
        uint256 expectedPaid;
        for (uint256 i; i < 12; ++i) {
            uint256 payout = i < 10 && ranking[i].points >= 60 ? pot * percentages[i] / 100 : 0;
            assertEq(
                imd.balanceOf(actors[ranking[i].actor]),
                before[ranking[i].actor] + payout,
                "prize recipient or share differs from batch model"
            );
            expectedPaid += payout;
        }
        assertEq(imd.balanceOf(address(seasons)), pot - expectedPaid);
        paid += expectedPaid;
        uint256 winners = n < 5 ? n : 5;
        for (uint256 i; i < winners; ++i) {
            uint256 tokenId = ++minted;
            assertEq(laureates.ownerOf(tokenId), actors[list[i].actor]);
            (uint64 pleaId, uint32 seasonKey, uint8 rank) = laureates.laureate(tokenId);
            assertEq(pleaId, list[i].id);
            assertEq(seasonKey, season);
            assertEq(rank, i + 1);
        }
        frozenRankings[season] = keccak256(abi.encode(seasons.topOf(season), seasons.topPleasOf(season)));
        ++closes;
        assertEq(seasons.nextToClose(), closes);
    }

    function advance(uint256 raw) external {
        vm.warp(vm.getBlockTimestamp() + bound(raw, 1, 5 hours));
    }

    function endCabal() external {
        if (results.diedAt() == 0) {
            // A real gate cannot die before it begins. Avoid an empty lifetime in this model.
            if (vm.getBlockTimestamp() == results.startedAt()) vm.warp(vm.getBlockTimestamp() + 1);
            results.die();
        }
    }

    function flush() external {
        if (!seasons.finished()) {
            vm.expectRevert(Seasons.NotFinished.selector);
            seasons.flushToWall();
            return;
        }
        uint256 pot = imd.balanceOf(address(seasons));
        seasons.flushToWall();
        flushed += pot;
        assertEq(imd.balanceOf(address(seasons)), 0);
        assertEq(imd.allowance(address(seasons), address(wall)), 0);
    }

    function transferLaureate(uint256 tokenSeed, uint256 recipientSeed) external {
        if (minted == 0) return;
        uint256 id = bound(tokenSeed, 1, minted);
        address from = laureates.ownerOf(id);
        address to = actors[recipientSeed % 12];
        vm.prank(from);
        laureates.transferFrom(from, to, id);
        assertEq(laureates.ownerOf(id), to);
    }

    function assertRankings() external view {
        uint256 current = (vm.getBlockTimestamp() - results.startedAt()) / 18000;
        for (uint256 season; season <= current; ++season) {
            if (season < closes) {
                assertTrue(seasons.closed(season));
                assertEq(
                    keccak256(abi.encode(seasons.topOf(season), seasons.topPleasOf(season))), frozenRankings[season]
                );
            } else {
                assertFalse(seasons.closed(season));
            }
            (SeasonModel.Approval[] memory list, uint256 n) = SeasonModel.sorted(approvals, season);
            SeasonModel.Wallet[12] memory ranking = SeasonModel.wallets(list, n);
            Seasons.Entry[10] memory actual = seasons.topOf(season);
            for (uint256 i; i < 10; ++i) {
                if (ranking[i].points == 0) assertEq(actual[i].wallet, address(0));
                else assertEq(actual[i].wallet, actors[ranking[i].actor]);
                assertEq(actual[i].points, ranking[i].points);
                assertEq(actual[i].pleaId, ranking[i].newest);
            }
            Seasons.PleaEntry[5] memory topPleas = seasons.topPleasOf(season);
            for (uint256 i; i < 5; ++i) {
                assertEq(topPleas[i].pleaId, i < n ? list[i].id : 0);
                assertEq(topPleas[i].score, i < n ? list[i].score : 0);
            }
        }
        for (uint256 i; i < approvals.length; ++i) {
            assertEq(seasons.recorded(approvals[i].id), approvals[i].recorded);
        }
    }
}

/// forge-config: default.invariant.runs = 128
/// forge-config: default.invariant.depth = 64
/// forge-config: default.invariant.fail-on-revert = true
contract SeasonInvariantTest is Test {
    PLEA internal token;
    Seasons internal seasons;
    Laureates internal laureates;
    SeasonResults internal results;
    SeasonWallSink internal wall;
    MockIMD internal imd;
    SeasonHandler internal handler;
    address[12] internal actors;

    function setUp() public {
        vm.warp(1791817200);
        token = new PLEA(address(this));
        results = new SeasonResults();
        imd = new MockIMD();
        seasons = new Seasons(address(token), address(results), address(imd));
        laureates = new Laureates(address(token));
        PleaDistributor drop = new PleaDistributor(address(token), address(this));
        wall = new SeasonWallSink(imd);
        token.setLauncher(address(results), address(seasons), address(laureates), address(drop));
        token.init(address(wall), makeAddr("unused season pool manager"));
        for (uint256 i; i < 12; ++i) {
            actors[i] = makeAddr(string.concat("season actor ", vm.toString(i)));
        }
        handler = new SeasonHandler(seasons, laureates, results, wall, imd, actors);
        // Start with a contested, payable leaderboard. Later actions add and record in any order.
        for (uint256 i; i < 12; ++i) {
            handler.approvePlea(i, 45, true);
            handler.approvePlea(i, 30 + i, true);
        }
        handler.donate(10_000e18);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = handler.approvePlea.selector;
        selectors[1] = handler.record.selector;
        selectors[2] = handler.donate.selector;
        selectors[3] = handler.closeOldest.selector;
        selectors[4] = handler.advance.selector;
        selectors[5] = handler.endCabal.selector;
        selectors[6] = handler.flush.selector;
        selectors[7] = handler.transferLaureate.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    function invariant_prizeMoneyIsPaidOnceOrRemainsInThePotOrWall() public view {
        uint256 balances;
        for (uint256 i; i < 12; ++i) {
            balances += imd.balanceOf(actors[i]);
        }
        assertEq(balances, handler.paid());
        assertEq(imd.balanceOf(address(wall)), handler.flushed());
        assertEq(wall.received(), handler.flushed());
        assertEq(balances + imd.balanceOf(address(wall)) + seasons.pot(), handler.funded());
        assertEq(imd.totalSupply(), handler.funded());
        assertEq(seasons.nextToClose(), handler.closes());
    }

    function invariant_nftsRemainUniqueAndOwnedAfterRandomTransfers() public view {
        uint256 total = handler.minted();
        assertEq(laureates.totalSupply(), total);
        uint256 sum;
        for (uint256 i; i < 12; ++i) {
            uint256 counted;
            for (uint256 id = 1; id <= total; ++id) {
                if (laureates.ownerOf(id) == actors[i]) ++counted;
            }
            assertEq(laureates.balanceOf(actors[i]), counted);
            sum += counted;
        }
        assertEq(sum, total);
    }

    function invariant_rankingsMatchAllRecordedApprovalsAndClosedSeasonsNeverChange() public view {
        handler.assertRankings();
    }

    function test_modelCoversPayableClosesRolloverAndFinalFlush() public {
        handler.advance(5 hours);
        handler.advance(1 hours);
        handler.closeOldest();
        assertEq(handler.closes(), 1);
        assertEq(handler.minted(), 5);
        assertGt(handler.paid(), 0);
        handler.approvePlea(0, 45, false);
        handler.record(24);
        handler.endCabal();
        handler.advance(1 hours);
        handler.closeOldest();
        handler.flush();
        assertTrue(seasons.finished());
        assertEq(seasons.pot(), 0);
        handler.transferLaureate(1, 11);
        invariant_prizeMoneyIsPaidOnceOrRemainsInThePotOrWall();
        invariant_nftsRemainUniqueAndOwnedAfterRandomTransfers();
        invariant_rankingsMatchAllRecordedApprovalsAndClosedSeasonsNeverChange();
    }
}
