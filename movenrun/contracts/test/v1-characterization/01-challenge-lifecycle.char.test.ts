// V1 CHARACTERIZATION — ZoneChallenge lifecycle & signature discrepancies.
//
// These tests PROVE the current deployed-V1 behavior, including behavior that
// is unsafe. Every test name is tagged "V1 characterization" or "known
// discrepancy" so nobody mistakes the proven behavior for an approved
// invariant. See docs/CONTRACT_V1_DISCREPANCIES.md for severity, impact, and
// the required V2 invariants. No contract source is modified.
import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import {
  deployAll,
  declareSig,
  scoreSig,
  fundMove,
  mintZoneTo,
  HEX_ID,
  type Deployment,
} from "./helpers";

const MAX = ethers.MaxUint256;
const DECLARATION_COST = ethers.parseEther("100");
const MINT_COST = ethers.parseEther("100");

/** Deploy, fund a defender + two challengers, mint a zone to the defender. */
async function challengeFixture() {
  const d = await deployAll();
  const defender = d.signers[2];
  const challengerA = d.signers[3];
  const challengerB = d.signers[5];
  const outsider = d.signers[6];

  await fundMove(d, defender, 20_000n);
  await fundMove(d, challengerA, 20_000n);
  await fundMove(d, challengerB, 20_000n);

  await d.moveToken.connect(defender).approve(await d.zoneNFT.getAddress(), MAX);
  await d.moveToken.connect(defender).approve(await d.zoneChallenge.getAddress(), MAX);
  await d.moveToken.connect(challengerA).approve(await d.zoneChallenge.getAddress(), MAX);
  await d.moveToken.connect(challengerB).approve(await d.zoneChallenge.getAddress(), MAX);

  await mintZoneTo(d, defender, HEX_ID, MINT_COST);

  return { d, defender, challengerA, challengerB, outsider };
}

