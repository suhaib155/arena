const { expect }     = require("chai");
const { ethers }     = require("hardhat");
const { time }       = require("@nomicfoundation/hardhat-network-helpers");

// ─── fixture ──────────────────────────────────────────────────────────────────

async function deployFixture() {
  const [owner, oracle, challenger, defender, clubMember, other] = await ethers.getSigners();

  // MOVE token (use MockERC20 for simplicity in challenge tests)
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const moveToken = await MockERC20.deploy("MoveToken", "MOVE", 18);

  // SeasonController
  const SeasonController = await ethers.getContractFactory("SeasonController");
  const seasonCtrl       = await SeasonController.deploy();

  // ZoneNFT
  const ZoneNFT = await ethers.getContractFactory("ZoneNFT");
  const zoneNFT = await ZoneNFT.deploy(await moveToken.getAddress());

  // ZoneChallenge
  const ZoneChallenge = await ethers.getContractFactory("ZoneChallenge");
  const challenge     = await ZoneChallenge.deploy(
    await zoneNFT.getAddress(),
    await moveToken.getAddress(),
    await seasonCtrl.getAddress(),
    oracle.address,
  );

  // Roles
  const MINTER_ROLE      = await zoneNFT.MINTER_ROLE();
  const CONTROLLER_ROLE  = await seasonCtrl.CONTROLLER_ROLE();

  // Grant ZoneChallenge MINTER_ROLE on ZoneNFT
  await zoneNFT.grantRole(MINTER_ROLE, await challenge.getAddress());
  // Grant ZoneChallenge CONTROLLER_ROLE on SeasonController
  await seasonCtrl.grantRole(CONTROLLER_ROLE, await challenge.getAddress());

  // Also allow owner to mint zones for test setup
  await zoneNFT.grantRole(MINTER_ROLE, owner.address);

  // Start season 1
  await seasonCtrl.startSeason(1);

  const HEX_A = 100n;
  const STAKE  = ethers.parseEther("100"); // 100 MOVE

  return {
    challenge, zoneNFT, moveToken, seasonCtrl,
    owner, oracle, challenger, defender, clubMember, other,
    HEX_A, STAKE,
  };
}

// ─── oracle signature helper ──────────────────────────────────────────────────

