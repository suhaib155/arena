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
///
///      G5 DRAFT PATCH (RESEARCH/PROPOSED, unaudited): the delay may never be set below
///      MIN_DELAY_FLOOR, at construction or later through updateDelay, so a one-second
///      timelock cannot be deployed or configured. The floor is one hour so the original
///      fixture (TIMELOCK_DELAY = 3600) runs unchanged; the proposed production floor is
///      48 hours (see DEED_VOID_LIFECYCLE.md, valve section).
contract MovenRunTimelock is TimelockController {
    /// @notice G5 patch: lowest delay the timelock accepts.
    uint256 public constant MIN_DELAY_FLOOR = 1 hours;

    error DelayMustBeNonZero();
    error DelayBelowFloor(uint256 delay, uint256 floor);

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
        if (minDelay < MIN_DELAY_FLOOR) revert DelayBelowFloor(minDelay, MIN_DELAY_FLOOR);
    }

    /// @dev G5 patch: the self-administered delay change keeps the floor.
    function updateDelay(uint256 newDelay) public override {
        if (newDelay < MIN_DELAY_FLOOR) revert DelayBelowFloor(newDelay, MIN_DELAY_FLOOR);
        super.updateDelay(newDelay);
    }
}
