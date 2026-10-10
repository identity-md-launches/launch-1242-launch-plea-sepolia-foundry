// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IGate} from "./interfaces/IPleaParts.sol";

interface IUniPool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
}

interface IUniV2Factory {
    function getPair(address a, address b) external view returns (address);
}

interface IUniV3Factory {
    function getPool(address a, address b, uint24 fee) external view returns (address);
}

/// @title PLEA — the sell-gated meme token
/// @notice 1e9 supply, 18 decimals, minted once in `init` (90% hook, 10% distributor). While the
/// gate says the Cabal is watching (`restricted()`), transfers are limited: see `_update`. The
/// restriction switches off when a Cabal dies and back on when the next one is revived.
contract PLEA is ERC20, Ownable {
    error CabalIsWatching();
    error NotDeployTx();
    error AlreadySet();
    error NotLauncher();
    error ZeroAddress();
    error NotAnExitPool();

    event Launched(address indexed launcher, address gate, address seasons, address laureates, address distributor);
    event Initialized(address indexed hook);
    event Allowed(address indexed account);
    event ExitRegistered(address indexed pool);

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;
    // keccak256("plea.deploy-tx") - 1
    uint256 private constant DEPLOY_TX_SLOT = 0x6e1b7d1b1a9e3e1b4d3f8c2a1d0b9e8f7c6b5a4d3e2f1a0b9c8d7e6f5a4b3c2d;

    /// @dev Fallback for the transient flag: the launch rehearsal deploys each contract in its own
    /// call, which clears transient storage, so `setLauncher` also accepts the deployment block.
    uint256 public immutable deployBlock;
    /// @notice Uniswap factories whose pools may be registered as exits (zero disables that kind).
    address public immutable v2Factory;
    address public immutable v3Factory;

    address public launcher;
    address public gate;
    address public seasons;
    address public laureates;
    address public distributor;
    address public hook;
    address public poolManager;

    /// @notice Add-only allowlist of senders exempt from the Cabal's transfer rule.
    mapping(address => bool) public allowed;
    /// @notice Genuine Uniswap v2/v3 pools that may send PLEA while the Cabal watches (LP exits
    /// and buys), never receive it from wallets.
    mapping(address => bool) public exitPool;

    constructor(address owner_, address v2Factory_, address v3Factory_) ERC20("PLEA", "PLEA") Ownable(owner_) {
        deployBlock = block.number;
        v2Factory = v2Factory_;
        v3Factory = v3Factory_;
        assembly ("memory-safe") {
            tstore(DEPLOY_TX_SLOT, 1)
        }
    }

    /// @notice Called once by PleaLaunch's constructor inside the launch transaction: records the
    /// launcher and the system's contracts. Nobody can call it afterwards.
    function setLauncher(address gate_, address seasons_, address laureates_, address distributor_) external {
        uint256 flag;
        assembly ("memory-safe") {
            flag := tload(DEPLOY_TX_SLOT)
        }
        if (flag != 1 && block.number != deployBlock) revert NotDeployTx();
        if (launcher != address(0)) revert AlreadySet();
        if (gate_ == address(0) || seasons_ == address(0) || laureates_ == address(0) || distributor_ == address(0)) {
            revert ZeroAddress();
        }
        assembly ("memory-safe") {
            tstore(DEPLOY_TX_SLOT, 0)
        }
        launcher = msg.sender;
        gate = gate_;
        seasons = seasons_;
        laureates = laureates_;
        distributor = distributor_;
        emit Launched(msg.sender, gate_, seasons_, laureates_, distributor_);
    }

    /// @notice Records the hook and mints the supply: 90% to the hook, 10% to the distributor.
    /// Only the launcher, once (from `deployHook`).
    function init(address hook_, address poolManager_) external {
        if (msg.sender != launcher) revert NotLauncher();
        if (hook != address(0)) revert AlreadySet();
        if (hook_ == address(0) || poolManager_ == address(0)) revert ZeroAddress();
        hook = hook_;
        poolManager = poolManager_;
        _mint(hook_, TOTAL_SUPPLY * 90 / 100);
        _mint(distributor, TOTAL_SUPPLY * 10 / 100);
        emit Initialized(hook_);
    }

    /// @notice Owner adds an address that may send PLEA freely while the Cabal watches. Add-only.
    function allow(address account) external onlyOwner {
        allowed[account] = true;
        emit Allowed(account);
    }

    /// @notice Anyone registers a genuine Uniswap v2 pair or v3 pool holding PLEA, so its LPs can
    /// still withdraw (and buyers buy) when sell limits return. Checked against the factories, so a
    /// look-alike contract (or a Safe, or a 7702 wallet) can never be registered.
    function registerExit(address pool) external {
        if (!isUniswapPool(pool)) revert NotAnExitPool();
        exitPool[pool] = true;
        emit ExitRegistered(pool);
    }

    function isUniswapPool(address pool) public view returns (bool) {
        if (pool.code.length == 0) return false;
        address t0;
        address t1;
        try IUniPool(pool).token0() returns (address a) {
            t0 = a;
        } catch {
            return false;
        }
        try IUniPool(pool).token1() returns (address b) {
            t1 = b;
        } catch {
            return false;
        }
        if (t0 != address(this) && t1 != address(this)) return false;
        if (v2Factory != address(0)) {
            try IUniV2Factory(v2Factory).getPair(t0, t1) returns (address p) {
                if (p == pool) return true;
            } catch {}
        }
        if (v3Factory != address(0)) {
            try IUniPool(pool).fee() returns (uint24 fee) {
                try IUniV3Factory(v3Factory).getPool(t0, t1, fee) returns (address p) {
                    if (p == pool) return true;
                } catch {}
            } catch {}
        }
        return false;
    }

    /// @notice Burns the caller's own tokens (the hook burns trims and the burn fee this way).
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /// @notice True while sell limits apply: before trading opens, and while a Cabal lives.
    function restricted() public view returns (bool) {
        address g = gate;
        if (g == address(0)) return true;
        return IGate(g).restricted();
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && restricted()) {
            if (to == poolManager) {
                if (from != gate && from != hook) revert CabalIsWatching();
            } else if (to == gate) {
                // Only the gate pulls PLEA (transferFrom in executeSell); direct sends are refused.
                if (msg.sender != gate) revert CabalIsWatching();
            } else if (
                from != poolManager && from != hook && from != gate && from != distributor && !allowed[from]
                    && !exitPool[from]
            ) {
                revert CabalIsWatching();
            }
        }
        super._update(from, to, value);
    }
}
