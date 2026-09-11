// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @title IMovenRunDeed
/// @notice Permanent ownership record for a single eligible solid H3 resolution-8 cell.
interface IMovenRunDeed is IERC721 {
    /// @notice Creates the initial deed for `h3CellId`. Callable only by the claims contract.
    function mintDeed(address to, uint64 h3CellId, uint32 cityId) external returns (uint256 tokenId);

    /// @notice Takes one of `holder`'s city slots for a contest they have just declared.
    /// @dev Callable only by the contests contract. Reverts when the holder has no capacity
    ///      left in the city, which is what makes every accepted declaration settleable.
    function reserveCitySlot(address holder, uint32 cityId) external;

    /// @notice Moves a deed into contest escrow without requiring the holder's approval.
    /// @dev Callable only by the contests contract; the destination is always that contract.
    ///      The deed keeps counting against the defender's city concentration while escrowed.
    function escrowToContests(uint256 tokenId) external;

    /// @notice Releases an escrowed deed to the contest winner and reconciles concentration.
    /// @dev Callable only by the contests contract. Consumes the challenger's reservation when
    ///      they win and releases it when they lose. Never fails on city capacity.
    function settleContestEscrow(
        uint256 tokenId,
        address defender,
        address challenger,
        address winner
    ) external;

    /// @notice City domain a deed belongs to, used for concentration limits.
    function cityOf(uint256 tokenId) external view returns (uint32);

    /// @notice Number of deeds already issued inside a city domain.
    function cityDeedCount(uint32 cityId) external view returns (uint256);

    /// @notice Deeds any one holder may hold inside a city, and whether the city is configured.
    function cityConcentrationCap(uint32 cityId)
        external
        view
        returns (uint256 capPerHolder, bool configured);

    /// @notice Deeds `holder` currently counts against `cityId`, escrowed defences included.
    function holderCityDeedCount(address holder, uint32 cityId) external view returns (uint256);

    /// @notice City capacity already promised to `holder` by open contest declarations.
    function holderCityReservedCount(address holder, uint32 cityId) external view returns (uint256);

    /// @notice Further deeds `holder` could still take on inside `cityId`.
    function holderCityCapacityRemaining(address holder, uint32 cityId)
        external
        view
        returns (uint256);

    /// @notice Whether a deed already exists for `tokenId`.
    function deedExists(uint256 tokenId) external view returns (bool);
}
