import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  deployV2,
  V2Fixture,
  mintMoveTo,
  mintZoneTo,
  declareChallengeOn,
  submitScoreFor,
  farDeadline,
  v2Domain,
  CHALLENGE_DECLARATION_TYPES,
  SCORE_TYPES,
} from "./helpers";

describe("ZoneChallengeV2", function () {
  let f: V2Fixture;
  let admin: SignerWithAddress;
  let oracle: SignerWithAddress;
  let treasury: SignerWithAddress;
  let defender: SignerWithAddress;
  let challenger: SignerWithAddress;
  let mallory: SignerWithAddress;

  const HEX_ID = 613177413693333503n;
  const MINT_COST = ethers.parseEther("100");
  const FOURTEEN_DAYS = 14 * 24 * 3600;

  beforeEach(async function () {
    [admin, oracle, treasury, defender, challenger, mallory] = await ethers.getSigners();
    f = await deployV2(admin, oracle, treasury);

    await mintMoveTo(f, defender.address, 20_000n);
    await mintMoveTo(f, challenger.address, 20_000n);
    await mintMoveTo(f, mallory.address, 20_000n);
    await f.moveToken.connect(defender).approve(await f.zoneChallenge.getAddress(), ethers.MaxUint256);
    await f.moveToken.connect(mallory).approve(await f.zoneChallenge.getAddress(), ethers.MaxUint256);
    await mintZoneTo(f, defender, HEX_ID, MINT_COST);
    // NOTE: no zoneNFT approval from the defender anywhere in this suite —
    // V2 settlement must not depend on it.
  });

  async function buildDeclareSig(overrides: Partial<{
    chainId: bigint;
    verifyingContract: string;
    challengeId: bigint;
    hexId: bigint;
    challenger: string;
    defender: string;
    defenderBaseScore: bigint;
    deadline: bigint;
  }> = {}) {
    const deadline = overrides.deadline ?? (await farDeadline());
    const challengeId = overrides.challengeId ?? (await f.zoneChallenge.nextChallengeId());
    return {
      deadline,
      challengeId,
      sig: await oracle.signTypedData(
        v2Domain(
          overrides.chainId ?? f.chainId,
          overrides.verifyingContract ?? (await f.zoneChallenge.getAddress())
        ),
        CHALLENGE_DECLARATION_TYPES,
        {
          challengeId,
          hexId: overrides.hexId ?? HEX_ID,
          challenger: overrides.challenger ?? challenger.address,
          defender: overrides.defender ?? defender.address,
          defenderBaseScore: overrides.defenderBaseScore ?? 0n,
          deadline,
        }
      ),
    };
  }

  describe("lifecycle state model", function () {
    it("None → Active on declaration, with active pointer set", async function () {
      const id = await declareChallengeOn(f, challenger, HEX_ID, 0n);
      expect(id).to.equal(1n);
      expect(await f.zoneChallenge.activeChallengeId(HEX_ID)).to.equal(1n);
      const c = await f.zoneChallenge.getChallenge(1n);
      expect(c.state).to.equal(1n); // Active
      expect(c.challenger).to.equal(challenger.address);
      expect(c.defender).to.equal(defender.address);
      expect(await f.zoneNFT.challengeLocked(HEX_ID)).to.equal(true);
    });

    it("an active challenge cannot be overwritten", async function () {
      await declareChallengeOn(f, challenger, HEX_ID, 0n);
      const { deadline, sig } = await buildDeclareSig({ challenger: mallory.address });
      await expect(
        f.zoneChallenge.connect(mallory).declareChallenge(HEX_ID, 0n, deadline, sig)
      ).to.be.revertedWith("ZoneChallengeV2: challenge already active");
    });

    it("burns the declaration cost", async function () {
      const before = await f.moveToken.balanceOf(challenger.address);
      const supplyBefore = await f.moveToken.totalSupply();
      await declareChallengeOn(f, challenger, HEX_ID, 0n);
      expect(before - (await f.moveToken.balanceOf(challenger.address))).to.equal(
        ethers.parseEther("100")
      );
      expect(supplyBefore - (await f.moveToken.totalSupply())).to.equal(
        ethers.parseEther("100")
      );
    });

    it("cannot challenge an unminted zone or your own zone", async function () {
      const { deadline, sig } = await buildDeclareSig({ hexId: HEX_ID + 1n });
      await expect(
        f.zoneChallenge.connect(challenger).declareChallenge(HEX_ID + 1n, 0n, deadline, sig)
      ).to.be.revertedWith("ZoneChallengeV2: zone not minted");

      const own = await buildDeclareSig({ challenger: defender.address });
      await expect(
        f.zoneChallenge.connect(defender).declareChallenge(HEX_ID, 0n, own.deadline, own.sig)
      ).to.be.revertedWith("ZoneChallengeV2: cannot challenge own zone");
    });

    it("a resolved challenge can be followed by a new challenge (new id), cooldown permitting", async function () {
      const id1 = await declareChallengeOn(f, challenger, HEX_ID, ethers.parseEther("999"));
      await time.increase(FOURTEEN_DAYS + 1);
      await f.zoneChallenge.resolveChallenge(id1); // defender wins
      expect(await f.zoneChallenge.activeChallengeId(HEX_ID)).to.equal(0n);

      // Same challenger is on cooldown for this hex.
      const retry = await buildDeclareSig();
      await expect(
        f.zoneChallenge.connect(challenger).declareChallenge(HEX_ID, 0n, retry.deadline, retry.sig)
      ).to.be.revertedWith("ZoneChallengeV2: cooldown active");

      // A different challenger can open a fresh challenge immediately.
      const id2 = await declareChallengeOn(f, mallory, HEX_ID, 0n);
      expect(id2).to.equal(id1 + 1n);
      expect(await f.zoneChallenge.activeChallengeId(HEX_ID)).to.equal(id2);

      // Same challenger can come back after the 30-day cooldown.
      await time.increase(FOURTEEN_DAYS + 1);
      await f.zoneChallenge.resolveChallenge(id2);
      await time.increase(31 * 24 * 3600);
      const id3 = await declareChallengeOn(f, challenger, HEX_ID, 0n);
      expect(id3).to.equal(id2 + 1n);
    });
  });

  describe("declaration signature (EIP-712)", function () {
    it("rejects wrong chain", async function () {
      const { deadline, sig } = await buildDeclareSig({ chainId: f.chainId + 1n });
      await expect(
        f.zoneChallenge.connect(challenger).declareChallenge(HEX_ID, 0n, deadline, sig)
      ).to.be.revertedWith("ZoneChallengeV2: invalid sig");
    });

    it("rejects wrong verifying contract", async function () {
      const { deadline, sig } = await buildDeclareSig({
        verifyingContract: await f.zoneNFT.getAddress(),
      });
      await expect(
        f.zoneChallenge.connect(challenger).declareChallenge(HEX_ID, 0n, deadline, sig)
      ).to.be.revertedWith("ZoneChallengeV2: invalid sig");
    });

    it("rejects a signature issued for a different challenger", async function () {
      const { deadline, sig } = await buildDeclareSig({ challenger: mallory.address });
      await expect(
        f.zoneChallenge.connect(challenger).declareChallenge(HEX_ID, 0n, deadline, sig)
      ).to.be.revertedWith("ZoneChallengeV2: invalid sig");
    });

    it("rejects a signature issued for a different defender", async function () {
      const { deadline, sig } = await buildDeclareSig({ defender: mallory.address });
      await expect(
        f.zoneChallenge.connect(challenger).declareChallenge(HEX_ID, 0n, deadline, sig)
      ).to.be.revertedWith("ZoneChallengeV2: invalid sig");
    });

    it("rejects a signature bound to the wrong challengeId", async function () {
      const { deadline, sig } = await buildDeclareSig({ challengeId: 999n });
      await expect(
        f.zoneChallenge.connect(challenger).declareChallenge(HEX_ID, 0n, deadline, sig)
      ).to.be.revertedWith("ZoneChallengeV2: invalid sig");
    });

    it("rejects an expired deadline", async function () {
      const past = BigInt(await time.latest()) - 1n;
      const { sig } = await buildDeclareSig({ deadline: past });
      await expect(
        f.zoneChallenge.connect(challenger).declareChallenge(HEX_ID, 0n, past, sig)
      ).to.be.revertedWith("ZoneChallengeV2: signature expired");
    });

    it("rejects a declaration signature reused for a later challenge on the same hex", async function () {
      // Sign for challengeId 1 with a deadline that outlives the whole flow,
      // use it, resolve, then try to reuse it for challengeId 2.
      const longDeadline = BigInt(await time.latest()) + 100n * 24n * 3600n;
      const first = await buildDeclareSig({ deadline: longDeadline });
      await f.moveToken.connect(challenger).approve(await f.zoneChallenge.getAddress(), ethers.MaxUint256);
      await f.zoneChallenge.connect(challenger).declareChallenge(HEX_ID, 0n, first.deadline, first.sig);
      await time.increase(FOURTEEN_DAYS + 1);
      await f.zoneChallenge.resolveChallenge(1n); // challenger score 0 → defender wins
      await time.increase(31 * 24 * 3600); // clear cooldown
      await expect(
        f.zoneChallenge.connect(challenger).declareChallenge(HEX_ID, 0n, first.deadline, first.sig)
      ).to.be.revertedWith("ZoneChallengeV2: invalid sig"); // nextChallengeId is now 2
    });

    it("rejects a V1-style personal-sign declaration tuple", async function () {
      const v1Hash = ethers.solidityPackedKeccak256(
        ["uint256", "uint64", "address", "uint256"],
        [f.chainId, HEX_ID, defender.address, 0n]
      );
      const v1Sig = await oracle.signMessage(ethers.getBytes(v1Hash));
      const deadline = await farDeadline();
      await expect(
        f.zoneChallenge.connect(challenger).declareChallenge(HEX_ID, 0n, deadline, v1Sig)
      ).to.be.revertedWith("ZoneChallengeV2: invalid sig");
    });

    it("rejects a signature from another V2 deployment (same chain)", async function () {
      const other = await (await ethers.getContractFactory("ZoneChallengeV2", admin)).deploy(
        await f.zoneNFT.getAddress(),
        await f.moveToken.getAddress(),
        await f.gpsOracle.getAddress()
      );
      await other.waitForDeployment();
      const { deadline, sig } = await buildDeclareSig({
        verifyingContract: await other.getAddress(),
      });
      await expect(
        f.zoneChallenge.connect(challenger).declareChallenge(HEX_ID, 0n, deadline, sig)
      ).to.be.revertedWith("ZoneChallengeV2: invalid sig");
    });
  });

  describe("score submission (EIP-712, per-participant nonce)", function () {
    let challengeId: bigint;

    beforeEach(async function () {
      challengeId = await declareChallengeOn(f, challenger, HEX_ID, 0n);
    });

    async function buildScoreSig(overrides: Partial<{
      chainId: bigint;
      verifyingContract: string;
      challengeId: bigint;
      hexId: bigint;
      submitter: string;
      score: bigint;
      nonce: bigint;
      deadline: bigint;
    }> = {}) {
      const deadline = overrides.deadline ?? (await farDeadline());
      const submitter = overrides.submitter ?? challenger.address;
      const nonce = overrides.nonce ?? (await f.zoneChallenge.scoreNonces(submitter));
      return {
        deadline,
        sig: await oracle.signTypedData(
          v2Domain(
            overrides.chainId ?? f.chainId,
            overrides.verifyingContract ?? (await f.zoneChallenge.getAddress())
          ),
          SCORE_TYPES,
          {
            challengeId: overrides.challengeId ?? challengeId,
            hexId: overrides.hexId ?? HEX_ID,
            submitter,
            score: overrides.score ?? 100n,
            nonce,
            deadline,
          }
        ),
      };
    }

    it("accepts scores from both participants and keeps the highest", async function () {
      await submitScoreFor(f, challenger, challengeId, HEX_ID, 500n);
      await submitScoreFor(f, challenger, challengeId, HEX_ID, 300n);
      await submitScoreFor(f, defender, challengeId, HEX_ID, 400n);
      const c = await f.zoneChallenge.getChallenge(challengeId);
      expect(c.challengerScore).to.equal(500n);
      expect(c.defenderScore).to.equal(400n);
    });

    it("rejects non-participants", async function () {
      const { deadline, sig } = await buildScoreSig({ submitter: mallory.address });
      await expect(
        f.zoneChallenge.connect(mallory).submitScore(challengeId, 100n, deadline, sig)
      ).to.be.revertedWith("ZoneChallengeV2: not participant");
    });

    it("rejects a reused score signature (nonce consumed)", async function () {
      const { deadline, sig } = await buildScoreSig({ score: 100n });
      await f.zoneChallenge.connect(challenger).submitScore(challengeId, 100n, deadline, sig);
      await expect(
        f.zoneChallenge.connect(challenger).submitScore(challengeId, 100n, deadline, sig)
      ).to.be.revertedWith("ZoneChallengeV2: invalid sig");
    });

    it("rejects a stale nonce", async function () {
      const { deadline, sig } = await buildScoreSig({ score: 100n, nonce: 5n });
      await expect(
        f.zoneChallenge.connect(challenger).submitScore(challengeId, 100n, deadline, sig)
      ).to.be.revertedWith("ZoneChallengeV2: invalid sig");
    });

    it("rejects a score signed for the wrong challengeId", async function () {
      const { deadline, sig } = await buildScoreSig({ challengeId: challengeId + 1n });
      await expect(
        f.zoneChallenge.connect(challenger).submitScore(challengeId, 100n, deadline, sig)
      ).to.be.revertedWith("ZoneChallengeV2: invalid sig");
    });

    it("rejects a score signed for a different submitter", async function () {
      const { deadline, sig } = await buildScoreSig({ submitter: defender.address });
      await expect(
        f.zoneChallenge.connect(challenger).submitScore(challengeId, 100n, deadline, sig)
      ).to.be.revertedWith("ZoneChallengeV2: invalid sig");
    });

    it("rejects wrong chain / wrong contract / expired deadline", async function () {
      const wrongChain = await buildScoreSig({ chainId: f.chainId + 1n });
      await expect(
        f.zoneChallenge.connect(challenger).submitScore(challengeId, 100n, wrongChain.deadline, wrongChain.sig)
      ).to.be.revertedWith("ZoneChallengeV2: invalid sig");

      const wrongContract = await buildScoreSig({ verifyingContract: await f.zoneNFT.getAddress() });
      await expect(
        f.zoneChallenge.connect(challenger).submitScore(challengeId, 100n, wrongContract.deadline, wrongContract.sig)
      ).to.be.revertedWith("ZoneChallengeV2: invalid sig");

      const past = BigInt(await time.latest()) - 1n;
      const expired = await buildScoreSig({ deadline: past });
      await expect(
        f.zoneChallenge.connect(challenger).submitScore(challengeId, 100n, past, expired.sig)
      ).to.be.revertedWith("ZoneChallengeV2: signature expired");
    });

    it("closes the submission window before challengeEnd (cutoff)", async function () {
      await time.increase(FOURTEEN_DAYS - 30 * 60); // inside the 1h cutoff
      const { deadline, sig } = await buildScoreSig();
      await expect(
        f.zoneChallenge.connect(challenger).submitScore(challengeId, 100n, deadline, sig)
      ).to.be.revertedWith("ZoneChallengeV2: window closed");
    });
  });

  describe("resolution and settlement", function () {
    it("challenger win transfers the deed WITHOUT defender approval", async function () {
      const challengeId = await declareChallengeOn(f, challenger, HEX_ID, 0n);
      await submitScoreFor(f, challenger, challengeId, HEX_ID, ethers.parseEther("1000"));
      await time.increase(FOURTEEN_DAYS + 1);

      await f.zoneChallenge.resolveChallenge(challengeId);
      expect(await f.zoneNFT.ownerOf(HEX_ID)).to.equal(challenger.address);
      expect(await f.zoneNFT.challengeLocked(HEX_ID)).to.equal(false);
      expect(await f.zoneChallenge.activeChallengeId(HEX_ID)).to.equal(0n);
      expect((await f.zoneChallenge.getChallenge(challengeId)).state).to.equal(2n); // Resolved
    });

    it("defender win unlocks the deed without transferring it", async function () {
      const challengeId = await declareChallengeOn(f, challenger, HEX_ID, ethers.parseEther("999"));
      await time.increase(FOURTEEN_DAYS + 1);
      await f.zoneChallenge.resolveChallenge(challengeId);
      expect(await f.zoneNFT.ownerOf(HEX_ID)).to.equal(defender.address);
      expect(await f.zoneNFT.challengeLocked(HEX_ID)).to.equal(false);
      // Defender can transfer freely again.
      await f.zoneNFT.connect(defender).transferFrom(defender.address, mallory.address, HEX_ID);
      expect(await f.zoneNFT.ownerOf(HEX_ID)).to.equal(mallory.address);
    });

    it("repeated resolution fails (idempotent settlement)", async function () {
      const challengeId = await declareChallengeOn(f, challenger, HEX_ID, 0n);
      await submitScoreFor(f, challenger, challengeId, HEX_ID, 100n);
      await time.increase(FOURTEEN_DAYS + 1);
      await f.zoneChallenge.resolveChallenge(challengeId);
      await expect(f.zoneChallenge.resolveChallenge(challengeId)).to.be.revertedWith(
        "ZoneChallengeV2: not active"
      );
    });

    it("cannot resolve before the window closes", async function () {
      const challengeId = await declareChallengeOn(f, challenger, HEX_ID, 0n);
      await expect(f.zoneChallenge.resolveChallenge(challengeId)).to.be.revertedWith(
        "ZoneChallengeV2: window not closed"
      );
    });

    it("the deed cannot be moved by the defender during an active challenge", async function () {
      await declareChallengeOn(f, challenger, HEX_ID, 0n);
      await expect(
        f.zoneNFT.connect(defender).transferFrom(defender.address, mallory.address, HEX_ID)
      ).to.be.revertedWith("ZoneNFTV2: challenge-locked");
    });

    it("the old owner cannot interfere after a lost challenge", async function () {
      // Defender pre-approves mallory (an approval that survives resolution).
      await f.zoneNFT.connect(defender).setApprovalForAll(mallory.address, true);
      const challengeId = await declareChallengeOn(f, challenger, HEX_ID, 0n);
      await submitScoreFor(f, challenger, challengeId, HEX_ID, 100n);
      await time.increase(FOURTEEN_DAYS + 1);
      await f.zoneChallenge.resolveChallenge(challengeId);
      expect(await f.zoneNFT.ownerOf(HEX_ID)).to.equal(challenger.address);

      // Old owner and their operator can no longer move the deed.
      await expect(
        f.zoneNFT.connect(defender).transferFrom(challenger.address, defender.address, HEX_ID)
      ).to.be.reverted;
      await expect(
        f.zoneNFT.connect(mallory).transferFrom(challenger.address, mallory.address, HEX_ID)
      ).to.be.reverted;
    });

    it("stronghold boost and loyalty apply to the defender score", async function () {
      // Deed ages past LOYALTY_TIER2 (125%) before the challenge.
      await time.increase(91 * 24 * 3600);
      const challengeId = await declareChallengeOn(
        f, challenger, HEX_ID, ethers.parseEther("100")
      );
      // Challenger posts slightly above the base score.
      await submitScoreFor(f, challenger, challengeId, HEX_ID, ethers.parseEther("110"));
      await time.increase(FOURTEEN_DAYS + 1);
      // Defender: 100 * 1.25 (loyalty) = 125 > 110 → defender wins.
      await f.zoneChallenge.resolveChallenge(challengeId);
      expect(await f.zoneNFT.ownerOf(HEX_ID)).to.equal(defender.address);
    });

    it("stronghold boost only counts while unexpired at resolution", async function () {
      // Fund the defender for the 300 MOVE stronghold cost (fresh daily caps).
      await time.increase(24 * 3600 + 1);
      await mintMoveTo(f, defender.address, 20_000n);
      await time.increase(24 * 3600 + 1);
      await mintMoveTo(f, defender.address, 20_000n);
      const challengeId = await declareChallengeOn(
        f, challenger, HEX_ID, ethers.parseEther("100")
      );
      await f.zoneChallenge.connect(defender).activateStrongholdBoost(challengeId);
      // Boost lasts 24h; resolution happens 14 days later → expired.
      await submitScoreFor(f, challenger, challengeId, HEX_ID, ethers.parseEther("110"));
      await time.increase(FOURTEEN_DAYS + 1);
      await f.zoneChallenge.resolveChallenge(challengeId);
      // 100 (no expired boost) < 110 → challenger wins.
      expect(await f.zoneNFT.ownerOf(HEX_ID)).to.equal(challenger.address);
    });

    it("time extension moves the end and is single-use", async function () {
      // Fund the defender for the 500 MOVE extension cost (fresh daily caps).
      await time.increase(24 * 3600 + 1);
      await mintMoveTo(f, defender.address, 20_000n);
      await time.increase(24 * 3600 + 1);
      await mintMoveTo(f, defender.address, 20_000n);
      const challengeId = await declareChallengeOn(f, challenger, HEX_ID, 0n);
      await f.zoneChallenge.connect(defender).requestTimeExtension(challengeId);
      await expect(
        f.zoneChallenge.connect(defender).requestTimeExtension(challengeId)
      ).to.be.revertedWith("ZoneChallengeV2: extension already used");
      await time.increase(FOURTEEN_DAYS + 1);
      await expect(f.zoneChallenge.resolveChallenge(challengeId)).to.be.revertedWith(
        "ZoneChallengeV2: window not closed"
      );
      await time.increase(3 * 24 * 3600);
      await f.zoneChallenge.resolveChallenge(challengeId);
    });
  });
});
