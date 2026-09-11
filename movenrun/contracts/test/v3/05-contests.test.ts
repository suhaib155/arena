import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  ONE,
  RULES_VERSION,
  SCORE_TYPES,
  Suite,
  claimDeed,
  configureCityCap,
  declareContest,
  declarationAuthorization,
  deploySuite,
  domain,
  execViaTimelock,
  fundLockedMove,
  nextNonce,
  signDeclaration,
  submitScore,
} from "./helpers";
import { cityCells } from "./cells";

const CITY = 7;
const NOTICE_PERIOD = 72 * 3600;
const SCORING_WINDOW = 7 * 24 * 3600;
const CHALLENGER_COOLDOWN = 30 * 24 * 3600;
const DEFENDER_PEACE_PERIOD = 14 * 24 * 3600;

async function contestSuite() {
  const fx: Suite = await loadFixture(deploySuite);
  await configureCityCap(fx, CITY, 2);
  await fundLockedMove(fx, 1, [
    { account: fx.alice.address, amount: 1_000n * ONE },
    { account: fx.bob.address, amount: 1_000n * ONE },
    { account: fx.carol.address, amount: 1_000n * ONE },
  ]);
  return fx;
}

/** Moves time to the scoring window, records both sides, then settles from an unrelated account. */
async function playOut(
  fx: Suite,
  contestId: bigint,
  challenger: string,
  defender: string,
  challengerScores: bigint[],
  defenderScores: bigint[]
) {
  await time.increase(NOTICE_PERIOD + 60);
  for (let day = 0; day < challengerScores.length; day += 1) {
    await (await submitScore(fx, contestId, challenger, day, challengerScores[day])).wait();
  }
  for (let day = 0; day < defenderScores.length; day += 1) {
    await (await submitScore(fx, contestId, defender, day, defenderScores[day])).wait();
  }
  await time.increase(SCORING_WINDOW + 60);
  return fx.contests.connect(fx.relayer).settleContest(contestId);
}

