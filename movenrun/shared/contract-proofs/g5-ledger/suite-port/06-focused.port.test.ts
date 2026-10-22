// NEW focused tests (not in c8262ec). RESEARCH ONLY. Patched build, Hardhat in-process network.
//   A. the 400M liquid valve: can one action open the full amount, and what bounds it now?
//   B. liquid toll leakage while the valve is shut
//   C. signer concentration and timelock behaviour
// Each test states a MEASURED FINDING (what the patched build does, good or bad); none is a
// recommendation. Findings that are gaps are asserted as they are, so a fix shows up as a
// failing test that must be updated deliberately.
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  ONE,
  DAY,
  CHALLENGE_WINDOW,
  PLAYER_MOVEMENT_ALLOCATION,
  SEASON_ONE_BUDGET,
  TIMELOCK_DELAY,
  ZERO_ADDRESS,
  ZERO_BYTES32,
  Suite,
  buildRewardTree,
  claimDeed,
  claimWithAttestation,
  closeScoringDay,
  declareContest,
  deploySuite,
  eligibilityAttestationV2,
  execBatchViaTimelock,
  execViaTimelock,
  publishSettlement,
  settleAfterGrace,
  settlementAuthorization,
  submitDayScores,
} from "./portHelpers";
import { cityCells } from "../v3/cells";

const NOMINAL = SEASON_ONE_BUDGET / 90n; // 100,000 MOVE
const CEILING = (SEASON_ONE_BUDGET * 2n) / 90n; // 200,000 MOVE
const CITY = 7;
const fx = (): Promise<Suite> => loadFixture(deploySuite);
const raise = (f: Suite, amount: bigint, salt: string) =>
  execViaTimelock(
    f,
    f.addresses.settlement,
    f.settlement.interface.encodeFunctionData("raiseLiquidIssuanceAllowance", [amount]),
    ethers.id(salt)
  );

