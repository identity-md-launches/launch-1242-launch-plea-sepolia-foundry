// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Fixture} from "./utils/Fixture.sol";
import {PleaHook} from "../src/PleaHook.sol";
import {BuyRouter} from "./utils/Mocks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";

contract HookTest is Fixture {
    function test_everyFeeIsPaidInTheSameSwap() public {
        buy(bob, 50e18); // IMD in the pool
        uint256 ownerBefore = imd.balanceOf(OWNER);
        uint256 prizeBefore = imd.balanceOf(address(seasons));
        uint256 claimsBefore = hook.retainClaims();
        uint256 supplyBefore = plea.totalSupply();
        uint256 amt = 100e18;
        uint256 fill = amt - amt * 150 / 10_150;
        buy(alice, 100e18);
        uint256 cashback = fill * 50 / 10_000;
        assertApproxEqAbs(imd.balanceOf(OWNER) - ownerBefore, cashback, 1);
        assertApproxEqAbs(imd.balanceOf(address(seasons)) - prizeBefore, fill * 25 / 10_000, 1);
        assertApproxEqAbs(hook.retainClaims() - claimsBefore, fill * 25 / 10_000, 2);
        assertApproxEqAbs(simd.byProject(alice, address(hook)), cashback, 1); // stacked as sIMD
        assertEq(imd.balanceOf(address(hook)), 0); // nothing parked
        assertLt(plea.totalSupply(), supplyBefore); // 0.25% burned
        (uint256 spent, uint256 held, uint256 t) = hook.basisOf(alice);
        assertEq(spent, 100e18);
        assertEq(held, plea.balanceOf(alice));
        assertEq(t, vm.getBlockTimestamp());
    }

    function test_firstBuyWithAnEmptyPoolSendsPayoutsToLiquidity() public {
        // Fresh fixture state: no IMD has ever entered the PoolManager.
        assertEq(imd.balanceOf(address(pm)), 0);
        vm.expectEmit(false, false, false, false, address(hook));
        emit PleaHook.PayoutsToPool(0);
        buy(alice, 10e18);
        assertGt(plea.balanceOf(alice), 0);
        assertGt(hook.retainClaims(), 0);
    }

    function test_aBuyMustAffordTheCredit() public {
        buy(bob, 50e18);
        bytes memory call = abi.encodeCall(BuyRouter.buyExactIn, (10e18, abi.encode(alice)));
        vm.prank(alice);
        (bool ok,) = address(router).call{gas: 400_000}(call);
        assertFalse(ok); // NotEnoughGas: the estimate can never pick a no-cashback path
        vm.prank(alice);
        (ok,) = address(router).call{gas: 2_000_000}(call);
        assertTrue(ok);
        assertGt(simd.byProject(alice, address(hook)), 0);
    }

    function test_plainImdOnlyWhenTheCreditReverts() public {
        buy(bob, 50e18);
        simd.setPaused(true);
        uint256 before = imd.balanceOf(alice);
        buy(alice, 10e18);
        assertEq(simd.balanceOf(alice), 0);
        uint256 amt = 10e18;
        uint256 fill = amt - amt * 150 / 10_150;
        assertApproxEqAbs(imd.balanceOf(alice), before - 10e18 + fill * 50 / 10_000, 1);
    }

    function test_sellsAndExactOutputOnlyThroughTheGateWhileAlive() public {
        buy(alice, 50e18);
        vm.prank(alice);
        vm.expectRevert();
        router.sellExactIn(1e18, abi.encode(alice));
        vm.prank(alice);
        vm.expectRevert();
        router.buyExactOut(1e18, abi.encode(alice));
        vm.prank(alice);
        vm.expectRevert();
        router.buyExactIn(1e18, ""); // no recipient
    }

    function test_freeTradingWhenTheCabalSleeps() public {
        buy(alice, 50e18);
        skip(DEADMAN);
        vm.startPrank(alice);
        plea.approve(address(router), type(uint256).max);
        uint256 out = router.sellExactIn(plea.balanceOf(alice) / 2, abi.encode(alice));
        vm.stopPrank();
        assertGt(out, 0);
    }

    function test_rebalanceRedeemsClaimsIntoTheWall() public {
        for (uint256 i; i < 5; ++i) {
            buy(alice, 400e18);
            buy(bob, 400e18);
        }
        assertGt(hook.retainClaims(), 1e18);
        uint256 claims = hook.retainClaims();
        vm.prank(keeper);
        hook.rebalance();
        assertEq(hook.retainClaims(), 0);
        (,, uint128 liq) = hook.wall();
        assertGt(liq, 0);
        assertGt(hook.wallImd(), claims / 2);
    }

    function test_avgBuyTimeIsBuyWeighted() public {
        buy(alice, 10e18);
        (,, uint256 t1) = hook.basisOf(alice);
        skip(10 days);
        // Keep the Cabal awake is irrelevant for buys; a second, equal-size buy halves the hold time.
        (, uint256 h1,) = hook.basisOf(alice);
        buy(alice, 10e18);
        (, uint256 h2, uint256 t2) = hook.basisOf(alice);
        uint256 expected = (t1 * h1 + vm.getBlockTimestamp() * (h2 - h1)) / h2;
        assertEq(t2, expected);
        assertGt(t2, t1);
    }

    function test_factScoreUsesCheckpointsNotSpot() public {
        buy(alice, 50e18);
        skip(1 hours);
        buy(bob, 10e18); // first trade of the hour sets the checkpoint
        uint256 latest = hook.latestPrice();
        buy(bob, 2_000e18); // a big pump in the same hour
        assertEq(hook.latestPrice(), latest);
        assertGt(hook.priceX96(), latest);
    }
}
