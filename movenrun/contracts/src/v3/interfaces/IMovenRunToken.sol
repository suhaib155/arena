// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IMovenRunToken
/// @notice External surface of the MovenRun MOVE token used by the rest of the V3 suite.
/// @dev The token enforces the locked/liquid distinction itself; no integrating contract
///      may reclassify a balance that has already been issued as locked.
interface IMovenRunToken is IERC20 {
    /// @notice Hard lifetime issuance ceiling. Never raisable by any role, proxy or timelock.
    function MAX_LIFETIME_MINTED() external view returns (uint256);

    /// @notice Total MOVE ever created, monotonically increasing. Burning never reduces it.
    function cumulativeMinted() external view returns (uint256);

    /// @notice Issuance capacity still available under the lifetime cap.
    function remainingMintCapacity() external view returns (uint256);

    /// @notice Portion of `account`'s balance that may never be transferred.
    function lockedBalanceOf(address account) external view returns (uint256);

    /// @notice Portion of `account`'s balance that is freely transferable.
    function liquidBalanceOf(address account) external view returns (uint256);

    /// @notice Creates `grossAmount` against the lifetime cap and immediately destroys
    ///         `burnAmount` of it, funding the rewards reserve with the remainder.
    /// @dev Restricted to the settlement contract configured during bootstrap.
    function settlementIssue(uint256 grossAmount, uint256 burnAmount) external;

    /// @notice Moves `amount` from the rewards reserve to `to` and marks it locked.
    /// @dev Restricted to the rewards contract configured during bootstrap.
    function releaseLocked(address to, uint256 amount) external;

    /// @notice Destroys `amount` of the caller's own balance, locked portion first.
    function burn(uint256 amount) external;

    /// @notice Destroys `amount` of `account`'s balance, locked portion first, spending allowance.
    /// @dev Restricted to fee-burner contracts; requires an explicit allowance from `account`.
    function burnFrom(address account, uint256 amount) external;
}
