// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// RESEARCH ONLY. Minimal stand-ins that let the legacy SeasonController.greatBurn (c8262ec,
// src/SeasonController.sol, copied unmodified next to this file by run.sh) execute on the
// in-process Hardhat network. They replace only what greatBurn reads: an ERC-20 with the
// legacy adjustEmissionRate hook, a zone-owner lookup and an oracle operator address.
// Not deployed anywhere; never part of the v3 contract set.

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract GreatBurnProbeToken is ERC20 {
    constructor() ERC20("Probe MOVE", "pMOVE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function adjustEmissionRate() external {}
}

contract GreatBurnProbeZones {
    mapping(uint64 hexId => address owner) public zoneOwner;

    function setZoneOwner(uint64 hexId, address owner) external {
        zoneOwner[hexId] = owner;
    }
}

contract GreatBurnProbeOracle {
    address public oracleOperator;

    constructor(address operator) {
        oracleOperator = operator;
    }
}