describe("V3 MovenRunContests", () => {
  describe("declaration and escrow", () => {
    it("escrows the deed without ever consulting the defender's approval", async () => {
      const fx = await contestSuite();
      const cell = cityCells(1)[0];
      await (await claimDeed(fx, fx.bob, cell, CITY)).wait();

      expect(await fx.deed.getApproved(cell)).to.equal(ethers.ZeroAddress);
      expect(await fx.deed.isApprovedForAll(fx.bob.address, fx.addresses.contests)).to.equal(false);

      await (await declareContest(fx, fx.alice, cell)).wait();

      expect(await fx.deed.ownerOf(cell)).to.equal(fx.addresses.contests);
      expect(await fx.deed.isEscrowed(cell)).to.equal(true);
      expect(await fx.contests.activeContestOf(cell)).to.equal(1n);
    });

    it("keeps the escrowed deed counted against its defender and never against the escrow contract", async () => {
      const fx = await contestSuite();
      const cell = cityCells(1)[0];
      await (await claimDeed(fx, fx.bob, cell, CITY)).wait();
      await (await declareContest(fx, fx.alice, cell)).wait();

      expect(await fx.deed.holderCityDeedCount(fx.bob.address, CITY)).to.equal(1n);
      expect(await fx.deed.holderCityDeedCount(fx.addresses.contests, CITY)).to.equal(0n);
      expect(await fx.deed.holderCityReservedCount(fx.addresses.contests, CITY)).to.equal(0n);
    });

    it("allows one active contest per deed and refuses to overwrite it", async () => {
      const fx = await contestSuite();
      const cell = cityCells(1)[0];
      await (await claimDeed(fx, fx.bob, cell, CITY)).wait();
      await (await declareContest(fx, fx.alice, cell)).wait();

      await expect(declareContest(fx, fx.carol, cell))
        .to.be.revertedWithCustomError(fx.contests, "ContestAlreadyActive")
        .withArgs(cell, 1n);
      expect(await fx.contests.lastContestId()).to.equal(1n);

      const contest = await fx.contests.contestOf(1);
      expect(contest.challenger).to.equal(fx.alice.address);
      expect(contest.defender).to.equal(fx.bob.address);
    });

    it("refuses a holder contesting their own deed", async () => {
      const fx = await contestSuite();
      const cell = cityCells(1)[0];
      await (await claimDeed(fx, fx.bob, cell, CITY)).wait();
      await expect(declareContest(fx, fx.bob, cell)).to.be.revertedWithCustomError(
        fx.contests,
        "ChallengerIsHolder"
      );
    });

    it("burns the declaration entry fee and honours the caller's maximum", async () => {
      const fx = await contestSuite();
      const cell = cityCells(1)[0];
      await (await claimDeed(fx, fx.bob, cell, CITY)).wait();

      const fee = 25n * ONE;
      const authorization = await declarationAuthorization({
        challenger: fx.alice.address,
        tokenId: cell,
        entryFee: fee,
      });
      const signature = await signDeclaration(fx, authorization);

      await expect(fx.contests.connect(fx.alice).declareContest(authorization, signature, fee - 1n))
        .to.be.revertedWithCustomError(fx.contests, "EntryFeeAboveMaximum")
        .withArgs(fee, fee - 1n);

      await (await fx.token.connect(fx.alice).approve(fx.addresses.contests, fee)).wait();
      const supplyBefore: bigint = await fx.token.totalSupply();
      await (await fx.contests.connect(fx.alice).declareContest(authorization, signature, fee)).wait();

      expect(await fx.token.totalSupply()).to.equal(supplyBefore - fee);
      expect(await fx.token.balanceOf(fx.addresses.contests)).to.equal(0n);
    });

    it("refuses fortification above its fixed ceiling", async () => {
      const fx = await contestSuite();
      const cell = cityCells(1)[0];
      await (await claimDeed(fx, fx.bob, cell, CITY)).wait();

      await expect(declareContest(fx, fx.alice, cell, { fortificationBps: 1_501 }))
        .to.be.revertedWithCustomError(fx.contests, "FortificationAboveCeiling")
        .withArgs(1_501, 1_500);
    });
  });

  describe("city capacity reservation", () => {
    it("takes one of the challenger's city slots at declaration", async () => {
      const fx = await contestSuite();
      const cells = cityCells(2);
      await (await claimDeed(fx, fx.bob, cells[0], CITY)).wait();
      await (await claimDeed(fx, fx.alice, cells[1], CITY)).wait();

      expect(await fx.deed.holderCityCapacityRemaining(fx.alice.address, CITY)).to.equal(1n);

      await expect(declareContest(fx, fx.alice, cells[0]))
        .to.emit(fx.contests, "ContestCapacityReserved")
        .withArgs(1n, fx.alice.address, CITY);

      expect(await fx.deed.holderCityReservedCount(fx.alice.address, CITY)).to.equal(1n);
      expect(await fx.deed.holderCityDeedCount(fx.alice.address, CITY)).to.equal(1n);
      expect(await fx.deed.holderCityCapacityRemaining(fx.alice.address, CITY)).to.equal(0n);
    });

    it("refuses a declaration from a challenger with no city capacity left", async () => {
      const fx = await contestSuite();
      const cells = cityCells(3);
      await (await claimDeed(fx, fx.bob, cells[0], CITY)).wait();
      await (await claimDeed(fx, fx.alice, cells[1], CITY)).wait();
      await (await claimDeed(fx, fx.alice, cells[2], CITY)).wait();

      await expect(declareContest(fx, fx.alice, cells[0]))
        .to.be.revertedWithCustomError(fx.deed, "HolderCityCapReached")
        .withArgs(fx.alice.address, CITY, 2);

      // The refusal happened before anything moved: the deed is untouched.
      expect(await fx.deed.ownerOf(cells[0])).to.equal(fx.bob.address);
      expect(await fx.contests.activeContestOf(cells[0])).to.equal(0n);
    });

    it("holds the reservation for the whole escrow so the challenger cannot spend the capacity", async () => {
      const fx = await contestSuite();
      const cells = cityCells(3);
      await (await claimDeed(fx, fx.bob, cells[0], CITY)).wait();
      await (await claimDeed(fx, fx.alice, cells[1], CITY)).wait();
      await (await declareContest(fx, fx.alice, cells[0])).wait();

      // This is the move that used to make a declared contest un-settleable: the challenger
      // filling their own city capacity while the contest is still in escrow.
      await expect(claimDeed(fx, fx.alice, cells[2], CITY)).to.be.revertedWithCustomError(
        fx.deedClaims,
        "HolderCityCapReached"
      );
      await (await claimDeed(fx, fx.carol, cells[2], CITY)).wait();
      await expect(
        fx.deed.connect(fx.carol).transferFrom(fx.carol.address, fx.alice.address, cells[2])
      ).to.be.revertedWithCustomError(fx.deed, "HolderCityCapReached");
    });

    it("consumes the reservation when the challenger wins", async () => {
      const fx = await contestSuite();
      const cells = cityCells(2);
      await (await claimDeed(fx, fx.bob, cells[0], CITY)).wait();
      await (await claimDeed(fx, fx.alice, cells[1], CITY)).wait();
      await (await declareContest(fx, fx.alice, cells[0])).wait();

      await expect(
        playOut(fx, 1n, fx.alice.address, fx.bob.address, [100n, 100n, 100n], [10n, 10n, 10n])
      )
        .to.emit(fx.contests, "ContestSettled")
        .withArgs(1n, cells[0], fx.alice.address, 300n, 31n, fx.relayer.address);

      expect(await fx.deed.ownerOf(cells[0])).to.equal(fx.alice.address);
      expect(await fx.deed.holderCityDeedCount(fx.alice.address, CITY)).to.equal(2n);
      expect(await fx.deed.holderCityReservedCount(fx.alice.address, CITY)).to.equal(0n);
      expect(await fx.deed.holderCityDeedCount(fx.bob.address, CITY)).to.equal(0n);
      expect(await fx.deed.holderCityCapacityRemaining(fx.alice.address, CITY)).to.equal(0n);
    });

    it("releases the reservation when the challenger loses", async () => {
      const fx = await contestSuite();
      const cells = cityCells(3);
      await (await claimDeed(fx, fx.bob, cells[0], CITY)).wait();
      await (await claimDeed(fx, fx.alice, cells[1], CITY)).wait();
      await (await declareContest(fx, fx.alice, cells[0])).wait();

      await (
        await playOut(fx, 1n, fx.alice.address, fx.bob.address, [10n, 10n, 10n], [100n, 100n, 100n])
      ).wait();

      expect(await fx.deed.ownerOf(cells[0])).to.equal(fx.bob.address);
      expect(await fx.deed.holderCityReservedCount(fx.alice.address, CITY)).to.equal(0n);
      expect(await fx.deed.holderCityDeedCount(fx.alice.address, CITY)).to.equal(1n);
      expect(await fx.deed.holderCityDeedCount(fx.bob.address, CITY)).to.equal(1n);

      // The freed capacity is usable again.
      expect(await fx.deed.holderCityCapacityRemaining(fx.alice.address, CITY)).to.equal(1n);
      await (await claimDeed(fx, fx.alice, cells[2], CITY)).wait();
    });

    it("settles a validly declared contest even when the city is full of other holders", async () => {
      const fx = await contestSuite();
      const cells = cityCells(6);

      await (await claimDeed(fx, fx.bob, cells[0], CITY)).wait();
      await (await claimDeed(fx, fx.alice, cells[1], CITY)).wait();
      await (await declareContest(fx, fx.alice, cells[0])).wait();

      // Everybody else fills the city to the brim while the contest sits in escrow.
      await (await claimDeed(fx, fx.bob, cells[2], CITY)).wait();
      await (await claimDeed(fx, fx.carol, cells[3], CITY)).wait();
      await (await claimDeed(fx, fx.carol, cells[4], CITY)).wait();
      await (await claimDeed(fx, fx.deployer, cells[5], CITY)).wait();

      // The declared contest still settles. Capacity was reserved, so it cannot be taken away.
      await (
        await playOut(fx, 1n, fx.alice.address, fx.bob.address, [100n, 100n, 100n], [1n, 1n, 1n])
      ).wait();
      expect(await fx.deed.ownerOf(cells[0])).to.equal(fx.alice.address);
    });

    it("keeps separate reservations for separate contests in the same city", async () => {
      const fx = await contestSuite();
      const cells = cityCells(2);
      await (await claimDeed(fx, fx.bob, cells[0], CITY)).wait();
      await (await claimDeed(fx, fx.carol, cells[1], CITY)).wait();

      await (await declareContest(fx, fx.alice, cells[0])).wait();
      await (await declareContest(fx, fx.alice, cells[1])).wait();
      expect(await fx.deed.holderCityReservedCount(fx.alice.address, CITY)).to.equal(2n);
      expect(await fx.deed.holderCityCapacityRemaining(fx.alice.address, CITY)).to.equal(0n);

      await (
        await playOut(fx, 1n, fx.alice.address, fx.bob.address, [100n, 100n, 100n], [1n, 1n, 1n])
      ).wait();
      expect(await fx.deed.holderCityReservedCount(fx.alice.address, CITY)).to.equal(1n);
      expect(await fx.deed.holderCityDeedCount(fx.alice.address, CITY)).to.equal(1n);

      // The second contest was never scored, so it ties and the deed stays with its holder.
      // The reservation is released rather than consumed, and the challenger's count is
      // unchanged: the two contests account for their capacity entirely independently.
      await (await fx.contests.connect(fx.relayer).settleContest(2n)).wait();
      expect(await fx.deed.holderCityReservedCount(fx.alice.address, CITY)).to.equal(0n);
      expect(await fx.deed.holderCityDeedCount(fx.alice.address, CITY)).to.equal(1n);
      expect(await fx.deed.ownerOf(cells[1])).to.equal(fx.carol.address);
      expect(await fx.deed.holderCityCapacityRemaining(fx.alice.address, CITY)).to.equal(1n);
    });

    it("reserves and settles city capacity only on behalf of the contests contract", async () => {
      const fx = await contestSuite();
      const cell = cityCells(1)[0];
      await (await claimDeed(fx, fx.bob, cell, CITY)).wait();

      await expect(
        fx.deed.connect(fx.alice).reserveCitySlot(fx.alice.address, CITY)
      ).to.be.revertedWithCustomError(fx.deed, "NotContestsContract");
      await expect(
        fx.deed.connect(fx.alice).settleContestEscrow(cell, fx.bob.address, fx.alice.address, fx.alice.address)
      ).to.be.revertedWithCustomError(fx.deed, "NotContestsContract");
      await expect(
        fx.deed.connect(fx.alice).escrowToContests(cell)
      ).to.be.revertedWithCustomError(fx.deed, "NotContestsContract");
    });
  });

  describe("scoring", () => {
    it("refuses scores outside the window, off the roster, past the last day or replayed", async () => {
      const fx = await contestSuite();
      const cell = cityCells(1)[0];
      await (await claimDeed(fx, fx.bob, cell, CITY)).wait();
      await (await declareContest(fx, fx.alice, cell)).wait();

      await expect(submitScore(fx, 1n, fx.alice.address, 0, 10n)).to.be.revertedWithCustomError(
        fx.contests,
        "ScoringNotOpen"
      );

      await time.increase(NOTICE_PERIOD + 60);
      await expect(submitScore(fx, 1n, fx.carol.address, 0, 10n)).to.be.revertedWithCustomError(
        fx.contests,
        "NotAContestant"
      );
      await expect(submitScore(fx, 1n, fx.alice.address, 7, 10n)).to.be.revertedWithCustomError(
        fx.contests,
        "InvalidScoringDay"
      );

      await (await submitScore(fx, 1n, fx.alice.address, 0, 10n)).wait();
      await expect(submitScore(fx, 1n, fx.alice.address, 0, 99n))
        .to.be.revertedWithCustomError(fx.contests, "ScoringDayAlreadySubmitted")
        .withArgs(0);

      await time.increase(SCORING_WINDOW + 60);
      await expect(submitScore(fx, 1n, fx.alice.address, 1, 10n)).to.be.revertedWithCustomError(
        fx.contests,
        "ScoringNotOpen"
      );
    });

    it("refuses a score the contest signer did not sign", async () => {
      const fx = await contestSuite();
      const cell = cityCells(1)[0];
      await (await claimDeed(fx, fx.bob, cell, CITY)).wait();
      await (await declareContest(fx, fx.alice, cell)).wait();
      await time.increase(NOTICE_PERIOD + 60);

      const authorization = {
        contestId: 1n,
        participant: fx.alice.address,
        scoringDay: 0,
        score: 10_000n,
        rulesVersion: RULES_VERSION,
        nonce: nextNonce(),
        expiry: (await time.latest()) + 3600,
      };
      const forged = await fx.alice.signTypedData(
        domain("MovenRunContests", fx.chainId, fx.addresses.contests),
        SCORE_TYPES,
        authorization
      );
      await expect(
        fx.contests.connect(fx.alice).submitScore(authorization, forged)
      ).to.be.revertedWithCustomError(fx.contests, "InvalidScoreSignature");
    });

    it("counts only the best three days of the seven", async () => {
      const fx = await contestSuite();
      const cell = cityCells(1)[0];
      await (await claimDeed(fx, fx.bob, cell, CITY)).wait();
      await (await declareContest(fx, fx.alice, cell)).wait();
      await time.increase(NOTICE_PERIOD + 60);

      for (const [day, score] of [[0, 10n], [1, 90n], [2, 20n], [3, 80n], [4, 5n], [5, 70n], [6, 1n]] as const) {
        await (await submitScore(fx, 1n, fx.alice.address, day, score)).wait();
      }
      expect(await fx.contests.sideTotalOf(1n, fx.alice.address)).to.equal(240n);
      expect(await fx.contests.COUNTED_SCORING_DAYS()).to.equal(3);
    });
  });

  describe("settlement", () => {
    it("refuses to settle before the scoring window closes", async () => {
      const fx = await contestSuite();
      const cell = cityCells(1)[0];
      await (await claimDeed(fx, fx.bob, cell, CITY)).wait();
      await (await declareContest(fx, fx.alice, cell)).wait();

      await expect(
        fx.contests.connect(fx.relayer).settleContest(1n)
      ).to.be.revertedWithCustomError(fx.contests, "ScoringWindowNotFinished");
    });

    it("is settleable by anybody, without the loser's cooperation or approval", async () => {
      const fx = await contestSuite();
      const cell = cityCells(1)[0];
      await (await claimDeed(fx, fx.bob, cell, CITY)).wait();
      await (await declareContest(fx, fx.alice, cell)).wait();

      // The relayer is neither side and holds no approval from either.
      await (
        await playOut(fx, 1n, fx.alice.address, fx.bob.address, [100n, 100n, 100n], [1n, 1n, 1n])
      ).wait();

      expect(await fx.deed.ownerOf(cell)).to.equal(fx.alice.address);
      const contest = await fx.contests.contestOf(1n);
      expect(contest.settled).to.equal(true);
      expect(contest.winner).to.equal(fx.alice.address);
      expect(await fx.contests.activeContestOf(cell)).to.equal(0n);
    });

    it("refuses to settle the same contest twice", async () => {
      const fx = await contestSuite();
      const cell = cityCells(1)[0];
      await (await claimDeed(fx, fx.bob, cell, CITY)).wait();
      await (await declareContest(fx, fx.alice, cell)).wait();
      await (
        await playOut(fx, 1n, fx.alice.address, fx.bob.address, [100n], [1n])
      ).wait();

      await expect(fx.contests.connect(fx.relayer).settleContest(1n))
        .to.be.revertedWithCustomError(fx.contests, "ContestAlreadySettled")
        .withArgs(1n);
    });

    it("leaves the deed with the current holder on a tie", async () => {
      const fx = await contestSuite();
      const cell = cityCells(1)[0];
      await (await claimDeed(fx, fx.bob, cell, CITY)).wait();
      await (await declareContest(fx, fx.alice, cell)).wait();

      // Identical raw scores: the home advantage tips an exact tie to the defender, and an
      // exactly equal weighted total would too, since only a strict win takes the deed.
      await (
        await playOut(fx, 1n, fx.alice.address, fx.bob.address, [100n, 100n, 100n], [100n, 100n, 100n])
      ).wait();

      expect(await fx.deed.ownerOf(cell)).to.equal(fx.bob.address);
      expect((await fx.contests.contestOf(1n)).winner).to.equal(fx.bob.address);
    });

    it("leaves the deed with the defender when nobody scores at all", async () => {
      const fx = await contestSuite();
      const cell = cityCells(1)[0];
      await (await claimDeed(fx, fx.bob, cell, CITY)).wait();
      await (await declareContest(fx, fx.alice, cell)).wait();

      await (await playOut(fx, 1n, fx.alice.address, fx.bob.address, [], [])).wait();
      expect(await fx.deed.ownerOf(cell)).to.equal(fx.bob.address);
    });

    it("applies the home advantage and the defender's fortification", async () => {
      const fx = await contestSuite();
      const cell = cityCells(1)[0];
      await (await claimDeed(fx, fx.bob, cell, CITY)).wait();
      await (await declareContest(fx, fx.alice, cell, { fortificationBps: 1_500 })).wait();

      // Defender raw 300, boosted by 5% home advantage and 15% fortification to 360.
      await expect(
        playOut(fx, 1n, fx.alice.address, fx.bob.address, [120n, 120n, 115n], [100n, 100n, 100n])
      )
        .to.emit(fx.contests, "ContestSettled")
        .withArgs(1n, cell, fx.bob.address, 355n, 360n, fx.relayer.address);
      expect(await fx.deed.ownerOf(cell)).to.equal(fx.bob.address);
    });
  });

  describe("cooldown and peace", () => {
    it("puts a losing challenger in cooldown and gives the surviving deed a peace period", async () => {
      const fx = await contestSuite();
      const cells = cityCells(2);
      await (await claimDeed(fx, fx.bob, cells[0], CITY)).wait();
      await (await claimDeed(fx, fx.carol, cells[1], CITY)).wait();
      await (await declareContest(fx, fx.alice, cells[0])).wait();

      await (
        await playOut(fx, 1n, fx.alice.address, fx.bob.address, [1n], [100n])
      ).wait();
      const settledAt = await time.latest();

      expect(await fx.contests.challengerCooldownUntil(fx.alice.address)).to.be.closeTo(
        settledAt + CHALLENGER_COOLDOWN,
        5
      );
      expect(await fx.contests.deedPeaceUntil(cells[0])).to.be.closeTo(
        settledAt + DEFENDER_PEACE_PERIOD,
        5
      );

      await expect(declareContest(fx, fx.alice, cells[1])).to.be.revertedWithCustomError(
        fx.contests,
        "ChallengerInCooldown"
      );
      await expect(declareContest(fx, fx.carol, cells[0])).to.be.revertedWithCustomError(
        fx.contests,
        "DeedInPeacePeriod"
      );
    });

    it("lets the same challenger come back once the cooldown has run out", async () => {
      const fx = await contestSuite();
      const cell = cityCells(1)[0];
      await (await claimDeed(fx, fx.bob, cell, CITY)).wait();
      await (await declareContest(fx, fx.alice, cell)).wait();
      await (await playOut(fx, 1n, fx.alice.address, fx.bob.address, [1n], [100n])).wait();

      await time.increase(CHALLENGER_COOLDOWN + 60);
      await (await declareContest(fx, fx.alice, cell)).wait();
      expect(await fx.contests.activeContestOf(cell)).to.equal(2n);

      await (await playOut(fx, 2n, fx.alice.address, fx.bob.address, [100n], [1n])).wait();
      expect(await fx.deed.ownerOf(cell)).to.equal(fx.alice.address);
    });
  });

  describe("pause and constants", () => {
    it("pauses new declarations without stopping an active contest from settling", async () => {
      const fx = await contestSuite();
      const cells = cityCells(2);
      await (await claimDeed(fx, fx.bob, cells[0], CITY)).wait();
      await (await claimDeed(fx, fx.carol, cells[1], CITY)).wait();
      await (await declareContest(fx, fx.alice, cells[0])).wait();

      await (await fx.contests.connect(fx.guardian).pauseDeclarations()).wait();
      await expect(declareContest(fx, fx.alice, cells[1])).to.be.revertedWithCustomError(
        fx.contests,
        "DeclarationsArePaused"
      );

      await (
        await playOut(fx, 1n, fx.alice.address, fx.bob.address, [100n], [1n])
      ).wait();
      expect(await fx.deed.ownerOf(cells[0])).to.equal(fx.alice.address);

      await expect(
        fx.contests.connect(fx.guardian).unpauseDeclarations()
      ).to.be.revertedWithCustomError(fx.contests, "AccessControlUnauthorizedAccount");
    });

    it("fixes the contest timings and cooldowns in code with no setter for any of them", async () => {
      const fx = await contestSuite();
      expect(await fx.contests.NOTICE_PERIOD()).to.equal(NOTICE_PERIOD);
      expect(await fx.contests.SCORING_WINDOW()).to.equal(SCORING_WINDOW);
      expect(await fx.contests.SCORING_DAYS()).to.equal(7);
      expect(await fx.contests.COUNTED_SCORING_DAYS()).to.equal(3);
      expect(await fx.contests.CHALLENGER_COOLDOWN()).to.equal(CHALLENGER_COOLDOWN);
      expect(await fx.contests.DEFENDER_PEACE_PERIOD()).to.equal(DEFENDER_PEACE_PERIOD);
      expect(await fx.contests.MAX_FORTIFICATION_BPS()).to.equal(1_500);

      const names = fx.contests.interface.fragments
        .filter((f: any) => f.type === "function")
        .map((f: any) => f.name);
      for (const forbidden of [
        "setNoticePeriod",
        "setScoringWindow",
        "setChallengerCooldown",
        "setDefenderPeacePeriod",
        "setMaxFortification",
        "extendContest",
        "boostScore",
      ]) {
        expect(names).to.not.include(forbidden);
      }
    });

    it("keeps the home advantage inside its fixed bounds", async () => {
      const fx = await contestSuite();
      await expect(
        execViaTimelock(
          fx,
          fx.addresses.contests,
          fx.contests.interface.encodeFunctionData("setHomeAdvantage", [1_001])
        )
      ).to.be.reverted;

      await execViaTimelock(
        fx,
        fx.addresses.contests,
        fx.contests.interface.encodeFunctionData("setHomeAdvantage", [1_000])
      );
      expect(await fx.contests.homeAdvantageBps()).to.equal(1_000);
    });
  });
});
