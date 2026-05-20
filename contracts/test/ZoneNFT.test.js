const { expect }     = require("chai");
const { ethers }     = require("hardhat");
const { time }       = require("@nomicfoundation/hardhat-network-helpers");

// ─── fixture ──────────────────────────────────────────────────────────────────

async function deployFixture() {
  const [owner, minter, yieldDepositor, user1, user2] = await ethers.getSigners();

  // Deploy a bare-bones MOVE token for ZoneNFT yield payments
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const moveToken = await MockERC20.deploy("MoveToken", "MOVE", 18);

  const ZoneNFT = await ethers.getContractFactory("ZoneNFT");
  const zoneNFT = await ZoneNFT.deploy(await moveToken.getAddress());

  const MINTER_ROLE          = await zoneNFT.MINTER_ROLE();
  const YIELD_DEPOSITOR_ROLE = await zoneNFT.YIELD_DEPOSITOR_ROLE();

  await zoneNFT.grantRole(MINTER_ROLE,          minter.address);
  await zoneNFT.grantRole(YIELD_DEPOSITOR_ROLE, yieldDepositor.address);

  return { zoneNFT, moveToken, owner, minter, yieldDepositor, user1, user2 };
}

const HEX_A = 1n;
const HEX_B = 2n;

// ─── tests ────────────────────────────────────────────────────────────────────

