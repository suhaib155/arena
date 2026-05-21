// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@chainlink/contracts/src/v0.8/functions/v1_0_0/FunctionsClient.sol";
import "@chainlink/contracts/src/v0.8/shared/access/ConfirmedOwner.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title GPSOracle — on-chain GPS proof verifier backed by Chainlink Functions
/// @notice Verifies backend-signed GPS proofs and provides a hook for Chainlink DON responses
contract GPSOracle is FunctionsClient, ConfirmedOwner {
    using ECDSA for bytes32;

    address public oracleOperator;

    // Pending Chainlink Functions request tracking
    mapping(bytes32 => address) public pendingRequests;

    event OracleOperatorUpdated(address indexed oldOperator, address indexed newOperator);
    event GPSProofVerified(bytes32 indexed routeHash, address indexed user, bool valid);
    event FunctionsRequestSent(bytes32 indexed requestId, address indexed user);
    event FunctionsRequestFulfilled(bytes32 indexed requestId, bytes response);

    error InvalidSignature();
    error ZeroAddress();

    /// @param router Chainlink Functions router address for the target network
    /// @param _oracleOperator Backend signer key address
    constructor(address router, address _oracleOperator) FunctionsClient(router) ConfirmedOwner(msg.sender) {
        if (_oracleOperator == address(0)) revert ZeroAddress();
        oracleOperator = _oracleOperator;
    }

    /// @notice Verify a backend-signed GPS proof
    /// @dev Signer is recovered from keccak256(routeHash, user, block.chainid)
    /// @param routeHash SHA-256 of the full route payload
    /// @param user Wallet address of the runner
    /// @param sig EIP-191 signature from the oracle operator backend
    /// @return valid True if the signature was produced by oracleOperator
    function verifyGPSProof(
        bytes32 routeHash,
        address user,
        bytes calldata sig
    ) external returns (bool valid) {
        bytes32 message = keccak256(abi.encodePacked(routeHash, user, block.chainid));
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(message);
        address recovered = ECDSA.recover(ethHash, sig);
        valid = (recovered == oracleOperator);
        emit GPSProofVerified(routeHash, user, valid);
    }

    /// @notice Stateless view version for off-chain checking without gas cost
    function verifyGPSProofView(
        bytes32 routeHash,
        address user,
        bytes calldata sig
    ) external view returns (bool) {
        bytes32 message = keccak256(abi.encodePacked(routeHash, user, block.chainid));
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(message);
        address recovered = ECDSA.recover(ethHash, sig);
        return recovered == oracleOperator;
    }

    /// @notice Rotate the oracle operator key (admin only)
    function setOracleOperator(address newOperator) external onlyOwner {
        if (newOperator == address(0)) revert ZeroAddress();
        emit OracleOperatorUpdated(oracleOperator, newOperator);
        oracleOperator = newOperator;
    }

    /// @dev Called internally by FunctionsClient.handleOracleFulfillment when a DON request is fulfilled
    function fulfillRequest(
        bytes32 requestId,
        bytes memory response,
        bytes memory /* err */
    ) internal override {
        emit FunctionsRequestFulfilled(requestId, response);
        delete pendingRequests[requestId];
    }
}
