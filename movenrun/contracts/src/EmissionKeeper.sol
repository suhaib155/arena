// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@chainlink/contracts/src/v0.8/automation/AutomationCompatible.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./MoveToken.sol";
import "./SeasonController.sol";

/// @title EmissionKeeper — Chainlink Automation upkeep for weekly emission adjustment
/// @notice Triggers MoveToken.adjustEmissionRate() every 7 days and handles season transitions
contract EmissionKeeper is AutomationCompatible, Ownable {
    uint256 public constant KEEPER_INTERVAL = 7 days;

    MoveToken public immutable moveToken;
    SeasonController public immutable seasonController;

    uint256 public lastUpkeep;

    event UpkeepPerformed(uint256 timestamp, bool seasonPaused);

    constructor(address _moveToken, address _seasonController) Ownable(msg.sender) {
        moveToken = MoveToken(_moveToken);
        seasonController = SeasonController(_seasonController);
        lastUpkeep = block.timestamp;
    }

    /// @inheritdoc AutomationCompatibleInterface
    function checkUpkeep(
        bytes calldata /* checkData */
    ) external view override returns (bool upkeepNeeded, bytes memory performData) {
        upkeepNeeded = block.timestamp >= lastUpkeep + KEEPER_INTERVAL;
        performData = bytes("");
    }

    /// @inheritdoc AutomationCompatibleInterface
    /// @notice Adjusts emission rate weekly. Also pauses minting if the season is ending.
    function performUpkeep(bytes calldata /* performData */) external override {
        require(block.timestamp >= lastUpkeep + KEEPER_INTERVAL, "EmissionKeeper: too early");
        lastUpkeep = block.timestamp;

        // Weekly emission valve — adjusts base rate if burn/mint ratio is low
        seasonController.weeklyKeeperRun();

        // Pause minting in the final 14 days of the season
        bool mintingPausedThisRun = false;
        if (!seasonController.mintingPaused()) {
            uint256 seasonEnd = seasonController.seasonEnd();
            if (seasonEnd > 0 && block.timestamp >= seasonEnd - seasonController.MINT_PAUSE_WINDOW()) {
                seasonController.pauseMinting();
                mintingPausedThisRun = true;
            }
        }

        emit UpkeepPerformed(block.timestamp, mintingPausedThisRun);
    }
}