describe("ZoneNFT", function () {

  // ── Minting ────────────────────────────────────────────────────────────────

  describe("mintZone()", function () {
    it("mints a zone NFT to the specified owner", async function () {
      const { zoneNFT, minter, user1 } = await deployFixture();

      const tx = await zoneNFT.connect(minter).mintZone(HEX_A, user1.address);
      const rc = await tx.wait();
      const log = rc.logs.find(l => l.fragment?.name === "ZoneMinted");
      const tokenId = log.args[2];

      expect(await zoneNFT.ownerOf(tokenId)).to.equal(user1.address);
      expect(await zoneNFT.hexToToken(HEX_A)).to.equal(tokenId);
    });

    it("reverts if the hex is already minted", async function () {
      const { zoneNFT, minter, user1 } = await deployFixture();
      await zoneNFT.connect(minter).mintZone(HEX_A, user1.address);
      await expect(
        zoneNFT.connect(minter).mintZone(HEX_A, user1.address)
      ).to.be.revertedWith("ZoneNFT: exists");
    });

    it("reverts when called without MINTER_ROLE", async function () {
      const { zoneNFT, user1 } = await deployFixture();
      await expect(
        zoneNFT.connect(user1).mintZone(HEX_A, user1.address)
      ).to.be.revertedWithCustomError(zoneNFT, "AccessControlUnauthorizedAccount");
    });
  });

  // ── Loyalty multiplier ─────────────────────────────────────────────────────

  describe("getLoyaltyMultiplier()", function () {
    async function mintAndGetHex(zoneNFT, minter, user) {
      await zoneNFT.connect(minter).mintZone(HEX_A, user.address);
      return HEX_A;
    }

    it("returns 100 (1.0×) in the first 30 days", async function () {
      const { zoneNFT, minter, user1 } = await deployFixture();
      const hexId = await mintAndGetHex(zoneNFT, minter, user1);
      expect(await zoneNFT.getLoyaltyMultiplier(hexId)).to.equal(100);
    });

    it("returns 115 (1.15×) between 31 – 90 days", async function () {
      const { zoneNFT, minter, user1 } = await deployFixture();
      const hexId = await mintAndGetHex(zoneNFT, minter, user1);
      await time.increase(31 * 24 * 3600);
      expect(await zoneNFT.getLoyaltyMultiplier(hexId)).to.equal(115);
    });

    it("returns 130 (1.30×) between 91 – 180 days", async function () {
      const { zoneNFT, minter, user1 } = await deployFixture();
      const hexId = await mintAndGetHex(zoneNFT, minter, user1);
      await time.increase(91 * 24 * 3600);
      expect(await zoneNFT.getLoyaltyMultiplier(hexId)).to.equal(130);
    });

    it("returns 150 (1.50×) between 181 – 365 days", async function () {
      const { zoneNFT, minter, user1 } = await deployFixture();
      const hexId = await mintAndGetHex(zoneNFT, minter, user1);
      await time.increase(181 * 24 * 3600);
      expect(await zoneNFT.getLoyaltyMultiplier(hexId)).to.equal(150);
    });

    it("returns 175 (1.75×) after 365 days", async function () {
      const { zoneNFT, minter, user1 } = await deployFixture();
      const hexId = await mintAndGetHex(zoneNFT, minter, user1);
      await time.increase(366 * 24 * 3600);
      expect(await zoneNFT.getLoyaltyMultiplier(hexId)).to.equal(175);
    });

    it("resets to 100 after zone is transferred (new owner clock)", async function () {
      const { zoneNFT, minter, user1, user2 } = await deployFixture();
      const hexId = await mintAndGetHex(zoneNFT, minter, user1);

      await time.increase(366 * 24 * 3600);
      expect(await zoneNFT.getLoyaltyMultiplier(hexId)).to.equal(175);

      // Transfer zone (simulates challenge win)
      await zoneNFT.connect(minter).transferZone(hexId, user2.address);
      expect(await zoneNFT.getLoyaltyMultiplier(hexId)).to.equal(100);
    });
  });

  // ── Dormancy and reclaim ───────────────────────────────────────────────────

  describe("dormancy / reclaim", function () {
    it("is not dormant immediately after minting", async function () {
      const { zoneNFT, minter, user1 } = await deployFixture();
      await zoneNFT.connect(minter).mintZone(HEX_A, user1.address);
      expect(await zoneNFT.isDormant(HEX_A)).to.equal(false);
    });

    it("becomes dormant after 90 days of inactivity", async function () {
      const { zoneNFT, minter, user1 } = await deployFixture();
      await zoneNFT.connect(minter).mintZone(HEX_A, user1.address);
      await time.increase(90 * 24 * 3600 + 1);
      expect(await zoneNFT.isDormant(HEX_A)).to.equal(true);
    });

    it("triggerDormancy reverts if zone is not dormant", async function () {
      const { zoneNFT, minter, user1 } = await deployFixture();
      await zoneNFT.connect(minter).mintZone(HEX_A, user1.address);
      await expect(zoneNFT.triggerDormancy(HEX_A)).to.be.revertedWith("ZoneNFT: not dormant");
    });

    it("allows reclaim after dormancy period + reclaim window", async function () {
      const { zoneNFT, minter, user1, user2 } = await deployFixture();
      await zoneNFT.connect(minter).mintZone(HEX_A, user1.address);

      await time.increase(90 * 24 * 3600 + 1);
      await zoneNFT.triggerDormancy(HEX_A);

      // Still in the 30-day reclaim window
      await expect(
        zoneNFT.connect(user2).reclaimZone(HEX_A)
      ).to.be.revertedWith("ZoneNFT: reclaim window active");

      await time.increase(30 * 24 * 3600 + 1);
      await zoneNFT.connect(user2).reclaimZone(HEX_A);

      const tokenId = await zoneNFT.hexToToken(HEX_A);
      expect(await zoneNFT.ownerOf(tokenId)).to.equal(user2.address);
    });

    it("resets loyalty clock after reclaim", async function () {
      const { zoneNFT, minter, user1, user2 } = await deployFixture();
      await zoneNFT.connect(minter).mintZone(HEX_A, user1.address);
      await time.increase(90 * 24 * 3600 + 1);
      await zoneNFT.triggerDormancy(HEX_A);
      await time.increase(30 * 24 * 3600 + 1);
      await zoneNFT.connect(user2).reclaimZone(HEX_A);

      // New owner's clock just started → 1.0× multiplier
      expect(await zoneNFT.getLoyaltyMultiplier(HEX_A)).to.equal(100);
    });
  });

  // ── Right of First Refusal ─────────────────────────────────────────────────

  describe("Right of First Refusal", function () {
    it("lets previous owner buy back within 14 days", async function () {
      const { zoneNFT, minter, user1, user2 } = await deployFixture();
      await zoneNFT.connect(minter).mintZone(HEX_A, user1.address);

      // Simulate zone transfer (challenge win by user2)
      await zoneNFT.connect(minter).transferZone(HEX_A, user2.address);
      await zoneNFT.connect(minter).setROFR(HEX_A, user1.address);

      // user1 exercises ROFR, paying 1 ETH
      await zoneNFT.connect(user1).exerciseROFR(HEX_A, { value: ethers.parseEther("1") });

      const tokenId = await zoneNFT.hexToToken(HEX_A);
      expect(await zoneNFT.ownerOf(tokenId)).to.equal(user1.address);
    });

    it("rejects ROFR exercise after 14 days", async function () {
      const { zoneNFT, minter, user1, user2 } = await deployFixture();
      await zoneNFT.connect(minter).mintZone(HEX_A, user1.address);
      await zoneNFT.connect(minter).transferZone(HEX_A, user2.address);
      await zoneNFT.connect(minter).setROFR(HEX_A, user1.address);

      await time.increase(14 * 24 * 3600 + 1);
      await expect(
        zoneNFT.connect(user1).exerciseROFR(HEX_A, { value: ethers.parseEther("1") })
      ).to.be.revertedWith("ZoneNFT: ROFR expired");
    });

    it("rejects ROFR exercise by a non-holder", async function () {
      const { zoneNFT, minter, user1, user2 } = await deployFixture();
      await zoneNFT.connect(minter).mintZone(HEX_A, user1.address);
      await zoneNFT.connect(minter).transferZone(HEX_A, user2.address);
      await zoneNFT.connect(minter).setROFR(HEX_A, user1.address);

      await expect(
        zoneNFT.connect(user2).exerciseROFR(HEX_A, { value: ethers.parseEther("1") })
      ).to.be.revertedWith("ZoneNFT: not ROFR holder");
    });
  });

  // ── Pull-payment yield ─────────────────────────────────────────────────────

  describe("yield pull-payment", function () {
    it("lets owner claim accumulated yield", async function () {
      const { zoneNFT, moveToken, minter, yieldDepositor, user1 } = await deployFixture();
      await zoneNFT.connect(minter).mintZone(HEX_A, user1.address);

      const yieldAmount = ethers.parseEther("100");
      await moveToken.mint(await zoneNFT.getAddress(), yieldAmount);
      await zoneNFT.connect(yieldDepositor).depositYield(user1.address, yieldAmount);

      const before = await moveToken.balanceOf(user1.address);
      await zoneNFT.connect(user1).claimYield();
      expect(await moveToken.balanceOf(user1.address)).to.equal(before + yieldAmount);
    });

    it("reverts claimYield when there is nothing to claim", async function () {
      const { zoneNFT, user1 } = await deployFixture();
      await expect(zoneNFT.connect(user1).claimYield()).to.be.revertedWith("ZoneNFT: no yield");
    });
  });

  // ── Stronghold mechanics ───────────────────────────────────────────────────

  describe("stronghold", function () {
    it("becomes a stronghold after 5 wins", async function () {
      const { zoneNFT, minter, user1 } = await deployFixture();
      await zoneNFT.connect(minter).mintZone(HEX_A, user1.address);

      for (let i = 0; i < 5; i++) {
        await zoneNFT.connect(minter).recordWin(HEX_A);
      }

      expect(await zoneNFT.isStronghold(HEX_A)).to.equal(true);
    });

    it("loses stronghold status on a loss", async function () {
      const { zoneNFT, minter, user1 } = await deployFixture();
      await zoneNFT.connect(minter).mintZone(HEX_A, user1.address);
      for (let i = 0; i < 5; i++) await zoneNFT.connect(minter).recordWin(HEX_A);
      expect(await zoneNFT.isStronghold(HEX_A)).to.equal(true);

      await zoneNFT.connect(minter).recordLoss(HEX_A);
      expect(await zoneNFT.isStronghold(HEX_A)).to.equal(false);
    });
  });
});
