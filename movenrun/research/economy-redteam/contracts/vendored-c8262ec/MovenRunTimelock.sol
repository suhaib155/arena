// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @title MovenRunTimelock
/// @notice Delayed administration for every adjustable MovenRun hypothesis and role change.
/// @dev Deployed with a nonzero delay and with a multisignature administrator as the sole
///      proposer and executor. The optional admin slot is passed as the zero address so the
///      timelock only administers itself and no deployer key remains a permanent root admin.
///
///      This contract governs the adjustable parameters only. The fixed MovenRun constants
///      are compile-time constants in their own contracts and are outside its reach: the
///      one billion MOVE lifetime cap, the four hundred million player movement allocation,
///      the two percent toll rate, the sixty percent automatic-charge ceiling, the seventy
///      two hour contest notice, the seven day scoring window, and the thirty and fourteen
///      day cooldown periods. No timelock proposal can change any of them.
contract MovenRunTimelock is TimelockController {
    error DelayMustBeNonZero();

    /// @param minDelay Minimum delay in seconds between scheduling and execution.
    /// @param proposers Addresses permitted to schedule operations, expected to be a multisignature.
    /// @param executors Addresses permitted to execute scheduled operations.
    /// @param admin Optional administrator; pass the zero address for self-administration only.
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) TimelockController(minDelay, proposers, executors, admin) {
        if (minDelay == 0) revert DelayMustBeNonZero();
    }
}
