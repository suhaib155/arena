// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title MovenRunH3
/// @notice Structural validation of canonical H3 resolution-8 cell identifiers.
/// @dev This library is a fail-closed structural pre-filter only. It proves that a 64-bit
///      value is shaped like a canonical resolution-8 H3 cell index; it does not and cannot
///      prove that the cell is solid ground, that it is eligible, or that the caller holds it.
///      Those properties come exclusively from the signed MovenRun eligibility attestation.
///      A value rejected here can never become a deed; a value accepted here still has to
///      clear every attestation check.
///
///      Index layout (most significant bit first):
///        bit  63      reserved, always zero
///        bits 62..59  index mode, 1 for a cell index
///        bits 58..56  mode-dependent bits, unused for cell indexes
///        bits 55..52  resolution, 0..15
///        bits 51..45  base cell, 0..121
///        bits 44..0   fifteen 3-bit digits; digits beyond the resolution are the unused
///                     sentinel 7, digits within the resolution are 0..6
library MovenRunH3 {
    /// @dev Index mode value that denotes a cell index.
    uint64 internal constant CELL_MODE = 1;
    /// @dev The only resolution MovenRun deeds are issued at.
    uint64 internal constant TARGET_RESOLUTION = 8;
    /// @dev Number of digit slots carried by every H3 index.
    uint8 internal constant MAX_DIGITS = 15;
    /// @dev Highest valid base cell number.
    uint64 internal constant MAX_BASE_CELL = 121;
    /// @dev Digit value reserved for slots beyond the index resolution.
    uint64 internal constant UNUSED_DIGIT = 7;
    /// @dev Digit value along the K axis, which pentagon base cells do not have.
    uint64 internal constant K_AXIS_DIGIT = 1;

    /// @dev The twelve pentagon base cells, as a bitmap indexed by base cell number.
    uint128 internal constant PENTAGON_BASE_CELLS =
        (uint128(1) << 4) |
        (uint128(1) << 14) |
        (uint128(1) << 24) |
        (uint128(1) << 38) |
        (uint128(1) << 49) |
        (uint128(1) << 58) |
        (uint128(1) << 63) |
        (uint128(1) << 72) |
        (uint128(1) << 83) |
        (uint128(1) << 97) |
        (uint128(1) << 107) |
        (uint128(1) << 117);

    /// @notice Returns true when `cellId` is a structurally canonical resolution-8 cell index.
    function isValidResolution8Cell(uint64 cellId) internal pure returns (bool) {
        if (cellId >> 63 != 0) {
            return false;
        }
        if (((cellId >> 59) & 0xF) != CELL_MODE) {
            return false;
        }
        if (((cellId >> 56) & 0x7) != 0) {
            return false;
        }
        if (((cellId >> 52) & 0xF) != TARGET_RESOLUTION) {
            return false;
        }

        uint64 baseCell = (cellId >> 45) & 0x7F;
        if (baseCell > MAX_BASE_CELL) {
            return false;
        }

        bool isPentagon = ((PENTAGON_BASE_CELLS >> uint8(baseCell)) & 1) == 1;
        bool leadingZeros = true;

        for (uint8 digit = 1; digit <= MAX_DIGITS; ++digit) {
            uint64 value = (cellId >> ((MAX_DIGITS - digit) * 3)) & 0x7;

            if (digit <= TARGET_RESOLUTION) {
                if (value == UNUSED_DIGIT) {
                    return false;
                }
                if (leadingZeros && value != 0) {
                    leadingZeros = false;
                    // Pentagon base cells have a deleted K-axis subsequence, so the first
                    // significant digit under a pentagon can never be the K-axis digit.
                    if (isPentagon && value == K_AXIS_DIGIT) {
                        return false;
                    }
                }
            } else if (value != UNUSED_DIGIT) {
                return false;
            }
        }

        return true;
    }

    /// @notice Returns the resolution encoded in `cellId` without validating the rest of it.
    function resolutionOf(uint64 cellId) internal pure returns (uint8) {
        return uint8((cellId >> 52) & 0xF);
    }

    /// @notice Returns the base cell encoded in `cellId` without validating the rest of it.
    function baseCellOf(uint64 cellId) internal pure returns (uint8) {
        return uint8((cellId >> 45) & 0x7F);
    }
}
