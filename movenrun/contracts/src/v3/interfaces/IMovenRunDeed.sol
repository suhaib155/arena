// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @title IMovenRunDeed
/// @notice Permanent ownership record for a single eligible solid H3 resolution-8 cell.
interface IMovenRunDeed is IERC721 {
    /// @notice Creates the initial deed for `h3CellId`. Callable only by the claims contract.
    function mintDeed(address to, uint64 h3CellId, uint32 cityId) external returns (uint256 tokenId);

    /// @notice Moves a deed into contest escrow without requiring the holder's approval.
    /// @dev Callable only by the contests contract; the destination is always that contract.
    function escrowToContests(uint256 tokenId) external;

    /// @notice Releases an escrowed deed to the contest outcome winner.
    /// @dev Callable only by the contests contract; the source is always that contract.
    function releaseFromContests(address to, uint256 tokenId) external;

    /// @notice City domain a deed belongs to, used for concentration limits.
    function cityOf(uint256 tokenId) external view returns (uint32);

    /// @notice Number of deeds already issued inside a city domain.
    function cityDeedCount(uint32 cityId) external view returns (uint256);

    /// @notice Whether a deed already exists for `tokenId`.
    function deedExists(uint256 tokenId) external view returns (bool);
}
