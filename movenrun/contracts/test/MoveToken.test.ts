import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { MoveToken } from "../typechain-types";

describe("MoveToken", function () {
  let moveToken: MoveToken;
  let admin: SignerWithAddress;
  let oracle: SignerWithAddress;
  let user: SignerWithAddress;
  let other: SignerWithAddress;

  beforeEach(async function () {
    [admin, oracle, user, other] = await ethers.getSigners();
    const MoveTokenFactory = await ethers.getContractFactory("MoveToken");
    moveToken = await MoveTokenFactory.deploy(oracle.address, admin.address);
    await moveToken.waitForDeployment();
  });

  describe("Deployment", function () {
    it("has correct name and symbol", async function () {
      expect(await moveToken.name()).to.equal("MoveToken");
      expect(await moveToken.symbol()).to.equal("$MOVE");
    });

    it("sets trusted oracle", async function () {
      expect(await moveToken.trustedOracle()).to.equal(oracle.address);
    });

    it("starts with zero supply", async function () {
      expect(await moveToken.totalSupply()).to.equal(0n);
    });

    it("baseRate is 10 $MOVE", async function () {
      expect(await moveToken.baseRate()).to.equal(ethers.parseEther("10"));
    });
  });

  describe("mintMOVE", function () {
    async function buildMintSig(
      to: string,
      routeHash: string,
      distanceMeters: bigint
    ) {
      const message = ethers.solidityPackedKeccak256(
        ["address", "bytes32", "uint256"],
        [to, routeHash, distanceMeters]
      );
      return oracle.signMessage(ethers.getBytes(message));
    }

    it("mints correct amount for 10km route", async function () {
      const routeHash = ethers.randomBytes(32);
      const distance = 10_000n; // 10 km in meters
      const sig = await buildMintSig(user.address, ethers.hexlify(routeHash), distance);

      await moveToken.mintMOVE(user.address, ethers.hexlify(routeHash), sig, distance);
      // 10km * 10 $MOVE/km = 100 $MOVE (minus 0 zone tax since zoneNFT not set)
      expect(await moveToken.balanceOf(user.address)).to.equal(ethers.parseEther("100"));
    });

    it("reverts on route replay", async function () {
      const routeHash = ethers.hexlify(ethers.randomBytes(32));
      const distance = 1_000n;
      const sig = await buildMintSig(user.address, routeHash, distance);
      await moveToken.mintMOVE(user.address, routeHash, sig, distance);
      await expect(
        moveToken.mintMOVE(user.address, routeHash, sig, distance)
      ).to.be.revertedWith("MoveToken: route already used");
    });

    it("reverts on invalid oracle sig", async function () {
      const routeHash = ethers.hexlify(ethers.randomBytes(32));
      const fakeSig = await other.signMessage(ethers.getBytes(
        ethers.solidityPackedKeccak256(["address", "bytes32", "uint256"], [user.address, routeHash, 1000n])
      ));
      await expect(
        moveToken.mintMOVE(user.address, routeHash, fakeSig, 1000n)
      ).to.be.revertedWith("MoveToken: invalid oracle sig");
    });

    it("enforces daily cap", async function () {
      // Mint up to daily cap (200 $MOVE = 20km)
      const routeHash1 = ethers.hexlify(ethers.randomBytes(32));
      const sig1 = await buildMintSig(user.address, routeHash1, 20_000n);
      await moveToken.mintMOVE(user.address, routeHash1, sig1, 20_000n);
      expect(await moveToken.balanceOf(user.address)).to.equal(ethers.parseEther("200"));

      // Second mint should yield 0 remaining and revert
      const routeHash2 = ethers.hexlify(ethers.randomBytes(32));
      const sig2 = await buildMintSig(user.address, routeHash2, 1_000n);
      await expect(
        moveToken.mintMOVE(user.address, routeHash2, sig2, 1_000n)
      ).to.be.revertedWith("MoveToken: daily cap reached");
    });
  });

  describe("burnMOVE", function () {
    it("burns tokens and updates weeklyBurn", async function () {
      // First mint some tokens
      const routeHash = ethers.hexlify(ethers.randomBytes(32));
      const message = ethers.solidityPackedKeccak256(
        ["address", "bytes32", "uint256"],
        [user.address, routeHash, 5_000n]
      );
      const sig = await oracle.signMessage(ethers.getBytes(message));
      await moveToken.mintMOVE(user.address, routeHash, sig, 5_000n);

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
