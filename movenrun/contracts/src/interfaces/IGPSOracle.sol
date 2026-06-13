// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IGPSOracle {
    function oracleOperator() external view returns (address);
}
