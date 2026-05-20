import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { MoveToken, ZoneNFT } from "../typechain-types";

describe("ZoneNFT", function () {
  let moveToken: MoveToken;
  let zoneNFT: ZoneNFT;
  let admin: SignerWithAddress;
  let oracle: SignerWithAddress;
  let mover: SignerWithAddress;
  let other: SignerWithAddress;

  const HEX_ID = 613177413693333503n; // example H3 res-8 hex ID

  beforeEach(async function () {
    [admin, oracle, mover, other] = await ethers.getSigners();

    const MoveTokenFactory = await ethers.getContractFactory("MoveToken");
    moveToken = await MoveTokenFactory.deploy(oracle.address, admin.address);
    await moveToken.waitForDeployment();

    const ZoneNFTFactory = await ethers.getContractFactory("ZoneNFT");
    zoneNFT = await ZoneNFTFactory.deploy(
      await moveToken.getAddress(),
      oracle.address,
      admin.address
    );
    await zoneNFT.waitForDeployment();

    // Give mover some $MOVE to burn for mint cost
    const routeHash = ethers.hexlify(ethers.randomBytes(32));
    const message = ethers.solidityPackedKeccak256(
      ["address", "bytes32", "uint256"],
      [mover.address, routeHash, 20_000n]
    );
    const moveSig = await oracle.signMessage(ethers.getBytes(message));
    await moveToken.mintMOVE(mover.address, routeHash, moveSig, 20_000n);

    // Approve ZoneNFT to burn mover's $MOVE
    await moveToken.connect(mover).approve(await zoneNFT.getAddress(), ethers.MaxUint256);
  });

  async function buildMintSig(hexId: bigint, toAddress: string, mintCost: bigint) {
    const sigHash = ethers.solidityPackedKeccak256(
      ["uint64", "address", "uint256"],
      [hexId, toAddress, mintCost]
    );
    return oracle.signMessage(ethers.getBytes(sigHash));
  }

  describe("mintZone", function () {
    it("mints zone NFT and burns $MOVE", async function () {
      const mintCost = ethers.parseEther("100");
      const sig = await buildMintSig(HEX_ID, mover.address, mintCost);
      const balanceBefore = await moveToken.balanceOf(mover.address);

      await zoneNFT.connect(mover).mintZone(HEX_ID, mintCost, sig);

      expect(await zoneNFT.ownerOf(HEX_ID)).to.equal(mover.address);
      expect(await moveToken.balanceOf(mover.address)).to.equal(balanceBefore - mintCost);
    });

    it("reverts if already minted", async function () {
      const mintCost = ethers.parseEther("100");
      const sig1 = await buildMintSig(HEX_ID, mover.address, mintCost);
      await zoneNFT.connect(mover).mintZone(HEX_ID, mintCost, sig1);

      const sig2 = await buildMintSig(HEX_ID, mover.address, mintCost);
      await expect(
        zoneNFT.connect(mover).mintZone(HEX_ID, mintCost, sig2)
      ).to.be.revertedWith("ZoneNFT: already minted");
    });

    it("reverts on invalid oracle sig", async function () {
      const mintCost = ethers.parseEther("100");
      const fakeSig = await other.signMessage(ethers.getBytes(
        ethers.solidityPackedKeccak256(["uint64", "address", "uint256"], [HEX_ID, mover.address, mintCost])
      ));
      await expect(
        zoneNFT.connect(mover).mintZone(HEX_ID, mintCost, fakeSig)
      ).to.be.revertedWith("ZoneNFT: invalid oracle sig");
    });
  });

  describe("getLoyaltyMultiplier", function () {
    it("returns 100 for fresh zone", async function () {
      const mintCost = ethers.parseEther("100");
      const sig = await buildMintSig(HEX_ID, mover.address, mintCost);
      await zoneNFT.connect(mover).mintZone(HEX_ID, mintCost, sig);
      expect(await zoneNFT.getLoyaltyMultiplier(HEX_ID)).to.equal(100n);
    });
  });

  describe("markDormant / reclaimDormant", function () {
    it("reverts markDormant if not old enough", async function () {
      const mintCost = ethers.parseEther("100");
      const sig = await buildMintSig(HEX_ID, mover.address, mintCost);
      await zoneNFT.connect(mover).mintZone(HEX_ID, mintCost, sig);
      await expect(zoneNFT.markDormant(HEX_ID)).to.be.revertedWith("ZoneNFT: not dormant yet");
    });
  });
});
