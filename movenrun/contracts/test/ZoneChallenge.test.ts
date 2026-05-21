import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { MoveToken, ZoneNFT, ZoneChallenge } from "../typechain-types";

describe("ZoneChallenge", function () {
  let moveToken: MoveToken;
  let zoneNFT: ZoneNFT;
  let zoneChallenge: ZoneChallenge;
  let admin: SignerWithAddress;
  let oracle: SignerWithAddress;
  let defender: SignerWithAddress;
  let challenger: SignerWithAddress;
  let other: SignerWithAddress;

  const HEX_ID = 613177413693333503n;
  const MINT_COST = ethers.parseEther("100");
  const DECLARATION_COST = ethers.parseEther("100");

  async function mintTokens(to: SignerWithAddress, distanceMeters: bigint) {
    const routeHash = ethers.hexlify(ethers.randomBytes(32));
    const message = ethers.solidityPackedKeccak256(
      ["address", "bytes32", "uint256"],
      [to.address, routeHash, distanceMeters]
    );
    const sig = await oracle.signMessage(ethers.getBytes(message));
    await moveToken.mintMOVE(to.address, routeHash, sig, distanceMeters);
  }

  beforeEach(async function () {
    [admin, oracle, defender, challenger, other] = await ethers.getSigners();

    const MoveTokenFactory = await ethers.getContractFactory("MoveToken");
    moveToken = await MoveTokenFactory.deploy(oracle.address, admin.address);
    await moveToken.waitForDeployment();

    const ZoneNFTFactory = await ethers.getContractFactory("ZoneNFT");
    zoneNFT = await ZoneNFTFactory.deploy(
      await moveToken.getAddress(), oracle.address, admin.address
    );
    await zoneNFT.waitForDeployment();

    const ZoneChallengeFactory = await ethers.getContractFactory("ZoneChallenge");
    zoneChallenge = await ZoneChallengeFactory.deploy(
      await moveToken.getAddress(),
      await zoneNFT.getAddress(),
      oracle.address,
      admin.address
    );
    await zoneChallenge.waitForDeployment();

    // Mint tokens for both parties (20km → 200 $MOVE each)
    await mintTokens(defender, 20_000n);
    await mintTokens(challenger, 20_000n);

    // Approve spending
    const zoneAddr = await zoneNFT.getAddress();
    const challengeAddr = await zoneChallenge.getAddress();
    await moveToken.connect(defender).approve(zoneAddr, ethers.MaxUint256);
    await moveToken.connect(defender).approve(challengeAddr, ethers.MaxUint256);
    await moveToken.connect(challenger).approve(challengeAddr, ethers.MaxUint256);

    // Mint the zone to defender
    const mintSigHash = ethers.solidityPackedKeccak256(
      ["uint64", "address", "uint256"],
      [HEX_ID, defender.address, MINT_COST]
    );
    const mintSig = await oracle.signMessage(ethers.getBytes(mintSigHash));
    await zoneNFT.connect(defender).mintZone(HEX_ID, MINT_COST, mintSig);

    // Approve zoneChallenge to transfer zone NFT on behalf of defender
    await zoneNFT.connect(defender).setApprovalForAll(challengeAddr, true);
  });

  async function buildDeclareSig(hexId: bigint, defenderAddr: string, baseScore: bigint) {
    const message = ethers.solidityPackedKeccak256(
      ["uint64", "address", "uint256"],
      [hexId, defenderAddr, baseScore]
    );
    return oracle.signMessage(ethers.getBytes(message));
  }

  async function buildScoreSig(hexId: bigint, submitter: string, score: bigint) {
    const message = ethers.solidityPackedKeccak256(
      ["uint64", "address", "uint256"],
      [hexId, submitter, score]
    );
    return oracle.signMessage(ethers.getBytes(message));
  }

  async function declareChallenge(baseScore: bigint = 0n) {
    const sig = await buildDeclareSig(HEX_ID, defender.address, baseScore);
    await zoneChallenge.connect(challenger).declareChallenge(HEX_ID, baseScore, sig);
  }

  describe("declareChallenge", function () {
    it("opens a challenge and escrows declaration cost", async function () {
      const baseScore = ethers.parseEther("50");
      const sig = await buildDeclareSig(HEX_ID, defender.address, baseScore);
      const balanceBefore = await moveToken.balanceOf(challenger.address);
      const challengeAddr = await zoneChallenge.getAddress();

      await zoneChallenge.connect(challenger).declareChallenge(HEX_ID, baseScore, sig);

      const challenge = await zoneChallenge.getChallenge(HEX_ID);
      expect(challenge.challenger).to.equal(challenger.address);
      expect(challenge.defender).to.equal(defender.address);
      expect(challenge.escrowedAmount).to.equal(DECLARATION_COST);

      // Funds leave challenger's wallet into the contract
      expect(await moveToken.balanceOf(challenger.address)).to.equal(balanceBefore - DECLARATION_COST);
      expect(await moveToken.balanceOf(challengeAddr)).to.equal(DECLARATION_COST);
    });

    it("reverts when a challenge is already active", async function () {
      await declareChallenge();
      const sig2 = await buildDeclareSig(HEX_ID, defender.address, 0n);
      await expect(
        zoneChallenge.connect(challenger).declareChallenge(HEX_ID, 0n, sig2)
      ).to.be.revertedWith("ZoneChallenge: challenge already active");
    });

    it("reverts if zone is not minted", async function () {
      const unknownHex = 613177413693333504n;
      const sig = await buildDeclareSig(unknownHex, defender.address, 0n);
      await expect(
        zoneChallenge.connect(challenger).declareChallenge(unknownHex, 0n, sig)
      ).to.be.revertedWith("ZoneChallenge: zone not minted");
    });

    it("reverts if defender tries to challenge their own zone", async function () {
      const sig = await buildDeclareSig(HEX_ID, defender.address, 0n);
      await expect(
        zoneChallenge.connect(defender).declareChallenge(HEX_ID, 0n, sig)
      ).to.be.revertedWith("ZoneChallenge: cannot challenge own zone");
    });

    it("allows new challenge after previous one is resolved", async function () {
      await declareChallenge();
      await time.increase(14 * 24 * 3600 + 1);
      await zoneChallenge.connect(admin).resolveChallenge(HEX_ID);

      // Mint more tokens for challenger for second declaration
      await mintTokens(challenger, 20_000n);

      const sig2 = await buildDeclareSig(HEX_ID, defender.address, 0n);
      await expect(
        zoneChallenge.connect(challenger).declareChallenge(HEX_ID, 0n, sig2)
      ).to.be.revertedWith("ZoneChallenge: cooldown active"); // defender wins → cooldown set
    });
  });

  describe("resolveChallenge", function () {
    it("transfers NFT to challenger when challenger wins and returns escrow", async function () {
      await declareChallenge(0n);

      const challengerScore = ethers.parseEther("1000");
      const scoreSig = await buildScoreSig(HEX_ID, challenger.address, challengerScore);
      await zoneChallenge.connect(challenger).submitScore(HEX_ID, challengerScore, scoreSig);

      const balanceBefore = await moveToken.balanceOf(challenger.address);

      await time.increase(14 * 24 * 3600 + 1);
      await zoneChallenge.connect(admin).resolveChallenge(HEX_ID);

      expect(await zoneNFT.ownerOf(HEX_ID)).to.equal(challenger.address);
      // Escrow returned to challenger
      expect(await moveToken.balanceOf(challenger.address)).to.equal(balanceBefore + DECLARATION_COST);
    });

    it("defender retains NFT when defender wins and escrow is burned", async function () {
      const baseScore = ethers.parseEther("999");
      await declareChallenge(baseScore);

      const supplyBefore = await moveToken.totalSupply();

      await time.increase(14 * 24 * 3600 + 1);
      await zoneChallenge.connect(admin).resolveChallenge(HEX_ID);

      expect(await zoneNFT.ownerOf(HEX_ID)).to.equal(defender.address);
      // Escrowed declaration cost was burned
      expect(await moveToken.totalSupply()).to.equal(supplyBefore - DECLARATION_COST);
    });

    it("tiebreaker: equal scores — defender wins", async function () {
      // baseScore = 500, defenderScore = 0, challengerScore = 500 → tie → defender wins
      const baseScore = ethers.parseEther("500");
      await declareChallenge(baseScore);

      const tieScore = ethers.parseEther("500");
      const scoreSig = await buildScoreSig(HEX_ID, challenger.address, tieScore);
      await zoneChallenge.connect(challenger).submitScore(HEX_ID, tieScore, scoreSig);

      await time.increase(14 * 24 * 3600 + 1);
      await zoneChallenge.connect(admin).resolveChallenge(HEX_ID);

      // Defender should still own the zone
      expect(await zoneNFT.ownerOf(HEX_ID)).to.equal(defender.address);
    });

    it("cancels challenge and returns escrow if NFT was transferred during battle", async function () {
      await declareChallenge(0n);

      // Defender transfers zone NFT to `other` mid-battle
      await zoneNFT.connect(defender).transferFrom(defender.address, other.address, HEX_ID);
      expect(await zoneNFT.ownerOf(HEX_ID)).to.equal(other.address);

      const challengerBalanceBefore = await moveToken.balanceOf(challenger.address);
      const challengeAddr = await zoneChallenge.getAddress();

      await time.increase(14 * 24 * 3600 + 1);
      await zoneChallenge.connect(admin).resolveChallenge(HEX_ID);

      // Escrow returned to challenger
      expect(await moveToken.balanceOf(challenger.address)).to.equal(
        challengerBalanceBefore + DECLARATION_COST
      );
      // Contract holds no remaining escrow
      expect(await moveToken.balanceOf(challengeAddr)).to.equal(0n);
      // NFT still belongs to `other`
      expect(await zoneNFT.ownerOf(HEX_ID)).to.equal(other.address);
    });

    it("reverts if called before challenge window closes", async function () {
      await declareChallenge();
      await expect(
        zoneChallenge.connect(admin).resolveChallenge(HEX_ID)
      ).to.be.revertedWith("ZoneChallenge: window not closed");
    });

    it("reverts if no active challenge", async function () {
      const unknownHex = 613177413693333504n;
      await expect(
        zoneChallenge.connect(admin).resolveChallenge(unknownHex)
      ).to.be.revertedWith("ZoneChallenge: no active challenge");
    });
  });

  describe("submitScore", function () {
    it("reverts on sig reuse", async function () {
      await declareChallenge();
      const score = ethers.parseEther("100");
      const scoreSig = await buildScoreSig(HEX_ID, challenger.address, score);
      await zoneChallenge.connect(challenger).submitScore(HEX_ID, score, scoreSig);

      await expect(
        zoneChallenge.connect(challenger).submitScore(HEX_ID, score, scoreSig)
      ).to.be.revertedWith("ZoneChallenge: sig reused");
    });

    it("reverts after challenge window closes", async function () {
      await declareChallenge();
      await time.increase(14 * 24 * 3600 + 1);
      const score = ethers.parseEther("100");
      const scoreSig = await buildScoreSig(HEX_ID, challenger.address, score);
      await expect(
        zoneChallenge.connect(challenger).submitScore(HEX_ID, score, scoreSig)
      ).to.be.revertedWith("ZoneChallenge: window closed");
    });
  });
});
