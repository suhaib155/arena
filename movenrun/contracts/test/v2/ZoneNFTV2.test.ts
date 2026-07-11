import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  deployV2,
  V2Fixture,
  mintMoveTo,
  mintZoneTo,
  signZoneMint,
  farDeadline,
  v2Domain,
  ZONE_MINT_TYPES,
} from "./helpers";

describe("ZoneNFTV2", function () {
  let f: V2Fixture;
  let admin: SignerWithAddress;
  let oracle: SignerWithAddress;
  let treasury: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  const HEX_ID = 613177413693333503n;
  const MINT_COST = ethers.parseEther("100");

  beforeEach(async function () {
    [admin, oracle, treasury, alice, bob] = await ethers.getSigners();
    f = await deployV2(admin, oracle, treasury);
    await mintMoveTo(f, alice.address, 20_000n); // 200 MOVE
    await f.moveToken.connect(alice).approve(await f.zoneNFT.getAddress(), ethers.MaxUint256);
  });

  async function buildMintSig(overrides: Partial<{
    chainId: bigint;
    verifyingContract: string;
    hexId: bigint;
    minter: string;
    mintCost: bigint;
    nonce: bigint;
    deadline: bigint;
  }> = {}) {
    const deadline = overrides.deadline ?? (await farDeadline());
    const nonce = overrides.nonce ?? (await f.zoneNFT.mintNonces(overrides.minter ?? alice.address));
    return {
      deadline,
      sig: await oracle.signTypedData(
        v2Domain(
          overrides.chainId ?? f.chainId,
          overrides.verifyingContract ?? (await f.zoneNFT.getAddress())
        ),
        ZONE_MINT_TYPES,
        {
          hexId: overrides.hexId ?? HEX_ID,
          minter: overrides.minter ?? alice.address,
          mintCost: overrides.mintCost ?? MINT_COST,
          nonce,
          deadline,
        }
      ),
    };
  }

  describe("mintZone (EIP-712)", function () {
    it("mints the deed and burns the mint cost", async function () {
      const balBefore = await f.moveToken.balanceOf(alice.address);
      const supplyBefore = await f.moveToken.totalSupply();
      const { deadline, sig } = await buildMintSig();
      await f.zoneNFT.connect(alice).mintZone(HEX_ID, MINT_COST, deadline, sig);
      expect(await f.zoneNFT.ownerOf(HEX_ID)).to.equal(alice.address);
      expect(balBefore - (await f.moveToken.balanceOf(alice.address))).to.equal(MINT_COST);
      expect(supplyBefore - (await f.moveToken.totalSupply())).to.equal(MINT_COST);
    });

    it("rejects a signature for the wrong chain", async function () {
      const { deadline, sig } = await buildMintSig({ chainId: f.chainId + 1n });
      await expect(
        f.zoneNFT.connect(alice).mintZone(HEX_ID, MINT_COST, deadline, sig)
      ).to.be.revertedWith("ZoneNFTV2: invalid oracle sig");
    });

    it("rejects a signature bound to a different contract", async function () {
      const { deadline, sig } = await buildMintSig({
        verifyingContract: await f.gpsOracle.getAddress(),
      });
      await expect(
        f.zoneNFT.connect(alice).mintZone(HEX_ID, MINT_COST, deadline, sig)
      ).to.be.revertedWith("ZoneNFTV2: invalid oracle sig");
    });

    it("rejects a signature issued to a different minter", async function () {
      const { deadline, sig } = await buildMintSig({ minter: bob.address, nonce: 0n });
      await expect(
        f.zoneNFT.connect(alice).mintZone(HEX_ID, MINT_COST, deadline, sig)
      ).to.be.revertedWith("ZoneNFTV2: invalid oracle sig");
    });

    it("rejects an expired deadline", async function () {
      const past = BigInt(await time.latest()) - 1n;
      const { sig } = await buildMintSig({ deadline: past });
      await expect(
        f.zoneNFT.connect(alice).mintZone(HEX_ID, MINT_COST, past, sig)
      ).to.be.revertedWith("ZoneNFTV2: signature expired");
    });

    it("rejects nonce reuse (same signature cannot mint twice)", async function () {
      const { deadline, sig } = await buildMintSig();
      await f.zoneNFT.connect(alice).mintZone(HEX_ID, MINT_COST, deadline, sig);
      // Same signature on a fresh hex: nonce already consumed.
      await expect(
        f.zoneNFT.connect(alice).mintZone(HEX_ID, MINT_COST, deadline, sig)
      ).to.be.revertedWith("ZoneNFTV2: already minted");
      const { sig: sigOtherHex } = await buildMintSig({ hexId: HEX_ID + 1n, nonce: 0n, deadline });
      await expect(
        f.zoneNFT.connect(alice).mintZone(HEX_ID + 1n, MINT_COST, deadline, sigOtherHex)
      ).to.be.revertedWith("ZoneNFTV2: invalid oracle sig");
    });

    it("rejects a V1-style personal-sign tuple", async function () {
      const v1Hash = ethers.solidityPackedKeccak256(
        ["uint256", "uint64", "address", "uint256"],
        [f.chainId, HEX_ID, alice.address, MINT_COST]
      );
      const v1Sig = await oracle.signMessage(ethers.getBytes(v1Hash));
      const deadline = await farDeadline();
      await expect(
        f.zoneNFT.connect(alice).mintZone(HEX_ID, MINT_COST, deadline, v1Sig)
      ).to.be.revertedWith("ZoneNFTV2: invalid oracle sig");
    });

    it("rejects a signature from another V2 deployment (same chain)", async function () {
      const other = await (await ethers.getContractFactory("ZoneNFTV2", admin)).deploy(
        await f.moveToken.getAddress(),
        await f.gpsOracle.getAddress()
      );
      await other.waitForDeployment();
      const { deadline, sig } = await buildMintSig({
        verifyingContract: await other.getAddress(),
      });
      await expect(
        f.zoneNFT.connect(alice).mintZone(HEX_ID, MINT_COST, deadline, sig)
      ).to.be.revertedWith("ZoneNFTV2: invalid oracle sig");
    });

    it("reverts while minting is paused (SEASON_ROLE)", async function () {
      const SEASON_ROLE = ethers.id("SEASON_ROLE");
      await f.zoneNFT.grantRole(SEASON_ROLE, admin.address);
      await f.zoneNFT.setMintingPaused(true);
      const { deadline, sig } = await buildMintSig();
      await expect(
        f.zoneNFT.connect(alice).mintZone(HEX_ID, MINT_COST, deadline, sig)
      ).to.be.revertedWith("ZoneNFTV2: minting paused");
    });
  });

  describe("challenge lock (CHALLENGE_ROLE)", function () {
    const CHALLENGE_ROLE = ethers.id("CHALLENGE_ROLE");

    beforeEach(async function () {
      await mintZoneTo(f, alice, HEX_ID, MINT_COST);
      // Grant the role to admin so the lock paths can be unit-tested directly.
      await f.zoneNFT.grantRole(CHALLENGE_ROLE, admin.address);
    });

    it("normal transfer works before any challenge", async function () {
      await f.zoneNFT.connect(alice).transferFrom(alice.address, bob.address, HEX_ID);
      expect(await f.zoneNFT.ownerOf(HEX_ID)).to.equal(bob.address);
    });

    it("only CHALLENGE_ROLE can set the lock", async function () {
      await expect(f.zoneNFT.connect(alice).setChallengeLock(HEX_ID, true)).to.be.reverted;
    });

    it("owner transfers revert while locked", async function () {
      await f.zoneNFT.setChallengeLock(HEX_ID, true);
      await expect(
        f.zoneNFT.connect(alice).transferFrom(alice.address, bob.address, HEX_ID)
      ).to.be.revertedWith("ZoneNFTV2: challenge-locked");
    });

    it("approvals cannot bypass the lock", async function () {
      await f.zoneNFT.connect(alice).approve(bob.address, HEX_ID);
      await f.zoneNFT.connect(alice).setApprovalForAll(bob.address, true);
      await f.zoneNFT.setChallengeLock(HEX_ID, true);
      await expect(
        f.zoneNFT.connect(bob).transferFrom(alice.address, bob.address, HEX_ID)
      ).to.be.revertedWith("ZoneNFTV2: challenge-locked");
      await expect(
        f.zoneNFT.connect(bob)["safeTransferFrom(address,address,uint256)"](
          alice.address, bob.address, HEX_ID
        )
      ).to.be.revertedWith("ZoneNFTV2: challenge-locked");
    });

    it("resolveChallengeTransfer requires the lock", async function () {
      await expect(
        f.zoneNFT.resolveChallengeTransfer(HEX_ID, alice.address, bob.address)
      ).to.be.revertedWith("ZoneNFTV2: not challenge-locked");
    });

    it("resolveChallengeTransfer verifies the expected owner", async function () {
      await f.zoneNFT.setChallengeLock(HEX_ID, true);
      await expect(
        f.zoneNFT.resolveChallengeTransfer(HEX_ID, bob.address, bob.address)
      ).to.be.revertedWith("ZoneNFTV2: owner changed");
    });

    it("resolveChallengeTransfer moves the deed without any approval and clears the lock", async function () {
      await f.zoneNFT.setChallengeLock(HEX_ID, true);
      // No approval from alice of any kind.
      await f.zoneNFT.resolveChallengeTransfer(HEX_ID, alice.address, bob.address);
      expect(await f.zoneNFT.ownerOf(HEX_ID)).to.equal(bob.address);
      expect(await f.zoneNFT.challengeLocked(HEX_ID)).to.equal(false);
      // Deed is transferable again by the new owner.
      await f.zoneNFT.connect(bob).transferFrom(bob.address, alice.address, HEX_ID);
      expect(await f.zoneNFT.ownerOf(HEX_ID)).to.equal(alice.address);
    });

    it("resolveChallengeTransfer is restricted to CHALLENGE_ROLE", async function () {
      await f.zoneNFT.setChallengeLock(HEX_ID, true);
      await expect(
        f.zoneNFT.connect(bob).resolveChallengeTransfer(HEX_ID, alice.address, bob.address)
      ).to.be.reverted;
    });

    it("unlocking without transfer restores normal transfers (defender-win path)", async function () {
      await f.zoneNFT.setChallengeLock(HEX_ID, true);
      await f.zoneNFT.setChallengeLock(HEX_ID, false);
      expect(await f.zoneNFT.ownerOf(HEX_ID)).to.equal(alice.address);
      await f.zoneNFT.connect(alice).transferFrom(alice.address, bob.address, HEX_ID);
      expect(await f.zoneNFT.ownerOf(HEX_ID)).to.equal(bob.address);
    });

    it("reclaim reverts while challenge-locked", async function () {
      await f.zoneNFT.setChallengeLock(HEX_ID, true);
      await time.increase(211 * 24 * 3600);
      await f.zoneNFT.setChallengeLock(HEX_ID, false);
      await f.zoneNFT.markDormant(HEX_ID);
      await f.zoneNFT.setChallengeLock(HEX_ID, true);
      await expect(f.zoneNFT.reclaimDormant(HEX_ID)).to.be.revertedWith(
        "ZoneNFTV2: challenge active"
      );
    });
  });

  describe("deed-instance semantics on transfer", function () {
    it("accumulated yield and loyalty follow the deed on transfer", async function () {
      await mintZoneTo(f, alice, HEX_ID, MINT_COST);
      await time.increase(24 * 3600 + 1);
      await mintMoveTo(f, bob.address, 10_000n, HEX_ID); // credit 2 MOVE yield
      const yieldBefore = await f.zoneNFT.accumulatedYield(HEX_ID);
      expect(yieldBefore).to.equal(ethers.parseEther("2"));

      await time.increase(91 * 24 * 3600); // past LOYALTY_TIER2
      expect(await f.zoneNFT.getLoyaltyMultiplier(HEX_ID)).to.equal(125n);

      await f.zoneNFT.connect(alice).transferFrom(alice.address, bob.address, HEX_ID);
      // Yield follows the deed; loyalty is deed-instance age, unchanged by transfer.
      expect(await f.zoneNFT.accumulatedYield(HEX_ID)).to.equal(yieldBefore);
      expect(await f.zoneNFT.getLoyaltyMultiplier(HEX_ID)).to.equal(125n);
      // New owner can withdraw the yield that followed the deed.
      await f.zoneNFT.connect(bob).withdrawYield(HEX_ID);
      expect(await f.zoneNFT.accumulatedYield(HEX_ID)).to.equal(0n);
    });
  });

  describe("reclaim cleanup", function () {
    it("clears all deed-instance state so a reminted hex inherits nothing", async function () {
      await mintZoneTo(f, alice, HEX_ID, MINT_COST);
      await time.increase(24 * 3600 + 1);
      await mintMoveTo(f, bob.address, 10_000n, HEX_ID); // yield on the deed
      expect(await f.zoneNFT.accumulatedYield(HEX_ID)).to.be.gt(0n);

      // Build loyalty (past tier 4), go dormant, reclaim.
      await time.increase(366 * 24 * 3600);
      expect(await f.zoneNFT.getLoyaltyMultiplier(HEX_ID)).to.equal(175n);
      await f.zoneNFT.markDormant(HEX_ID);
      await f.zoneNFT.reclaimDormant(HEX_ID);

      expect(await f.zoneNFT.ownershipStart(HEX_ID)).to.equal(0n);
      expect(await f.zoneNFT.lastActivity(HEX_ID)).to.equal(0n);
      expect(await f.zoneNFT.accumulatedYield(HEX_ID)).to.equal(0n);
      expect(await f.zoneNFT.isDormant(HEX_ID)).to.equal(false);
      expect(await f.zoneNFT.challengeLocked(HEX_ID)).to.equal(false);
      expect(await f.zoneNFT.getLoyaltyMultiplier(HEX_ID)).to.equal(100n);

      // Remint to bob: fresh instance, no inherited yield or loyalty.
      await mintMoveTo(f, bob.address, 20_000n);
      await f.moveToken.connect(bob).approve(await f.zoneNFT.getAddress(), ethers.MaxUint256);
      await mintZoneTo(f, bob, HEX_ID, MINT_COST);
      expect(await f.zoneNFT.ownerOf(HEX_ID)).to.equal(bob.address);
      expect(await f.zoneNFT.accumulatedYield(HEX_ID)).to.equal(0n);
      expect(await f.zoneNFT.getLoyaltyMultiplier(HEX_ID)).to.equal(100n);
      await expect(f.zoneNFT.connect(bob).withdrawYield(HEX_ID)).to.be.revertedWith(
        "ZoneNFTV2: no yield"
      );
    });

    it("reclaim requires dormancy and the reclaim period", async function () {
      await mintZoneTo(f, alice, HEX_ID, MINT_COST);
      await expect(f.zoneNFT.reclaimDormant(HEX_ID)).to.be.revertedWith(
        "ZoneNFTV2: not dormant"
      );
      await expect(f.zoneNFT.markDormant(HEX_ID)).to.be.revertedWith(
        "ZoneNFTV2: not dormant yet"
      );
    });
  });

  describe("withdrawYield", function () {
    it("pays accumulated yield to the current owner only", async function () {
      await mintZoneTo(f, alice, HEX_ID, MINT_COST);
      await time.increase(24 * 3600 + 1);
      await mintMoveTo(f, bob.address, 10_000n, HEX_ID);
      await expect(f.zoneNFT.connect(bob).withdrawYield(HEX_ID)).to.be.revertedWith(
        "ZoneNFTV2: not owner"
      );
      const before = await f.moveToken.balanceOf(alice.address);
      await f.zoneNFT.connect(alice).withdrawYield(HEX_ID);
      expect((await f.moveToken.balanceOf(alice.address)) - before).to.equal(
        ethers.parseEther("2")
      );
    });
  });
});
