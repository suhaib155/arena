// Copied next to test/v3/ by run.sh; imports resolve there.
// G5 contract issue ledger: executable proofs against feat/v3-onchain-core.
// Runs only on the in-process Hardhat network. No RPC, no keys beyond Hardhat's
// built-in test accounts, nothing deployed anywhere.
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  ONE,
  SEASON_ONE_BUDGET,
  Suite,
  configureCityCap,
  declareContest,
  deploySuite,
  domain,
  eligibilityAttestation,
  execViaTimelock,
  fundLockedMove,
  fundLiquidMove,
  buildRewardTree,
  publishSettlement,
  settlementAuthorization,
  signEligibility,
  submitScore,
  RULES_VERSION,
  SCORE_TYPES,
  nextNonce,
} from "../v3/helpers";
import { cityCells, cellAt } from "../v3/cells";

const CITY = 1;
const OTHER_CITY = 2;
const DAY = 24 * 3600;

async function fx(): Promise<Suite> {
  return loadFixture(deploySuite);
}

describe("G5 ledger proofs (c8262ec)", () => {
  describe("H1 settlement day not bound to time; pool absorbs the unissued budget", () => {
    it("publishing day 90 straight after day 1 mints the whole remaining season budget in one call", async () => {
      const f = await fx();
      await (await publishSettlement(f, await settlementAuthorization({ dayId: 1, grossIssuance: ONE }))).wait();
      const remaining = SEASON_ONE_BUDGET - ONE;
      expect(await f.settlement.dailyPoolOf(90)).to.equal(remaining);
      await (await publishSettlement(f, await settlementAuthorization({ dayId: 90, grossIssuance: remaining }))).wait();
      expect(await f.settlement.seasonIssued(1)).to.equal(SEASON_ONE_BUDGET);
      // No time had to pass between the two publications.
      const r1 = await f.settlement.settlementOf(1);
      const r90 = await f.settlement.settlementOf(90);
      expect(r90.publishedAt - r1.publishedAt).to.be.lessThan(60n);
    });

    it("the next season's whole budget follows immediately (day 180), and skipped days can never be published", async () => {
      const f = await fx();
      await (await publishSettlement(f, await settlementAuthorization({ dayId: 90, grossIssuance: SEASON_ONE_BUDGET }))).wait();
      const s2 = (SEASON_ONE_BUDGET * 9000n) / 10000n;
      await (await publishSettlement(f, await settlementAuthorization({ dayId: 180, grossIssuance: s2 }))).wait();
      expect(await f.settlement.lifetimeMovementIssued()).to.equal(SEASON_ONE_BUDGET + s2);
      await expect(
        publishSettlement(f, await settlementAuthorization({ dayId: 2, grossIssuance: ONE }))
      ).to.be.revertedWithCustomError(f.settlement, "DayNotAdvancing");
    });

    it("liquid extraction in that path is bounded by the allowance plus 2% tolls (allowance is zero here)", async () => {
      const f = await fx();
      const gross = SEASON_ONE_BUDGET;
      const toll = (gross * 200n) / 10000n;
      await (
        await publishSettlement(f, await settlementAuthorization({ dayId: 90, grossIssuance: gross, tollBase: gross, tollCredits: toll }))
      ).wait();
      expect((await f.rewards.dayAllocation(90)).liquidAllocated).to.equal(toll);
      await expect(
        publishSettlement(f, await settlementAuthorization({ dayId: 91, grossIssuance: ONE, liquidMovementClaims: 1n }))
      ).to.be.revertedWithCustomError(f.settlement, "LiquidIssuanceAllowanceExceeded");
    });
  });

  describe("H2 one contest signer decides declarations and every score", () => {
    it("the signer alone hands any deed to a challenger in notice + window (~10 days)", async () => {
      const f = await fx();
      await configureCityCap(f, CITY, 5);
      const [cell] = cityCells(1);
      const claim = await eligibilityAttestation({ claimant: f.alice.address, h3CellId: cell, cityId: CITY });
      await (await f.deedClaims.connect(f.alice).claim(claim, await signEligibility(f, claim), 0)).wait();

      await (await declareContest(f, f.bob, cell)).wait();
      const contestId = await f.contests.lastContestId();
      await time.increase(72 * 3600 + 1);
      // All seven scoring days can be relayed at once: scoringDay is not bound to the clock.
      for (let d = 0; d < 7; d++) await (await submitScore(f, contestId, f.bob.address, d, 1n)).wait();
      // The defender's scores are simply never signed.
      await time.increase(7 * DAY);
      await (await f.contests.settleContest(contestId)).wait();
      expect(await f.deed.ownerOf(cell)).to.equal(f.bob.address);
    });

    it("the declaration authorization does not bind the defender: a holder change before declaration is not detected", async () => {
      const f = await fx();
      await configureCityCap(f, CITY, 5);
      const [cell] = cityCells(1);
      const claim = await eligibilityAttestation({ claimant: f.alice.address, h3CellId: cell, cityId: CITY });
      await (await f.deedClaims.connect(f.alice).claim(claim, await signEligibility(f, claim), 0)).wait();
      await (await f.deed.connect(f.alice).transferFrom(f.alice.address, f.carol.address, cell)).wait();
      await (await declareContest(f, f.bob, cell, { fortificationBps: 0 })).wait();
      const c = await f.contests.contestOf(await f.contests.lastContestId());
      expect(c.defender).to.equal(f.carol.address);
    });
  });

  describe("H3 / M1 one eligibility signer; cap per wallet and per signer-chosen city label", () => {
    it("fresh wallets each take a deed in a city whose per-holder cap is 1", async () => {
      const f = await fx();
      await configureCityCap(f, CITY, 1);
      const cells = cityCells(3);
      for (const [i, w] of [f.alice, f.bob, f.carol].entries()) {
        const a = await eligibilityAttestation({ claimant: w.address, h3CellId: cells[i], cityId: CITY });
        await (await f.deedClaims.connect(w).claim(a, await signEligibility(f, a), 0)).wait();
      }
      expect(await f.deed.cityDeedCount(CITY)).to.equal(3n);
    });

    it("cityId is whatever the attestation says: one wallet exceeds a cap of 1 for cells in the same place", async () => {
      const f = await fx();
      await configureCityCap(f, CITY, 1);
      await configureCityCap(f, OTHER_CITY, 1);
      const [c1, c2] = cityCells(2);
      const a1 = await eligibilityAttestation({ claimant: f.alice.address, h3CellId: c1, cityId: CITY });
      await (await f.deedClaims.connect(f.alice).claim(a1, await signEligibility(f, a1), 0)).wait();
      const a2 = await eligibilityAttestation({ claimant: f.alice.address, h3CellId: c2, cityId: OTHER_CITY });
      await (await f.deedClaims.connect(f.alice).claim(a2, await signEligibility(f, a2), 0)).wait();
      expect(await f.deed.balanceOf(f.alice.address)).to.equal(2n);
    });

    it("a deed has no burn or revoke path: a wrongly attested deed is permanent", async () => {
      const f = await fx();
      const fragment = f.deed.interface.fragments.map((x: any) => x.name).filter(Boolean);
      expect(fragment).to.not.include("burn");
      expect(fragment).to.not.include("revoke");
    });
  });

  describe("M2 cooldown is per challenger address across all deeds", () => {
    it("losing on deed A locks the address out of deed B; a fresh address is not locked", async () => {
      const f = await fx();
      await configureCityCap(f, CITY, 5);
      const [a, b] = cityCells(2);
      for (const cell of [a, b]) {
        const at = await eligibilityAttestation({ claimant: f.alice.address, h3CellId: cell, cityId: CITY });
        await (await f.deedClaims.connect(f.alice).claim(at, await signEligibility(f, at), 0)).wait();
      }
      await (await declareContest(f, f.bob, a)).wait();
      await time.increase(10 * DAY + 1);
      await (await f.contests.settleContest(await f.contests.lastContestId())).wait();
      await expect(declareContest(f, f.bob, b)).to.be.revertedWithCustomError(f.contests, "ChallengerInCooldown");
      await expect(declareContest(f, f.carol, b)).to.not.be.reverted;
    });
  });

  describe("M3 rulesVersion is global, not per contest", () => {
    it("a version change mid-contest voids already-signed scores; unrelayed contest goes to the defender 0-0", async () => {
      const f = await fx();
      await configureCityCap(f, CITY, 5);
      const [cell] = cityCells(1);
      const at = await eligibilityAttestation({ claimant: f.alice.address, h3CellId: cell, cityId: CITY });
      await (await f.deedClaims.connect(f.alice).claim(at, await signEligibility(f, at), 0)).wait();
      await (await declareContest(f, f.bob, cell)).wait();
      const contestId = await f.contests.lastContestId();
      const auth = {
        contestId, participant: f.bob.address, scoringDay: 0, score: 100n,
        rulesVersion: RULES_VERSION, nonce: nextNonce(), expiry: (await time.latest()) + 30 * DAY,
      };
      const sig = await f.contestScoreSigner.signTypedData(
        domain("MovenRunContests", f.chainId, f.addresses.contests), SCORE_TYPES, auth);
      await execViaTimelock(f, f.addresses.contests,
        f.contests.interface.encodeFunctionData("setRulesVersion", [RULES_VERSION + 1]), ethers.id("rv2"));
      await time.increase(72 * 3600);
      await expect(f.contests.connect(f.relayer).submitScore(auth, sig))
        .to.be.revertedWithCustomError(f.contests, "UnexpectedRulesVersion");
      await time.increase(8 * DAY);
      await (await f.contests.settleContest(contestId)).wait();
      expect(await f.deed.ownerOf(cell)).to.equal(f.alice.address);
    });
  });

  describe("M4 / M5 toll credits are liquid outside the allowance; per-leaf split is off chain", () => {
    it("with zero allowance, a non-holder account claims liquid MOVE from the toll bucket", async () => {
      const f = await fx();
      expect(await f.settlement.liquidIssuanceAllowance()).to.equal(0n);
      const gross = 1_000n * ONE;
      const toll = (gross * 200n) / 10000n;
      const entries = [
        { leafIndex: 0, account: f.alice.address, lockedAmount: gross - toll, liquidAmount: 0n },
        // carol holds no deed; nothing on chain checks the toll recipient.
        { leafIndex: 1, account: f.carol.address, lockedAmount: 0n, liquidAmount: toll },
      ];
      const tree = buildRewardTree(f.chainId, f.addresses.rewards, 1, entries);
      await (await publishSettlement(f, await settlementAuthorization({
        dayId: 1, grossIssuance: gross, tollBase: gross, tollCredits: toll, merkleRoot: tree.root,
      }))).wait();
      await (await f.rewards.claim(1, 1, f.carol.address, 0n, toll, tree.proofFor(1))).wait();
      expect(await f.token.liquidBalanceOf(f.carol.address)).to.equal(toll);
      expect(await f.deed.balanceOf(f.carol.address)).to.equal(0n);
    });
  });

  describe("M6 stale listings revive", () => {
    it("a listing survives the deed leaving and returning, and is bought at the old price", async () => {
      const f = await fx();
      await configureCityCap(f, CITY, 5);
      const [cell] = cityCells(1);
      const at = await eligibilityAttestation({ claimant: f.alice.address, h3CellId: cell, cityId: CITY });
      await (await f.deedClaims.connect(f.alice).claim(at, await signEligibility(f, at), 0)).wait();
      await (await f.deed.connect(f.alice).setApprovalForAll(f.addresses.marketplace, true)).wait();
      await (await f.marketplace.connect(f.alice).list(cell, 5n * ONE)).wait();
      await (await f.deed.connect(f.alice).transferFrom(f.alice.address, f.carol.address, cell)).wait();
      expect(await f.marketplace.isListingLive(cell)).to.equal(false);
      await (await f.deed.connect(f.carol).transferFrom(f.carol.address, f.alice.address, cell)).wait();
      expect(await f.marketplace.isListingLive(cell)).to.equal(true);
      await fundLiquidMove(f, 1, [{ account: f.bob.address, amount: 5n * ONE }]);
      await (await f.token.connect(f.bob).approve(f.addresses.marketplace, 5n * ONE)).wait();
      await (await f.marketplace.connect(f.bob).buy(cell, 5n * ONE)).wait();
      expect(await f.deed.ownerOf(cell)).to.equal(f.bob.address);
    });
  });

  describe("M7 locked rewards pay the claim fee; the deed is then freely transferable", () => {
    it("locked-only MOVE is burned for a deed which moves to another wallet with no MOVE involved", async () => {
      const f = await fx();
      await configureCityCap(f, CITY, 5);
      await fundLockedMove(f, 1, [{ account: f.alice.address, amount: 10n * ONE }]);
      expect(await f.token.liquidBalanceOf(f.alice.address)).to.equal(0n);
      await (await f.token.connect(f.alice).approve(f.addresses.deedClaims, 10n * ONE)).wait();
      const [cell] = cityCells(1);
      const at = await eligibilityAttestation({ claimant: f.alice.address, h3CellId: cell, cityId: CITY, claimFee: 10n * ONE });
      await (await f.deedClaims.connect(f.alice).claim(at, await signEligibility(f, at), 10n * ONE)).wait();
      expect(await f.token.lockedBalanceOf(f.alice.address)).to.equal(0n);
      await (await f.deed.connect(f.alice).transferFrom(f.alice.address, f.bob.address, cell)).wait();
      expect(await f.deed.ownerOf(cell)).to.equal(f.bob.address);
    });
  });

  describe("M8 / L1 token id is the public resolution-8 cell", () => {
    it("tokenId equals the H3 index; a resolution-9 cell is refused", async () => {
      const f = await fx();
      await configureCityCap(f, CITY, 5);
      const cell = cellAt(12.9716, 77.5946, 8);
      const at = await eligibilityAttestation({ claimant: f.alice.address, h3CellId: cell, cityId: CITY });
      await (await f.deedClaims.connect(f.alice).claim(at, await signEligibility(f, at), 0)).wait();
      expect(await f.deed.h3CellIdOf(cell)).to.equal(cell);
      const r9 = cellAt(12.9716, 77.5946, 9);
      const at9 = await eligibilityAttestation({ claimant: f.bob.address, h3CellId: r9, cityId: CITY });
      await expect(f.deedClaims.connect(f.bob).claim(at9, await signEligibility(f, at9), 0))
        .to.be.revertedWithCustomError(f.deed, "InvalidH3Cell");
    });
  });

  describe("L2 timelock accepts a 1-second delay", () => {
    it("deploys with minDelay = 1", async () => {
      const [a] = await ethers.getSigners();
      const t = await (await ethers.getContractFactory("MovenRunTimelock")).deploy(1, [a.address], [a.address], ethers.ZeroAddress);
      expect(await t.getMinDelay()).to.equal(1n);
    });
  });

  describe("L3 leaves are not summed on chain", () => {
    it("an over-committed tree makes the later claimant revert", async () => {
      const f = await fx();
      const entries = [
        { leafIndex: 0, account: f.alice.address, lockedAmount: 60n * ONE, liquidAmount: 0n },
        { leafIndex: 1, account: f.bob.address, lockedAmount: 60n * ONE, liquidAmount: 0n },
      ];
      const tree = buildRewardTree(f.chainId, f.addresses.rewards, 1, entries);
      await (await publishSettlement(f, await settlementAuthorization({ dayId: 1, grossIssuance: 100n * ONE, merkleRoot: tree.root }))).wait();
      await (await f.rewards.claim(1, 0, f.alice.address, 60n * ONE, 0n, tree.proofFor(0))).wait();
      await expect(f.rewards.claim(1, 1, f.bob.address, 60n * ONE, 0n, tree.proofFor(1)))
        .to.be.revertedWithCustomError(f.rewards, "LockedAllocationExceeded");
    });
  });

  describe("L4 a city cap of 0 freezes deeds already in the city", () => {
    it("holders can no longer transfer and nobody can declare a contest there", async () => {
      const f = await fx();
      await configureCityCap(f, CITY, 5);
      const [cell] = cityCells(1);
      const at = await eligibilityAttestation({ claimant: f.alice.address, h3CellId: cell, cityId: CITY });
      await (await f.deedClaims.connect(f.alice).claim(at, await signEligibility(f, at), 0)).wait();
      await configureCityCap(f, CITY, 0);
      await expect(f.deed.connect(f.alice).transferFrom(f.alice.address, f.bob.address, cell))
        .to.be.revertedWithCustomError(f.deed, "HolderCityCapReached");
      await expect(declareContest(f, f.bob, cell)).to.be.revertedWithCustomError(f.deed, "HolderCityCapReached");
    });
  });

  describe("L5 expiry has no upper bound", () => {
    it("a settlement authorization valid until 2100 is accepted", async () => {
      const f = await fx();
      await (await publishSettlement(f, await settlementAuthorization({ dayId: 1, grossIssuance: ONE, expiry: 4102444800 }))).wait();
      expect((await f.settlement.settlementOf(1)).published).to.equal(true);
    });
  });
});
