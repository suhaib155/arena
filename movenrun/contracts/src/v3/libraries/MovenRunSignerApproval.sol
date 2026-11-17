// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title MovenRunSignerApproval
/// @notice Second, independent consent for putting a new signing key in place.
/// @dev Replacing a signer is a delayed administrative action. On its own that leaves one
///      party, whoever controls the delayed administrator, able to swap every signing key of
///      a contract and then sign whatever it likes. Contracts that inherit this require each
///      new key to be approved beforehand by SIGNER_APPROVER_ROLE. That role administers
///      itself, so the delayed administrator can neither grant it nor take it away. An
///      approval names one address, expires, and is spent by the replacement it permits.
///      The approver cannot install a key; it can only allow or refuse one.
abstract contract MovenRunSignerApproval is AccessControl {
    /// @notice Independent role that must approve every new signing key.
    bytes32 public constant SIGNER_APPROVER_ROLE = keccak256("MOVENRUN_SIGNER_APPROVER_ROLE");
    /// @notice Lifetime of an approval.
    uint64 public constant SIGNER_APPROVAL_TTL = 7 days;

    /// @notice Time until which a signer may be installed. Zero means not approved.
    mapping(address signer => uint64 expiresAt) public signerApprovalExpiry;

    event SignerAdditionApproved(address indexed signer, uint64 expiresAt, address approver);

    error SignerAdditionNotApproved(address signer);
    error SignerApprovalZeroAddress();

    /// @dev Call once from the constructor with the initial approver.
    function _initSignerApprover(address approver) internal {
        _setRoleAdmin(SIGNER_APPROVER_ROLE, SIGNER_APPROVER_ROLE);
        _grantRole(SIGNER_APPROVER_ROLE, approver);
    }

    /// @notice Approves one future installation of `signer`. SIGNER_APPROVER_ROLE only.
    function approveSignerAddition(address signer) external onlyRole(SIGNER_APPROVER_ROLE) {
        if (signer == address(0)) revert SignerApprovalZeroAddress();
        uint64 expiresAt = uint64(block.timestamp) + SIGNER_APPROVAL_TTL;
        signerApprovalExpiry[signer] = expiresAt;
        emit SignerAdditionApproved(signer, expiresAt, msg.sender);
    }

    /// @notice Withdraws an unused approval. SIGNER_APPROVER_ROLE only.
    function revokeSignerApproval(address signer) external onlyRole(SIGNER_APPROVER_ROLE) {
        delete signerApprovalExpiry[signer];
        emit SignerAdditionApproved(signer, 0, msg.sender);
    }

    function _consumeSignerApproval(address signer) internal {
        if (block.timestamp > signerApprovalExpiry[signer]) revert SignerAdditionNotApproved(signer);
        delete signerApprovalExpiry[signer];
    }
}
