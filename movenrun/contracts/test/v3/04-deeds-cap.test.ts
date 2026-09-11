import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  ONE,
  Suite,
  claimDeed,
  configureCityCap,
  deploySuite,
  eligibilityAttestation,
  execViaTimelock,
  fundLockedMove,
  signEligibility,
} from "./helpers";
import { cellAt, cityCells, childOf, parentOf } from "./cells";

const CITY = 7;
const OTHER_CITY = 9;

/** A suite with two cities open at two deeds per holder, and MOVE in a few pockets. */
async function openSuite() {
  const fx: Suite = await loadFixture(deploySuite);
  await configureCityCap(fx, CITY, 2);
  await configureCityCap(fx, OTHER_CITY, 2);
  await fundLockedMove(fx, 1, [
    { account: fx.alice.address, amount: 1_000n * ONE },
    { account: fx.bob.address, amount: 1_000n * ONE },
    { account: fx.carol.address, amount: 1_000n * ONE },
  ]);
  return fx;
}

describe("V3 MovenRunDeed and the per-holder city cap", () => {
  describe("cell validity", () => {
    it("mints one deed whose token id is the resolution-8 cell itself", async () => {
      const fx = await openSuite();
      const cell = cellAt(12.9716, 77.5946);

      await expect(claimDeed(fx, fx.alice, cell, CITY))
        .to.emit(fx.deed, "DeedCreated")
        .withArgs(cell, fx.alice.address, CITY);

      expect(await fx.deed.ownerOf(cell)).to.equal(fx.alice.address);
      expect(await fx.deed.cityOf(cell)).to.equal(CITY);
      expect(await fx.deed.h3CellIdOf(cell)).to.equal(cell);
      expect(await fx.deed.totalDeeds()).to.equal(1n);
      expect(await fx.deed.deedExists(cell)).to.equal(true);
    });

    it("refuses any resolution other than eight", async () => {
      const fx = await openSuite();
      for (const cell of [parentOf(12.9716, 77.5946, 7), childOf(12.9716, 77.5946, 9)]) {
        await expect(claimDeed(fx, fx.alice, cell, CITY)).to.be.revertedWithCustomError(
          fx.deed,
          "InvalidH3Cell"
        );
      }
    });

    it("refuses values that are not canonical cell indexes", async () => {
      const fx = await openSuite();
      const valid = cellAt(12.9716, 77.5946);
      const candidates: Array<[string, bigint]> = [
        ["zero", 0n],
        ["reserved high bit set", valid | (1n << 63n)],
        ["index mode is not a cell", valid ^ (1n << 61n)],
        ["mode-dependent bits used", valid | (1n << 57n)],
        ["resolution rewritten to nine", (valid & ~(0xfn << 52n)) | (9n << 52n)],
        ["a digit past the resolution is not the unused sentinel", valid & ~0x7n],
        ["base cell above one hundred and twenty one", valid | (0x7fn << 45n)],
      ];
      for (const [reason, cell] of candidates) {
        await expect(
          claimDeed(fx, fx.alice, BigInt.asUintN(64, cell), CITY),
          reason
        ).to.be.reverted;
      }
    });

    it("allows only one deed per cell", async () => {
      const fx = await openSuite();
      const cell = cellAt(12.9716, 77.5946);

      await (await claimDeed(fx, fx.alice, cell, CITY)).wait();
      await expect(claimDeed(fx, fx.bob, cell, CITY))
        .to.be.revertedWithCustomError(fx.deed, "DeedAlreadyExists")
        .withArgs(cell);
    });

    it("creates deeds only on behalf of the claims contract", async () => {
      const fx = await openSuite();
      await expect(
        fx.deed.connect(fx.alice).mintDeed(fx.alice.address, cellAt(12.9716, 77.5946), CITY)
      ).to.be.revertedWithCustomError(fx.deed, "NotClaimsContract");
    });
  });

  describe("eligibility attestation", () => {
    it("refuses ground that is not solid", async () => {
      const fx = await openSuite();
      await expect(
        claimDeed(fx, fx.alice, cellAt(12.9716, 77.5946), CITY, { solidGround: false })
      ).to.be.revertedWithCustomError(fx.deedClaims, "GroundNotSolid");
    });

    it("refuses ground whose related traffic was not excluded", async () => {
      const fx = await openSuite();
      await expect(
        claimDeed(fx, fx.alice, cellAt(12.9716, 77.5946), CITY, { relatedTrafficExcluded: false })
      ).to.be.revertedWithCustomError(fx.deedClaims, "RelatedTrafficNotExcluded");
    });

    it("refuses ground below any of the three published thresholds", async () => {
      const fx = await openSuite();
      const cell = cellAt(12.9716, 77.5946);

      await expect(claimDeed(fx, fx.alice, cell, CITY, { tenureDays: 20 }))
        .to.be.revertedWithCustomError(fx.deedClaims, "TenureTooShort")
        .withArgs(20, 21);
      await expect(claimDeed(fx, fx.alice, cell, CITY, { distinctCrossers: 29 }))
        .to.be.revertedWithCustomError(fx.deedClaims, "TooFewDistinctCrossers")
        .withArgs(29, 30);
      await expect(claimDeed(fx, fx.alice, cell, CITY, { trafficDays: 9 }))
        .to.be.revertedWithCustomError(fx.deedClaims, "TooFewTrafficDays")
        .withArgs(9, 10);
    });

    it("refuses an attestation that is expired, replayed, redirected or unsigned by the eligibility signer", async () => {
      const fx = await openSuite();
      const cells = cityCells(3);

      const expired = await eligibilityAttestation({
        claimant: fx.alice.address,
        h3CellId: cells[0],
        cityId: CITY,
        expiry: (await time.latest()) + 60,
      });
      const expiredSignature = await signEligibility(fx, expired);
      await time.increase(120);
      await expect(
        fx.deedClaims.connect(fx.alice).claim(expired, expiredSignature, 0)
      ).to.be.revertedWithCustomError(fx.deedClaims, "AttestationExpired");

      const first = await eligibilityAttestation({
        claimant: fx.alice.address,
        h3CellId: cells[0],
        cityId: CITY,
      });
      await (await fx.deedClaims.connect(fx.alice).claim(first, await signEligibility(fx, first), 0)).wait();

      const replayed = { ...first, h3CellId: cells[1] };
      await expect(
        fx.deedClaims.connect(fx.alice).claim(replayed, await signEligibility(fx, replayed), 0)
      ).to.be.revertedWithCustomError(fx.deedClaims, "AttestationAlreadyUsed");

      const other = await eligibilityAttestation({
        claimant: fx.alice.address,
        h3CellId: cells[1],
        cityId: CITY,
      });
      await expect(
        fx.deedClaims.connect(fx.bob).claim(other, await signEligibility(fx, other), 0)
      ).to.be.revertedWithCustomError(fx.deedClaims, "WrongClaimant");

      const forged = await eligibilityAttestation({
        claimant: fx.bob.address,
        h3CellId: cells[2],
        cityId: CITY,
      });
      const forgedSignature = await fx.alice.signTypedData(
        { name: "MovenRunDeedClaims", version: "3", chainId: fx.chainId, verifyingContract: fx.addresses.deedClaims },
        {
          DeedEligibilityAttestation: [
            { name: "claimant", type: "address" },
            { name: "h3CellId", type: "uint64" },
            { name: "cityId", type: "uint32" },
            { name: "solidGround", type: "bool" },
            { name: "tenureDays", type: "uint32" },
            { name: "distinctCrossers", type: "uint32" },
            { name: "trafficDays", type: "uint32" },
            { name: "relatedTrafficExcluded", type: "bool" },
            { name: "claimFee", type: "uint256" },
            { name: "rulesVersion", type: "uint16" },
            { name: "nonce", type: "uint256" },
            { name: "expiry", type: "uint64" },
          ],
        },
        forged
      );
      await expect(
        fx.deedClaims.connect(fx.bob).claim(forged, forgedSignature, 0)
      ).to.be.revertedWithCustomError(fx.deedClaims, "InvalidAttestationSignature");
    });
  });

  describe("claim fee", () => {
    it("refuses a quoted fee above the caller's stated maximum", async () => {
      const fx = await openSuite();
      const attestation = await eligibilityAttestation({
        claimant: fx.alice.address,
        h3CellId: cellAt(12.9716, 77.5946),
        cityId: CITY,
        claimFee: 100n * ONE,
      });
      const signature = await signEligibility(fx, attestation);

      await expect(fx.deedClaims.connect(fx.alice).claim(attestation, signature, 99n * ONE))
        .to.be.revertedWithCustomError(fx.deedClaims, "ClaimFeeAboveMaximum")
        .withArgs(100n * ONE, 99n * ONE);
    });

    it("genuinely burns the claim fee rather than moving it to a treasury", async () => {
      const fx = await openSuite();
      const fee = 100n * ONE;
      const supplyBefore: bigint = await fx.token.totalSupply();
      const aliceBefore: bigint = await fx.token.balanceOf(fx.alice.address);

      await (await fx.token.connect(fx.alice).approve(fx.addresses.deedClaims, fee)).wait();
      await (
        await claimDeed(fx, fx.alice, cellAt(12.9716, 77.5946), CITY, { claimFee: fee })
      ).wait();

      expect(await fx.token.totalSupply()).to.equal(supplyBefore - fee);
      expect(await fx.token.balanceOf(fx.alice.address)).to.equal(aliceBefore - fee);
      expect(await fx.token.balanceOf(fx.addresses.deedClaims)).to.equal(0n);
      expect(await fx.token.balanceOf(fx.addresses.deed)).to.equal(0n);
      // Burning does not hand the destroyed MOVE back as mint capacity.
      expect(await fx.token.cumulativeMinted()).to.equal(supplyBefore);
    });
  });

  describe("per-holder, per-city concentration", () => {
    it("refuses any claim in a city the timelock has not opened", async () => {
      const fx: Suite = await loadFixture(deploySuite);
      await expect(claimDeed(fx, fx.alice, cellAt(12.9716, 77.5946), CITY))
        .to.be.revertedWithCustomError(fx.deedClaims, "CityCapNotConfigured")
        .withArgs(CITY);
    });

    it("caps one holder at their own limit inside a city", async () => {
      const fx = await openSuite();
      const cells = cityCells(4);

      await (await claimDeed(fx, fx.alice, cells[0], CITY)).wait();
      await (await claimDeed(fx, fx.alice, cells[1], CITY)).wait();
      expect(await fx.deed.holderCityDeedCount(fx.alice.address, CITY)).to.equal(2n);
      expect(await fx.deed.holderCityCapacityRemaining(fx.alice.address, CITY)).to.equal(0n);

      await expect(claimDeed(fx, fx.alice, cells[2], CITY))
        .to.be.revertedWithCustomError(fx.deedClaims, "HolderCityCapReached")
        .withArgs(fx.alice.address, CITY, 2);
    });

    it("leaves the city open to everybody else once one holder is at their cap", async () => {
      const fx = await openSuite();
      const cells = cityCells(6);

      await (await claimDeed(fx, fx.alice, cells[0], CITY)).wait();
      await (await claimDeed(fx, fx.alice, cells[1], CITY)).wait();
      await expect(claimDeed(fx, fx.alice, cells[2], CITY)).to.be.revertedWithCustomError(
        fx.deedClaims,
        "HolderCityCapReached"
      );

      // The cap is a limit on concentration, not on the city's total deed supply.
      await (await claimDeed(fx, fx.bob, cells[2], CITY)).wait();
      await (await claimDeed(fx, fx.bob, cells[3], CITY)).wait();
      await (await claimDeed(fx, fx.carol, cells[4], CITY)).wait();

      expect(await fx.deed.cityDeedCount(CITY)).to.equal(5n);
      expect(await fx.deed.holderCityDeedCount(fx.bob.address, CITY)).to.equal(2n);
      expect(await fx.deed.holderCityDeedCount(fx.carol.address, CITY)).to.equal(1n);
      expect(await fx.deed.holderCityCapacityRemaining(fx.carol.address, CITY)).to.equal(1n);
    });

    it("counts each city separately", async () => {
      const fx = await openSuite();
      const here = cityCells(2);
      const elsewhere = cityCells(1, 52.52, 13.405);

      await (await claimDeed(fx, fx.alice, here[0], CITY)).wait();
      await (await claimDeed(fx, fx.alice, here[1], CITY)).wait();
      await (await claimDeed(fx, fx.alice, elsewhere[0], OTHER_CITY)).wait();

      expect(await fx.deed.holderCityDeedCount(fx.alice.address, CITY)).to.equal(2n);
      expect(await fx.deed.holderCityDeedCount(fx.alice.address, OTHER_CITY)).to.equal(1n);
    });

    it("frees a slot when a deed leaves a holder", async () => {
      const fx = await openSuite();
      const cells = cityCells(3);

      await (await claimDeed(fx, fx.alice, cells[0], CITY)).wait();
      await (await claimDeed(fx, fx.alice, cells[1], CITY)).wait();

      await (
        await fx.deed.connect(fx.alice).transferFrom(fx.alice.address, fx.bob.address, cells[1])
      ).wait();
      expect(await fx.deed.holderCityDeedCount(fx.alice.address, CITY)).to.equal(1n);
      expect(await fx.deed.holderCityDeedCount(fx.bob.address, CITY)).to.equal(1n);

      await (await claimDeed(fx, fx.alice, cells[2], CITY)).wait();
      expect(await fx.deed.holderCityDeedCount(fx.alice.address, CITY)).to.equal(2n);
    });

    it("holds a direct transfer to the same limit as a claim", async () => {
      const fx = await openSuite();
      const cells = cityCells(3);

      await (await claimDeed(fx, fx.alice, cells[0], CITY)).wait();
      await (await claimDeed(fx, fx.alice, cells[1], CITY)).wait();
      await (await claimDeed(fx, fx.bob, cells[2], CITY)).wait();

      await expect(fx.deed.connect(fx.bob).transferFrom(fx.bob.address, fx.alice.address, cells[2]))
        .to.be.revertedWithCustomError(fx.deed, "HolderCityCapReached")
        .withArgs(fx.alice.address, CITY, 2);

      await expect(
        fx.deed.connect(fx.bob)["safeTransferFrom(address,address,uint256)"](
          fx.bob.address,
          fx.alice.address,
          cells[2]
        )
      ).to.be.revertedWithCustomError(fx.deed, "HolderCityCapReached");
    });

    it("refuses a voluntary transfer into the contest escrow contract", async () => {
      const fx = await openSuite();
      const cell = cityCells(1)[0];
      await (await claimDeed(fx, fx.alice, cell, CITY)).wait();

      await expect(
        fx.deed.connect(fx.alice).transferFrom(fx.alice.address, fx.addresses.contests, cell)
      )
        .to.be.revertedWithCustomError(fx.deed, "EscrowReservedForContests")
        .withArgs(cell);
    });

    it("lets only the timelock open or resize a city", async () => {
      const fx: Suite = await loadFixture(deploySuite);
      await expect(
        fx.deed.connect(fx.admin).configureCityConcentrationCap(CITY, 5)
      ).to.be.revertedWithCustomError(fx.deed, "AccessControlUnauthorizedAccount");

      await configureCityCap(fx, CITY, 5);
      const [cap, configured] = await fx.deed.cityConcentrationCap(CITY);
      expect(cap).to.equal(5n);
      expect(configured).to.equal(true);

      // The claims contract reports the same cap it is measured against.
      const [claimsCap, claimsConfigured] = await fx.deedClaims.cityConcentrationCap(CITY);
      expect(claimsCap).to.equal(5n);
      expect(claimsConfigured).to.equal(true);
    });

    it("reports per-holder claim availability rather than a city-wide open or closed flag", async () => {
      const fx = await openSuite();
      const cells = cityCells(2);
      await (await claimDeed(fx, fx.alice, cells[0], CITY)).wait();
      await (await claimDeed(fx, fx.alice, cells[1], CITY)).wait();

      expect(await fx.deedClaims.cityClaimsOpenFor(fx.alice.address, CITY)).to.equal(false);
      expect(await fx.deedClaims.cityClaimsOpenFor(fx.bob.address, CITY)).to.equal(true);
    });
  });

  describe("claim pause", () => {
    it("lets the guardian pause claims without touching existing deeds", async () => {
      const fx = await openSuite();
      const cells = cityCells(2);
      await (await claimDeed(fx, fx.alice, cells[0], CITY)).wait();

      await (await fx.deedClaims.connect(fx.guardian).pauseClaims()).wait();
      await expect(claimDeed(fx, fx.bob, cells[1], CITY)).to.be.revertedWithCustomError(
        fx.deedClaims,
        "ClaimsArePaused"
      );

      // A pause stops new issuance only; deeds already held stay freely transferable.
      await (
        await fx.deed.connect(fx.alice).transferFrom(fx.alice.address, fx.bob.address, cells[0])
      ).wait();
      expect(await fx.deed.ownerOf(cells[0])).to.equal(fx.bob.address);

      await expect(fx.deedClaims.connect(fx.guardian).unpauseClaims()).to.be.revertedWithCustomError(
        fx.deedClaims,
        "AccessControlUnauthorizedAccount"
      );
      await execViaTimelock(
        fx,
        fx.addresses.deedClaims,
        fx.deedClaims.interface.encodeFunctionData("unpauseClaims", [])
      );
      await (await claimDeed(fx, fx.bob, cells[1], CITY)).wait();
    });
  });

  it("stores no geography beyond the cell identifier and the opaque city domain", async () => {
    const fx: Suite = await loadFixture(deploySuite);
    const surface = JSON.stringify(fx.deed.interface.fragments).toLowerCase();
    for (const forbidden of ["latitude", "longitude", "\"lat\"", "\"lng\"", "gps", "routepoint", "startpoint", "endpoint", "coordinate"]) {
      expect(surface).to.not.include(forbidden);
    }
  });
});
