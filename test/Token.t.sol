// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Fixture} from "./utils/Fixture.sol";
import {PLEA} from "../src/PLEA.sol";
import {MockUniPair} from "./utils/Mocks.sol";

contract TokenTest is Fixture {
    function setUp() public override {
        super.setUp();
        buy(alice, 50e18);
    }

    function test_walletsCannotSendWhileTheCabalWatches() public {
        uint256 bal = plea.balanceOf(alice);
        vm.startPrank(alice);
        vm.expectRevert(PLEA.CabalIsWatching.selector);
        plea.transfer(bob, 1);
        vm.expectRevert(PLEA.CabalIsWatching.selector);
        plea.transfer(address(pm), 1);
        vm.expectRevert(PLEA.CabalIsWatching.selector);
        plea.transfer(address(gate), 1); // direct sends to the gate are refused
        vm.expectRevert(PLEA.CabalIsWatching.selector);
        plea.transfer(address(hook), 1);
        vm.expectRevert(PLEA.CabalIsWatching.selector);
        plea.burn(1);
        plea.approve(bob, type(uint256).max);
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert(PLEA.CabalIsWatching.selector);
        plea.transferFrom(alice, bob, 1);
        assertEq(plea.balanceOf(alice), bal);
    }

    function test_distributorAndAllowlistMaySend() public {
        vm.prank(address(distributor));
        plea.transfer(bob, 1e18);
        vm.prank(alice);
        vm.expectRevert();
        plea.allow(alice);
        vm.prank(OWNER);
        plea.allow(alice);
        vm.prank(alice);
        plea.transfer(bob, 1e18);
    }

    function test_freeWhenTheCabalSleepsAndLockedAgainWhenRevived() public {
        skip(DEADMAN);
        vm.prank(alice);
        plea.transfer(bob, 1e18);
        skip(BREAK);
        vm.prank(carol);
        seasons.contribute(500e18);
        vm.prank(alice);
        plea.transfer(bob, 1e18); // warning: still free
        skip(WARNING);
        vm.prank(alice);
        vm.expectRevert(PLEA.CabalIsWatching.selector);
        plea.transfer(bob, 1e18);
    }

    function test_registeredExitPoolsCanSendButNeverReceive() public {
        address pair = v2f.create(address(plea), address(imd));
        address pool = v3f.create(address(plea), address(imd), 3000);
        // Fund the pools while the Cabal sleeps.
        skip(DEADMAN);
        vm.startPrank(alice);
        plea.transfer(pair, 1_000e18);
        plea.transfer(pool, 1_000e18);
        vm.stopPrank();
        skip(BREAK);
        vm.prank(carol);
        seasons.contribute(500e18);
        skip(WARNING);
        assertTrue(plea.restricted());
        // Unregistered: LPs are trapped.
        vm.expectRevert(PLEA.CabalIsWatching.selector);
        MockUniPair(pair).send(plea, bob, 1e18);
        plea.registerExit(pair);
        plea.registerExit(pool);
        MockUniPair(pair).send(plea, bob, 1e18);
        MockUniPair(pool).send(plea, bob, 1e18);
        // Nobody can sell into them.
        vm.prank(alice);
        vm.expectRevert(PLEA.CabalIsWatching.selector);
        plea.transfer(pair, 1e18);
    }

    function test_onlyGenuineUniswapPoolsRegister() public {
        // Same tokens, same interface, not from the factory.
        MockUniPair fake = new MockUniPair(address(plea), address(imd), 3000);
        vm.expectRevert(PLEA.NotAnExitPool.selector);
        plea.registerExit(address(fake));
        // A genuine pair without PLEA.
        address other = v2f.create(address(imd), address(oimd));
        vm.expectRevert(PLEA.NotAnExitPool.selector);
        plea.registerExit(other);
        // A wallet.
        vm.expectRevert(PLEA.NotAnExitPool.selector);
        plea.registerExit(alice);
    }

    function test_launcherAndInitAreOneShot() public {
        vm.expectRevert(PLEA.AlreadySet.selector);
        plea.setLauncher(alice, alice, alice, alice);
        vm.expectRevert(PLEA.NotLauncher.selector);
        plea.init(alice, alice);
        vm.prank(address(launch));
        vm.expectRevert(PLEA.AlreadySet.selector);
        plea.init(alice, alice);
        // A fresh PLEA in a later block cannot be wired by anyone.
        PLEA p = new PLEA(OWNER, address(0), address(0));
        vm.roll(vm.getBlockNumber() + 1);
        // forge keeps transient storage within a test, so clear the flag as a new transaction would.
        vm.store(address(p), bytes32(0), bytes32(0));
        assertEq(p.totalSupply(), 0);
        assertLe(plea.totalSupply(), 1_000_000_000e18 - hook.totalBurned());
        assertGt(plea.totalSupply(), 999_000_000e18);
        assertEq(plea.balanceOf(address(distributor)), 100_000_000e18);
    }
}
