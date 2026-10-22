// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {IMovenRunToken} from "./interfaces/IMovenRunToken.sol";
import {IMovenRunRewards} from "./interfaces/IMovenRunRewards.sol";

/// @title MovenRunRewards
/// @notice Pull-based distribution of finalized daily movement rewards.
/// @dev The contract holds the reserve minted by MovenRunSettlement for each finalized day
///      and releases it against Merkle proofs. It has no administrator, no pause, no
///      withdrawal path and no expiry: once a day is finalized, the allocation belongs to
///      the accounts committed in that day's root and nothing can take it back. Claims stay
///      available even while new settlement publication is paused.
contract MovenRunRewards is IMovenRunRewards {
    /// @notice Domain separator for the per-account daily reward leaf.
    bytes32 public constant REWARD_LEAF_TYPEHASH =
        keccak256(
            "MovenRunDailyRewardLeaf(uint256 chainId,address rewards,uint32 dayId,uint256 leafIndex,address account,uint256 lockedAmount,uint256 liquidAmount)"
        );

    /// @notice The MovenRun MOVE token.
    IMovenRunToken public immutable moveToken;

    /// @notice The only contract permitted to finalize a day.
    address public settlement;

    /// @notice Address permitted to perform the one-time settlement wiring.
    address public bootstrapper;

    struct DailyAllocation {
        bytes32 merkleRoot;
        uint256 lockedAllocated;
        uint256 liquidAllocated;
        uint256 lockedClaimed;
        uint256 liquidClaimed;
        bool finalized;
    }

    mapping(uint32 dayId => DailyAllocation allocation) private _days;
    mapping(uint32 dayId => mapping(uint256 word => uint256 bits)) private _claimedBitmap;

    event SettlementConfigured(address indexed settlement);
    event DayFinalized(uint32 indexed dayId, bytes32 merkleRoot, uint256 lockedAllocated, uint256 liquidAllocated);
    event RewardClaimed(
        uint32 indexed dayId,
        uint256 indexed leafIndex,
        address indexed account,
        uint256 lockedAmount,
        uint256 liquidAmount
    );

    error ZeroAddress();
    error NotBootstrapper();
    error NotSettlement();
    error SettlementAlreadyConfigured();
    error DayAlreadyFinalized(uint32 dayId);
    error DayNotFinalized(uint32 dayId);
    error RewardAlreadyClaimed(uint32 dayId, uint256 leafIndex);
    error InvalidMerkleProof();
    error LockedAllocationExceeded(uint32 dayId);
    error LiquidAllocationExceeded(uint32 dayId);
    error LiquidTransferFailed();

    constructor(address moveToken_, address bootstrapper_) {
        if (moveToken_ == address(0) || bootstrapper_ == address(0)) revert ZeroAddress();
        moveToken = IMovenRunToken(moveToken_);
        bootstrapper = bootstrapper_;
    }

    /// @notice Performs the single permitted wiring of the settlement contract.
    function configureSettlement(address settlement_) external {
        if (msg.sender != bootstrapper) revert NotBootstrapper();
        if (settlement != address(0)) revert SettlementAlreadyConfigured();
        if (settlement_ == address(0)) revert ZeroAddress();

        settlement = settlement_;
        bootstrapper = address(0);

        emit SettlementConfigured(settlement_);
    }

    /// @inheritdoc IMovenRunRewards
    function finalizeDay(
        uint32 dayId,
        bytes32 merkleRoot,
        uint256 lockedAllocated,
        uint256 liquidAllocated
    ) external {
        if (msg.sender != settlement) revert NotSettlement();

        DailyAllocation storage allocation = _days[dayId];
        if (allocation.finalized) revert DayAlreadyFinalized(dayId);

        allocation.merkleRoot = merkleRoot;
        allocation.lockedAllocated = lockedAllocated;
        allocation.liquidAllocated = liquidAllocated;
        allocation.finalized = true;

        emit DayFinalized(dayId, merkleRoot, lockedAllocated, liquidAllocated);
    }

    /// @notice Claims one account's reward for one finalized day.
    /// @dev Anyone may relay the call; the reward is always delivered to `account`, which is
    ///      part of the committed leaf. One account's inaction cannot strand another's reward.
    function claim(
        uint32 dayId,
        uint256 leafIndex,
        address account,
        uint256 lockedAmount,
        uint256 liquidAmount,
        bytes32[] calldata merkleProof
    ) external {
        DailyAllocation storage allocation = _days[dayId];
        if (!allocation.finalized) revert DayNotFinalized(dayId);
        if (isClaimed(dayId, leafIndex)) revert RewardAlreadyClaimed(dayId, leafIndex);

        bytes32 leaf = rewardLeaf(dayId, leafIndex, account, lockedAmount, liquidAmount);
        if (!MerkleProof.verifyCalldata(merkleProof, allocation.merkleRoot, leaf)) {
            revert InvalidMerkleProof();
        }

        uint256 lockedClaimed = allocation.lockedClaimed + lockedAmount;
        uint256 liquidClaimed = allocation.liquidClaimed + liquidAmount;
        if (lockedClaimed > allocation.lockedAllocated) revert LockedAllocationExceeded(dayId);
        if (liquidClaimed > allocation.liquidAllocated) revert LiquidAllocationExceeded(dayId);

        allocation.lockedClaimed = lockedClaimed;
        allocation.liquidClaimed = liquidClaimed;
        _setClaimed(dayId, leafIndex);

        if (lockedAmount > 0) {
            moveToken.releaseLocked(account, lockedAmount);
        }
        if (liquidAmount > 0) {
            if (!moveToken.transfer(account, liquidAmount)) revert LiquidTransferFailed();
        }

        emit RewardClaimed(dayId, leafIndex, account, lockedAmount, liquidAmount);
    }

    /// @notice Recomputes the domain-separated leaf for a daily reward entry.
    function rewardLeaf(
        uint32 dayId,
        uint256 leafIndex,
        address account,
        uint256 lockedAmount,
        uint256 liquidAmount
    ) public view returns (bytes32) {
        return
            keccak256(
                bytes.concat(
                    keccak256(
                        abi.encode(
                            REWARD_LEAF_TYPEHASH,
                            block.chainid,
                            address(this),
                            dayId,
                            leafIndex,
                            account,
                            lockedAmount,
                            liquidAmount
                        )
                    )
                )
            );
    }

    /// @notice Whether a specific leaf of a specific day has already been claimed.
    function isClaimed(uint32 dayId, uint256 leafIndex) public view returns (bool) {
        uint256 word = leafIndex >> 8;
        uint256 bit = leafIndex & 0xFF;
        return (_claimedBitmap[dayId][word] >> bit) & 1 == 1;
    }

    /// @notice Finalized allocation and claim progress for a day.
    function dayAllocation(uint32 dayId) external view returns (DailyAllocation memory) {
        return _days[dayId];
    }

    function _setClaimed(uint32 dayId, uint256 leafIndex) private {
        uint256 word = leafIndex >> 8;
        uint256 bit = leafIndex & 0xFF;
        _claimedBitmap[dayId][word] |= (1 << bit);
    }
}
