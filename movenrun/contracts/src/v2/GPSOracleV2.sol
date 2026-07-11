// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

interface IMoveTokenMintV2 {
    function mintMOVE(address to, bytes32 routeHash, uint256 distanceMeters, uint64 hexId) external;
}

/// GPSOracleV2 — verifies EIP-712 typed route proofs signed by the oracle
/// operator and forwards minting to MoveTokenV2 (holds ORACLE_ROLE there).
/// The EIP-712 domain binds name ("MovenRun"), version ("2"), chainId, and
/// this contract's address, so a signature is valid for exactly one
/// deployment on exactly one chain. V1 personal-sign tuples can never
/// verify here.
contract GPSOracleV2 is AccessControl, EIP712 {
    string public constant SIGNING_DOMAIN_NAME    = "MovenRun";
    string public constant SIGNING_DOMAIN_VERSION = "2";

    bytes32 public constant ROUTE_PROOF_TYPEHASH = keccak256(
        "RouteProof(address recipient,bytes32 routeHash,uint256 distanceMeters,uint64 hexId,uint256 deadline)"
    );

    address public oracleOperator;
    address public moveToken;

    event RouteSubmitted(address indexed to, bytes32 indexed routeHash, uint256 distanceMeters, uint64 hexId);
    event OracleOperatorUpdated(address oldOperator, address newOperator);
    event MoveTokenSet(address moveToken);

    constructor(address _oracleOperator)
        EIP712(SIGNING_DOMAIN_NAME, SIGNING_DOMAIN_VERSION)
    {
        require(_oracleOperator != address(0), "GPSOracleV2: zero operator");
        oracleOperator = _oracleOperator;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function setMoveToken(address _moveToken) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_moveToken != address(0), "GPSOracleV2: zero moveToken");
        moveToken = _moveToken;
        emit MoveTokenSet(_moveToken);
    }

    function updateOperator(address newOperator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newOperator != address(0), "GPSOracleV2: zero operator");
        emit OracleOperatorUpdated(oracleOperator, newOperator);
        oracleOperator = newOperator;
    }

    /// Verify the typed RouteProof and forward to MoveTokenV2.mintMOVE.
    /// Route-hash replay protection lives in MoveTokenV2.usedRoutes; the
    /// deadline bounds how long a signed proof stays submittable.
    function submitRoute(
        address to,
        bytes32 routeHash,
        uint256 distanceMeters,
        uint64  hexId,
        uint256 deadline,
        bytes calldata sig
    ) external {
        require(moveToken != address(0), "GPSOracleV2: moveToken not set");
        require(block.timestamp <= deadline, "GPSOracleV2: signature expired");

        bytes32 structHash = keccak256(abi.encode(
            ROUTE_PROOF_TYPEHASH,
            to,
            routeHash,
            distanceMeters,
            hexId,
            deadline
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        require(ECDSA.recover(digest, sig) == oracleOperator, "GPSOracleV2: invalid sig");

        IMoveTokenMintV2(moveToken).mintMOVE(to, routeHash, distanceMeters, hexId);
        emit RouteSubmitted(to, routeHash, distanceMeters, hexId);
    }

    /// Exposed for off-chain signers/tests to cross-check domain separators.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
