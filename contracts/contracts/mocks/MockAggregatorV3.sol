// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockAggregatorV3 {
    int256 public price;
    uint8  public constant decimals = 8;

    constructor(int256 initialPrice) {
        price = initialPrice;
    }

    function setPrice(int256 newPrice) external {
        price = newPrice;
    }

    function latestRoundData()
        external
        view
        returns (
            uint80  roundId,
            int256  answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80  answeredInRound
        )
    {
        return (1, price, block.timestamp, block.timestamp, 1);
    }
}