describe("G5 focused: valve, toll leakage, signer concentration (patched)", () => {
  describe("A. the 400M liquid valve", () => {
    it("FINDING A1: ONE timelocked action still opens the full 400M allowance (no revenue link, no per-period cap)", async () => {
      const f = await fx();
      await raise(f, PLAYER_MOVEMENT_ALLOCATION, "a1");
      expect(await f.settlement.liquidIssuanceAllowance()).to.equal(400_000_000n * ONE);
    });

    it("FINDING A2: but no single publication can issue more than 2x the nominal day, however large the valve", async () => {
      const f = await fx();
      await raise(f, PLAYER_MOVEMENT_ALLOCATION, "a2");
      // Skip ahead to day 60 so the unissued budget has piled into that day's pool.
      const pool = await f.settlement.dailyPoolOf(60).catch(() => 0n);
      void pool;
      const auth = await settlementAuthorization(f, {
        dayId: 60, grossIssuance: CEILING + 1n, lockedClaims: 0n, liquidMovementClaims: CEILING + 1n,
      });
      // Day 60's pool (9M / 31 = 290k) is above the ceiling, so only the H1 ceiling stops it.
      await expect(publishSettlement(f, auth))
        .to.be.revertedWithCustomError(f.settlement, "PublicationAboveDailyCeiling")
        .withArgs(CEILING + 1n, CEILING);
      await (await publishSettlement(f, await settlementAuthorization(f, {
        dayId: 60, grossIssuance: CEILING, lockedClaims: 0n, liquidMovementClaims: CEILING,
      }))).wait();
      expect((await f.rewards.dayAllocation(60)).liquidAllocated).to.equal(CEILING);
      expect(await f.settlement.liquidIssuanceAllowance()).to.equal(PLAYER_MOVEMENT_ALLOCATION - CEILING);
    });

    it("FINDING A3: the clock binds the valve: a day not yet closed cannot be drawn on, so the open valve cannot be drained ahead of time", async () => {
      const f = await fx();
      await raise(f, PLAYER_MOVEMENT_ALLOCATION, "a3");
      const genesis = Number(await f.settlement.genesis());
      const closesAt = genesis + 90 * DAY;
      // Build the authorization for day 90 without advancing the chain (base helper path).
      const { settlementAuthorization: raw } = await import("../v3/helpers");
      const auth = await raw({ dayId: 90, grossIssuance: NOMINAL, lockedClaims: 0n, liquidMovementClaims: NOMINAL });
      expect(await time.latest()).to.be.lt(closesAt);
      await expect(publishSettlement(f, auth)).to.be.revertedWithCustomError(f.settlement, "DayNotYetClosed");
    });

    it("FINDING A4: with the valve at 400M, two keys still move a whole season's budget liquid over 90 closed days (9M), none of it revenue-linked", async () => {
      const f = await fx();
      await raise(f, PLAYER_MOVEMENT_ALLOCATION, "a4");
      let liquid = 0n;
      for (let day = 1; day <= 90; day += 1) {
        const pool: bigint = await f.settlement.dailyPoolOf(day);
        const gross = pool < CEILING ? pool : CEILING;
        await (await publishSettlement(f, await settlementAuthorization(f, {
          dayId: day, grossIssuance: gross, lockedClaims: 0n, liquidMovementClaims: gross,
        }))).wait();
        liquid += gross;
      }
      expect(liquid).to.equal(SEASON_ONE_BUDGET);
      expect(await f.settlement.seasonIssued(1)).to.equal(SEASON_ONE_BUDGET);
      expect(await f.settlement.liquidIssuanceAllowance()).to.equal(PLAYER_MOVEMENT_ALLOCATION - SEASON_ONE_BUDGET);
    });

    it("FINDING A5: unused allowance still never expires (V2 is not changed by the patches)", async () => {
      const f = await fx();
      await raise(f, 1_000n * ONE, "a5");
      await time.increase(365 * DAY);
      expect(await f.settlement.liquidIssuanceAllowance()).to.equal(1_000n * ONE);
    });

    it("HOLDS A6: the guardian can shut the valve at once and cannot open it", async () => {
      const f = await fx();
      await raise(f, PLAYER_MOVEMENT_ALLOCATION, "a6");
      await (await f.settlement.connect(f.guardian).reduceLiquidIssuanceAllowance(PLAYER_MOVEMENT_ALLOCATION)).wait();
      expect(await f.settlement.liquidIssuanceAllowance()).to.equal(0n);
      await expect(f.settlement.connect(f.guardian).raiseLiquidIssuanceAllowance(1n)).to.be.reverted;
    });
  });

  describe("B. liquid toll leakage while the valve is shut", () => {
    it("FINDING B1: with allowance 0, every day still issues up to 2% of its gross as LIQUID, and it is freely transferable", async () => {
      const f = await fx();
      expect(await f.settlement.liquidIssuanceAllowance()).to.equal(0n);
      const toll = (NOMINAL * 200n) / 10_000n;
      const entries = [
        { leafIndex: 0, account: f.carol.address, lockedAmount: 0n, liquidAmount: toll },
        { leafIndex: 1, account: f.bob.address, lockedAmount: NOMINAL - toll, liquidAmount: 0n },
      ];
      const tree = buildRewardTree(f.chainId, f.addresses.rewards, 1, entries);
      await (await publishSettlement(f, await settlementAuthorization(f, {
        dayId: 1, grossIssuance: NOMINAL, tollBase: NOMINAL, tollCredits: toll, merkleRoot: tree.root, participantCount: 2,
      }))).wait();
      await (await f.rewards.connect(f.relayer).claim(1, 0, f.carol.address, 0n, toll, tree.proofFor(0))).wait();

      expect(await f.settlement.liquidIssuanceAllowance()).to.equal(0n);
      expect(await f.token.balanceOf(f.carol.address)).to.equal(toll);
      // The leaked toll moves to an unrelated address with no restriction: liquid for real.
      await (await f.token.connect(f.carol).transfer(f.outsider.address, toll)).wait();
      expect(await f.token.balanceOf(f.outsider.address)).to.equal(toll);
    });

    it("FINDING B2: over 30 days the valve-shut leak is exactly 2% of everything issued; no configuration lowers it, only pausing publication (which also stops locked rewards)", async () => {
      const f = await fx();
      let issued = 0n;
      let liquid = 0n;
      let tolls = 0n;
      for (let day = 1; day <= 30; day += 1) {
        const gross: bigint = await f.settlement.dailyPoolOf(day);
        const toll = (gross * 200n) / 10_000n;
        await (await publishSettlement(f, await settlementAuthorization(f, {
          dayId: day, grossIssuance: gross, tollBase: gross, tollCredits: toll,
        }))).wait();
        issued += gross;
        tolls += toll;
        liquid += (await f.rewards.dayAllocation(day)).liquidAllocated;
      }
      expect(liquid).to.equal(tolls); // each day's toll is floor(2% of that day's gross)
      expect(liquid).to.be.lte((issued * 200n) / 10_000n);
      expect(await f.settlement.liquidIssuanceAllowance()).to.equal(0n);
      const setters = f.settlement.interface.fragments
        .filter((x: any) => x.type === "function").map((x: any) => x.name)
        .filter((n: string) => /toll/i.test(n) && n.startsWith("set"));
      expect(setters).to.deep.equal([]);
      await (await f.settlement.connect(f.guardian).pausePublication()).wait();
      await expect(publishSettlement(f, await settlementAuthorization(f, { dayId: 31, grossIssuance: ONE })))
        .to.be.revertedWithCustomError(f.settlement, "PublicationIsPaused");
    });

    it("FINDING B3: who receives the leaked toll is chosen by the two settlement keys alone (any leaf address, including one they control)", async () => {
      const f = await fx();
      const toll = (NOMINAL * 200n) / 10_000n;
      const entries = [
        { leafIndex: 0, account: f.reconciliationSigner.address, lockedAmount: 0n, liquidAmount: toll },
        { leafIndex: 1, account: f.bob.address, lockedAmount: NOMINAL - toll, liquidAmount: 0n },
      ];
      const tree = buildRewardTree(f.chainId, f.addresses.rewards, 1, entries);
      await (await publishSettlement(f, await settlementAuthorization(f, {
        dayId: 1, grossIssuance: NOMINAL, tollBase: NOMINAL, tollCredits: toll, merkleRoot: tree.root, participantCount: 2,
      }))).wait();
      await (await f.rewards.connect(f.relayer).claim(1, 0, f.reconciliationSigner.address, 0n, toll, tree.proofFor(0))).wait();
      expect(await f.token.balanceOf(f.reconciliationSigner.address)).to.equal(toll);
      // tollBase can be set to the whole gross; the contract has no notion of a real deed owner.
    });
  });

  describe("C. signer concentration and timelock", () => {
    it("FINDING C1: two eligibility keys held by ONE operator mint only up to the on-chain caps (5/city/day, city-wide cap), then stop", async () => {
      const f = await fx();
      const cells = cityCells(20);
      await execBatchViaTimelock(f, [f.addresses.deed, f.addresses.deedClaims], [
        f.deed.interface.encodeFunctionData("configureCityConcentrationCap", [CITY, 1]),
        f.deedClaims.interface.encodeFunctionData("setCityWideCap", [CITY, 12]),
      ], ethers.id("c1"));
      // Default daily limit (5) and per-cluster cap (1) are untouched; the operator uses a fresh wallet and cluster id per claim.
      let n = 0;
      const next = async () => {
        const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
        await ethers.provider.send("hardhat_setBalance", [wallet.address, "0x56BC75E2D63100000"]);
        const i = n++;
        return claimDeed(f, wallet as any, cells[i], CITY, { clusterId: ethers.id(`fresh-${i}`) });
      };
      for (let i = 0; i < 5; i += 1) await (await next()).wait();
      await expect(next()).to.be.revertedWithCustomError(f.deedClaims, "CityDailyClaimLimitReached");
      await time.increase(DAY);
      for (let i = 0; i < 5; i += 1) await (await next()).wait();
      await time.increase(DAY);
      for (let i = 0; i < 2; i += 1) await (await next()).wait();
      await expect(next()).to.be.revertedWithCustomError(f.deedClaims, "CityWideCapReached");
      expect(await f.deed.cityDeedCount(CITY)).to.equal(12n);
    });

    it("FINDING C2: voiding a colluding batch inside the window frees the cells and holder slots but does NOT return cluster, daily or lifetime claim counters", async () => {
      const f = await fx();
      const cells = cityCells(3);
      await execBatchViaTimelock(f, [f.addresses.deed, f.addresses.deedClaims], [
        f.deed.interface.encodeFunctionData("configureCityConcentrationCap", [CITY, 1]),
        f.deedClaims.interface.encodeFunctionData("setCityWideCap", [CITY, 50]),
      ], ethers.id("c2"));
      const cluster = ethers.id("ring");
      await (await claimDeed(f, f.alice, cells[0], CITY, { clusterId: cluster })).wait();
      await (await f.deed.connect(f.voider).voidPendingDeed(cells[0], 1)).wait();
      expect(await f.deed.cityDeedCount(CITY)).to.equal(0n);
      expect(await f.deed.totalDeeds()).to.equal(0n);
      // Counters on the claims contract stay spent.
      expect(await f.deedClaims.totalClaims()).to.equal(1n);
      expect(await f.deedClaims.clusterClaimCount(CITY, cluster)).to.equal(1n);
      await expect(claimDeed(f, f.bob, cells[0], CITY, { clusterId: cluster }))
        .to.be.revertedWithCustomError(f.deedClaims, "ClusterCapReached");
    });

    it("HOLDS C3: threshold floor 2, no duplicate signatures, a third registered key alone is not enough", async () => {
      const f = await fx();
      await expect(execViaTimelock(f, f.addresses.deedClaims,
        f.deedClaims.interface.encodeFunctionData("setAttestationThreshold", [1]), ethers.id("t1"))).to.be.reverted;
      await execBatchViaTimelock(f, [f.addresses.deed, f.addresses.deedClaims, f.addresses.deedClaims], [
        f.deed.interface.encodeFunctionData("configureCityConcentrationCap", [CITY, 2]),
        f.deedClaims.interface.encodeFunctionData("setCityWideCap", [CITY, 50]),
        f.deedClaims.interface.encodeFunctionData("setEligibilitySignerRegistered", [f.outsider.address, true]),
      ], ethers.id("c3"));
      const cells = cityCells(3);
      const att = await eligibilityAttestationV2({ claimant: f.alice.address, h3CellId: cells[0], cityId: CITY });
      await expect(claimWithAttestation(f, f.alice, att, [f.outsider])).to.be.revertedWithCustomError(f.deedClaims, "ThresholdNotMet");
      await expect(claimWithAttestation(f, f.alice, att, [f.outsider, f.outsider])).to.be.revertedWithCustomError(f.deedClaims, "SignersNotAscendingOrUnknown");
      await (await claimWithAttestation(f, f.alice, att, [f.outsider, f.deedSigner])).wait(); // any two of three
    });

    it("FINDING C4: the timelock admin is sole proposer, executor and canceller; one admin key can replace BOTH eligibility signers after the delay, collapsing 2-of-n to one party", async () => {
      const f = await fx();
      const cells = cityCells(2);
      await execBatchViaTimelock(f, [f.addresses.deed, f.addresses.deedClaims], [
        f.deed.interface.encodeFunctionData("configureCityConcentrationCap", [CITY, 2]),
        f.deedClaims.interface.encodeFunctionData("setCityWideCap", [CITY, 50]),
      ], ethers.id("c4a"));
      // Premature execution is refused and the schedule is public (CallScheduled).
      const data = f.deedClaims.interface.encodeFunctionData("setEligibilitySignerRegistered", [f.outsider.address, true]);
      await expect(f.timelock.connect(f.admin).schedule(f.addresses.deedClaims, 0, data, ZERO_BYTES32, ethers.id("c4b"), TIMELOCK_DELAY))
        .to.emit(f.timelock, "CallScheduled");
      await expect(f.timelock.connect(f.admin).execute(f.addresses.deedClaims, 0, data, ZERO_BYTES32, ethers.id("c4b")))
        .to.be.reverted;
      await expect(f.timelock.connect(f.outsider).schedule(f.addresses.deedClaims, 0, data, ZERO_BYTES32, ethers.id("c4c"), TIMELOCK_DELAY))
        .to.be.reverted;
      // During the delay the guardian can pause claims, but only until the admin unpauses after its own delay.
      await (await f.deedClaims.connect(f.guardian).pauseClaims()).wait();
      await time.increase(TIMELOCK_DELAY + 1);
      await (await f.timelock.connect(f.admin).execute(f.addresses.deedClaims, 0, data, ZERO_BYTES32, ethers.id("c4b"))).wait();
      // Admin then also rotates the original signer: both signing keys are now admin-chosen.
      await execBatchViaTimelock(f, [f.addresses.deedClaims, f.addresses.deedClaims], [
        f.deedClaims.interface.encodeFunctionData("setEligibilitySigner", [f.voider.address]),
        f.deedClaims.interface.encodeFunctionData("unpauseClaims", []),
      ], ethers.id("c4d"));
      const att = await eligibilityAttestationV2({ claimant: f.alice.address, h3CellId: cells[0], cityId: CITY });
      await (await claimWithAttestation(f, f.alice, att, [f.outsider, f.voider])).wait();
      expect(await f.deed.ownerOf(cells[0])).to.equal(f.alice.address);
      // The old signer no longer counts.
      const att2 = await eligibilityAttestationV2({ claimant: f.alice.address, h3CellId: cells[1], cityId: CITY });
      await expect(claimWithAttestation(f, f.alice, att2, [f.deedSigner, f.outsider]))
        .to.be.revertedWithCustomError(f.deedClaims, "SignersNotAscendingOrUnknown");
    });

    it("FINDING C5 (= L2): the timelock still accepts a 1-second delay; only zero is refused", async () => {
      const f = await fx();
      const factory = await ethers.getContractFactory("MovenRunTimelock");
      await expect(factory.deploy(0, [f.admin.address], [f.admin.address], ZERO_ADDRESS))
        .to.be.revertedWithCustomError(factory, "DelayMustBeNonZero");
      const t = await factory.deploy(1, [f.admin.address], [f.admin.address], ZERO_ADDRESS);
      expect(await t.getMinDelay()).to.equal(1n);
    });

    it("HOLDS C6: contest signer and co-signer must stay distinct, in either rotation direction", async () => {
      const f = await fx();
      await expect(execViaTimelock(f, f.addresses.contests,
        f.contests.interface.encodeFunctionData("setContestSigner", [f.contestCoSigner.address]), ethers.id("c6a"))).to.be.reverted;
      await expect(execViaTimelock(f, f.addresses.contests,
        f.contests.interface.encodeFunctionData("setContestCoSigner", [f.contestScoreSigner.address]), ethers.id("c6b"))).to.be.reverted;
    });

    it("FINDING C7: two contest keys held by one operator decide any contest, within the per-day score ceiling and only after each day closes; declarations still need ONE key (H2b open)", async () => {
      const f = await fx();
      await execBatchViaTimelock(f, [f.addresses.deed, f.addresses.deedClaims], [
        f.deed.interface.encodeFunctionData("configureCityConcentrationCap", [CITY, 2]),
        f.deedClaims.interface.encodeFunctionData("setCityWideCap", [CITY, 50]),
      ], ethers.id("c7"));
      const cell = cityCells(1)[0];
      await (await claimDeed(f, f.bob, cell, CITY)).wait();
      await (await declareContest(f, f.alice, cell)).wait(); // single-signed declaration (H2b)
      for (let day = 0; day < 3; day += 1) {
        await closeScoringDay(f, 1n, day);
        await (await submitDayScores(f, 1n, day, 100_000n, 0n)).wait();
      }
      await closeScoringDay(f, 1n, 3);
      await expect(submitDayScores(f, 1n, 3, 100_001n, 0n)).to.be.revertedWithCustomError(f.contests, "ScoreOutOfRange");
      await (await settleAfterGrace(f, 1n)).wait();
      // The colluding pair flipped the deed with the defender never scoring.
      expect(await f.deed.ownerOf(cell)).to.equal(f.alice.address);
      void CHALLENGE_WINDOW; void publishSettlement;
    });
  });
});
