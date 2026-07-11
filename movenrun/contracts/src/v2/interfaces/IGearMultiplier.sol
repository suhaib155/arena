// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Read-only multiplier source consumed by MoveTokenV2 at mint time.
/// Implemented by GearNFTV2. Result is 1e18-scaled (1e18 = 1.0x).
interface IGearMultiplier {
    function getUserMultiplier(address user) external view returns (uint256);
}
