// V1 CHARACTERIZATION — ZoneNFT reclaim cleanup & GearNFT equipped-state.
//
// Proves current deployed-V1 behavior (issues #10, #11). Test names are tagged
// so the proven behavior is never mistaken for an approved invariant. See
// docs/CONTRACT_V1_DISCREPANCIES.md. No contract source is modified.
import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployAll, routeSig, zoneMintSig, fundMove, mintZoneTo, HEX_ID } from "./helpers";

const MAX = ethers.MaxUint256;
const MINT_COST = ethers.parseEther("100");

describe("V1 characterization — ZoneNFT reclaim & GearNFT state", function () {
  // ── Issue #10 ─────────────────────────────────────────────────────────────
  it("V1 characterization (known discrepancy #10): reclaimDormant() leaks accumulatedYield & lastActivity; leaked yield survives burn and is withdrawable by the next minter", async function () {
    const d = await deployAll();
    const alice = d.signers[2];
    const bob = d.signers[3];

    await fundMove(d, alice, 20_000n);
    await d.moveToken.connect(alice).approve(await d.zoneNFT.getAddress(), MAX);
    await mintZoneTo(d, alice, HEX_ID, MINT_COST);

    // Accumulate real zone yield: alice moves THROUGH her zone (hexId = HEX_ID),
    // routing the 2% zone tax into ZoneNFT.accumulatedYield[HEX_ID]. Advance a
    // day first so the daily mint cap has reset.
    await time.increase(24 * 3600 + 1);
    const route = routeSig(d.oracle, d.chainId);
    const taxHash = ethers.hexlify(ethers.randomBytes(32));
    const taxSig = await route(alice.address, taxHash, 10_000n, HEX_ID);
    await d.gpsOracle.submitRoute(alice.address, taxHash, 10_000n, HEX_ID, taxSig);

    const yieldAfterActivity = await d.zoneNFT.accumulatedYield(HEX_ID);
    expect(yieldAfterActivity).to.be.gt(0n);
    const lastActivityBefore = await d.zoneNFT.lastActivity(HEX_ID);

    // Neglect past the 210-day reclaim period, then mark dormant + reclaim.
    await time.increase(211 * 24 * 3600);
    await d.zoneNFT.markDormant(HEX_ID);
    await d.zoneNFT.reclaimDormant(HEX_ID);

    // reclaimDormant only `delete`s ownershipStart and isDormant.
    expect(await d.zoneNFT.ownershipStart(HEX_ID)).to.equal(0n); // cleared
    expect(await d.zoneNFT.isDormant(HEX_ID)).to.equal(false); // cleared
    // ...but lastActivity and accumulatedYield are LEAKED (never cleared):
    expect(await d.zoneNFT.lastActivity(HEX_ID)).to.equal(lastActivityBefore); // leaked
    expect(await d.zoneNFT.accumulatedYield(HEX_ID)).to.equal(yieldAfterActivity); // leaked, survives the burn

    // The deed was burned (isDormant cleared), so it can be re-minted. mintZone
    // does not reset accumulatedYield, so the NEW owner inherits the OLD
    // owner's yield and can withdraw it.
    await fundMove(d, bob, 20_000n);
    await d.moveToken.connect(bob).approve(await d.zoneNFT.getAddress(), MAX);
    await mintZoneTo(d, bob, HEX_ID, MINT_COST);
    expect(await d.zoneNFT.ownerOf(HEX_ID)).to.equal(bob.address);

    const bobBefore = await d.moveToken.balanceOf(bob.address);
    await d.zoneNFT.connect(bob).withdrawYield(HEX_ID);
    expect(await d.moveToken.balanceOf(bob.address)).to.equal(bobBefore + yieldAfterActivity);

    // Intended V2 invariant: reclaimDormant must fully clear per-zone state
    // (ownershipStart, lastActivity, accumulatedYield, dormant) so no value or
    // history survives a burn into a later re-mint.
  });

  // ── Issue #11 ─────────────────────────────────────────────────────────────
  it("V1 characterization (known discrepancy #11): getUserMultiplier keeps returning the gear multiplier after ALL copies are transferred away", async function () {
    const d = await deployAll();
    const alice = d.signers[2];
    const bob = d.signers[3];

    // Admin (deployer holds GEAR_ADMIN_ROLE) registers a 1.5x Shoes gear type.
    const tx = await d.gearNFT.addGearType("Runner Shoes", 0 /* Shoes */, 15_000 /* 1.5x bps */, ethers.parseEther("10"));
    await tx.wait();
    const tokenId = 1n; // nextGearId started at 1

    await fundMove(d, alice, 20_000n);
    await d.moveToken.connect(alice).approve(await d.gearNFT.getAddress(), MAX);

    await d.gearNFT.connect(alice).mintGear(tokenId, 1n);
    await d.gearNFT.connect(alice).equipGear(tokenId);
    expect(await d.gearNFT.getUserMultiplier(alice.address)).to.equal(ethers.parseEther("1.5"));

    // Alice transfers away every copy she owns.
    await d.gearNFT
      .connect(alice)
      .safeTransferFrom(alice.address, bob.address, tokenId, 1n, "0x");
    expect(await d.gearNFT.balanceOf(alice.address, tokenId)).to.equal(0n);

    // getUserMultiplier reads only equippedGear[user][slot]; it never re-checks
    // balanceOf. Alice keeps the full 1.5x multiplier while holding zero gear.
    expect(await d.gearNFT.getUserMultiplier(alice.address)).to.equal(ethers.parseEther("1.5"));

    // Intended V2 invariant: only currently held (and active) gear may
    // contribute to the multiplier.
  });
});