async function signContribution(oracle, challenge, hexId, side, contributor, score, nonce) {
  const msgHash = ethers.solidityPackedKeccak256(
    ["uint64", "address", "address", "uint256", "uint256"],
    [hexId,    side,      contributor, score,   nonce],
  );
  return oracle.signMessage(ethers.getBytes(msgHash));
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe("ZoneChallenge", function () {

  // ── Open challenge ─────────────────────────────────────────────────────────

  describe("openChallenge()", function () {
    it("opens a challenge and locks challenger's stake", async function () {
      const { challenge, zoneNFT, moveToken, challenger, defender, HEX_A, STAKE, owner } = await deployFixture();

      await zoneNFT.connect(owner).mintZone(HEX_A, defender.address);
      await moveToken.mint(challenger.address, STAKE);
      await moveToken.connect(challenger).approve(await challenge.getAddress(), STAKE);

      await expect(
        challenge.connect(challenger).openChallenge(HEX_A, STAKE)
      ).to.emit(challenge, "ChallengeOpened");

      expect(await moveToken.balanceOf(await challenge.getAddress())).to.equal(STAKE);
    });

    it("reverts if stake is below minimum", async function () {
      const { challenge, zoneNFT, moveToken, challenger, defender, HEX_A, owner } = await deployFixture();
      await zoneNFT.connect(owner).mintZone(HEX_A, defender.address);
      const tiny = ethers.parseEther("1");
      await moveToken.mint(challenger.address, tiny);
      await moveToken.connect(challenger).approve(await challenge.getAddress(), tiny);
      await expect(
        challenge.connect(challenger).openChallenge(HEX_A, tiny)
      ).to.be.revertedWith("ZoneChallenge: stake too low");
    });

    it("reverts if zone is not minted", async function () {
      const { challenge, moveToken, challenger, HEX_A, STAKE } = await deployFixture();
      await moveToken.mint(challenger.address, STAKE);
      await moveToken.connect(challenger).approve(await challenge.getAddress(), STAKE);
      await expect(
        challenge.connect(challenger).openChallenge(HEX_A, STAKE)
      ).to.be.revertedWith("ZoneChallenge: zone not minted");
    });

    it("reverts if challenger owns the zone", async function () {
      const { challenge, zoneNFT, moveToken, challenger, HEX_A, STAKE, owner } = await deployFixture();
      await zoneNFT.connect(owner).mintZone(HEX_A, challenger.address);
      await moveToken.mint(challenger.address, STAKE);
      await moveToken.connect(challenger).approve(await challenge.getAddress(), STAKE);
      await expect(
        challenge.connect(challenger).openChallenge(HEX_A, STAKE)
      ).to.be.revertedWith("ZoneChallenge: own zone");
    });
  });

  // ── Cooldown enforcement ───────────────────────────────────────────────────

  describe("challengeCooldown", function () {
    it("prevents re-challenge within 30 days", async function () {
      const { challenge, zoneNFT, moveToken, challenger, defender, HEX_A, STAKE, owner } = await deployFixture();

      await zoneNFT.connect(owner).mintZone(HEX_A, defender.address);

      // First challenge
      await moveToken.mint(challenger.address, STAKE * 2n);
      await moveToken.connect(challenger).approve(await challenge.getAddress(), STAKE * 2n);
      await challenge.connect(challenger).openChallenge(HEX_A, STAKE);

      // Resolve immediately (close time not reached, but let's advance past duration)
      await time.increase(24 * 3600 + 1);
      await challenge.resolveChallenge(HEX_A);

      // Immediately try to re-challenge: still in cooldown
      await moveToken.mint(challenger.address, STAKE);
      await moveToken.connect(challenger).approve(await challenge.getAddress(), STAKE);
      await expect(
        challenge.connect(challenger).openChallenge(HEX_A, STAKE)
      ).to.be.revertedWith("ZoneChallenge: cooldown");
    });

    it("allows challenge after cooldown expires", async function () {
      const { challenge, zoneNFT, moveToken, challenger, defender, HEX_A, STAKE, owner } = await deployFixture();

      await zoneNFT.connect(owner).mintZone(HEX_A, defender.address);

      await moveToken.mint(challenger.address, STAKE * 2n);
      await moveToken.connect(challenger).approve(await challenge.getAddress(), STAKE * 2n);
      await challenge.connect(challenger).openChallenge(HEX_A, STAKE);

      await time.increase(24 * 3600 + 1);
      await challenge.resolveChallenge(HEX_A);

      // Wait 30 days
      await time.increase(30 * 24 * 3600 + 1);

      await moveToken.mint(challenger.address, STAKE);
      await moveToken.connect(challenger).approve(await challenge.getAddress(), STAKE);
      await expect(
        challenge.connect(challenger).openChallenge(HEX_A, STAKE)
      ).to.emit(challenge, "ChallengeOpened");
    });
  });

  // ── Full battle lifecycle: challenger wins ─────────────────────────────────

  describe("full lifecycle — challenger wins", function () {
    it("transfers zone to challenger when challenger score is higher", async function () {
      const { challenge, zoneNFT, moveToken, oracle, challenger, defender, clubMember, HEX_A, STAKE, owner } = await deployFixture();

      await zoneNFT.connect(owner).mintZone(HEX_A, defender.address);
      await moveToken.mint(challenger.address, STAKE);
      await moveToken.connect(challenger).approve(await challenge.getAddress(), STAKE);
      await challenge.connect(challenger).openChallenge(HEX_A, STAKE);

      // Contribute scores: challenger side gets more
      const nonce0 = await challenge.contributionNonces(clubMember.address);
      const sig0   = await signContribution(oracle, challenge, HEX_A, challenger.address, clubMember.address, 1000n, nonce0);
      await challenge.connect(clubMember).contributeToChallenge(HEX_A, challenger.address, 1000n, sig0);

      const nonce1 = await challenge.contributionNonces(clubMember.address);
      const sig1   = await signContribution(oracle, challenge, HEX_A, defender.address, clubMember.address, 500n, nonce1);
      await challenge.connect(clubMember).contributeToChallenge(HEX_A, defender.address, 500n, sig1);

      await time.increase(24 * 3600 + 1);

      await expect(challenge.resolveChallenge(HEX_A))
        .to.emit(challenge, "ChallengeResolved")
        .withArgs(HEX_A, challenger.address, true);

      const tokenId = await zoneNFT.hexToToken(HEX_A);
      expect(await zoneNFT.ownerOf(tokenId)).to.equal(challenger.address);
    });

    it("sets Right of First Refusal for the evicted defender", async function () {
      const { challenge, zoneNFT, moveToken, oracle, challenger, defender, clubMember, HEX_A, STAKE, owner } = await deployFixture();

      await zoneNFT.connect(owner).mintZone(HEX_A, defender.address);
      await moveToken.mint(challenger.address, STAKE);
      await moveToken.connect(challenger).approve(await challenge.getAddress(), STAKE);
      await challenge.connect(challenger).openChallenge(HEX_A, STAKE);

      const nonce = await challenge.contributionNonces(clubMember.address);
      const sig   = await signContribution(oracle, challenge, HEX_A, challenger.address, clubMember.address, 1000n, nonce);
      await challenge.connect(clubMember).contributeToChallenge(HEX_A, challenger.address, 1000n, sig);

      await time.increase(24 * 3600 + 1);
      await challenge.resolveChallenge(HEX_A);

      expect(await zoneNFT.rightOfFirstRefusal(HEX_A)).to.equal(defender.address);
    });

    it("sends staked MOVE to the winner (challenger)", async function () {
      const { challenge, zoneNFT, moveToken, oracle, challenger, defender, clubMember, HEX_A, STAKE, owner } = await deployFixture();

      await zoneNFT.connect(owner).mintZone(HEX_A, defender.address);
      await moveToken.mint(challenger.address, STAKE);
      await moveToken.connect(challenger).approve(await challenge.getAddress(), STAKE);
      await challenge.connect(challenger).openChallenge(HEX_A, STAKE);

      const nonce = await challenge.contributionNonces(clubMember.address);
      const sig   = await signContribution(oracle, challenge, HEX_A, challenger.address, clubMember.address, 999n, nonce);
      await challenge.connect(clubMember).contributeToChallenge(HEX_A, challenger.address, 999n, sig);

      await time.increase(24 * 3600 + 1);
      const balBefore = await moveToken.balanceOf(challenger.address);
      await challenge.resolveChallenge(HEX_A);
      expect(await moveToken.balanceOf(challenger.address)).to.equal(balBefore + STAKE);
    });
  });

  // ── Full battle lifecycle: defender wins ───────────────────────────────────

  describe("full lifecycle — defender wins", function () {
    it("keeps zone with defender when defender score is higher", async function () {
      const { challenge, zoneNFT, moveToken, oracle, challenger, defender, clubMember, HEX_A, STAKE, owner } = await deployFixture();

      await zoneNFT.connect(owner).mintZone(HEX_A, defender.address);
      await moveToken.mint(challenger.address, STAKE);
      await moveToken.connect(challenger).approve(await challenge.getAddress(), STAKE);
      await challenge.connect(challenger).openChallenge(HEX_A, STAKE);

      // Defender's club contributes more
      const nonce = await challenge.contributionNonces(clubMember.address);
      const sig   = await signContribution(oracle, challenge, HEX_A, defender.address, clubMember.address, 900n, nonce);
      await challenge.connect(clubMember).contributeToChallenge(HEX_A, defender.address, 900n, sig);

      await time.increase(24 * 3600 + 1);
      await expect(challenge.resolveChallenge(HEX_A))
        .to.emit(challenge, "ChallengeResolved")
        .withArgs(HEX_A, defender.address, false);

      const tokenId = await zoneNFT.hexToToken(HEX_A);
      expect(await zoneNFT.ownerOf(tokenId)).to.equal(defender.address);
    });

    it("defender wins on tie (no score submitted)", async function () {
      const { challenge, zoneNFT, moveToken, challenger, defender, HEX_A, STAKE, owner } = await deployFixture();

      await zoneNFT.connect(owner).mintZone(HEX_A, defender.address);
      await moveToken.mint(challenger.address, STAKE);
      await moveToken.connect(challenger).approve(await challenge.getAddress(), STAKE);
      await challenge.connect(challenger).openChallenge(HEX_A, STAKE);

      // No contributions → 0 vs 0 → challenger score NOT > defender score → defender wins
      await time.increase(24 * 3600 + 1);
      await expect(challenge.resolveChallenge(HEX_A))
        .to.emit(challenge, "ChallengeResolved")
        .withArgs(HEX_A, defender.address, false);
    });

    it("sends staked MOVE to the winner (defender)", async function () {
      const { challenge, zoneNFT, moveToken, challenger, defender, HEX_A, STAKE, owner } = await deployFixture();

      await zoneNFT.connect(owner).mintZone(HEX_A, defender.address);
      await moveToken.mint(challenger.address, STAKE);
      await moveToken.connect(challenger).approve(await challenge.getAddress(), STAKE);
      await challenge.connect(challenger).openChallenge(HEX_A, STAKE);

      await time.increase(24 * 3600 + 1);
      const balBefore = await moveToken.balanceOf(defender.address);
      await challenge.resolveChallenge(HEX_A);
      expect(await moveToken.balanceOf(defender.address)).to.equal(balBefore + STAKE);
    });
  });

  // ── Stronghold boost ───────────────────────────────────────────────────────

  describe("stronghold boost", function () {
    it("defender wins with lower raw score if zone is a stronghold", async function () {
      const { challenge, zoneNFT, moveToken, oracle, challenger, defender, clubMember, HEX_A, STAKE, owner } = await deployFixture();

      await zoneNFT.connect(owner).mintZone(HEX_A, defender.address);

      // Make it a stronghold (5 wins)
      for (let i = 0; i < 5; i++) await zoneNFT.connect(owner).recordWin(HEX_A);
      expect(await zoneNFT.isStronghold(HEX_A)).to.equal(true);

      await moveToken.mint(challenger.address, STAKE);
      await moveToken.connect(challenger).approve(await challenge.getAddress(), STAKE);
      await challenge.connect(challenger).openChallenge(HEX_A, STAKE);

      // Challenger: 1100 raw, Defender: 1000 raw
      // effectiveDefender = 1000 × 1.2 = 1200 → defender wins
      const nonce0 = await challenge.contributionNonces(clubMember.address);
      const sig0   = await signContribution(oracle, challenge, HEX_A, challenger.address, clubMember.address, 1100n, nonce0);
      await challenge.connect(clubMember).contributeToChallenge(HEX_A, challenger.address, 1100n, sig0);

      const nonce1 = await challenge.contributionNonces(clubMember.address);
      const sig1   = await signContribution(oracle, challenge, HEX_A, defender.address, clubMember.address, 1000n, nonce1);
      await challenge.connect(clubMember).contributeToChallenge(HEX_A, defender.address, 1000n, sig1);

      await time.increase(24 * 3600 + 1);
      await expect(challenge.resolveChallenge(HEX_A))
        .to.emit(challenge, "ChallengeResolved")
        .withArgs(HEX_A, defender.address, false);
    });
  });

  // ── Club rally: oracle sig verification ───────────────────────────────────

  describe("contributeToChallenge() — oracle verification", function () {
    it("rejects contributions with an invalid oracle signature", async function () {
      const { challenge, zoneNFT, moveToken, challenger, defender, clubMember, HEX_A, STAKE, owner, other } = await deployFixture();

      await zoneNFT.connect(owner).mintZone(HEX_A, defender.address);
      await moveToken.mint(challenger.address, STAKE);
      await moveToken.connect(challenger).approve(await challenge.getAddress(), STAKE);
      await challenge.connect(challenger).openChallenge(HEX_A, STAKE);

      const nonce = await challenge.contributionNonces(clubMember.address);
      // Sign with a non-oracle account
      const badSig = await signContribution(other, challenge, HEX_A, challenger.address, clubMember.address, 500n, nonce);

      await expect(
        challenge.connect(clubMember).contributeToChallenge(HEX_A, challenger.address, 500n, badSig)
      ).to.be.revertedWith("ZoneChallenge: bad oracle sig");
    });

    it("rejects a replayed nonce", async function () {
      const { challenge, zoneNFT, moveToken, oracle, challenger, defender, clubMember, HEX_A, STAKE, owner } = await deployFixture();

      await zoneNFT.connect(owner).mintZone(HEX_A, defender.address);
      await moveToken.mint(challenger.address, STAKE);
      await moveToken.connect(challenger).approve(await challenge.getAddress(), STAKE);
      await challenge.connect(challenger).openChallenge(HEX_A, STAKE);

      const nonce = await challenge.contributionNonces(clubMember.address);
      const sig   = await signContribution(oracle, challenge, HEX_A, challenger.address, clubMember.address, 500n, nonce);
      await challenge.connect(clubMember).contributeToChallenge(HEX_A, challenger.address, 500n, sig);

      // Re-use same sig — nonce has advanced, recovered address won't match oracle
      await expect(
        challenge.connect(clubMember).contributeToChallenge(HEX_A, challenger.address, 500n, sig)
      ).to.be.revertedWith("ZoneChallenge: bad oracle sig");
    });

    it("rejects contribution to an invalid side", async function () {
      const { challenge, zoneNFT, moveToken, oracle, challenger, defender, clubMember, other, HEX_A, STAKE, owner } = await deployFixture();

      await zoneNFT.connect(owner).mintZone(HEX_A, defender.address);
      await moveToken.mint(challenger.address, STAKE);
      await moveToken.connect(challenger).approve(await challenge.getAddress(), STAKE);
      await challenge.connect(challenger).openChallenge(HEX_A, STAKE);

      const nonce = await challenge.contributionNonces(clubMember.address);
      // Sign with `other.address` as the side (neither challenger nor defender)
      const sig = await signContribution(oracle, challenge, HEX_A, other.address, clubMember.address, 500n, nonce);

      await expect(
        challenge.connect(clubMember).contributeToChallenge(HEX_A, other.address, 500n, sig)
      ).to.be.revertedWith("ZoneChallenge: invalid side");
    });
  });

  // ── Resolve guards ─────────────────────────────────────────────────────────

  describe("resolveChallenge() guards", function () {
    it("reverts if called before challenge duration ends", async function () {
      const { challenge, zoneNFT, moveToken, challenger, defender, HEX_A, STAKE, owner } = await deployFixture();
      await zoneNFT.connect(owner).mintZone(HEX_A, defender.address);
      await moveToken.mint(challenger.address, STAKE);
      await moveToken.connect(challenger).approve(await challenge.getAddress(), STAKE);
      await challenge.connect(challenger).openChallenge(HEX_A, STAKE);

      await expect(challenge.resolveChallenge(HEX_A)).to.be.revertedWith("ZoneChallenge: not closed");
    });

    it("reverts if there is no active challenge", async function () {
      const { challenge, HEX_A } = await deployFixture();
      await expect(challenge.resolveChallenge(HEX_A)).to.be.revertedWith("ZoneChallenge: not open");
    });
  });

  // ── Season points ──────────────────────────────────────────────────────────

  describe("season points integration", function () {
    it("awards points to both winner and loser after a resolved battle", async function () {
      const { challenge, zoneNFT, moveToken, challenger, defender, seasonCtrl, HEX_A, STAKE, owner } = await deployFixture();

      await zoneNFT.connect(owner).mintZone(HEX_A, defender.address);
      await moveToken.mint(challenger.address, STAKE);
      await moveToken.connect(challenger).approve(await challenge.getAddress(), STAKE);
      await challenge.connect(challenger).openChallenge(HEX_A, STAKE);

      await time.increase(24 * 3600 + 1);
      await challenge.resolveChallenge(HEX_A);

      // Defender wins (no contributions, score 0 vs 0)
      // winner gets 10 points, loser gets 5 points
      const defPoints = await seasonCtrl.seasonPoints(defender.address, 1);
      const chalPoints = await seasonCtrl.seasonPoints(challenger.address, 1);

      expect(defPoints).to.equal(10);
      expect(chalPoints).to.equal(5);
    });
  });
});
