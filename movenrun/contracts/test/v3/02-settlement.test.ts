import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  DAY_ONE_POOL,
  ONE,
  PLAYER_MOVEMENT_ALLOCATION,
  RULES_VERSION,
  SETTLEMENT_TYPES,
  Suite,
  ZERO_BYTES32,
  deploySuite,
  domain,
  execViaTimelock,
  publishSettlement,
  settlementAuthorization,
  signSettlement,
} from "./helpers";

describe("V3 MovenRunSettlement", () => {
  describe("dual independent authorization", () => {
    it("publishes when both independent signers authorize the identical settlement", async () => {
      const fx: Suite = await loadFixture(deploySuite);
      const authorization = await settlementAuthorization({ dayId: 1, grossIssuance: 1_000n * ONE });

      await expect(publishSettlement(fx, authorization))
        .to.emit(fx.settlement, "SettlementPublished")
        .withArgs(1, 1, RULES_VERSION, ZERO_BYTES32, 1_000n * ONE, 1_000n * ONE, 0n, 0n, 0n);

      const record = await fx.settlement.settlementOf(1);
      expect(record.published).to.equal(true);
      expect(record.grossIssuance).to.equal(1_000n * ONE);
    });

    it("refuses a settlement signed twice by the same key", async () => {
      const fx: Suite = await loadFixture(deploySuite);
      const authorization = await settlementAuthorization({ dayId: 1, grossIssuance: 1_000n * ONE });
      const dom = domain("MovenRunSettlement", fx.chainId, fx.addresses.settlement);
      const single = await fx.settlementSigner.signTypedData(dom, SETTLEMENT_TYPES, authorization);

      await expect(
        fx.settlement.connect(fx.relayer).publishSettlement(authorization, single, single)
      ).to.be.revertedWithCustomError(fx.settlement, "InvalidReconciliationSignature");
    });

    it("refuses when either signature comes from the wrong key", async () => {
      const fx: Suite = await loadFixture(deploySuite);
      const authorization = await settlementAuthorization({ dayId: 1, grossIssuance: 1_000n * ONE });
      const dom = domain("MovenRunSettlement", fx.chainId, fx.addresses.settlement);
      const { settlementSignature, reconciliationSignature } = await signSettlement(fx, authorization);
      const impostor = await fx.alice.signTypedData(dom, SETTLEMENT_TYPES, authorization);

      await expect(
        fx.settlement.connect(fx.relayer).publishSettlement(authorization, impostor, reconciliationSignature)
      ).to.be.revertedWithCustomError(fx.settlement, "InvalidSettlementSignature");
      await expect(
        fx.settlement.connect(fx.relayer).publishSettlement(authorization, settlementSignature, impostor)
      ).to.be.revertedWithCustomError(fx.settlement, "InvalidReconciliationSignature");
    });

    it("refuses a deployment that reuses one key for both critical signers", async () => {
      const fx: Suite = await loadFixture(deploySuite);
      const factory = await ethers.getContractFactory("MovenRunSettlement");
      await expect(
        factory.deploy(
          fx.addresses.timelock,
          fx.guardian.address,
          fx.addresses.token,
          fx.addresses.rewards,
          fx.settlementSigner.address,
          fx.settlementSigner.address,
          RULES_VERSION
        )
      ).to.be.revertedWithCustomError(factory, "SignerReuse");
    });

    it("keeps the two critical signers distinct across rotations", async () => {
      const fx: Suite = await loadFixture(deploySuite);
      await expect(
        execViaTimelock(
          fx,
          fx.addresses.settlement,
          fx.settlement.interface.encodeFunctionData("setSettlementSigner", [
            fx.reconciliationSigner.address,
          ])
        )
      ).to.be.reverted;
    });
  });

  describe("authorization binding", () => {
    it("refuses an expired authorization", async () => {
      const fx: Suite = await loadFixture(deploySuite);
      const authorization = await settlementAuthorization({
        dayId: 1,
        grossIssuance: 1_000n * ONE,
        expiry: (await time.latest()) + 60,
      });
      await time.increase(120);
      await expect(publishSettlement(fx, authorization)).to.be.revertedWithCustomError(
        fx.settlement,
        "AuthorizationExpired"
      );
    });

    it("refuses a replayed nonce", async () => {
      const fx: Suite = await loadFixture(deploySuite);
      const first = await settlementAuthorization({ dayId: 1, grossIssuance: 1_000n * ONE });
      await (await publishSettlement(fx, first)).wait();

      const second = await settlementAuthorization({
        dayId: 2,
        grossIssuance: 1_000n * ONE,
        nonce: first.nonce,
      });
      await expect(publishSettlement(fx, second))
        .to.be.revertedWithCustomError(fx.settlement, "AuthorizationAlreadyUsed")
        .withArgs(first.nonce);
    });

    it("refuses an authorization declaring the wrong rules version", async () => {
      const fx: Suite = await loadFixture(deploySuite);
      const authorization = await settlementAuthorization({
        dayId: 1,
        grossIssuance: 1_000n * ONE,
        rulesVersion: RULES_VERSION + 1,
      });
      await expect(publishSettlement(fx, authorization))
        .to.be.revertedWithCustomError(fx.settlement, "UnexpectedRulesVersion")
        .withArgs(RULES_VERSION + 1, RULES_VERSION);
    });

    it("refuses signatures bound to another chain or another contract", async () => {
      const fx: Suite = await loadFixture(deploySuite);
      const authorization = await settlementAuthorization({ dayId: 1, grossIssuance: 1_000n * ONE });

      const wrongChain = domain("MovenRunSettlement", fx.chainId + 1, fx.addresses.settlement);
      const wrongContract = domain("MovenRunSettlement", fx.chainId, fx.addresses.rewards);

      for (const dom of [wrongChain, wrongContract]) {
        const settlementSignature = await fx.settlementSigner.signTypedData(
          dom,
          SETTLEMENT_TYPES,
          authorization
        );
        const reconciliationSignature = await fx.reconciliationSigner.signTypedData(
          dom,
          SETTLEMENT_TYPES,
          authorization
        );
        await expect(
          fx.settlement
            .connect(fx.relayer)
            .publishSettlement(authorization, settlementSignature, reconciliationSignature)
        ).to.be.revertedWithCustomError(fx.settlement, "InvalidSettlementSignature");
      }
    });
  });

  describe("season and day boundaries", () => {
    it("refuses day zero and any day that does not advance", async () => {
      const fx: Suite = await loadFixture(deploySuite);
      await expect(
        publishSettlement(fx, await settlementAuthorization({ dayId: 0, grossIssuance: 0n, seasonId: 1 }))
      ).to.be.revertedWithCustomError(fx.settlement, "DayNotAdvancing");

      await (
        await publishSettlement(fx, await settlementAuthorization({ dayId: 5, grossIssuance: 1n * ONE }))
      ).wait();

      for (const dayId of [5, 4, 1]) {
        await expect(
          publishSettlement(fx, await settlementAuthorization({ dayId, grossIssuance: 1n * ONE }))
        )
          .to.be.revertedWithCustomError(fx.settlement, "DayNotAdvancing")
          .withArgs(dayId, 5);
      }
    });

    it("refuses a season that does not match the day it claims", async () => {
      const fx: Suite = await loadFixture(deploySuite);
      await expect(
        publishSettlement(
          fx,
          await settlementAuthorization({ dayId: 1, grossIssuance: 1n * ONE, seasonId: 2 })
        )
      )
        .to.be.revertedWithCustomError(fx.settlement, "SeasonMismatch")
        .withArgs(2, 1);
    });

    it("refuses to skip a season so the decay chain cannot be jumped", async () => {
      const fx: Suite = await loadFixture(deploySuite);
      await expect(
        publishSettlement(fx, await settlementAuthorization({ dayId: 181, grossIssuance: 1n * ONE }))
      )
        .to.be.revertedWithCustomError(fx.settlement, "SeasonSequenceViolation")
        .withArgs(3, 0);
    });

    it("keeps a finalized day immutable", async () => {
      const fx: Suite = await loadFixture(deploySuite);
      const first = await settlementAuthorization({
        dayId: 1,
        grossIssuance: 1_000n * ONE,
        merkleRoot: ethers.id("original"),
      });
      await (await publishSettlement(fx, first)).wait();

      await expect(
        publishSettlement(
          fx,
          await settlementAuthorization({
            dayId: 1,
            grossIssuance: 5n * ONE,
            merkleRoot: ethers.id("rewritten"),
          })
        )
      ).to.be.revertedWithCustomError(fx.settlement, "DayNotAdvancing");

      const record = await fx.settlement.settlementOf(1);
      expect(record.merkleRoot).to.equal(ethers.id("original"));
      expect(record.grossIssuance).to.equal(1_000n * ONE);
    });

    it("holds each day inside the pool its season allows", async () => {
      const fx: Suite = await loadFixture(deploySuite);
      await expect(
        publishSettlement(fx, await settlementAuthorization({ dayId: 1, grossIssuance: DAY_ONE_POOL + 1n }))
      )
        .to.be.revertedWithCustomError(fx.settlement, "DailyPoolExceeded")
        .withArgs(DAY_ONE_POOL + 1n, DAY_ONE_POOL);

      await (
        await publishSettlement(fx, await settlementAuthorization({ dayId: 1, grossIssuance: DAY_ONE_POOL }))
      ).wait();
      expect(await fx.settlement.seasonIssued(1)).to.equal(DAY_ONE_POOL);
    });
  });

  describe("player movement allocation", () => {
    it("declares a four hundred million lifetime movement allocation", async () => {
      const fx: Suite = await loadFixture(deploySuite);
      expect(await fx.settlement.PLAYER_MOVEMENT_ALLOCATION()).to.equal(400_000_000n * ONE);
      expect(await fx.settlement.remainingPlayerAllocation()).to.equal(PLAYER_MOVEMENT_ALLOCATION);
    });

    it("draws every season down from the same allocation and never exceeds it", async () => {
      const fx: Suite = await loadFixture(deploySuite);

      let issued = 0n;
      // One settlement per season, walking the decay chain in order.
      for (let season = 1; season <= 20; season += 1) {
        const dayId = (season - 1) * 90 + 1;
        const pool: bigint = await fx.settlement.dailyPoolOf(dayId).catch(() => 0n);
        const gross = pool > 0n ? pool : 1n * ONE;
        await (await publishSettlement(fx, await settlementAuthorization({ dayId, grossIssuance: gross }))).wait();
        issued += gross;

        const scheduleBudget: bigint = await fx.settlement.seasonScheduleBudget(season);
        const budget: bigint = await fx.settlement.seasonBudget(season);
        // Each season budget is the schedule value, clamped by what the allocation still holds.
        expect(budget).to.be.lte(scheduleBudget);
        expect(budget).to.be.gte(2_000_000n * ONE);
        expect(await fx.settlement.lifetimeMovementIssued()).to.equal(issued);
        expect(issued).to.be.lt(PLAYER_MOVEMENT_ALLOCATION);
      }

      // Ninety percent decay, floored at two million MOVE.
      expect(await fx.settlement.seasonScheduleBudget(1)).to.equal(9_000_000n * ONE);
      expect(await fx.settlement.seasonScheduleBudget(2)).to.equal(8_100_000n * ONE);
      expect(await fx.settlement.seasonScheduleBudget(3)).to.equal(7_290_000n * ONE);
      expect(await fx.settlement.seasonScheduleBudget(20)).to.equal(2_000_000n * ONE);
      expect(await fx.settlement.remainingPlayerAllocation()).to.equal(
        PLAYER_MOVEMENT_ALLOCATION - issued
      );
    });
  });

  describe("toll: liquid, capped and zero-sum", () => {
    it("fixes the toll rate at two percent with no setter anywhere in the ABI", async () => {
      const fx: Suite = await loadFixture(deploySuite);
      expect(await fx.settlement.TOLL_RATE_BPS()).to.equal(200);
      const setters = fx.settlement.interface.fragments
        .filter((f: any) => f.type === "function")
        .map((f: any) => f.name)
        .filter((name: string) => /toll|burn|allocation|cap/i.test(name) && name.startsWith("set"));
      expect(setters).to.deep.equal([]);
    });

    it("refuses toll credits above two percent of the applicable reward base", async () => {
      const fx: Suite = await loadFixture(deploySuite);
      const gross = 10_000n * ONE;
      const tollBase = 10_000n * ONE;
      const ceiling = (tollBase * 200n) / 10_000n;

      await expect(
        publishSettlement(
          fx,
          await settlementAuthorization({
            dayId: 1,
            grossIssuance: gross,
            tollBase,
            tollCredits: ceiling + 1n,
          })
        )
      )
        .to.be.revertedWithCustomError(fx.settlement, "TollCreditsExceedCap")
        .withArgs(ceiling + 1n, ceiling);

      await (
        await publishSettlement(
          fx,
          await settlementAuthorization({
            dayId: 1,
            grossIssuance: gross,
            tollBase,
            tollCredits: ceiling,
          })
        )
      ).wait();
    });

    it("refuses a toll base larger than the gross settlement it sits inside", async () => {
      const fx: Suite = await loadFixture(deploySuite);
      await expect(
        publishSettlement(
          fx,
          await settlementAuthorization({
            dayId: 1,
            grossIssuance: 1_000n * ONE,
            tollBase: 1_001n * ONE,
          })
        )
      )
        .to.be.revertedWithCustomError(fx.settlement, "TollBaseExceedsGross")
        .withArgs(1_001n * ONE, 1_000n * ONE);
    });

    it("refuses any settlement whose components do not add up to its gross", async () => {
      const fx: Suite = await loadFixture(deploySuite);
      await expect(
        publishSettlement(
          fx,
          await settlementAuthorization({
            dayId: 1,
            grossIssuance: 1_000n * ONE,
            lockedClaims: 999n * ONE,
            tollBase: 1_000n * ONE,
            tollCredits: 0n,
          })
        )
      )
        .to.be.revertedWithCustomError(fx.settlement, "SettlementAccountingMismatch")
        .withArgs(999n * ONE, 1_000n * ONE);
    });

    it("mints nothing extra for the toll: a tolled day issues exactly what an untolled day issues", async () => {
      const fx: Suite = await loadFixture(deploySuite);
      const gross = 10_000n * ONE;
      const tollBase = 10_000n * ONE;
      const toll = (tollBase * 200n) / 10_000n;

      // Day one carries no toll; day two carries the maximum toll on the same gross.
      await (
        await publishSettlement(fx, await settlementAuthorization({ dayId: 1, grossIssuance: gross }))
      ).wait();
      const mintedAfterUntolled: bigint = await fx.token.cumulativeMinted();
      const supplyAfterUntolled: bigint = await fx.token.totalSupply();
      const reserveAfterUntolled: bigint = await fx.token.balanceOf(fx.addresses.rewards);

      await (
        await publishSettlement(
          fx,
          await settlementAuthorization({ dayId: 2, grossIssuance: gross, tollBase, tollCredits: toll })
        )
      ).wait();

      // Same issuance, same lifetime draw, same reserve growth. The toll only changes who the
      // committed tree pays, never how much MOVE comes into existence.
      expect((await fx.token.cumulativeMinted()) - mintedAfterUntolled).to.equal(gross);
      expect((await fx.token.totalSupply()) - supplyAfterUntolled).to.equal(gross);
      expect((await fx.token.balanceOf(fx.addresses.rewards)) - reserveAfterUntolled).to.equal(gross);

      // The runner side gives up exactly what the deed-owner side gains.
      const untolledDay = await fx.rewards.dayAllocation(1);
      const tolledDay = await fx.rewards.dayAllocation(2);
      expect(untolledDay.lockedAllocated - tolledDay.lockedAllocated).to.equal(toll);
      expect(tolledDay.liquidAllocated - untolledDay.liquidAllocated).to.equal(toll);
      expect(tolledDay.lockedAllocated + tolledDay.liquidAllocated).to.equal(
        untolledDay.lockedAllocated + untolledDay.liquidAllocated
      );
      expect(tolledDay.lockedAllocated + tolledDay.liquidAllocated).to.equal(gross);
    });

    it("classifies the toll as liquid without consuming the liquid movement allowance", async () => {
      const fx: Suite = await loadFixture(deploySuite);
      expect(await fx.settlement.liquidIssuanceAllowance()).to.equal(0n);

      const gross = 10_000n * ONE;
      const toll = (gross * 200n) / 10_000n;
      await (
        await publishSettlement(
          fx,
          await settlementAuthorization({
            dayId: 1,
            grossIssuance: gross,
            tollBase: gross,
            tollCredits: toll,
          })
        )
      ).wait();

      // The toll was paid as liquid MOVE, and the allowance for newly created liquid
      // movement rewards is untouched: it is still exactly zero.
      const day = await fx.rewards.dayAllocation(1);
      expect(day.liquidAllocated).to.equal(toll);
      expect(await fx.settlement.liquidIssuanceAllowance()).to.equal(0n);
    });

    it("refuses newly created liquid movement rewards beyond the allowance", async () => {
      const fx: Suite = await loadFixture(deploySuite);

      await expect(
        publishSettlement(
          fx,
          await settlementAuthorization({
            dayId: 1,
            grossIssuance: 1_000n * ONE,
            liquidMovementClaims: 1n,
          })
        )
      )
        .to.be.revertedWithCustomError(fx.settlement, "LiquidIssuanceAllowanceExceeded")
        .withArgs(1n, 0n);

      await execViaTimelock(
        fx,
        fx.addresses.settlement,
        fx.settlement.interface.encodeFunctionData("raiseLiquidIssuanceAllowance", [500n * ONE])
      );
      expect(await fx.settlement.liquidIssuanceAllowance()).to.equal(500n * ONE);

      await (
        await publishSettlement(
          fx,
          await settlementAuthorization({
            dayId: 1,
            grossIssuance: 1_000n * ONE,
            liquidMovementClaims: 500n * ONE,
          })
        )
      ).wait();
      expect(await fx.settlement.liquidIssuanceAllowance()).to.equal(0n);
    });

    it("lets the guardian lower the liquid allowance but never raise it", async () => {
      const fx: Suite = await loadFixture(deploySuite);
      await execViaTimelock(
        fx,
        fx.addresses.settlement,
        fx.settlement.interface.encodeFunctionData("raiseLiquidIssuanceAllowance", [500n * ONE])
      );

      await (await fx.settlement.connect(fx.guardian).reduceLiquidIssuanceAllowance(600n * ONE)).wait();
      expect(await fx.settlement.liquidIssuanceAllowance()).to.equal(0n);

      await expect(
        fx.settlement.connect(fx.guardian).raiseLiquidIssuanceAllowance(1n)
      ).to.be.revertedWithCustomError(fx.settlement, "AccessControlUnauthorizedAccount");
    });
  });

  describe("automatic burn ceiling", () => {
    it("caps the automatic day-close charge at sixty percent of the day's gross", async () => {
      const fx: Suite = await loadFixture(deploySuite);
      const gross = 10_000n * ONE;
      const ceiling = (gross * 6_000n) / 10_000n;

      await expect(
        publishSettlement(
          fx,
          await settlementAuthorization({ dayId: 1, grossIssuance: gross, automaticBurn: ceiling + 1n })
        )
      )
        .to.be.revertedWithCustomError(fx.settlement, "AutomaticBurnExceedsCap")
        .withArgs(ceiling + 1n, ceiling);

      await (
        await publishSettlement(
          fx,
          await settlementAuthorization({ dayId: 1, grossIssuance: gross, automaticBurn: ceiling })
        )
      ).wait();

      expect(await fx.settlement.MAX_AUTOMATIC_BURN_BPS()).to.equal(6_000);
      expect(await fx.token.cumulativeMinted()).to.equal(gross);
      expect(await fx.token.totalSupply()).to.equal(gross - ceiling);
    });
  });

  describe("publication pause", () => {
    it("lets the guardian pause publication and only the timelock resume it", async () => {
      const fx: Suite = await loadFixture(deploySuite);

      await (await fx.settlement.connect(fx.guardian).pausePublication()).wait();
      await expect(
        publishSettlement(fx, await settlementAuthorization({ dayId: 1, grossIssuance: 1n * ONE }))
      ).to.be.revertedWithCustomError(fx.settlement, "PublicationIsPaused");

      await expect(
        fx.settlement.connect(fx.guardian).unpausePublication()
      ).to.be.revertedWithCustomError(fx.settlement, "AccessControlUnauthorizedAccount");

      await execViaTimelock(
        fx,
        fx.addresses.settlement,
        fx.settlement.interface.encodeFunctionData("unpausePublication", [])
      );
      await (
        await publishSettlement(fx, await settlementAuthorization({ dayId: 1, grossIssuance: 1n * ONE }))
      ).wait();
    });
  });
});
