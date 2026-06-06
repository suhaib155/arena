import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { MoveToken, GPSOracle } from "../typechain-types";

describe("MoveToken", function () {
  let moveToken: MoveToken;
  let gpsOracle: GPSOracle;
  let admin:     SignerWithAddress;
  let oracle:    SignerWithAddress; // EOA oracle operator
  let user:      SignerWithAddress;
  let other:     SignerWithAddress;
  let chainId:   bigint;

  beforeEach(async function () {
    [admin, oracle, user, other] = await ethers.getSigners();
    chainId = (await ethers.provider.getNetwork()).chainId;

    const MoveTokenFactory = await ethers.getContractFactory("MoveToken");
    moveToken = await MoveTokenFactory.deploy(admin.address);
    await moveToken.waitForDeployment();

    // Deploy GPSOracle and wire it up
    const GPSOracleFactory = await ethers.getContractFactory("GPSOracle");
    gpsOracle = await GPSOracleFactory.deploy(oracle.address);
    await gpsOracle.waitForDeployment();

    await gpsOracle.setMoveToken(await moveToken.getAddress());
    const ORACLE_ROLE = ethers.id("ORACLE_ROLE");
    await moveToken.connect(admin).grantRole(ORACLE_ROLE, await gpsOracle.getAddress());
  });

  // FIX-001: signatures now include chainId and hexId
  async function buildRouteSig(to: string, routeHash: string, distanceMeters: bigint, hexId: bigint = 0n) {
    const message = ethers.solidityPackedKeccak256(
      ["uint256", "address", "bytes32", "uint256", "uint64"],
      [chainId, to, routeHash, distanceMeters, hexId]
    );
    return oracle.signMessage(ethers.getBytes(message));
  }

  describe("Deployment", function () {
    it("has correct name and symbol", async function () {
      expect(await moveToken.name()).to.equal("MoveToken");
      expect(await moveToken.symbol()).to.equal("$MOVE");
    });

    it("starts with zero supply", async function () {
      expect(await moveToken.totalSupply()).to.equal(0n);
    });

    it("baseRate is 10 $MOVE", async function () {
      expect(await moveToken.baseRate()).to.equal(ethers.parseEther("10"));
    });

    it("admin has DEFAULT_ADMIN_ROLE", async function () {
      const ADMIN_ROLE = ethers.ZeroHash;
      expect(await moveToken.hasRole(ADMIN_ROLE, admin.address)).to.be.true;
    });
  });

  describe("mintMOVE (via GPSOracle.submitRoute)", function () {
    it("mints correct amount for 10km route", async function () {
      const routeHash = ethers.hexlify(ethers.randomBytes(32));
      const distance  = 10_000n;
      const sig = await buildRouteSig(user.address, routeHash, distance);
      await gpsOracle.submitRoute(user.address, routeHash, distance, 0n, sig);
      // 10km * 10 $MOVE/km = 100 $MOVE (no zone tax since zoneNFT not set)
      expect(await moveToken.balanceOf(user.address)).to.equal(ethers.parseEther("100"));
    });

    it("reverts on route replay", async function () {
      const routeHash = ethers.hexlify(ethers.randomBytes(32));
      const distance  = 1_000n;
      const sig = await buildRouteSig(user.address, routeHash, distance);
      await gpsOracle.submitRoute(user.address, routeHash, distance, 0n, sig);
      await expect(
        gpsOracle.submitRoute(user.address, routeHash, distance, 0n, sig)
      ).to.be.revertedWith("MoveToken: route already used");
    });

    it("reverts on invalid oracle sig in GPSOracle", async function () {
      const routeHash = ethers.hexlify(ethers.randomBytes(32));
      // fakeSig signed by wrong key — recovered address won't match oracleOperator
      const fakeSig   = await other.signMessage(ethers.getBytes(
        ethers.solidityPackedKeccak256(
          ["uint256", "address", "bytes32", "uint256", "uint64"],
          [chainId, user.address, routeHash, 1000n, 0n]
        )
      ));
      await expect(
        gpsOracle.submitRoute(user.address, routeHash, 1000n, 0n, fakeSig)
      ).to.be.revertedWith("GPSOracle: invalid sig");
    });

    it("enforces daily cap", async function () {
      const routeHash1 = ethers.hexlify(ethers.randomBytes(32));
      const sig1 = await buildRouteSig(user.address, routeHash1, 20_000n);
      await gpsOracle.submitRoute(user.address, routeHash1, 20_000n, 0n, sig1);
      expect(await moveToken.balanceOf(user.address)).to.equal(ethers.parseEther("200"));

      const routeHash2 = ethers.hexlify(ethers.randomBytes(32));
      const sig2 = await buildRouteSig(user.address, routeHash2, 1_000n);
      await expect(
        gpsOracle.submitRoute(user.address, routeHash2, 1_000n, 0n, sig2)
      ).to.be.revertedWith("MoveToken: daily cap reached");
    });
  });

  describe("burnMOVE", function () {
    it("burns tokens and updates weeklyBurn", async function () {
      const routeHash = ethers.hexlify(ethers.randomBytes(32));
      const sig = await buildRouteSig(user.address, routeHash, 5_000n);
      await gpsOracle.submitRoute(user.address, routeHash, 5_000n, 0n, sig);

      const balanceBefore = await moveToken.balanceOf(user.address);
      await moveToken.connect(user).burnMOVE(ethers.parseEther("10"));
      expect(await moveToken.balanceOf(user.address)).to.equal(balanceBefore - ethers.parseEther("10"));
      expect(await moveToken.weeklyBurn()).to.equal(ethers.parseEther("10"));
    });
  });

  describe("updateBaseRate", function () {
    it("allows governor to update rate", async function () {
      await moveToken.connect(admin).updateBaseRate(ethers.parseEther("7"));
      expect(await moveToken.baseRate()).to.equal(ethers.parseEther("7"));
    });

    it("reverts for non-governor", async function () {
      await expect(
        moveToken.connect(user).updateBaseRate(ethers.parseEther("7"))
      ).to.be.reverted;
    });
  });
});
