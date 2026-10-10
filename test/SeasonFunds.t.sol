// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {PLEA} from "../src/PLEA.sol";
import {Seasons} from "../src/Seasons.sol";
import {Laureates} from "../src/Laureates.sol";
import {PleaDistributor} from "../src/PleaDistributor.sol";
import {MockIMD} from "./utils/Mocks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Currency} from "v4-core/types/Currency.sol";

contract FundResults {
    uint256 public constant SEASON = 18000;
    uint64 public constant startedAt = 1791817200;
    uint64 public diedAt;

    struct Result {
        address seller;
        uint8 score;
        bool approved;
        uint64 verdictAt;
    }
    mapping(uint256 => Result) public result;

    function approve(uint256 id, address wallet, uint256 season) external {
        result[id] = Result(wallet, 45, true, uint64(startedAt + season * SEASON));
    }

    function die(uint64 at) external {
        diedAt = at;
    }
}

contract PrizeWall {
    MockIMD public immutable imd;

    constructor(MockIMD imd_) {
        imd = imd_;
    }

    function fundWall(uint256 amount) external {
        imd.transferFrom(msg.sender, address(this), amount);
    }
}

contract SeasonFundsTest is Test {
    FundResults gate;
    Seasons seasons;
    MockIMD imd;
    IPoolManager pm;
    PrizeWall wall;
    address alice = makeAddr("fund alice");
    address bob = makeAddr("fund bob");

    function setUp() public {
        gate = new FundResults();
        vm.warp(gate.startedAt());
        imd = new MockIMD();
        pm = IPoolManager(deployCode("PoolManager.sol:PoolManager", abi.encode(address(this))));
        PLEA plea = new PLEA(address(this));
        seasons = new Seasons(address(plea), address(gate), address(imd));
        Laureates laureates = new Laureates(address(plea));
        PleaDistributor distributor = new PleaDistributor(address(plea), address(this));
        wall = new PrizeWall(imd);
        plea.setLauncher(address(gate), address(seasons), address(laureates), address(distributor));
        plea.init(address(wall), address(pm));
    }

    function fund(uint256 amount) internal {
        imd.mint(address(seasons), amount);
        seasons.checkpoint();
    }

    function fundClaims(uint256 amount) internal {
        imd.mint(address(this), amount);
        pm.unlock(abi.encode(amount));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(pm));
        uint256 amount = abi.decode(data, (uint256));
        pm.mint(address(seasons), uint256(uint160(address(imd))), amount);
        seasons.checkpoint(); // the hook notifies before the swapper settles, too
        pm.sync(Currency.wrap(address(imd)));
        imd.transfer(address(pm), amount);
        pm.settle();
        return "";
    }

    function leader(uint256 season, address wallet, uint256 id) internal {
        gate.approve(id, wallet, season);
        gate.approve(id + 1, wallet, season);
        seasons.record(id);
        seasons.record(id + 1);
    }

    function atSeason(uint256 season) internal {
        vm.warp(gate.startedAt() + season * gate.SEASON());
    }

    function close() internal {
        seasons.closeSeason(new uint256[](0));
    }

    function test_lateClosesOnlyRollUnpaidSharesForward() public {
        leader(0, alice, 1);
        fund(1000e18);
        atSeason(1);
        leader(1, bob, 3);
        fundClaims(2000e18);
        atSeason(2);
        fund(3000e18);
        atSeason(3);
        skip(1 hours);

        close();
        assertEq(imd.balanceOf(alice), 250e18);
        assertEq(seasons.rollover(), 750e18);
        assertEq(seasons.seasonFees(1), 2000e18);
        assertEq(seasons.seasonFees(2), 3000e18);
        assertEq(pm.balanceOf(address(seasons), uint256(uint160(address(imd)))), 0);
        close();
        assertEq(imd.balanceOf(bob), 687.5e18); // 25% of 2000 + 750
        assertEq(seasons.rollover(), 2062.5e18);
        close(); // season 2 has no eligible wallets
        assertEq(seasons.rollover(), 5062.5e18);
        assertEq(seasons.pot(), 6000e18 - imd.balanceOf(alice) - imd.balanceOf(bob));
        seasons.checkpoint(); // payouts and claim redemption are not new revenue
        assertEq(seasons.seasonFees(3), 0);
    }

    function test_feeAtBoundaryBelongsToNextSeason() public {
        leader(0, alice, 1);
        vm.warp(gate.startedAt() + gate.SEASON() - 1);
        fund(100e18);
        atSeason(1);
        fund(900e18);
        skip(1 hours);
        close();
        assertEq(imd.balanceOf(alice), 25e18);
        assertEq(seasons.rollover(), 75e18);
        assertEq(seasons.seasonFees(1), 900e18);
        assertEq(seasons.pot(), 975e18);
    }

    function test_unobservedDonationCannotFlowBackwards() public {
        leader(0, alice, 1);
        fund(100e18);
        atSeason(1);
        imd.mint(address(seasons), 900e18); // no notification yet
        skip(1 hours);
        close();
        assertEq(imd.balanceOf(alice), 25e18);
        assertEq(seasons.seasonFees(1), 900e18);
    }

    function test_failedPayoutRollsForwardWithoutBlockingOtherWinners() public {
        leader(0, alice, 1);
        leader(0, bob, 3);
        fund(1000e18);
        atSeason(1);
        skip(1 hours);
        vm.mockCall(address(imd), abi.encodeCall(imd.transfer, (alice, 250e18)), abi.encode(false));
        close();
        assertEq(imd.balanceOf(alice), 0);
        assertEq(imd.balanceOf(bob), 180e18);
        assertEq(seasons.rollover(), 820e18);
        assertEq(seasons.pot(), 820e18);
        seasons.checkpoint();
        assertEq(seasons.seasonFees(1), 0);
    }

    function test_deathAtBoundaryFlushesClaimsAndLateDonationsOnce() public {
        fundClaims(100e18);
        atSeason(1);
        fundClaims(200e18);
        atSeason(2);
        gate.die(uint64(vm.getBlockTimestamp()));
        fund(300e18); // a direct donation after death belongs to the final season
        assertEq(seasons.seasonFees(1), 500e18);
        skip(1 hours);
        close();
        close();
        assertTrue(seasons.finished());
        seasons.flushToWall();
        assertEq(imd.balanceOf(address(wall)), 600e18);
        assertEq(seasons.pot(), 0);
        assertEq(seasons.rollover(), 0);
        fundClaims(25e18); // donation after the final close can still be flushed
        seasons.flushToWall();
        assertEq(imd.balanceOf(address(wall)), 625e18);
        seasons.flushToWall();
        assertEq(seasons.pot(), 0);
    }

    function test_deathMidSeasonPreservesEarlierSeasonFees() public {
        leader(0, alice, 1);
        fund(100e18);
        atSeason(1);
        skip(1);
        fundClaims(900e18);
        gate.die(uint64(vm.getBlockTimestamp()));
        skip(1 hours);
        close();
        assertEq(imd.balanceOf(alice), 25e18);
        assertEq(seasons.seasonFees(1), 900e18);
        close();
        seasons.flushToWall();
        assertEq(imd.balanceOf(address(wall)), 975e18);
    }

    function test_claimRedemptionCallbackCannotBeInvokedOutsideUnlock() public {
        vm.expectRevert(Seasons.CallbackNotExpected.selector);
        seasons.unlockCallback(abi.encode(1e18));
        vm.prank(address(pm));
        vm.expectRevert(Seasons.CallbackNotExpected.selector);
        seasons.unlockCallback(abi.encode(1e18));
    }

    function testFuzz_lateCloseConservesAssets(uint96 first, uint96 later, bool claims) public {
        leader(0, alice, 1);
        first = uint96(bound(first, 1, 1_000_000e18));
        later = uint96(bound(later, 1, 1_000_000e18));
        fund(first);
        atSeason(1);
        if (claims) fundClaims(later);
        else fund(later);
        skip(1 hours);
        close();
        uint256 paid = uint256(first) * 2500 / 10000;
        assertEq(imd.balanceOf(alice), paid);
        assertEq(seasons.pot() + paid, uint256(first) + later);
        assertEq(seasons.rollover(), first - paid);
        assertEq(seasons.seasonFees(1), later);
    }
}
