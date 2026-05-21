import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { MoveToken, ZoneNFT, SeasonController, EmissionKeeper } from "../typechain-types";

describe("EmissionKeeper", function () {
  let moveToken: MoveToken;
  let zoneNFT: ZoneNFT;
  let seasonController: SeasonController;
  let emissionKeeper: EmissionKeeper;
  let admin: SignerWithAddress;
  let oracle: SignerWithAddress;
  let treasury: SignerWithAddress;

  beforeEach(async function () {
    [admin, oracle, treasury] = await ethers.getSigners();

    const MoveTokenFactory = await ethers.getContractFactory("MoveToken");
    moveToken = await MoveTokenFactory.deploy(oracle.address, admin.address);
    await moveToken.waitForDeployment();

    const ZoneNFTFactory = await ethers.getContractFactory("ZoneNFT");
    zoneNFT = await ZoneNFTFactory.deploy(
      await moveToken.getAddress(), oracle.address, admin.address
    );
    await zoneNFT.waitForDeployment();

    const SeasonControllerFactory = await ethers.getContractFactory("SeasonController");
    seasonController = await SeasonControllerFactory.deploy(
      await moveToken.getAddress(),
      await zoneNFT.getAddress(),
      oracle.address,
      treasury.address,
      admin.address
    );
    await seasonController.waitForDeployment();

    const EmissionKeeperFactory = await ethers.getContractFactory("EmissionKeeper");
    emissionKeeper = await EmissionKeeperFactory.deploy(
      await moveToken.getAddress(),
      await seasonController.getAddress()
    );
    await emissionKeeper.waitForDeployment();

    // Grant EmissionKeeper the SEASON_ROLE so it can call adjustEmissionRate via SeasonController
    const seasonRole = await moveToken.SEASON_ROLE();
    await moveToken.connect(admin).grantRole(seasonRole, await seasonController.getAddress());

    // Grant SeasonController KEEPER_ROLE so EmissionKeeper's performUpkeep can call weeklyKeeperRun
    const keeperRole = await seasonController.KEEPER_ROLE();
    await seasonController.connect(admin).grantRole(keeperRole, await emissionKeeper.getAddress());
  });

  describe("checkUpkeep", function () {
    it("returns false immediately after deploy", async function () {
      const [upkeepNeeded] = await emissionKeeper.checkUpkeep("0x");
      expect(upkeepNeeded).to.be.false;
    });

    it("returns true after KEEPER_INTERVAL passes", async function () {
      await time.increase(7 * 24 * 3600 + 1);
      const [upkeepNeeded] = await emissionKeeper.checkUpkeep("0x");
      expect(upkeepNeeded).to.be.true;
    });
  });

  describe("performUpkeep", function () {
    it("reverts if called too early", async function () {
      await expect(emissionKeeper.performUpkeep("0x")).to.be.revertedWith(
        "EmissionKeeper: too early"
      );
    });

    it("succeeds after interval and updates lastUpkeep", async function () {
      const before = await emissionKeeper.lastUpkeep();
      await time.increase(7 * 24 * 3600 + 1);

      await emissionKeeper.performUpkeep("0x");

      const after = await emissionKeeper.lastUpkeep();
      expect(after).to.be.greaterThan(before);
    });

    it("calls weeklyKeeperRun (resets weekly stats)", async function () {
      // Confirm adjustEmissionRate runs without error
      await time.increase(7 * 24 * 3600 + 1);
      await expect(emissionKeeper.performUpkeep("0x")).to.not.be.reverted;
      // weeklyMint and weeklyBurn should be reset to 0
      expect(await moveToken.weeklyMint()).to.equal(0n);
      expect(await moveToken.weeklyBurn()).to.equal(0n);
    });
  });
});
