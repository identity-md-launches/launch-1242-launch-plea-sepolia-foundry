// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPLEA, IGate, ILaureates, IPleaHook} from "./interfaces/IPleaParts.sol";

/// @title Seasons — PLEA's leaderboard and prizes while the Cabal lives
/// @notice Seasons of `SEASON` each run back to back from the moment trading opens; the last one
/// ends when the Cabal dies. An approved plea earns its judges' score (0-45) as points; each
/// wallet's best three count. When a season ends anyone calls `closeSeason`: the top 10 with at
/// least 60 points are paid 25/18/14/11/9/7/6/4/3/3 % of the prize pot in IMD, unpaid shares roll
/// over, and the season's five best pleas are minted as Laureates. The pot is fed by the hook's
/// 0.25% prize fee. After the last season is closed, whatever is left goes to the buy wall.
contract Seasons {
    using SafeERC20 for IERC20;

    error NotApproved(uint256 pleaId);
    error AlreadyRecorded(uint256 pleaId);
    error SeasonClosed(uint256 season);
    error NotReady(uint256 season);
    error NotFinished();

    event Recorded(uint256 indexed pleaId, uint256 indexed season, address indexed wallet, uint8 score, uint16 points);
    event SeasonClosedOut(uint256 indexed season, uint256 pot, uint256 paid);
    event PrizePaid(uint256 indexed season, address indexed wallet, uint8 rank, uint256 amount);
    event LaureateMinted(uint256 indexed season, uint256 indexed pleaId, uint8 rank, uint256 tokenId);
    event LeftoverToWall(uint256 amount);

    struct Entry {
        address wallet;
        uint16 points;
        uint64 pleaId; // the plea that last raised the total (ties go to the earlier one)
    }

    struct PleaEntry {
        uint64 pleaId;
        uint8 score;
    }

    // ---------------------------------------------------------------- agreed numbers
    uint256 public constant MIN_POINTS = 60;
    uint256 public constant TOP = 10;
    uint256 public constant LAUREATES_PER_SEASON = 5;
    /// @notice After a season ends, time to record late approvals before it can be closed.
    uint256 public constant CLOSE_GRACE = 1 hours;

    IPLEA public immutable plea;
    IGate public immutable gate;
    IERC20 public immutable imd;
    uint256 public immutable SEASON;

    mapping(uint256 => Entry[10]) internal _top;
    mapping(uint256 => PleaEntry[5]) internal _topPleas;
    mapping(uint256 => mapping(address => uint8[3])) internal _best;
    mapping(uint256 => bool) public closed;
    mapping(uint256 => bool) public recorded;
    /// @notice The oldest season not yet closed (season 0 starts when trading opens).
    uint256 public nextToClose;

    constructor(address plea_, address gate_, address imd_) {
        plea = IPLEA(plea_);
        gate = IGate(gate_);
        imd = IERC20(imd_);
        SEASON = IGate(gate_).SEASON();
    }

    // ================================================================ views

    function topOf(uint256 season) external view returns (Entry[10] memory) {
        return _top[season];
    }

    function topPleasOf(uint256 season) external view returns (PleaEntry[5] memory) {
        return _topPleas[season];
    }

    function bestOf(uint256 season, address wallet) external view returns (uint8[3] memory) {
        return _best[season][wallet];
    }

    /// @notice A season's window. It exists once it has started while the Cabal was alive; it ends
    /// after `SEASON` or when the Cabal dies.
    function seasonBounds(uint256 season) public view returns (bool exists, uint64 start, uint64 end, bool ended) {
        uint256 t0 = gate.startedAt();
        if (t0 == 0) return (false, 0, 0, false);
        uint256 s = t0 + season * SEASON;
        uint256 e = s + SEASON;
        uint256 died = gate.diedAt();
        if (block.timestamp < s || (died != 0 && died <= s)) return (false, uint64(s), uint64(e), false);
        if (died != 0 && died < e) e = died;
        return (true, uint64(s), uint64(e), block.timestamp >= e);
    }

    /// @notice The season running now, if the Cabal is alive.
    function currentSeason() external view returns (bool live, uint256 season, uint64 endsAt) {
        uint256 t0 = gate.startedAt();
        if (t0 == 0 || !gate.cabalAlive()) return (false, 0, 0);
        season = (block.timestamp - t0) / SEASON;
        return (true, season, uint64(t0 + (season + 1) * SEASON));
    }

    /// @notice Prize IMD a season would share out if closed now.
    function pot() public view returns (uint256) {
        return imd.balanceOf(address(this));
    }

    /// @notice True once the Cabal is dead and its last season is closed.
    function finished() public view returns (bool) {
        if (gate.diedAt() == 0) return false;
        (bool exists,,,) = seasonBounds(nextToClose);
        return !exists;
    }

    // ================================================================ points

    /// @notice Records an approved plea's score for its season. Anyone may call it; the seller has
    /// every reason to. Must happen before the season is closed.
    function record(uint256 pleaId) external {
        (address seller, uint8 score, bool approved, uint64 verdictAt) = gate.result(pleaId);
        if (!approved) revert NotApproved(pleaId);
        if (recorded[pleaId]) revert AlreadyRecorded(pleaId);
        uint256 season = _seasonOf(verdictAt);
        if (closed[season]) revert SeasonClosed(season);
        _record(pleaId, season, seller, score);
    }

    function _seasonOf(uint64 verdictAt) internal view returns (uint256) {
        return (uint256(verdictAt) - gate.startedAt()) / SEASON;
    }

    function _record(uint256 pleaId, uint256 season, address seller, uint8 score) internal {
        recorded[pleaId] = true;
        _insertPlea(season, uint64(pleaId), score);
        uint8[3] storage b = _best[season][seller];
        uint256 mi;
        if (b[1] < b[mi]) mi = 1;
        if (b[2] < b[mi]) mi = 2;
        uint16 pts;
        if (score > b[mi]) {
            b[mi] = score;
            pts = uint16(uint256(b[0]) + b[1] + b[2]);
            _insertWallet(season, Entry({wallet: seller, points: pts, pleaId: uint64(pleaId)}));
        }
        emit Recorded(pleaId, season, seller, score, pts);
    }

    function _better(Entry memory a, Entry memory b) internal pure returns (bool) {
        if (b.wallet == address(0)) return true;
        return a.points > b.points || (a.points == b.points && a.pleaId < b.pleaId);
    }

    function _insertWallet(uint256 season, Entry memory ne) internal {
        Entry[10] storage t = _top[season];
        Entry[10] memory m = t;
        uint256 pos = TOP;
        for (uint256 k; k < TOP; ++k) {
            if (m[k].wallet == ne.wallet) {
                pos = k;
                break;
            }
        }
        if (pos == TOP) {
            if (!_better(ne, m[TOP - 1])) return;
            pos = TOP - 1;
        }
        uint256 i = pos;
        while (i > 0 && _better(ne, m[i - 1])) {
            m[i] = m[i - 1];
            --i;
        }
        m[i] = ne;
        for (uint256 k = i; k <= pos; ++k) {
            t[k] = m[k];
        }
    }

    function _insertPlea(uint256 season, uint64 pleaId, uint8 score) internal {
        PleaEntry[5] storage t = _topPleas[season];
        PleaEntry[5] memory m = t;
        uint256 n = LAUREATES_PER_SEASON;
        // A newer plea needs a strictly higher score to pass an older one.
        if (m[n - 1].pleaId != 0 && score <= m[n - 1].score) return;
        uint256 i = n - 1;
        while (i > 0 && (m[i - 1].pleaId == 0 || score > m[i - 1].score)) {
            m[i] = m[i - 1];
            --i;
        }
        m[i] = PleaEntry({pleaId: pleaId, score: score});
        for (uint256 k = i; k < n; ++k) {
            t[k] = m[k];
        }
    }

    // ================================================================ closing

    /// @notice Closes the oldest open season once it has ended (plus a one-hour grace): records any
    /// listed approvals first, pays the top 10, mints the top 5 Laureates. Anyone may call it.
    function closeSeason(uint256[] calldata pleaIds) external {
        for (uint256 i; i < pleaIds.length; ++i) {
            _tryRecord(pleaIds[i]);
        }
        uint256 season = nextToClose;
        (bool exists,, uint64 end, bool ended) = seasonBounds(season);
        if (!exists || !ended || block.timestamp < uint256(end) + CLOSE_GRACE) revert NotReady(season);
        closed[season] = true;
        nextToClose = season + 1;

        uint256 amountIn = pot();
        uint256 paid;
        Entry[10] memory t = _top[season];
        for (uint256 i; i < TOP; ++i) {
            if (t[i].wallet == address(0) || t[i].points < MIN_POINTS) continue;
            uint256 amount = amountIn * _shareBps(i) / 10_000;
            if (amount != 0 && _pay(t[i].wallet, amount)) {
                paid += amount;
                emit PrizePaid(season, t[i].wallet, uint8(i + 1), amount);
            }
        }
        emit SeasonClosedOut(season, amountIn, paid);

        PleaEntry[5] memory lp = _topPleas[season];
        ILaureates l = ILaureates(plea.laureates());
        for (uint256 i; i < LAUREATES_PER_SEASON; ++i) {
            if (lp[i].pleaId == 0) break;
            (address seller,,,) = gate.result(lp[i].pleaId);
            uint256 tokenId = l.mint(seller, season, uint8(i + 1), lp[i].pleaId);
            emit LaureateMinted(season, lp[i].pleaId, uint8(i + 1), tokenId);
        }
    }

    /// @notice Once the Cabal is dead and its last season closed, anyone sends what is left (unpaid
    /// shares) to the buy wall.
    function flushToWall() external {
        if (!finished()) revert NotFinished();
        uint256 amount = pot();
        if (amount == 0) return;
        IPleaHook h = IPleaHook(plea.hook());
        imd.forceApprove(address(h), amount);
        h.fundWall(amount);
        emit LeftoverToWall(amount);
    }

    function _tryRecord(uint256 pleaId) internal {
        if (recorded[pleaId]) return;
        (address seller, uint8 score, bool approved, uint64 verdictAt) = gate.result(pleaId);
        if (!approved) return;
        uint256 season = _seasonOf(verdictAt);
        if (closed[season]) return;
        _record(pleaId, season, seller, score);
    }

    function _shareBps(uint256 rank) internal pure returns (uint256) {
        if (rank == 0) return 2_500;
        if (rank == 1) return 1_800;
        if (rank == 2) return 1_400;
        if (rank == 3) return 1_100;
        if (rank == 4) return 900;
        if (rank == 5) return 700;
        if (rank == 6) return 600;
        if (rank == 7) return 400;
        return 300;
    }

    /// @dev A transfer that fails (a blocked recipient) leaves the share in the pot.
    function _pay(address to, uint256 amount) internal returns (bool) {
        (bool ok, bytes memory ret) = address(imd).call(abi.encodeCall(IERC20.transfer, (to, amount)));
        return ok && (ret.length == 0 || abi.decode(ret, (bool)));
    }
}
