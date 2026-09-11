// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MovenRunH3} from "../libraries/MovenRunH3.sol";

/// @title MovenRunH3Probe
/// @notice Test-only wrapper that exposes the MovenRunH3 library to the test runner.
/// @dev This contract is never part of the deployed MovenRun suite. It exists so the H3
///      validator can be exercised as compiled Solidity against h3-js reference vectors,
///      rather than against a reimplementation of the same rules in the test file.
contract MovenRunH3Probe {
    function isValidResolution8Cell(uint64 cellId) external pure returns (bool) {
        return MovenRunH3.isValidResolution8Cell(cellId);
    }

    function resolutionOf(uint64 cellId) external pure returns (uint8) {
        return MovenRunH3.resolutionOf(cellId);
    }

    function baseCellOf(uint64 cellId) external pure returns (uint8) {
        return MovenRunH3.baseCellOf(cellId);
    }

    /// @notice Batch form, so large reference vector sets cost one call rather than thousands.
    function validateBatch(uint64[] calldata cellIds) external pure returns (bool[] memory results) {
        results = new bool[](cellIds.length);
        for (uint256 i = 0; i < cellIds.length; ++i) {
            results[i] = MovenRunH3.isValidResolution8Cell(cellIds[i]);
        }
    }
}
