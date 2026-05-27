import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { MoveToken, GPSOracle, ZoneNFT, ZoneChallenge } from "../typechain-types";

describe("ZoneChallenge", function () {
  let moveToken:    MoveToken;
  let gpsOracle:    GPSOracle;
  let zoneNFT:      ZoneNFT;
  let zoneChallenge: ZoneChallenge;
  let admin:        SignerWithAddress;
  let oracle:       SignerWithAddress;
  let defender:     SignerWithAddress;
  let challenger:   SignerWithAddress;
  let chainId:      bigint;

  const HEX_ID        = 613177413693333503n;
  const MINT_COST     = ethers.parseEther("100");
  const DECLARATION_COST = ethers.parseEther("100");

  async function mintTokens(to: SignerWithAddress, distanceMeters: bigint) {
    const routeHash = ethers.hexlify(ethers.randomBytes(32));
    const message = ethers.solidityPackedKeccak256(
      ["uint256", "address", "bytes32", "uint256", "uint64"],
      [chainId, to.address, routeHash, distanceMeters, 0n]
    );
    const sig = await oracle.signMessage(ethers.getBytes(message));
    await gpsOracle.submitRoute(to.address, routeHash, distanceMeters, 0n, sig);
  }

  beforeEach(async function () {
    [admin, oracle, defender, challenger] = await ethers.getSigners();
    chainId = (await ethers.provider.getNetwork()).chainId;

    const MoveTokenFactory = await ethers.getContractFactory("MoveToken");
    moveToken = await MoveTokenFactory.deploy(admin.address);
    await moveToken.waitForDeployment();

    const GPSOracleFactory = await ethers.getContractFactory("GPSOracle");
    gpsOracle = await GPSOracleFactory.deploy(oracle.address);
    await gpsOracle.waitForDeployment();
    await gpsOracle.setMoveToken(await moveToken.getAddress());
    const ORACLE_ROLE = ethers.id("ORACLE_ROLE");
    await moveToken.connect(admin).grantRole(ORACLE_ROLE, await gpsOracle.getAddress());

    const ZoneNFTFactory = await ethers.getContractFactory("ZoneNFT");
    zoneNFT = await ZoneNFTFactory.deploy(
      await moveToken.getAddress(),
      await gpsOracle.getAddress()
    );
    await zoneNFT.waitForDeployment();

    const ZoneChallengeFactory = await ethers.getContractFactory("ZoneChallenge");
    zoneChallenge = await ZoneChallengeFactory.deploy(
      await zoneNFT.getAddress(),
      await moveToken.getAddress(),
      await gpsOracle.getAddress()
    );
    await zoneChallenge.waitForDeployment();

    // Mint tokens for both parties
    await mintTokens(defender, 20_000n);
    await mintTokens(challenger, 20_000n);

    // Approve spending
    const zoneAddr      = await zoneNFT.getAddress();
    const challengeAddr = await zoneChallenge.getAddress();
    await moveToken.connect(defender).approve(zoneAddr, ethers.MaxUint256);
    await moveToken.connect(defender).approve(challengeAddr, ethers.MaxUint256);
    await moveToken.connect(challenger).approve(challengeAddr, ethers.MaxUint256);

    // Mint the zone to defender — FIX-001: mintZone sig includes chainId
    const mintSigHash = ethers.solidityPackedKeccak256(
      ["uint256", "uint64", "address", "uint256"],
      [chainId, HEX_ID, defender.address, MINT_COST]
    );
    const mintSig = await oracle.signMessage(ethers.getBytes(mintSigHash));
    await zoneNFT.connect(defender).mintZone(HEX_ID, MINT_COST, mintSig);

    // Approve zoneChallenge to transfer zone NFT on defender's behalf
    await zoneNFT.connect(defender).setApprovalForAll(challengeAddr, true);
  });

  // FIX-001: all challenge sigs include chainId
  async function buildDeclareSig(hexId: bigint, defenderAddr: string, baseScore: bigint) {
    const message = ethers.solidityPackedKeccak256(
      ["uint256", "uint64", "address", "uint256"],
      [chainId, hexId, defenderAddr, baseScore]
    );
    return oracle.signMessage(ethers.getBytes(message));
  }

  async function buildScoreSig(hexId: bigint, submitter: string, score: bigint) {
    const message = ethers.solidityPackedKeccak256(
      ["uint256", "uint64", "address", "uint256"],
      [chainId, hexId, submitter, score]
    );
    return oracle.signMessage(ethers.getBytes(message));
  }

  describe("declareChallenge", function () {
    it("opens a challenge and burns declaration cost", async function () {
      const baseScore = ethers.parseEther("50");
      const sig = await buildDeclareSig(HEX_ID, defender.address, baseScore);
      const balanceBefore = await moveToken.balanceOf(challenger.address);

      await zoneChallenge.connect(challenger).declareChallenge(HEX_ID, baseScore, sig);

      const challenge = await zoneChallenge.getChallenge(HEX_ID);
      expect(challenge.challenger).to.equal(challenger.address);
      expect(challenge.defender).to.equal(defender.address);
      expect(await moveToken.balanceOf(challenger.address)).to.equal(
        balanceBefore - DECLARATION_COST
      );
    });
  });

  describe("resolveChallenge", function () {
    it("transfers NFT to challenger when challenger wins", async function () {
      const baseScore   = 0n;
      const declareSig  = await buildDeclareSig(HEX_ID, defender.address, baseScore);
      await zoneChallenge.connect(challenger).declareChallenge(HEX_ID, baseScore, declareSig);

      const challengerScore = ethers.parseEther("1000");
      const scoreSig        = await buildScoreSig(HEX_ID, challenger.address, challengerScore);
      await zoneChallenge.connect(challenger).submitScore(HEX_ID, challengerScore, scoreSig);

      await time.increase(14 * 24 * 3600 + 1);

      await zoneChallenge.connect(admin).resolveChallenge(HEX_ID);
      expect(await zoneNFT.ownerOf(HEX_ID)).to.equal(challenger.address);
    });

    it("defender retains NFT when defender wins", async function () {
      const baseScore  = ethers.parseEther("999");
      const declareSig = await buildDeclareSig(HEX_ID, defender.address, baseScore);
      await zoneChallenge.connect(challenger).declareChallenge(HEX_ID, baseScore, declareSig);

      await time.increase(14 * 24 * 3600 + 1);

      await zoneChallenge.connect(admin).resolveChallenge(HEX_ID);
      expect(await zoneNFT.ownerOf(HEX_ID)).to.equal(defender.address);
    });
  });
});