describe("V1 characterization — ZoneChallenge lifecycle", function () {
  // ── Issue #1 ──────────────────────────────────────────────────────────────
  it("V1 characterization (known discrepancy #1): an ACTIVE challenge can be overwritten by a second declaration", async function () {
    const { d, defender, challengerA, challengerB } = await loadFixture(challengeFixture);
    const declare = declareSig(d.oracle, d.chainId);
    const sig = await declare(HEX_ID, defender.address, 0n);

    await d.zoneChallenge.connect(challengerA).declareChallenge(HEX_ID, 0n, sig);
    const first = await d.zoneChallenge.getChallenge(HEX_ID);
    expect(first.challenger).to.equal(challengerA.address);
    expect(first.resolved).to.equal(false);

    // The guard is `!resolved || challenger == address(0)`. For an active
    // (unresolved) challenge `!resolved` is TRUE, so a second declaration
    // passes and clobbers the live challenge — challengerA's 100 $MOVE
    // declaration cost is already burned and is lost with no recourse.
    await d.zoneChallenge.connect(challengerB).declareChallenge(HEX_ID, 0n, sig);
    const second = await d.zoneChallenge.getChallenge(HEX_ID);
    expect(second.challenger).to.equal(challengerB.address);
    expect(second.challengeStart).to.be.gte(first.challengeStart);

    // Intended V2 invariant: `state == None || state == Resolved` — an active
    // challenge must NEVER be overwritten.
  });

  // ── Issue #2 ──────────────────────────────────────────────────────────────
  it("V1 characterization (known discrepancy #2): after a challenge RESOLVES, no new challenge can be opened for the same hex", async function () {
    const { d, defender, challengerA, challengerB } = await loadFixture(challengeFixture);
    const declare = declareSig(d.oracle, d.chainId);

    // Defender wins (high base score) so the NFT stays and the hex remains minted.
    const sig = await declare(HEX_ID, defender.address, ethers.parseEther("9999"));
    await d.zoneChallenge.connect(challengerA).declareChallenge(HEX_ID, ethers.parseEther("9999"), sig);
    await time.increase(14 * 24 * 3600 + 1);
    await d.zoneChallenge.resolveChallenge(HEX_ID);

    const resolved = await d.zoneChallenge.getChallenge(HEX_ID);
    expect(resolved.resolved).to.equal(true);
    expect(resolved.challenger).to.not.equal(ethers.ZeroAddress);

    // `!resolved || challenger == 0` is now `false || false` == false. A fresh
    // challenger (no cooldown of their own) still cannot re-open the hex: the
    // resolved check fails first. The zone is permanently locked from future
    // challenges once resolved.
    const sig2 = await declare(HEX_ID, defender.address, 0n);
    await expect(
      d.zoneChallenge.connect(challengerB).declareChallenge(HEX_ID, 0n, sig2),
    ).to.be.revertedWith("ZoneChallenge: challenge already active");

    // Intended V2 behavior: a resolved challenge can be followed by a new
    // challenge after applicable cooldown rules.
  });

  // ── Issue #3 ──────────────────────────────────────────────────────────────
  it("V1 characterization (known discrepancy #3): a numerically-winning challenger cannot settle unless the losing defender voluntarily approved the transfer", async function () {
    const { d, defender, challengerA } = await loadFixture(challengeFixture);
    const declare = declareSig(d.oracle, d.chainId);
    const score = scoreSig(d.oracle, d.chainId);

    const sig = await declare(HEX_ID, defender.address, 0n);
    await d.zoneChallenge.connect(challengerA).declareChallenge(HEX_ID, 0n, sig);

    const winning = ethers.parseEther("1000");
    const sSig = await score(HEX_ID, challengerA.address, winning);
    await d.zoneChallenge.connect(challengerA).submitScore(HEX_ID, winning, sSig);

    await time.increase(14 * 24 * 3600 + 1);

    // Challenger has strictly the higher score (1000 vs defender base 0), yet
    // resolution reverts because the ZoneChallenge contract was never approved
    // by the defender to move the deed. The losing party can grief settlement
    // simply by NOT approving.
    await expect(d.zoneChallenge.resolveChallenge(HEX_ID)).to.be.revertedWithCustomError(
      d.zoneNFT,
      "ERC721InsufficientApproval",
    );

    // The only reason the existing passing suite (integration.test.ts,
    // ZoneChallenge.test.ts) settles a challenger win is an explicit
    // `setApprovalForAll(zoneChallenge, true)` by the defender. Grant it and
    // the same resolution now succeeds:
    await d.zoneNFT.connect(defender).setApprovalForAll(await d.zoneChallenge.getAddress(), true);
    await d.zoneChallenge.resolveChallenge(HEX_ID);
    expect(await d.zoneNFT.ownerOf(HEX_ID)).to.equal(challengerA.address);

    // Intended V2 invariant: a valid resolved challenge must settle without
    // voluntary approval from the losing defender (escrow / operator model).
  });

  // ── Issue #4 ──────────────────────────────────────────────────────────────
  it("V1 characterization (known discrepancy #4): the deed can be transferred away while a challenge is ACTIVE (no challenge lock)", async function () {
    const { d, defender, challengerA, outsider } = await loadFixture(challengeFixture);
    const declare = declareSig(d.oracle, d.chainId);

    const sig = await declare(HEX_ID, defender.address, 0n);
    await d.zoneChallenge.connect(challengerA).declareChallenge(HEX_ID, 0n, sig);

    const active = await d.zoneChallenge.getChallenge(HEX_ID);
    expect(active.resolved).to.equal(false);
    expect(active.defender).to.equal(defender.address);

    // ZoneNFT does not override _update / transferFrom to lock a challenged
    // deed. The defender can move it out mid-challenge to a fresh address,
    // stranding the challenge (which still references the old defender).
    await d.zoneNFT.connect(defender).transferFrom(defender.address, outsider.address, HEX_ID);
    expect(await d.zoneNFT.ownerOf(HEX_ID)).to.equal(outsider.address);

    // Intended V2 rule: the deed must be challenge-locked or escrowed while an
    // active challenge exists.
  });

  // ── Issue #5 ──────────────────────────────────────────────────────────────
  it("V1 characterization (known discrepancy #5): a declaration signature is not bound to the challenger/instance/nonce/deadline and can be replayed by another challenger", async function () {
    const { d, defender, challengerA, challengerB } = await loadFixture(challengeFixture);
    const declare = declareSig(d.oracle, d.chainId);

    // The signed payload is keccak256(chainId, hexId, zoneOwner, baseScore).
    // It contains NO challenger, NO challenge instance id, NO deadline, NO
    // nonce, and NO verifying-contract address. Reconstruct it to make the
    // missing bindings explicit:
    const payload = ethers.solidityPackedKeccak256(
      ["uint256", "uint64", "address", "uint256"],
      [d.chainId, HEX_ID, defender.address, 0n],
    );
    const ethHash = ethers.hashMessage(ethers.getBytes(payload));
    const sig = await declare(HEX_ID, defender.address, 0n);
    expect(ethers.recoverAddress(ethHash, sig)).to.equal(d.oracle.address);

    // challengerA opens with the signature...
    await d.zoneChallenge.connect(challengerA).declareChallenge(HEX_ID, 0n, sig);
    expect((await d.zoneChallenge.getChallenge(HEX_ID)).challenger).to.equal(challengerA.address);

    // ...and challengerB replays the SAME signature bytes to open their own
    // declaration for the same hex (here overwriting, per #1). The contract
    // never marks a declaration signature used, so it is replayable by anyone.
    await d.zoneChallenge.connect(challengerB).declareChallenge(HEX_ID, 0n, sig);
    expect((await d.zoneChallenge.getChallenge(HEX_ID)).challenger).to.equal(challengerB.address);

    // Intended V2 invariant: declaration signatures must bind challenger,
    // challenge instance, a deadline, a nonce, and the verifying contract.
  });

  // ── Issue #6 ──────────────────────────────────────────────────────────────
  it("V1 characterization (known discrepancy #6): score signatures are tracked GLOBALLY (chainId,hexId,submitter,score) with no challenge-instance binding", async function () {
    const { d, defender, challengerA } = await loadFixture(challengeFixture);
    const declare = declareSig(d.oracle, d.chainId);
    const score = scoreSig(d.oracle, d.chainId);

    const sig = await declare(HEX_ID, defender.address, 0n);
    await d.zoneChallenge.connect(challengerA).declareChallenge(HEX_ID, 0n, sig);

    const value = ethers.parseEther("500");
    const sSig = await score(HEX_ID, challengerA.address, value);
    await d.zoneChallenge.connect(challengerA).submitScore(HEX_ID, value, sSig);

    // The used-key omits any challenge instance id: it is exactly
    // keccak256(chainId, hexId, submitter, score).
    const sigHash = ethers.solidityPackedKeccak256(
      ["uint256", "uint64", "address", "uint256"],
      [d.chainId, HEX_ID, challengerA.address, value],
    );
    expect(await d.zoneChallenge.usedScoreSigs(sigHash)).to.equal(true);

    // Because the key is global (not per-challenge), the identical logical
    // score for this (hex, submitter) can never be submitted again — reusing
    // the same signature reverts. If the resolved-hex lock (#2) were ever
    // fixed to allow re-challenges, this same global tracking would leak the
    // "used" state across challenge instances.
    await expect(
      d.zoneChallenge.connect(challengerA).submitScore(HEX_ID, value, sSig),
    ).to.be.revertedWith("ZoneChallenge: sig reused");

    // Intended V2 invariant: score signatures must be bound to a specific
    // challenge instance so lifecycle collisions across challenges are
    // impossible.
  });
});
