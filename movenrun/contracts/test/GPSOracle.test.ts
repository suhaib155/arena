import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { GPSOracle } from "../typechain-types";

// Dummy Chainlink Functions router for local testing
const MOCK_ROUTER = "0x0000000000000000000000000000000000000001";

describe("GPSOracle", function () {
  let gpsOracle: GPSOracle;
  let owner: SignerWithAddress;
  let oracleOperator: SignerWithAddress;
  let user: SignerWithAddress;
  let attacker: SignerWithAddress;

  beforeEach(async function () {
    [owner, oracleOperator, user, attacker] = await ethers.getSigners();
    const GPSOracleFactory = await ethers.getContractFactory("GPSOracle");
    gpsOracle = await GPSOracleFactory.deploy(MOCK_ROUTER, oracleOperator.address);
    await gpsOracle.waitForDeployment();
  });

  describe("Deployment", function () {
    it("sets oracleOperator", async function () {
      expect(await gpsOracle.oracleOperator()).to.equal(oracleOperator.address);
    });

    it("reverts with zero oracleOperator", async function () {
      const Factory = await ethers.getContractFactory("GPSOracle");
      await expect(
        Factory.deploy(MOCK_ROUTER, ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(gpsOracle, "ZeroAddress");
    });
  });

  describe("verifyGPSProof", function () {
    async function buildGPSSig(routeHash: string, userAddr: string) {
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const message = ethers.solidityPackedKeccak256(
        ["bytes32", "address", "uint256"],
        [routeHash, userAddr, chainId]
      );
      return oracleOperator.signMessage(ethers.getBytes(message));
    }

    it("returns true for valid operator signature", async function () {
      const routeHash = ethers.hexlify(ethers.randomBytes(32));
      const sig = await buildGPSSig(routeHash, user.address);
      // Use staticCall to read return value without sending tx
      const valid = await gpsOracle.verifyGPSProof.staticCall(routeHash, user.address, sig);
      expect(valid).to.be.true;
    });

    it("returns false for attacker signature", async function () {
      const routeHash = ethers.hexlify(ethers.randomBytes(32));
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const message = ethers.solidityPackedKeccak256(
        ["bytes32", "address", "uint256"],
        [routeHash, user.address, chainId]
      );
      const fakeSig = await attacker.signMessage(ethers.getBytes(message));
      const valid = await gpsOracle.verifyGPSProof.staticCall(routeHash, user.address, fakeSig);
      expect(valid).to.be.false;
    });

    it("view version matches tx version", async function () {
      const routeHash = ethers.hexlify(ethers.randomBytes(32));
      const sig = await buildGPSSig(routeHash, user.address);
      const viewResult = await gpsOracle.verifyGPSProofView(routeHash, user.address, sig);
      expect(viewResult).to.be.true;
    });
  });

  describe("setOracleOperator", function () {
    it("allows owner to rotate operator", async function () {
      await gpsOracle.connect(owner).setOracleOperator(attacker.address);
      expect(await gpsOracle.oracleOperator()).to.equal(attacker.address);
    });

    it("reverts for non-owner", async function () {
      await expect(
        gpsOracle.connect(attacker).setOracleOperator(attacker.address)
      ).to.be.reverted;
    });

    it("reverts with zero address", async function () {
      await expect(
        gpsOracle.connect(owner).setOracleOperator(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(gpsOracle, "ZeroAddress");
    });
  });
});
