// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IMovenRunToken} from "./interfaces/IMovenRunToken.sol";

/// @title MovenRunToken
/// @notice The single MovenRun MOVE ERC-20, with a hard lifetime issuance cap and an
///         onchain locked/liquid balance distinction enforced by the token itself.
/// @dev Design invariants, none of which any role, timelock or upgrade path can relax:
///      - `cumulativeMinted` only ever increases and never exceeds `MAX_LIFETIME_MINTED`.
///      - Burning reduces `totalSupply` but never `cumulativeMinted`, so destroyed MOVE
///        does not reopen issuance capacity.
///      - Locked balance is part of the ordinary ERC-20 balance and can only leave an
///        account by being burned. It is never reclassified as liquid.
///      - There is no administrative seizure, blacklist, transfer fee or proxy path.
contract MovenRunToken is ERC20, ERC20Permit, AccessControl, IMovenRunToken {
    /// @notice Contracts allowed to burn a holder's balance against an explicit allowance.
    bytes32 public constant FEE_BURNER_ROLE = keccak256("MOVENRUN_FEE_BURNER_ROLE");

    /// @inheritdoc IMovenRunToken
    uint256 public constant MAX_LIFETIME_MINTED = 1_000_000_000 ether;

    /// @inheritdoc IMovenRunToken
    uint256 public cumulativeMinted;

    /// @notice The only contract permitted to create new MOVE.
    address public settlement;

    /// @notice The only contract permitted to release reserves as locked balance.
    address public rewards;

    /// @notice Address permitted to perform the one-time suite wiring; cleared on finalization.
    address public bootstrapper;

    /// @notice True once the settlement and rewards wiring is permanently sealed.
    bool public bootstrapFrozen;

    mapping(address account => uint256 lockedAmount) private _lockedBalances;

    event CoreContractsConfigured(address indexed settlement, address indexed rewards);
    event BootstrapFinalized(address indexed bootstrapper);
    event SettlementIssued(uint256 grossAmount, uint256 burnedAmount, uint256 cumulativeMinted);
    event LockedBalanceReleased(address indexed account, uint256 amount);
    event LockedBalanceConsumed(address indexed account, uint256 amount);

    error ZeroAddress();
    error NotBootstrapper();
    error BootstrapAlreadyConfigured();
    error BootstrapIsFrozen();
    error BootstrapIncomplete();
    error NotSettlement();
    error NotRewards();
    error LifetimeCapExceeded(uint256 requested, uint256 remaining);
    error BurnExceedsIssuance(uint256 burnAmount, uint256 grossAmount);
    error LockedBalanceNotTransferable(address account, uint256 requested, uint256 liquidAvailable);

    /// @param admin Delayed administrator, expected to be MovenRunTimelock.
    /// @param bootstrapper_ Address permitted to run the one-time wiring, then discarded.
    constructor(address admin, address bootstrapper_)
        ERC20("MovenRun MOVE", "MOVE")
        ERC20Permit("MovenRun MOVE")
    {
        if (admin == address(0) || bootstrapper_ == address(0)) revert ZeroAddress();
        bootstrapper = bootstrapper_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ---------------------------------------------------------------------
    // One-time wiring
    // ---------------------------------------------------------------------

    /// @notice Performs the single permitted wiring of the settlement and rewards contracts.
    /// @dev Callable once, only before finalization, only by the bootstrapper. There is no
    ///      path that replaces these addresses afterwards.
    function configureCore(
        address settlement_,
        address rewards_,
        address[] calldata feeBurners
    ) external {
        if (msg.sender != bootstrapper) revert NotBootstrapper();
        if (bootstrapFrozen) revert BootstrapIsFrozen();
        if (settlement != address(0) || rewards != address(0)) revert BootstrapAlreadyConfigured();
        if (settlement_ == address(0) || rewards_ == address(0)) revert ZeroAddress();

        settlement = settlement_;
        rewards = rewards_;

        uint256 burnerCount = feeBurners.length;
        for (uint256 i = 0; i < burnerCount; ++i) {
            if (feeBurners[i] == address(0)) revert ZeroAddress();
            _grantRole(FEE_BURNER_ROLE, feeBurners[i]);
        }

        emit CoreContractsConfigured(settlement_, rewards_);
    }

    /// @notice Permanently seals the wiring and discards the bootstrapper capability.
    function finalizeBootstrap() external {
        if (msg.sender != bootstrapper) revert NotBootstrapper();
        if (settlement == address(0) || rewards == address(0)) revert BootstrapIncomplete();

        bootstrapFrozen = true;
        bootstrapper = address(0);

        emit BootstrapFinalized(msg.sender);
    }

    // ---------------------------------------------------------------------
    // Issuance
    // ---------------------------------------------------------------------

    /// @inheritdoc IMovenRunToken
    /// @dev The full gross amount is charged against the lifetime cap before any of it is
    ///      destroyed, so an automatic day-close charge is a genuine burn of issued supply
    ///      rather than an accounting shortcut that would leave capacity unused.
    function settlementIssue(uint256 grossAmount, uint256 burnAmount) external {
        if (msg.sender != settlement) revert NotSettlement();
        if (burnAmount > grossAmount) revert BurnExceedsIssuance(burnAmount, grossAmount);

        uint256 remaining = MAX_LIFETIME_MINTED - cumulativeMinted;
        if (grossAmount > remaining) revert LifetimeCapExceeded(grossAmount, remaining);

        cumulativeMinted += grossAmount;

        address reserve = rewards;
        _mint(reserve, grossAmount);
        if (burnAmount > 0) {
            _burn(reserve, burnAmount);
        }

        emit SettlementIssued(grossAmount, burnAmount, cumulativeMinted);
    }

    // ---------------------------------------------------------------------
    // Locked and liquid balances
    // ---------------------------------------------------------------------

    /// @inheritdoc IMovenRunToken
    function releaseLocked(address to, uint256 amount) external {
        if (msg.sender != rewards) revert NotRewards();
        if (to == address(0)) revert ZeroAddress();

        _transfer(msg.sender, to, amount);
        _lockedBalances[to] += amount;

        emit LockedBalanceReleased(to, amount);
    }

    /// @inheritdoc IMovenRunToken
    function lockedBalanceOf(address account) public view returns (uint256) {
        return _lockedBalances[account];
    }

    /// @inheritdoc IMovenRunToken
    function liquidBalanceOf(address account) public view returns (uint256) {
        return balanceOf(account) - _lockedBalances[account];
    }

    /// @inheritdoc IMovenRunToken
    function remainingMintCapacity() external view returns (uint256) {
        return MAX_LIFETIME_MINTED - cumulativeMinted;
    }

    // ---------------------------------------------------------------------
    // Burns
    // ---------------------------------------------------------------------

    /// @inheritdoc IMovenRunToken
    function burn(uint256 amount) external {
        _burnLockedFirst(msg.sender, amount);
    }

    /// @inheritdoc IMovenRunToken
    /// @dev Restricted to registered MovenRun fee sinks and still bounded by the allowance
    ///      the holder granted, so no counterparty can destroy a balance unilaterally.
    function burnFrom(address account, uint256 amount) external onlyRole(FEE_BURNER_ROLE) {
        _spendAllowance(account, msg.sender, amount);
        _burnLockedFirst(account, amount);
    }

    /// @dev Consumes locked balance before liquid balance. This preserves transferable
    ///      liquidity and can never increase the transferable portion of a balance.
    function _burnLockedFirst(address account, uint256 amount) private {
        uint256 lockedBalance = _lockedBalances[account];
        if (lockedBalance > 0) {
            uint256 consumed = amount < lockedBalance ? amount : lockedBalance;
            unchecked {
                _lockedBalances[account] = lockedBalance - consumed;
            }
            emit LockedBalanceConsumed(account, consumed);
        }
        _burn(account, amount);
    }

    // ---------------------------------------------------------------------
    // Transfer enforcement
    // ---------------------------------------------------------------------

    /// @dev Ordinary transfers may only move the liquid portion of a balance. Mints and
    ///      burns are exempt: a mint adds no locked balance, and a burn has already
    ///      decremented the locked portion through `_burnLockedFirst`.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 lockedBalance = _lockedBalances[from];
            if (lockedBalance > 0) {
                uint256 liquid = balanceOf(from) - lockedBalance;
                if (value > liquid) {
                    revert LockedBalanceNotTransferable(from, value, liquid);
                }
            }
        }
        super._update(from, to, value);
    }
}
