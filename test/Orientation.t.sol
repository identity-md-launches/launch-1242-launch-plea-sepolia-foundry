// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Fixture} from "./utils/Fixture.sol";
import {HookTest} from "./Hook.t.sol";
import {GateTest} from "./Gate.t.sol";
import {SeasonsTest} from "./Seasons.t.sol";
import {MockIMD} from "./utils/Mocks.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

/*
  The launch factory may give PLEA an address below TestIMD, which makes PLEA currency0
  (`hook.pleaIsZero() == true`) and selects the other branch in seed(), _pleaIn/_imdIn, _applyCap,
  _rebalance and CabalGate.unlockCallback. These suites rerun the hook, gate and seasons tests with
  IMD etched at the highest address, so PLEA is currency0.
*/
abstract contract PleaIsZeroFixture is Fixture {
    address constant HIGH_IMD = address(type(uint160).max);

    function deployImd() internal virtual override {
        deployCodeTo("Mocks.sol:MockIMD", "", HIGH_IMD);
        imd = MockIMD(HIGH_IMD);
    }

    function test_orientationIsPleaZero() public view {
        assertTrue(hook.pleaIsZero(), "PLEA must be currency0 in this suite");
        PoolKey memory key = hook.poolKey();
        assertEq(Currency.unwrap(key.currency0), address(plea));
        assertEq(Currency.unwrap(key.currency1), address(imd));
    }
}

contract HookPleaIsZeroTest is PleaIsZeroFixture, HookTest {
    function deployImd() internal override(Fixture, PleaIsZeroFixture) {
        PleaIsZeroFixture.deployImd();
    }
}

contract GatePleaIsZeroTest is PleaIsZeroFixture, GateTest {
    function deployImd() internal override(Fixture, PleaIsZeroFixture) {
        PleaIsZeroFixture.deployImd();
    }

    function setUp() public override(Fixture, GateTest) {
        GateTest.setUp();
    }
}

contract SeasonsPleaIsZeroTest is PleaIsZeroFixture, SeasonsTest {
    function deployImd() internal override(Fixture, PleaIsZeroFixture) {
        PleaIsZeroFixture.deployImd();
    }

    function setUp() public override(Fixture, SeasonsTest) {
        SeasonsTest.setUp();
    }
}
