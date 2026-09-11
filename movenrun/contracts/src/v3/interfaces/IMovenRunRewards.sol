// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IMovenRunRewards
/// @notice Pull-based distribution of finalized daily movement rewards.
interface IMovenRunRewards {
    /// @notice Records a finalized daily allocation. Callable only by the settlement contract.
    /// @param dayId Settlement day identifier.
    /// @param merkleRoot Root committing to the per-account leaves for that day.
    /// @param lockedAllocated Total locked MOVE claimable for that day.
    /// @param liquidAllocated Total liquid MOVE claimable for that day.
    function finalizeDay(
        uint32 dayId,
        bytes32 merkleRoot,
        uint256 lockedAllocated,
        uint256 liquidAllocated
    ) external;
}
