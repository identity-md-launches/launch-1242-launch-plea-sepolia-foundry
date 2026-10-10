// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPLEA, IGate, ILaureates} from "./interfaces/IPleaParts.sol";

/// @title Seasons — PLEA's leaderboard, prizes and the ransom that revives the Cabal
/// @notice Each era (one Cabal) has two seasons of `SEASON` each; a season also ends early when its
/// Cabal dies. An approved plea earns its judges' score (0-45) as points; each wallet's best three
/// count. When a season ends anyone calls `closeSeason`: the top 10 (at least 60 points) are paid
/// 25/18/14/11/9/7/6/4/3/3 % of the prize pot in IMD, unpaid shares roll over, and the season's
/// five best pleas are minted as Laureates. The pot is fed by the hook's 0.25% prize fee.
///
/// After a Cabal dies PLEA trades freely for `BREAK`; then the ransom opens. If holders put 500
/// IMD in within `RANSOM_WINDOW`, the next Cabal returns after a `WARNING`, with the ransom as its
/// first season's extra prizes; a contribution of at least 6 IMD earns a soulbound relic (+10% on
/// that season's points). Otherwise contributors take their IMD back and anyone may start a new
/// round by contributing.
contract Seasons {
    using SafeERC20 for IERC20;

    error BelowAgreedTiming();
    error ZeroTiming();
    error NotApproved(uint256 pleaId);
    error AlreadyRecorded(uint256 pleaId);
    error SeasonClosed(uint256 seasonKey);
    error NotReady(uint256 seasonKey);
    error CabalNotDead();
    error RansomNotOpen(uint64 opensAt);
    error RansomClosed();
    error ZeroAmount();
    error NothingToRefund();
    error RoundNotFailed();

    event Recorded(
        uint256 indexed pleaId, uint256 indexed seasonKey, address indexed wallet, uint8 score, uint16 points10
    );
    event SeasonClosedOut(uint256 indexed seasonKey, uint256 pot, uint256 paid);
    event PrizePaid(uint256 indexed seasonKey, address indexed wallet, uint8 rank, uint256 amount);
    event LaureateMinted(uint256 indexed seasonKey, uint256 indexed pleaId, uint8 rank, uint256 tokenId);
    event RansomRound(uint256 indexed round, uint256 indexed era, uint64 opensAt, uint64 closesAt);
    event Contributed(uint256 indexed round, address indexed wallet, uint256 amount, uint256 total);
    event RelicEarned(uint256 indexed round, address indexed wallet);
    event RansomPaid(uint256 indexed round, uint256 total, uint64 cabalReturnsAt);
    event Refunded(uint256 indexed round, address indexed wallet, uint256 amount);

    /// @dev Points are kept ×10 so the relic's +10% stays exact.
    struct Entry {
        address wallet;
        uint16 points10;
        uint64 pleaId; // the plea that last raised the total (ties go to the earlier one)
    }

    struct PleaEntry {
        uint64 pleaId;
        uint8 score;
    }

    struct Round {
        uint32 era;
        uint64 opensAt;
        uint64 closesAt;
        uint128 total;
        bool succeeded;
    }

    // ---------------------------------------------------------------- agreed numbers
    uint256 public constant RANSOM_TARGET = 500e18;
    uint256 public constant RELIC_MIN = 6e18;
    uint256 public constant MIN_POINTS10 = 600;
    uint256 public constant TOP = 10;
    uint256 public constant LAUREATES_PER_SEASON = 5;
    /// @notice After a season ends, time to record late approvals before it can be closed.
    uint256 public constant CLOSE_GRACE = 1 hours;

    IPLEA public immutable plea;
    IGate public immutable gate;
    IERC20 public immutable imd;
    uint256 public immutable SEASON;
    uint256 public immutable BREAK;
    uint256 public immutable RANSOM_WINDOW;
    uint256 public immutable WARNING;

    mapping(uint256 => Entry[10]) internal _top;
    mapping(uint256 => PleaEntry[5]) internal _topPleas;
    mapping(uint256 => mapping(address => uint8[3])) internal _best;
    mapping(uint256 => bool) public closed;
    mapping(uint256 => bool) public recorded;
    /// @notice The oldest season not yet closed (seasonKey = era * 2 + season within the era).
    uint256 public nextToClose;

    Round[] internal _rounds;
    mapping(uint256 => mapping(address => uint256)) public contributed;
    /// @notice The ransom round (index + 1) that revived an era.
    mapping(uint256 => uint256) public revivingRound;
    /// @notice Ransom IMD held for open or failed rounds (refundable, not prize money).
    uint256 public escrow;
    /// @notice Paid ransoms waiting for their season, and per season.
    uint256 public reservedTotal;
    mapping(uint256 => uint256) public bonus;

    constructor(address plea_, address gate_, address imd_, uint256 break_, uint256 ransomWindow_, uint256 warning_) {
        if (break_ == 0 || ransomWindow_ == 0 || warning_ == 0) revert ZeroTiming();
        if (block.chainid == 1 && (break_ < 72 hours || ransomWindow_ < 72 hours || warning_ < 24 hours)) {
            revert BelowAgreedTiming();
        }
        plea = IPLEA(plea_);
        gate = IGate(gate_);
        imd = IERC20(imd_);
        SEASON = IGate(gate_).SEASON();
        BREAK = break_;
        RANSOM_WINDOW = ransomWindow_;
        WARNING = warning_;
    }

    // ================================================================ views

    function topOf(uint256 seasonKey) external view returns (Entry[10] memory) {
        return _top[seasonKey];
    }

    function topPleasOf(uint256 seasonKey) external view returns (PleaEntry[5] memory) {
        return _topPleas[seasonKey];
    }

    function bestOf(uint256 seasonKey, address wallet) external view returns (uint8[3] memory) {
        return _best[seasonKey][wallet];
    }

    /// @notice A season's window. It exists once it has started and its Cabal was alive then; it
    /// ends after `SEASON` or when its Cabal dies.
    function seasonBounds(uint256 key) public view returns (bool exists, uint64 start, uint64 end, bool ended) {
        (uint64 es, uint64 died) = gate.eraTimes(key / 2);
        if (es == 0) return (false, 0, 0, false);
        uint256 s = uint256(es) + (key % 2) * SEASON;
        uint256 e = s + SEASON;
        if (block.timestamp < s || (died != 0 && died <= s)) return (false, uint64(s), uint64(e), false);
        if (died != 0 && died < e) e = died;
        return (true, uint64(s), uint64(e), block.timestamp >= e);
    }

    /// @notice The season the current time falls in, if a Cabal is alive.
    function currentSeason() external view returns (bool live, uint256 key, uint64 endsAt) {
        uint256 era = gate.eraIndex();
        for (uint256 i; i < 2; ++i) {
            (bool ex,, uint64 end, bool ended) = seasonBounds(era * 2 + i);
            if (ex && !ended) return (true, era * 2 + i, end);
        }
        return (false, 0, 0);
    }

    /// @notice Prize IMD a season would share out if closed now.
    function potFor(uint256 key) public view returns (uint256) {
        uint256 bal = imd.balanceOf(address(this));
        uint256 held = escrow + reservedTotal;
        uint256 free = bal > held ? bal - held : 0;
        return free + bonus[key];
    }

    function roundCount() external view returns (uint256) {
        return _rounds.length;
    }

    function rounds(uint256 i) external view returns (Round memory) {
        return _rounds[i];
    }

    /// @notice Whether `wallet` holds the relic of the ransom that revived `era`.
    function relicOf(address wallet, uint256 era) public view returns (bool) {
        uint256 r = revivingRound[era];
        return r != 0 && contributed[r - 1][wallet] >= RELIC_MIN;
    }

    // ================================================================ points

    /// @notice Records an approved plea's score for its season. Anyone may call it; the seller has
    /// every reason to. Must happen before the season is closed.
    function record(uint256 pleaId) external {
        (address seller, uint8 score, bool approved, uint64 verdictAt, uint32 era) = gate.result(pleaId);
        if (!approved) revert NotApproved(pleaId);
        if (recorded[pleaId]) revert AlreadyRecorded(pleaId);
        uint256 key = _keyOf(era, verdictAt);
        if (closed[key]) revert SeasonClosed(key);
        _record(pleaId, key, seller, score, era);
    }

    function _keyOf(uint32 era, uint64 verdictAt) internal view returns (uint256) {
        (uint64 es,) = gate.eraTimes(era);
        uint256 s = (uint256(verdictAt) - es) / SEASON;
        return uint256(era) * 2 + (s > 1 ? 1 : s);
    }

    function _record(uint256 pleaId, uint256 key, address seller, uint8 score, uint32 era) internal {
        recorded[pleaId] = true;
        _insertPlea(key, uint64(pleaId), score);
        uint8[3] storage b = _best[key][seller];
        uint256 mi;
        if (b[1] < b[mi]) mi = 1;
        if (b[2] < b[mi]) mi = 2;
        uint16 pts;
        if (score > b[mi]) {
            b[mi] = score;
            uint256 sum = uint256(b[0]) + b[1] + b[2];
            pts = uint16(sum * (key % 2 == 0 && relicOf(seller, era) ? 11 : 10));
            _insertWallet(key, Entry({wallet: seller, points10: pts, pleaId: uint64(pleaId)}));
        }
        emit Recorded(pleaId, key, seller, score, pts);
    }

    function _better(Entry memory a, Entry memory b) internal pure returns (bool) {
        if (b.wallet == address(0)) return true;
        return a.points10 > b.points10 || (a.points10 == b.points10 && a.pleaId < b.pleaId);
    }

    function _insertWallet(uint256 key, Entry memory ne) internal {
        Entry[10] storage t = _top[key];
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

    function _insertPlea(uint256 key, uint64 pleaId, uint8 score) internal {
        PleaEntry[5] storage t = _topPleas[key];
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
        uint256 key = nextToClose;
        (bool exists,, uint64 end, bool ended) = seasonBounds(key);
        if (!exists || !ended || block.timestamp < uint256(end) + CLOSE_GRACE) revert NotReady(key);
        closed[key] = true;
        (bool nextExists,,,) = seasonBounds(key + 1);
        nextToClose = (key % 2 == 0 && nextExists) ? key + 1 : (key / 2 + 1) * 2;

        uint256 pot = potFor(key);
        reservedTotal -= bonus[key];
        bonus[key] = 0;
        uint256 paid;
        Entry[10] memory t = _top[key];
        for (uint256 i; i < TOP; ++i) {
            if (t[i].wallet == address(0) || t[i].points10 < MIN_POINTS10) continue;
            uint256 amount = pot * _shareBps(i) / 10_000;
            if (amount != 0 && _pay(t[i].wallet, amount)) {
                paid += amount;
                emit PrizePaid(key, t[i].wallet, uint8(i + 1), amount);
            }
        }
        emit SeasonClosedOut(key, pot, paid);

        PleaEntry[5] memory lp = _topPleas[key];
        ILaureates l = ILaureates(plea.laureates());
        for (uint256 i; i < LAUREATES_PER_SEASON; ++i) {
            if (lp[i].pleaId == 0) break;
            (address seller,,,,) = gate.result(lp[i].pleaId);
            uint256 tokenId = l.mint(seller, key, uint8(i + 1), lp[i].pleaId);
            emit LaureateMinted(key, lp[i].pleaId, uint8(i + 1), tokenId);
        }
    }

    function _tryRecord(uint256 pleaId) internal {
        if (recorded[pleaId]) return;
        (address seller, uint8 score, bool approved, uint64 verdictAt, uint32 era) = gate.result(pleaId);
        if (!approved) return;
        uint256 key = _keyOf(era, verdictAt);
        if (closed[key]) return;
        _record(pleaId, key, seller, score, era);
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

    // ================================================================ ransom

    /// @notice Where the ransom stands: 0 Cabal alive (or not begun), 1 free-trading break,
    /// 2 ransom open, 3 last round failed (refunds; contributing starts a new round), 4 warning
    /// (paid; the Cabal returns at `at`).
    function ransomPhase() external view returns (uint8 phase, uint64 at, uint256 round, uint256 total) {
        uint256 era = gate.eraIndex();
        (uint64 es,) = gate.eraTimes(era);
        if (block.timestamp < es) return (4, es, revivingRound[era] - 1, _rounds[revivingRound[era] - 1].total);
        uint64 died = gate.diedAt();
        if (died == 0) return (0, 0, 0, 0);
        uint256 n = _rounds.length;
        if (n != 0 && _rounds[n - 1].era == era) {
            Round memory r = _rounds[n - 1];
            if (block.timestamp < r.closesAt) return (2, r.closesAt, n - 1, r.total);
            return (3, r.closesAt, n - 1, r.total);
        }
        uint256 opens = uint256(died) + BREAK;
        if (block.timestamp < opens) return (1, uint64(opens), 0, 0);
        if (block.timestamp < opens + RANSOM_WINDOW) return (2, uint64(opens + RANSOM_WINDOW), n, 0);
        return (3, uint64(opens + RANSOM_WINDOW), n, 0);
    }

    /// @notice Puts `amount` IMD toward the ransom. Opens after the break; a failed round's window
    /// is over, so the next contribution starts a new round. Reaching 500 IMD schedules the next
    /// Cabal after the warning.
    function contribute(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        uint64 died = gate.diedAt();
        if (died == 0) revert CabalNotDead();
        uint256 era = gate.eraIndex();
        uint256 r = _roundFor(era, died);
        Round storage rd = _rounds[r];
        if (block.timestamp < rd.opensAt) revert RansomNotOpen(rd.opensAt);
        imd.safeTransferFrom(msg.sender, address(this), amount);
        uint256 before = contributed[r][msg.sender];
        contributed[r][msg.sender] = before + amount;
        uint256 total = rd.total + amount;
        rd.total = uint128(total);
        escrow += amount;
        emit Contributed(r, msg.sender, amount, total);
        if (before < RELIC_MIN && before + amount >= RELIC_MIN) emit RelicEarned(r, msg.sender);
        if (total >= RANSOM_TARGET) {
            rd.succeeded = true;
            escrow -= total;
            uint256 firstSeason = (era + 1) * 2;
            bonus[firstSeason] += total;
            reservedTotal += total;
            revivingRound[era + 1] = r + 1;
            uint64 at = uint64(block.timestamp + WARNING);
            gate.revive(at);
            emit RansomPaid(r, total, at);
        }
    }

    function _roundFor(uint256 era, uint64 died) internal returns (uint256) {
        uint256 n = _rounds.length;
        if (n != 0) {
            Round storage last = _rounds[n - 1];
            if (last.era == era) {
                if (block.timestamp < last.closesAt) return n - 1;
                return _openRound(era, uint64(block.timestamp));
            }
        }
        uint256 opens = uint256(died) + BREAK;
        // Nobody contributed in the first window: that round failed empty; a new one starts now.
        if (block.timestamp >= opens + RANSOM_WINDOW) opens = block.timestamp;
        return _openRound(era, uint64(opens));
    }

    function _openRound(uint256 era, uint64 opens) internal returns (uint256 r) {
        r = _rounds.length;
        uint64 closes = uint64(opens + RANSOM_WINDOW);
        _rounds.push(Round({era: uint32(era), opensAt: opens, closesAt: closes, total: 0, succeeded: false}));
        emit RansomRound(r, era, opens, closes);
    }

    /// @notice Takes back a contribution to a round that missed its target.
    function refund(uint256 round) external {
        Round storage rd = _rounds[round];
        if (rd.succeeded || block.timestamp < rd.closesAt) revert RoundNotFailed();
        uint256 amount = contributed[round][msg.sender];
        if (amount == 0) revert NothingToRefund();
        contributed[round][msg.sender] = 0;
        escrow -= amount;
        imd.safeTransfer(msg.sender, amount);
        emit Refunded(round, msg.sender, amount);
    }
}
