// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {PLEA} from "src/PLEA.sol";
import {Seasons} from "src/Seasons.sol";
import {Laureates} from "src/Laureates.sol";
import {PleaDistributor} from "src/PleaDistributor.sol";
import {SeasonResults, SeasonWallSink} from "./utils/SeasonModel.sol";

contract SelectivePrizeAsset is ERC20 {
    address public blocked;
    bool public returnFalse;

    constructor() ERC20("Selective quote", "Q") {}

    function mint(address who, uint256 amount) external {
        _mint(who, amount);
    }

    function blockRecipient(address who, bool falseReturn) external {
        blocked = who;
        returnFalse = falseReturn;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (to == blocked) {
            if (returnFalse) return false;
            revert("recipient blocked");
        }
        return super.transfer(to, amount);
    }
}

/// forge-config: default.fuzz.runs = 256
contract SeasonAdversarialTest is Test {
    PLEA internal token;
    Seasons internal seasons;
    Laureates internal laureates;
    SeasonResults internal results;
    SeasonWallSink internal wall;
    SelectivePrizeAsset internal quote;
    address internal alice = makeAddr("prize alice");
    address internal bob = makeAddr("prize bob");

    function setUp() public {
        vm.warp(1791817200);
        token = new PLEA(address(this));
        results = new SeasonResults();
        quote = new SelectivePrizeAsset();
        seasons = new Seasons(address(token), address(results), address(quote));
        laureates = new Laureates(address(token));
        PleaDistributor drop = new PleaDistributor(address(token), address(this));
        wall = new SeasonWallSink(quote);
        token.setLauncher(address(results), address(seasons), address(laureates), address(drop));
        // Seasons now includes redeemable IMD claims in its assets, so its manager must be live.
        token.init(address(wall), deployCode("PoolManager.sol:PoolManager", abi.encode(address(this))));
    }

    function approve(uint256 id, address seller, uint8 score) internal {
        results.setResult(id, seller, score, true, uint64(vm.getBlockTimestamp()));
    }

    function ready() internal {
        vm.warp(uint256(results.startedAt()) + 18000 + 1 hours);
    }

    function test_closeBeforeGraceRollsBackItsBatchRecording() public {
        approve(1, alice, 45);
        uint256[] memory ids = new uint256[](1);
        ids[0] = 1;
        vm.warp(uint256(results.startedAt()) + 18000 + 1 hours - 1);
        vm.expectRevert(abi.encodeWithSelector(Seasons.NotReady.selector, uint256(0)));
        seasons.closeSeason(ids);
        assertFalse(seasons.recorded(1));
        assertFalse(seasons.closed(0));
        assertEq(seasons.nextToClose(), 0);
        assertEq(laureates.totalSupply(), 0);
        vm.warp(vm.getBlockTimestamp() + 1);
        seasons.closeSeason(ids);
        assertTrue(seasons.recorded(1));
        assertTrue(seasons.closed(0));
        assertEq(laureates.totalSupply(), 1);
    }

    function test_batchIgnoresUnknownDeniedAndRepeatedIdsButCannotReopenASeason() public {
        approve(1, alice, 45);
        approve(2, alice, 45);
        results.setResult(3, bob, 45, false, uint64(vm.getBlockTimestamp()));
        uint256[] memory ids = new uint256[](5);
        (ids[0], ids[1], ids[2], ids[3], ids[4]) = (1, 1, 3, 999, 2);
        quote.mint(address(seasons), 100e18);
        seasons.checkpoint();
        ready();
        seasons.closeSeason(ids);
        assertEq(quote.balanceOf(alice), 25e18);
        assertEq(laureates.totalSupply(), 2);
        assertFalse(seasons.recorded(3));
        assertFalse(seasons.recorded(999));
        vm.expectRevert(abi.encodeWithSelector(Seasons.NotReady.selector, uint256(1)));
        seasons.closeSeason(ids);
        assertEq(quote.balanceOf(alice), 25e18);
        assertEq(laureates.totalSupply(), 2);
        assertEq(seasons.nextToClose(), 1);
    }

    function test_recordRejectsDenialsDuplicatesAndLateApprovals() public {
        results.setResult(1, alice, 44, false, uint64(vm.getBlockTimestamp()));
        vm.expectRevert(abi.encodeWithSelector(Seasons.NotApproved.selector, uint256(1)));
        seasons.record(1);
        approve(2, alice, 45);
        seasons.record(2);
        vm.expectRevert(abi.encodeWithSelector(Seasons.AlreadyRecorded.selector, uint256(2)));
        seasons.record(2);
        approve(3, bob, 45);
        ready();
        seasons.closeSeason(new uint256[](0));
        vm.expectRevert(abi.encodeWithSelector(Seasons.SeasonClosed.selector, uint256(0)));
        seasons.record(3);
        assertFalse(seasons.recorded(3));
        assertEq(laureates.totalSupply(), 1);
    }

    function testFuzz_failedPrizeDoesNotBlockOthersAndUnpaidShareReachesWall(bool falseReturn) public {
        approve(1, alice, 45);
        approve(2, alice, 45);
        approve(3, bob, 45);
        approve(4, bob, 45);
        uint256[] memory ids = new uint256[](4);
        for (uint256 i; i < 4; ++i) {
            ids[i] = i + 1;
        }
        quote.mint(address(seasons), 100e18);
        seasons.checkpoint();
        quote.blockRecipient(alice, falseReturn);
        vm.warp(uint256(results.startedAt()) + 18000);
        results.die(); // no season starts at the exact death boundary
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        seasons.closeSeason(ids);
        assertEq(quote.balanceOf(alice), 0);
        assertEq(quote.balanceOf(bob), 18e18);
        assertEq(seasons.pot(), 82e18);
        assertEq(laureates.totalSupply(), 4);
        assertTrue(seasons.finished());
        seasons.flushToWall();
        assertEq(wall.received(), 82e18);
        assertEq(seasons.pot(), 0);
        seasons.flushToWall();
        assertEq(wall.received(), 82e18, "flush is idempotent with no new funding");
        quote.mint(address(seasons), 1);
        seasons.flushToWall();
        assertEq(wall.received(), 82e18 + 1);
    }

    function testFuzz_prizeRoundingConservesAnOddSizedPot(uint256 rawPot) public {
        uint256 pot = bound(rawPot, 1, 1_000_000_000e18);
        quote.mint(address(seasons), pot);
        seasons.checkpoint();
        uint256[] memory ids = new uint256[](20);
        address[10] memory actors;
        for (uint256 i; i < 10; ++i) {
            actors[i] = makeAddr(string.concat("rounding wallet ", vm.toString(i)));
            approve(2 * i + 1, actors[i], 45);
            approve(2 * i + 2, actors[i], 45);
            ids[2 * i] = 2 * i + 1;
            ids[2 * i + 1] = 2 * i + 2;
        }
        ready();
        seasons.closeSeason(ids);
        uint256[10] memory percent = [uint256(25), 18, 14, 11, 9, 7, 6, 4, 3, 3];
        uint256 paid;
        for (uint256 i; i < 10; ++i) {
            assertEq(quote.balanceOf(actors[i]), pot * percent[i] / 100);
            paid += quote.balanceOf(actors[i]);
        }
        assertEq(paid + seasons.pot(), pot);
        assertLt(seasons.pot(), 10, "at most nine wei of rounding dust for ten paid shares");
    }

    function test_prizesRequireSixtyPointsButLaureatesDoNot() public {
        approve(1, alice, 30);
        approve(2, alice, 29);
        approve(3, bob, 30);
        approve(4, bob, 30);
        uint256[] memory ids = new uint256[](4);
        for (uint256 i; i < 4; ++i) {
            ids[i] = i + 1;
        }
        quote.mint(address(seasons), 100e18);
        seasons.checkpoint();
        ready();
        seasons.closeSeason(ids);
        assertEq(quote.balanceOf(alice), 0);
        assertEq(quote.balanceOf(bob), 25e18);
        assertEq(laureates.totalSupply(), 4);
        assertEq(laureates.balanceOf(alice), 2);
        assertEq(seasons.pot(), 75e18);
    }

    function test_flushBeforeFinalCloseCannotMoveAnyFunds() public {
        quote.mint(address(seasons), 100e18);
        vm.expectRevert(Seasons.NotFinished.selector);
        seasons.flushToWall();
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        results.die();
        vm.expectRevert(Seasons.NotFinished.selector);
        seasons.flushToWall();
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        seasons.closeSeason(new uint256[](0));
        seasons.flushToWall();
        assertEq(quote.balanceOf(address(wall)), 100e18);
    }

    function test_onlySeasonsMintsAndFailedMintCannotIncrementSupply() public {
        vm.expectRevert(Laureates.NotSeasons.selector);
        laureates.mint(alice, 0, 1, 1);
        vm.prank(address(seasons));
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InvalidReceiver.selector, address(0)));
        laureates.mint(address(0), 0, 1, 1);
        assertEq(laureates.totalSupply(), 0);
        vm.prank(address(seasons));
        laureates.mint(alice, 0, 1, 1);
        assertEq(laureates.ownerOf(1), alice);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721InsufficientApproval.selector, bob, uint256(1)));
        laureates.transferFrom(alice, bob, 1);
        assertEq(laureates.ownerOf(1), alice);
        assertEq(laureates.totalSupply(), 1);
    }

    function test_invalidNamesAndFailedRenamesPreserveTheOldReservation() public {
        vm.prank(alice);
        laureates.setName("alice_1");
        string[12] memory invalid = [
            "a",
            "ab",
            "abcdefghijklmnopqrstu",
            "Alice",
            "bad name",
            "bad-name",
            "cabal",
            "admin",
            "imd",
            "plea",
            "owner",
            "a\nb"
        ];
        for (uint256 i; i < invalid.length; ++i) {
            vm.prank(alice);
            vm.expectRevert(Laureates.BadName.selector);
            laureates.setName(invalid[i]);
            assertEq(laureates.nameOf(alice), "alice_1");
            assertEq(laureates.nameOwner(keccak256("alice_1")), alice);
        }
        vm.prank(bob);
        laureates.setName("bob_2");
        vm.prank(alice);
        vm.expectRevert(Laureates.NameTaken.selector);
        laureates.setName("bob_2");
        assertEq(laureates.nameOwner(keccak256("alice_1")), alice);
        assertEq(laureates.nameOwner(keccak256("bob_2")), bob);
    }

    function testFuzz_namesAreUniqueIdempotentAndReleasedOnClear(uint256 seed, uint8 rawLength) public {
        uint256 length = bound(rawLength, 3, 20);
        bytes memory name = new bytes(length);
        name[0] = "_"; // avoids reserved words while exercising the whole remaining alphabet
        bytes memory alphabet = "abcdefghijklmnopqrstuvwxyz0123456789_";
        for (uint256 i = 1; i < length; ++i) {
            name[i] = alphabet[uint256(keccak256(abi.encode(seed, i))) % alphabet.length];
        }
        vm.startPrank(alice);
        laureates.setName(string(name));
        laureates.setName(string(name));
        vm.stopPrank();
        assertEq(laureates.nameOf(alice), string(name));
        assertEq(laureates.nameOwner(keccak256(name)), alice);
        vm.prank(bob);
        vm.expectRevert(Laureates.NameTaken.selector);
        laureates.setName(string(name));
        vm.prank(alice);
        laureates.setName("");
        vm.prank(bob);
        laureates.setName(string(name));
        assertEq(laureates.nameOf(alice), "");
        assertEq(laureates.nameOwner(keccak256(name)), bob);
    }

    function test_metadataDecodesToValidJsonAndEscapesUntrustedTextInSvg() public {
        approve(1, alice, 45);
        vm.prank(alice);
        laureates.setName("alice_1");
        vm.prank(address(seasons));
        laureates.mint(alice, 0, 1, 1);
        string memory json = string(decode64(bytes(laureates.tokenURI(1)), 29));
        assertEq(vm.parseJsonString(json, ".name"), "PLEA Laureate #1");
        assertTrue(vm.contains(vm.parseJsonString(json, ".description"), results.pleaText(1)));
        string memory svg = string(decode64(bytes(vm.parseJsonString(json, ".image")), 26));
        assertTrue(vm.contains(svg, "&quot;please&quot;"));
        assertTrue(vm.contains(svg, "&lt;half&gt;"));
        assertTrue(vm.contains(svg, "&amp;"));
        assertTrue(vm.contains(svg, "alice_1"));
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, uint256(2)));
        laureates.tokenURI(2);
    }

    /// @dev Decode the transport so assertions inspect JSON/XML, not production encoder output.
    function decode64(bytes memory input, uint256 prefix) internal pure returns (bytes memory output) {
        uint256 size = input.length - prefix;
        uint256 padding = input[input.length - 1] == "=" ? 1 : 0;
        if (input[input.length - 2] == "=") ++padding;
        output = new bytes(size / 4 * 3 - padding);
        uint256 word;
        uint256 bits;
        uint256 at;
        for (uint256 i = prefix; i < input.length && input[i] != "="; ++i) {
            uint8 c = uint8(input[i]);
            uint256 value = c >= 65 && c <= 90
                ? c - 65
                : c >= 97 && c <= 122 ? c - 71 : c >= 48 && c <= 57 ? c + 4 : c == 43 ? 62 : 63;
            word = (word << 6) | value;
            bits += 6;
            if (bits >= 8) {
                bits -= 8;
                output[at++] = bytes1(uint8(word >> bits));
            }
        }
    }
}
