// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

interface IMoveTokenMint {
    function mintMOVE(address to, bytes32 routeHash, uint256 distanceMeters, uint64 hexId) external;
}

// GPSOracle: verifies off-chain GPS route signatures and forwards minting to MoveToken.
// Holds ORACLE_ROLE on MoveToken. The oracleOperator EOA signs route data off-chain.
contract GPSOracle is AccessControl {
    using ECDSA for bytes32;

    address public oracleOperator;
    address public moveToken;

    event RouteSubmitted(address indexed to, bytes32 indexed routeHash, uint256 distanceMeters);
    event OracleOperatorUpdated(address oldOperator, address newOperator);
    event MoveTokenSet(address moveToken);

    constructor(address _oracleOperator) {
        require(_oracleOperator != address(0), "GPSOracle: zero operator"); // FIX-003
        oracleOperator = _oracleOperator;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function setMoveToken(address _moveToken) external onlyRole(DEFAULT_ADMIN_ROLE) {
        moveToken = _moveToken;
        emit MoveTokenSet(_moveToken);
    }

    function updateOperator(address newOperator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        emit OracleOperatorUpdated(oracleOperator, newOperator);
        oracleOperator = newOperator;
    }

    // Verify oracle signature over (chainId, to, routeHash, distanceMeters, hexId) and call mintMOVE.
    // hexId = H3 zone the runner is in (0 if not in any zone). FIX-001 + FIX-004
    function submitRoute(
        address to,
        bytes32 routeHash,
        uint256 distanceMeters,
        uint64  hexId,
        bytes calldata sig
    ) external {
        require(moveToken != address(0), "GPSOracle: moveToken not set");
        bytes32 message = keccak256(abi.encodePacked(block.chainid, to, routeHash, distanceMeters, hexId)); // FIX-001
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(message);
        require(ECDSA.recover(ethHash, sig) == oracleOperator, "GPSOracle: invalid sig");
        IMoveTokenMint(moveToken).mintMOVE(to, routeHash, distanceMeters, hexId);
        emit RouteSubmitted(to, routeHash, distanceMeters);
    }
}
