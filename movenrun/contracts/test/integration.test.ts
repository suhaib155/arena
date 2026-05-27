import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  MoveToken,
  GPSOracle,
  ZoneNFT,
  GearNFT,
  MoveVault,
  ZoneChallenge,
  SeasonController,
  MovenDAO,
} from "../typechain-types";

describe("MovenRun Integration", function () {
  let deployer:   SignerWithAddress;
  let oracle:     SignerWithAddress; // EOA that signs routes
  let alice:      SignerWithAddress; // runner / zone minter
  let bob:        SignerWithAddress; // challenger
  let treasury:   SignerWithAddress;

  let moveToken:       MoveToken;
  let gpsOracle:       GPSOracle;
  let zoneNFT:         ZoneNFT;
  let gearNFT:         GearNFT;
  let moveVault:       MoveVault;
  let zoneChallenge:   ZoneChallenge;
  let seasonController: SeasonController;
  let movenDAO:        MovenDAO;

  const HEX_ID = 613177413693333503n; // H3 resolution-8 hex

  // ── Deploy all contracts ──────────────────────────────────────────────────
  before(async function () {
    [deployer, oracle, alice, bob, treasury] = await ethers.getSigners();

    // 1. MoveToken
    const MoveTokenF = await ethers.getContractFactory("MoveToken");
    moveToken = await MoveTokenF.deploy(deployer.address);
    await moveToken.waitForDeployment();

    // 2. GPSOracle
    const GPSOracleF = await ethers.getContractFactory("GPSOracle");
    gpsOracle = await GPSOracleF.deploy(oracle.address);
    await gpsOracle.waitForDeployment();

    // 3. ZoneNFT
    const ZoneNFTF = await ethers.getContractFactory("ZoneNFT");
    zoneNFT = await ZoneNFTF.deploy(
      await moveToken.getAddress(),
      await gpsOracle.getAddress()
    );
    await zoneNFT.waitForDeployment();

    // 4. GearNFT
    const GearNFTF = await ethers.getContractFactory("GearNFT");
    gearNFT = await GearNFTF.deploy(await moveToken.getAddress());
    await gearNFT.waitForDeployment();

    // 5. MoveVault
    const MoveVaultF = await ethers.getContractFactory("MoveVault");
    moveVault = await MoveVaultF.deploy(await moveToken.getAddress());
    await moveVault.waitForDeployment();

    // 6. ZoneChallenge
    const ZoneChallengeF = await ethers.getContractFactory("ZoneChallenge");
    zoneChallenge = await ZoneChallengeF.deploy(
      await zoneNFT.getAddress(),
      await moveToken.getAddress(),
      await gpsOracle.getAddress()
    );
    await zoneChallenge.waitForDeployment();

    // 7. SeasonController
    const SeasonControllerF = await ethers.getContractFactory("SeasonController");
    seasonController = await SeasonControllerF.deploy(
      await moveToken.getAddress(),
      await zoneNFT.getAddress(),
      await zoneChallenge.getAddress()
    );
    await seasonController.waitForDeployment();

    // 8. MovenDAO
    const MovenDAOF = await ethers.getContractFactory("MovenDAO");
    movenDAO = await MovenDAOF.deploy(
      await moveToken.getAddress(),
      await zoneNFT.getAddress(),
      await moveVault.getAddress()
    );
    await movenDAO.waitForDeployment();

    // ── Post-deployment wiring ──────────────────────────────────────────────
    const MINTER_ROLE   = ethers.id("MINTER_ROLE");
    const ORACLE_ROLE   = ethers.id("ORACLE_ROLE");
    const GOVERNOR_ROLE = ethers.id("GOVERNOR_ROLE");
    const SEASON_ROLE   = ethers.id("SEASON_ROLE");

    await moveToken.grantRole(MINTER_ROLE,   await zoneNFT.getAddress());
    await moveToken.grantRole(ORACLE_ROLE,   await gpsOracle.getAddress());
    await moveToken.grantRole(GOVERNOR_ROLE, await movenDAO.getAddress());
    await moveToken.grantRole(SEASON_ROLE,   await seasonController.getAddress());

    await gpsOracle.setMoveToken(await moveToken.getAddress());
    await zoneNFT.setSeasonController(await seasonController.getAddress());
    await zoneNFT.setChallengeContract(await zoneChallenge.getAddress());
    await zoneChallenge.setSeasonController(await seasonController.getAddress());
    await seasonController.setGpsOracle(await gpsOracle.getAddress());
    await seasonController.setDaoTreasury(treasury.address);
    await moveToken.setZoneNFT(await zoneNFT.getAddress());
  });

  // ── Helper: build oracle signature for mintMOVE ──────────────────────────
  async function buildRouteSig(to: string, routeHash: string, distanceMeters: bigint) {
    const message = ethers.solidityPackedKeccak256(
      ["address", "bytes32", "uint256"],
      [to, routeHash, distanceMeters]
    );
    return oracle.signMessage(ethers.getBytes(message));
  }

  // ── Helper: build oracle sig for zone mint ───────────────────────────────
  async function buildZoneMintSig(hexId: bigint, toAddress: string, mintCost: bigint) {
    const sigHash = ethers.solidityPackedKeccak256(
      ["uint64", "address", "uint256"],
      [hexId, toAddress, mintCost]
    );
    return oracle.signMessage(ethers.getBytes(sigHash));
  }

  // ── Helper: build oracle sig for challenge declare ────────────────────────
  async function buildDeclareSig(hexId: bigint, defenderAddr: string, baseScore: bigint) {
    const message = ethers.solidityPackedKeccak256(
      ["uint64", "address", "uint256"],
      [hexId, defenderAddr, baseScore]
    );
    return oracle.signMessage(ethers.getBytes(message));
  }

  // ── Helper: build oracle sig for score submission ─────────────────────────
  async function buildScoreSig(hexId: bigint, submitter: string, score: bigint) {
    const message = ethers.solidityPackedKeccak256(
      ["uint64", "address", "uint256"],
      [hexId, submitter, score]
    );
    return oracle.signMessage(ethers.getBytes(message));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Step 1-4: GPS route → mintMOVE via GPSOracle
  // ─────────────────────────────────────────────────────────────────────────
  it("Step 1-4: GPS route signed by oracle → mintMOVE increases $MOVE balance", async function () {
    // Fake GPS route: array of coordinates represented as a routeHash
    const fakeRoute = [
      { lat: 37.7749, lng: -122.4194 },
      { lat: 37.7849, lng: -122.4094 },
    ];
    const routeHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(fakeRoute)));
    const distanceMeters = 5_000n; // 5 km

    const sig = await buildRouteSig(alice.address, routeHash, distanceMeters);
    const balanceBefore = await moveToken.balanceOf(alice.address);

    // GPSOracle verifies sig and calls moveToken.mintMOVE
    await gpsOracle.submitRoute(alice.address, routeHash, distanceMeters, sig);

    const balanceAfter = await moveToken.balanceOf(alice.address);
    expect(balanceAfter).to.be.gt(balanceBefore);
    // 5km * 10 $MOVE/km = 50 $MOVE (minus 2% zone tax = 49 $MOVE since zoneNFT set)
    // Zone tax goes to zoneNFT contract (no zone minted yet, but contract gets the tax)
    expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("49")); // 98% of 50
    console.log("    Alice earned:", ethers.formatEther(balanceAfter - balanceBefore), "$MOVE");
  });

  it("Step 4b: route replay reverts", async function () {
    const routeHash = ethers.keccak256(ethers.toUtf8Bytes("duplicate-route"));
    const sig = await buildRouteSig(alice.address, routeHash, 1000n);
    await gpsOracle.submitRoute(alice.address, routeHash, 1000n, sig);
    await expect(
      gpsOracle.submitRoute(alice.address, routeHash, 1000n, sig)
    ).to.be.revertedWith("MoveToken: route already used");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Step 5: Mint Zone NFT for an eligible hex
  // ─────────────────────────────────────────────────────────────────────────
  it("Step 5: Mint Zone NFT for eligible hex (oracle signature)", async function () {
    // Give alice more $MOVE to cover zone mint cost
    const fundHash = ethers.hexlify(ethers.randomBytes(32));
    const fundSig  = await buildRouteSig(alice.address, fundHash, 20_000n);
    await gpsOracle.submitRoute(alice.address, fundHash, 20_000n, fundSig);

    // Also fund bob for challenges
    const bobHash1 = ethers.hexlify(ethers.randomBytes(32));
    const bobSig1  = await buildRouteSig(bob.address, bobHash1, 20_000n);
    await gpsOracle.submitRoute(bob.address, bobHash1, 20_000n, bobSig1);

    const mintCost = ethers.parseEther("100");
    const zoneSig  = await buildZoneMintSig(HEX_ID, alice.address, mintCost);

    await moveToken.connect(alice).approve(await zoneNFT.getAddress(), ethers.MaxUint256);
    const balanceBefore = await moveToken.balanceOf(alice.address);

    await zoneNFT.connect(alice).mintZone(HEX_ID, mintCost, zoneSig);

    expect(await zoneNFT.ownerOf(HEX_ID)).to.equal(alice.address);
    expect(await moveToken.balanceOf(alice.address)).to.equal(balanceBefore - mintCost);
    console.log("    Alice owns Zone NFT #", HEX_ID.toString());
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Step 6-7: Open challenge, submit scores, resolve → NFT transfer on win
  // ─────────────────────────────────────────────────────────────────────────
  it("Step 6-7: Challenge opened, challenger wins → NFT transferred", async function () {
    // Approve ZoneChallenge to burn $MOVE for bob (declaration cost)
    await moveToken.connect(bob).approve(await zoneChallenge.getAddress(), ethers.MaxUint256);
    // Approve ZoneChallenge to transfer zone NFT on alice's behalf
    await zoneNFT.connect(alice).setApprovalForAll(await zoneChallenge.getAddress(), true);

    const defenderBaseScore = 0n;
    const declareSig = await buildDeclareSig(HEX_ID, alice.address, defenderBaseScore);

    const bobBalBefore = await moveToken.balanceOf(bob.address);
    await zoneChallenge.connect(bob).declareChallenge(HEX_ID, defenderBaseScore, declareSig);
    expect(await moveToken.balanceOf(bob.address)).to.equal(
      bobBalBefore - ethers.parseEther("100") // DECLARATION_COST
    );

    const challenge = await zoneChallenge.getChallenge(HEX_ID);
    expect(challenge.challenger).to.equal(bob.address);
    expect(challenge.defender).to.equal(alice.address);

    // Bob submits a high score
    const bobScore    = ethers.parseEther("1000");
    const bobScoreSig = await buildScoreSig(HEX_ID, bob.address, bobScore);
    await zoneChallenge.connect(bob).submitScore(HEX_ID, bobScore, bobScoreSig);

    // Advance time past 14-day challenge window
    await time.increase(14 * 24 * 3600 + 1);

    // Resolve: challenger wins (bob's 1000 > alice's 0 base)
    await zoneChallenge.connect(deployer).resolveChallenge(HEX_ID);

    expect(await zoneNFT.ownerOf(HEX_ID)).to.equal(bob.address);
    console.log("    Bob won Zone NFT #", HEX_ID.toString(), "from alice");
  });

  it("Step 6b: Defender wins → NFT stays, cooldown applied", async function () {
    const HEX_ID_2 = HEX_ID + 1n;

    // Give alice enough tokens and mint a second zone
    const fundHash = ethers.hexlify(ethers.randomBytes(32));
    const fundSig  = await buildRouteSig(alice.address, fundHash, 20_000n);
    await gpsOracle.submitRoute(alice.address, fundHash, 20_000n, fundSig);

    const mintCost = ethers.parseEther("100");
    const zoneSig2 = await buildZoneMintSig(HEX_ID_2, alice.address, mintCost);
    await moveToken.connect(alice).approve(await zoneNFT.getAddress(), ethers.MaxUint256);
    await zoneNFT.connect(alice).mintZone(HEX_ID_2, mintCost, zoneSig2);

    // Give bob more tokens for declaration
    const bobFundHash = ethers.hexlify(ethers.randomBytes(32));
    const bobFundSig  = await buildRouteSig(bob.address, bobFundHash, 20_000n);
    await gpsOracle.submitRoute(bob.address, bobFundHash, 20_000n, bobFundSig);
    await moveToken.connect(bob).approve(await zoneChallenge.getAddress(), ethers.MaxUint256);
    await zoneNFT.connect(alice).setApprovalForAll(await zoneChallenge.getAddress(), true);

    // Defender has a high base score
    const highBaseScore = ethers.parseEther("9999");
    const declareSig    = await buildDeclareSig(HEX_ID_2, alice.address, highBaseScore);
    await zoneChallenge.connect(bob).declareChallenge(HEX_ID_2, highBaseScore, declareSig);

    await time.increase(14 * 24 * 3600 + 1);
    await zoneChallenge.connect(deployer).resolveChallenge(HEX_ID_2);

    expect(await zoneNFT.ownerOf(HEX_ID_2)).to.equal(alice.address);
    console.log("    Alice defended Zone NFT #", HEX_ID_2.toString());
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Step 8: Season end → greatBurn
  // ─────────────────────────────────────────────────────────────────────────
  it("Step 8: greatBurn burns 10% of top-zone yields at season end", async function () {
    // Start a season
    await seasonController.startSeason();

    // Give alice some $MOVE and approve SeasonController to transfer on her behalf
    const earnHash = ethers.hexlify(ethers.randomBytes(32));
    const earnSig  = await buildRouteSig(alice.address, earnHash, 20_000n);
    await gpsOracle.submitRoute(alice.address, earnHash, 20_000n, earnSig);

    const aliceBalance = await moveToken.balanceOf(alice.address);
    const zoneYield    = ethers.parseEther("100");

    // Pre-approve so SeasonController can burn
    await moveToken.connect(alice).approve(await seasonController.getAddress(), ethers.MaxUint256);

    // Fast-forward to season end
    await time.increase(90 * 24 * 3600 + 1);

    const topHexIds: bigint[] = [HEX_ID + 1n]; // alice owns HEX_ID+1
    const yields:   bigint[] = [zoneYield];

    // Build oracle signature over (seasonNumber, topHexIds, yields)
    const seasonNumber = await seasonController.seasonNumber();
    const payload = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "uint64[]", "uint256[]"],
        [seasonNumber, topHexIds, yields]
      )
    );
    const burnSig = await oracle.signMessage(ethers.getBytes(payload));

    const aliceBalBefore   = await moveToken.balanceOf(alice.address);
    const treasuryBalBefore = await moveToken.balanceOf(treasury.address);

    await seasonController.greatBurn(topHexIds, yields, burnSig);

    const burnAmount = (zoneYield * 1000n) / 10000n; // 10%
    expect(await moveToken.balanceOf(alice.address)).to.equal(aliceBalBefore - burnAmount);
    expect(await moveToken.balanceOf(treasury.address)).to.equal(treasuryBalBefore + burnAmount);
    console.log("    Great Burn: transferred", ethers.formatEther(burnAmount), "$MOVE to treasury");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Bonus: zone tax flow
  // ─────────────────────────────────────────────────────────────────────────
  it("Bonus: zone tax accumulates in ZoneNFT contract when moving through a zone", async function () {
    const routeHash = ethers.hexlify(ethers.randomBytes(32));
    const sig = await buildRouteSig(alice.address, routeHash, 10_000n); // 10 km

    // Read current base rate (may have been reduced by adjustEmissionRate in greatBurn)
    const currentRate = await moveToken.currentRate();
    // Alice has hit daily cap — use a fresh route for a new user isn't possible here,
    // so just verify the tax delta is > 0 and equals 2% of earned.
    const zoneNFTBalBefore = await moveToken.balanceOf(await zoneNFT.getAddress());
    const aliceBalBefore   = await moveToken.balanceOf(alice.address);
    await gpsOracle.submitRoute(alice.address, routeHash, 10_000n, sig);
    const zoneNFTBalAfter = await moveToken.balanceOf(await zoneNFT.getAddress());
    const aliceBalAfter   = await moveToken.balanceOf(alice.address);

    const aliceEarned = aliceBalAfter - aliceBalBefore;
    const taxPaid     = zoneNFTBalAfter - zoneNFTBalBefore;

    // Both alice and zone got something; zone gets 2% of total, alice gets 98%
    expect(taxPaid).to.be.gt(0n);
    // tax / (alice + tax) == 2%
    const totalEarned = aliceEarned + taxPaid;
    expect(taxPaid * 10_000n / totalEarned).to.equal(200n); // exactly 2%
    console.log("    Zone tax accumulated:", ethers.formatEther(taxPaid), "$MOVE (2% of", ethers.formatEther(totalEarned), ")");
  });
});
