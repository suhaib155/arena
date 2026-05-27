// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IGPSOracle {
    function oracleOperator() external view returns (address);
}
