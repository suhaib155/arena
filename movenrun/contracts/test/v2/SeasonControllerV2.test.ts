import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  deployV2,
  V2Fixture,
  mintMoveTo,
  mintZoneTo,
  signGreatBurn,
  farDeadline,
} from "./helpers";

describe("SeasonControllerV2", function () {
  let f: V2Fixture;
  let admin: SignerWithAddress;
  let oracle: SignerWithAddress;
  let treasury: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  const HEX_ID = 613177413693333503n;
  const MINT_COST = ethers.parseEther("100");
  const NINETY_DAYS = 90 * 24 * 3600;

  beforeEach(async function () {
    [admin, oracle, treasury, alice, bob] = await ethers.getSigners();
    f = await deployV2(admin, oracle, treasury);
  });

  describe("season mint pause pauses BOTH mint paths", function () {
    beforeEach(async function () {
      await f.seasonController.startSeason();
      await mintMoveTo(f, alice.address, 20_000n);
      await f.moveToken.connect(alice).approve(await f.zoneNFT.getAddress(), ethers.MaxUint256);
    });

    it("pauseMinting inside the window pauses route AND zone minting; startSeason unpauses both", async function () {
      await time.increase(NINETY_DAYS - 7 * 24 * 3600); // inside the 14-day pause window
      await f.seasonController.pauseMinting();

      expect(await f.moveToken.mintingPaused()).to.equal(true);
      expect(await f.zoneNFT.mintingPaused()).to.equal(true);
      expect(await f.seasonController.isMintingAllowed()).to.equal(false);

      // Route-based $MOVE minting reverts.
      await expect(mintMoveTo(f, alice.address, 1_000n)).to.be.revertedWith(
        "MoveTokenV2: minting paused"
      );
      // Zone Deed minting reverts.
      await expect(mintZoneTo(f, alice, HEX_ID, MINT_COST)).to.be.revertedWith(
        "ZoneNFTV2: minting paused"
      );

      // Next season unpauses both mint paths.
      await time.increase(8 * 24 * 3600);
      await f.seasonController.startSeason();
      expect(await f.moveToken.mintingPaused()).to.equal(false);
      expect(await f.zoneNFT.mintingPaused()).to.equal(false);
      await mintMoveTo(f, alice.address, 1_000n);
      await mintZoneTo(f, alice, HEX_ID, MINT_COST);
      expect(await f.zoneNFT.ownerOf(HEX_ID)).to.equal(alice.address);
    });

    it("cannot pause before the pause window", async function () {
      await expect(f.seasonController.pauseMinting()).to.be.revertedWith(
        "SeasonControllerV2: too early to pause"
      );
    });

    it("only KEEPER_ROLE can pause or start seasons", async function () {
      await expect(f.seasonController.connect(alice).pauseMinting()).to.be.reverted;
      await expect(f.seasonController.connect(alice).startSeason()).to.be.reverted;
    });
  });

  describe("greatBurn", function () {
    let seasonNumber: bigint;

    // Starts a season, mints a zone with funded owner, ends the season.
    async function setupSeasonWithZone(approveAmount = ethers.MaxUint256) {
      await f.seasonController.startSeason();
      seasonNumber = await f.seasonController.seasonNumber();
      await mintMoveTo(f, alice.address, 20_000n); // 200 MOVE
      await f.moveToken.connect(alice).approve(await f.zoneNFT.getAddress(), ethers.MaxUint256);
      await mintZoneTo(f, alice, HEX_ID, MINT_COST); // alice keeps 100 MOVE
      await f.moveToken.connect(alice).approve(await f.seasonController.getAddress(), approveAmount);
      await time.increase(NINETY_DAYS + 1);
    }

    async function burnSig(topHexIds: bigint[], yields: bigint[], deadlineOverride?: bigint) {
      const deadline = deadlineOverride ?? (await farDeadline());
      const sig = await signGreatBurn(oracle, f.chainId, await f.seasonController.getAddress(), {
        seasonNumber,
        topHexIds,
        yields,
        deadline,
      });
      return { deadline, sig };
    }

    it("burns exactly 10% of each yield, reducing totalSupply, never paying the treasury", async function () {
      await setupSeasonWithZone();
      const yieldAmount = ethers.parseEther("100");
      const expectedBurn = ethers.parseEther("10"); // 100 * 1000 / 10000

      const supplyBefore = await f.moveToken.totalSupply();
      const aliceBefore = await f.moveToken.balanceOf(alice.address);
      const treasuryBefore = await f.moveToken.balanceOf(treasury.address);

      const { deadline, sig } = await burnSig([HEX_ID], [yieldAmount]);
      await expect(f.seasonController.greatBurn([HEX_ID], [yieldAmount], deadline, sig))
        .to.emit(f.seasonController, "GreatBurn")
        .withArgs(seasonNumber, expectedBurn);

      expect(supplyBefore - (await f.moveToken.totalSupply())).to.equal(expectedBurn);
      expect(aliceBefore - (await f.moveToken.balanceOf(alice.address))).to.equal(expectedBurn);
      expect(await f.moveToken.balanceOf(treasury.address)).to.equal(treasuryBefore);
    });

    it("cannot run twice for the same season (no replay)", async function () {
      await setupSeasonWithZone();
      const { deadline, sig } = await burnSig([HEX_ID], [ethers.parseEther("100")]);
      await f.seasonController.greatBurn([HEX_ID], [ethers.parseEther("100")], deadline, sig);
      await expect(
        f.seasonController.greatBurn([HEX_ID], [ethers.parseEther("100")], deadline, sig)
      ).to.be.revertedWith("SeasonControllerV2: already executed");
    });

    it("rejects execution before season end", async function () {
      await f.seasonController.startSeason();
      seasonNumber = await f.seasonController.seasonNumber();
      const { deadline, sig } = await burnSig([HEX_ID], [ethers.parseEther("100")]);
      await expect(
        f.seasonController.greatBurn([HEX_ID], [ethers.parseEther("100")], deadline, sig)
      ).to.be.revertedWith("SeasonControllerV2: season not over");
    });

    it("rejects an expired signature", async function () {
      await setupSeasonWithZone();
      const past = BigInt(await time.latest()) - 1n;
      const { sig } = await burnSig([HEX_ID], [ethers.parseEther("100")], past);
      await expect(
        f.seasonController.greatBurn([HEX_ID], [ethers.parseEther("100")], past, sig)
      ).to.be.revertedWith("SeasonControllerV2: signature expired");
    });

    it("rejects a signature over different arrays or a different season", async function () {
      await setupSeasonWithZone();
      const { deadline, sig } = await burnSig([HEX_ID], [ethers.parseEther("100")]);
      await expect(
        f.seasonController.greatBurn([HEX_ID], [ethers.parseEther("999")], deadline, sig)
      ).to.be.revertedWith("SeasonControllerV2: invalid sig");
    });

    it("skips (and reports) owners with insufficient allowance without claiming the burn", async function () {
      await setupSeasonWithZone(0n); // no allowance to SeasonControllerV2
      const yieldAmount = ethers.parseEther("100");
      const supplyBefore = await f.moveToken.totalSupply();
      const { deadline, sig } = await burnSig([HEX_ID], [yieldAmount]);
      await expect(f.seasonController.greatBurn([HEX_ID], [yieldAmount], deadline, sig))
        .to.emit(f.seasonController, "GreatBurn").withArgs(seasonNumber, 0n)
        .and.to.emit(f.seasonController, "GreatBurnSkipped")
        .withArgs(seasonNumber, ethers.parseEther("10"), 1n);
      expect(await f.moveToken.totalSupply()).to.equal(supplyBefore);
    });

    it("skips (and reports) owners with insufficient balance", async function () {
      await setupSeasonWithZone();
      // Alice empties her balance after approving.
      await f.moveToken.connect(alice).transfer(bob.address, await f.moveToken.balanceOf(alice.address));
      const yieldAmount = ethers.parseEther("100");
      const { deadline, sig } = await burnSig([HEX_ID], [yieldAmount]);
      await expect(f.seasonController.greatBurn([HEX_ID], [yieldAmount], deadline, sig))
        .to.emit(f.seasonController, "GreatBurnSkipped")
        .withArgs(seasonNumber, ethers.parseEther("10"), 1n);
    });

    it("processes duplicated hex input deterministically (first wins, duplicate skipped)", async function () {
      await setupSeasonWithZone();
      const yieldAmount = ethers.parseEther("100");
      const hexes = [HEX_ID, HEX_ID];
      const yields = [yieldAmount, yieldAmount];
      const { deadline, sig } = await burnSig(hexes, yields);
      await expect(f.seasonController.greatBurn(hexes, yields, deadline, sig))
        .to.emit(f.seasonController, "GreatBurn").withArgs(seasonNumber, ethers.parseEther("10"))
        .and.to.emit(f.seasonController, "GreatBurnSkipped").withArgs(seasonNumber, 0n, 1n);
    });

    it("skips unminted zones and zero-yield entries", async function () {
      await setupSeasonWithZone();
      const hexes = [HEX_ID + 1n, HEX_ID]; // first is unminted
      const yields = [ethers.parseEther("100"), 0n]; // second is zero yield
      const { deadline, sig } = await burnSig(hexes, yields);
      await expect(f.seasonController.greatBurn(hexes, yields, deadline, sig))
        .to.emit(f.seasonController, "GreatBurn").withArgs(seasonNumber, 0n)
        .and.to.emit(f.seasonController, "GreatBurnSkipped").withArgs(seasonNumber, 0n, 2n);
    });

    it("zero yield across the board burns nothing and still finalizes the season", async function () {
      await setupSeasonWithZone();
      const { deadline, sig } = await burnSig([], []);
      await expect(f.seasonController.greatBurn([], [], deadline, sig))
        .to.emit(f.seasonController, "GreatBurn").withArgs(seasonNumber, 0n);
      expect(await f.seasonController.greatBurnExecuted(seasonNumber)).to.equal(true);
    });

    it("rejects more than 100 zones", async function () {
      await setupSeasonWithZone();
      const hexes = Array.from({ length: 101 }, (_, i) => HEX_ID + BigInt(i));
      const yields = hexes.map(() => 1n);
      const { deadline, sig } = await burnSig(hexes, yields);
      await expect(
        f.seasonController.greatBurn(hexes, yields, deadline, sig)
      ).to.be.revertedWith("SeasonControllerV2: max zones exceeded");
    });

    it("rejects mismatched array lengths", async function () {
      await setupSeasonWithZone();
      const { deadline, sig } = await burnSig([HEX_ID], [1n, 2n]);
      await expect(
        f.seasonController.greatBurn([HEX_ID], [1n, 2n], deadline, sig)
      ).to.be.revertedWith("SeasonControllerV2: length mismatch");
    });

    it("is keeper-only", async function () {
      await setupSeasonWithZone();
      const { deadline, sig } = await burnSig([HEX_ID], [1n]);
      await expect(
        f.seasonController.connect(alice).greatBurn([HEX_ID], [1n], deadline, sig)
      ).to.be.reverted;
    });
  });
});
