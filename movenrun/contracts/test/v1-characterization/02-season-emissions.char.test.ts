// V1 CHARACTERIZATION — SeasonController mint-pause, Great Burn semantics & replay.
//
// Proves current deployed-V1 behavior (issues #7, #8, #9). Test names are
// tagged so the proven behavior is never mistaken for an approved invariant.
// See docs/CONTRACT_V1_DISCREPANCIES.md. No contract source is modified.
import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAll, greatBurnSig, fundMove, mintZoneTo, HEX_ID } from "./helpers";

const MAX = ethers.MaxUint256;
const MINT_COST = ethers.parseEther("100");

async function seasonFixture() {
  const d = await deployAll();
  const alice = d.signers[2];
  await fundMove(d, alice, 20_000n);
  await d.moveToken.connect(alice).approve(await d.zoneNFT.getAddress(), MAX);
  await mintZoneTo(d, alice, HEX_ID, MINT_COST);
  return { d, alice };
}

describe("V1 characterization — SeasonController emissions", function () {
  // ── Issue #7 ──────────────────────────────────────────────────────────────
  it("V1 characterization (known discrepancy #7): pauseMinting() flips isMintingAllowed() to false but does NOT stop route MOVE minting or zone minting", async function () {
    const { d, alice } = await loadFixture(seasonFixture);

    await d.seasonController.startSeason();
    // Advance into the allowed pause window (seasonEnd - 14 days).
    await time.increase(77 * 24 * 3600);
    await d.seasonController.pauseMinting();

    expect(await d.seasonController.isMintingAllowed()).to.equal(false);

    // Exact current result #1: route MOVE minting STILL succeeds. Neither
    // GPSOracle nor MoveToken consults SeasonController.mintingPaused.
    const bob = d.signers[3];
    const balBefore = await d.moveToken.balanceOf(bob.address);
    await fundMove(d, bob, 20_000n); // 200 $MOVE — enough to also mint a zone below
    expect(await d.moveToken.balanceOf(bob.address)).to.be.gt(balBefore);

    // Exact current result #2: zone (deed) minting STILL succeeds. ZoneNFT
    // does not consult SeasonController.mintingPaused either.
    await d.moveToken.connect(bob).approve(await d.zoneNFT.getAddress(), MAX);
    await mintZoneTo(d, bob, HEX_ID + 1n, MINT_COST);
    expect(await d.zoneNFT.ownerOf(HEX_ID + 1n)).to.equal(bob.address);

    // Ambiguity to resolve in V2: the pause flag is purely advisory today.
    // V2 must DEFINE whether the pause covers (a) MOVE route minting,
    // (b) Zone Deed minting, or (c) both — and then actually enforce it.
  });

  // ── Issue #8 ──────────────────────────────────────────────────────────────
  it("V1 characterization (known discrepancy #8): greatBurn() is a TREASURY TRANSFER — it increases treasury balance and does NOT reduce total supply", async function () {
    const { d, alice } = await loadFixture(seasonFixture);
    await d.seasonController.startSeason();
    await d.moveToken.connect(alice).approve(await d.seasonController.getAddress(), MAX);
    await time.increase(90 * 24 * 3600 + 1);

    const zoneYield = ethers.parseEther("100");
    const topHexIds = [HEX_ID]; // alice owns HEX_ID
    const yields = [zoneYield];
    const seasonNumber = await d.seasonController.seasonNumber();
    const sig = await greatBurnSig(d.oracle, d.chainId)(seasonNumber, topHexIds, yields);

    const supplyBefore = await d.moveToken.totalSupply();
    const treasuryBefore = await d.moveToken.balanceOf(d.treasury.address);
    const aliceBefore = await d.moveToken.balanceOf(alice.address);

    await d.seasonController.greatBurn(topHexIds, yields, sig);

    // burnAmount = yield * GREAT_BURN_PCT / 10_000, GREAT_BURN_PCT = 1_000 = 10%.
    const burnAmount = (zoneYield * 1000n) / 10_000n;
    expect(burnAmount).to.equal(zoneYield / 10n);

    // Total supply is UNCHANGED — nothing is actually ERC-20 burned.
    expect(await d.moveToken.totalSupply()).to.equal(supplyBefore);
    // The "burned" amount simply moved from the owner to the DAO treasury.
    expect(await d.moveToken.balanceOf(d.treasury.address)).to.equal(treasuryBefore + burnAmount);
    expect(await d.moveToken.balanceOf(alice.address)).to.equal(aliceBefore - burnAmount);

    // Intended V2: "Great Burn" must be a real burn (or explicitly renamed to
    // a treasury sweep) with defined tokenomics.
  });

  // ── Issue #9 ──────────────────────────────────────────────────────────────
  it("V1 characterization (known discrepancy #9): the SAME signed greatBurn payload can be executed more than once (no per-season finalization / no signed-payload nonce)", async function () {
    const { d, alice } = await loadFixture(seasonFixture);
    await d.seasonController.startSeason();
    await d.moveToken.connect(alice).approve(await d.seasonController.getAddress(), MAX);
    await time.increase(90 * 24 * 3600 + 1);

    const zoneYield = ethers.parseEther("100");
    const topHexIds = [HEX_ID];
    const yields = [zoneYield];
    const seasonNumber = await d.seasonController.seasonNumber();
    const sig = await greatBurnSig(d.oracle, d.chainId)(seasonNumber, topHexIds, yields);
    const burnAmount = (zoneYield * 1000n) / 10_000n;

    const treasuryBefore = await d.moveToken.balanceOf(d.treasury.address);

    // Execute the identical (payload, signature) twice within the same season.
    // seasonNumber does not change between calls, so the payload is byte-identical.
    await d.seasonController.greatBurn(topHexIds, yields, sig);
    await d.seasonController.greatBurn(topHexIds, yields, sig);

    // The treasury received the transfer TWICE — there is no usedGreatBurnSigs
    // mapping and no per-season finalization flag to stop replay while the
    // owner still has balance + allowance.
    expect(await d.moveToken.balanceOf(d.treasury.address)).to.equal(treasuryBefore + burnAmount * 2n);

    // Intended V2 invariant: one finalization per season, or one use per
    // signed payload (nonce / finalized flag).
  });
});
