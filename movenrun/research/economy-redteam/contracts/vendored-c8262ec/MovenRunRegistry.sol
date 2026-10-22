// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title MovenRunRegistry
/// @notice One discoverable, versioned address record for the MovenRun V3 contract suite.
/// @dev The registry holds no business logic and takes no custody. Records are append-only:
///      publishing a new version never rewrites a historical one, so a client can always
///      resolve the exact addresses a past version referred to. The record can additionally
///      be frozen permanently, after which no further version can be published at all.
contract MovenRunRegistry is AccessControl {
    struct SuiteDeployment {
        string suiteVersion;
        uint256 chainId;
        address timelock;
        address token;
        address rewards;
        address settlement;
        address deed;
        address deedClaims;
        address contests;
        address marketplace;
        uint64 recordedAt;
    }

    /// @notice Address permitted to publish the first record, then discarded.
    address public bootstrapper;
    /// @notice Sequence number of the most recent published version. Zero means none.
    uint256 public latestVersion;
    /// @notice True once no further version can ever be published.
    bool public frozen;

    mapping(uint256 version => SuiteDeployment record) private _records;

    event SuiteDeploymentPublished(uint256 indexed version, string suiteVersion, uint256 chainId);
    event RegistryFrozen(address indexed actor, uint256 finalVersion);

    error ZeroAddress();
    error NotPublisher();
    error RegistryIsFrozen();
    error ChainIdMismatch(uint256 provided, uint256 actual);
    error NoRecordPublished();

    /// @param admin Delayed administrator, expected to be MovenRunTimelock.
    /// @param bootstrapper_ Address permitted to publish the first record, then discarded.
    constructor(address admin, address bootstrapper_) {
        if (admin == address(0) || bootstrapper_ == address(0)) revert ZeroAddress();
        bootstrapper = bootstrapper_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Appends a suite deployment record as a new version.
    /// @dev The first record is published by the bootstrapper during deployment, which then
    ///      gives up the capability. Later versions require delayed administration.
    function publishDeployment(SuiteDeployment calldata record) external returns (uint256 version) {
        bool isBootstrap = msg.sender == bootstrapper && latestVersion == 0;
        if (!isBootstrap && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) revert NotPublisher();
        if (frozen) revert RegistryIsFrozen();
        if (record.chainId != block.chainid) revert ChainIdMismatch(record.chainId, block.chainid);
        if (
            record.timelock == address(0) ||
            record.token == address(0) ||
            record.rewards == address(0) ||
            record.settlement == address(0) ||
            record.deed == address(0) ||
            record.deedClaims == address(0) ||
            record.contests == address(0) ||
            record.marketplace == address(0)
        ) revert ZeroAddress();

        version = latestVersion + 1;
        _records[version] = SuiteDeployment({
            suiteVersion: record.suiteVersion,
            chainId: record.chainId,
            timelock: record.timelock,
            token: record.token,
            rewards: record.rewards,
            settlement: record.settlement,
            deed: record.deed,
            deedClaims: record.deedClaims,
            contests: record.contests,
            marketplace: record.marketplace,
            recordedAt: uint64(block.timestamp)
        });
        latestVersion = version;

        if (isBootstrap) {
            bootstrapper = address(0);
        }

        emit SuiteDeploymentPublished(version, record.suiteVersion, record.chainId);
    }

    /// @notice Permanently prevents any further version from being published.
    function freeze() external {
        if (msg.sender != bootstrapper && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotPublisher();
        }
        if (latestVersion == 0) revert NoRecordPublished();

        frozen = true;
        bootstrapper = address(0);

        emit RegistryFrozen(msg.sender, latestVersion);
    }

    /// @notice A published historical record. Never rewritten once published.
    function deploymentAt(uint256 version) external view returns (SuiteDeployment memory) {
        return _records[version];
    }

    /// @notice The most recently published record.
    function currentDeployment() external view returns (SuiteDeployment memory) {
        if (latestVersion == 0) revert NoRecordPublished();
        return _records[latestVersion];
    }
}
