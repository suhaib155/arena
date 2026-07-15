import { expect } from "chai";
import { ethers } from "hardhat";
import { time, mine } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { deployV2, V2Fixture, mintMoveTo, TIMELOCK_MIN_DELAY } from "./helpers";

describe("MovenGovernorV2", function () {
  let f: V2Fixture;
  let admin: SignerWithAddress;
  let oracle: SignerWithAddress;
  let treasury: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  const DAY = 24 * 3600;

  beforeEach(async function () {
    [admin, oracle, treasury, alice, bob] = await ethers.getSigners();
    f = await deployV2(admin, oracle, treasury);
    // Voting power: alice 200 MOVE (across two days for the daily cap).
    await mintMoveTo(f, alice.address, 20_000n);
    await time.increase(DAY + 1);
    await mintMoveTo(f, alice.address, 20_000n);
    await mintMoveTo(f, bob.address, 15_000n);
  });

  function proposalArgs(description = "set reward rate") {
    const calldata = f.moveVault.interface.encodeFunctionData("setRewardRate", [123n]);
    return {
      targets: [f.moveVault.target as string],
      values: [0n],
      calldatas: [calldata],
      description,
      descriptionHash: ethers.id(description),
    };
  }

  async function proposeAs(proposer: SignerWithAddress, description?: string) {
    const p = proposalArgs(description);
    const tx = await f.governor
      .connect(proposer)
      .propose(p.targets, p.values, p.calldatas, p.description);
    const receipt = await tx.wait();
    const log = receipt!.logs
      .map((l) => { try { return f.governor.interface.parseLog(l); } catch { return null; } })
      .find((l) => l?.name === "ProposalCreated");
    return { ...p, proposalId: log!.args.proposalId as bigint };
  }

  describe("configuration", function () {
    it("uses the required governance parameters (timestamp units)", async function () {
      expect(await f.governor.votingDelay()).to.equal(BigInt(DAY));
      expect(await f.governor.votingPeriod()).to.equal(BigInt(7 * DAY));
      expect(await f.governor.proposalThreshold()).to.equal(ethers.parseEther("100"));
      expect(await f.timelock.getMinDelay()).to.equal(TIMELOCK_MIN_DELAY);
      expect(await f.governor.CLOCK_MODE()).to.equal("mode=timestamp");
      expect(await f.governor.clock()).to.equal(BigInt(await time.latest()));
    });

    it("quorum is 10% of past total supply at a snapshot", async function () {
      await mine();
      const t = BigInt(await time.latest()) - 1n;
      const supply = await f.moveToken.getPastTotalSupply(t);
      expect(await f.governor.quorum(t)).to.equal(supply / 10n);
    });
  });

  describe("proposal threshold and delegation", function () {
    it("rejects proposals from accounts below 100 MOVE of votes", async function () {
      // bob holds 150 MOVE but has NOT delegated → 0 votes.
      const p = proposalArgs();
      await expect(
        f.governor.connect(bob).propose(p.targets, p.values, p.calldatas, p.description)
      ).to.be.reverted;
    });

    it("delegation activates voting power for proposing", async function () {
      await f.moveToken.connect(bob).delegate(bob.address);
      await mine();
      await proposeAs(bob);
    });

    it("undelegated holders have no voting power in an active vote", async function () {
      await f.moveToken.connect(alice).delegate(alice.address);
      const { proposalId } = await proposeAs(alice);
      await time.increase(DAY + 1);
      // bob never delegated: casting a vote records zero weight.
      const tx = await f.governor.connect(bob).castVote(proposalId, 1);
      const receipt = await tx.wait();
      const voteLog = receipt!.logs
        .map((l) => { try { return f.governor.interface.parseLog(l); } catch { return null; } })
        .find((l) => l?.name === "VoteCast");
      expect(voteLog!.args.weight).to.equal(0n);
    });
  });

  describe("snapshot voting", function () {
    it("voting power is snapshotted at the proposal start; transfers afterwards cannot vote twice", async function () {
      await f.moveToken.connect(alice).delegate(alice.address);
      await f.moveToken.connect(bob).delegate(bob.address);
      const { proposalId } = await proposeAs(alice);
      await time.increase(DAY + 1); // past voting delay → snapshot fixed

      // Alice votes with her snapshot weight, then sends everything to bob.
      await f.governor.connect(alice).castVote(proposalId, 1);
      const aliceBalance = await f.moveToken.balanceOf(alice.address);
      await f.moveToken.connect(alice).transfer(bob.address, aliceBalance);

      // Bob's weight is still his snapshot weight — the received tokens
      // arrived after the snapshot and add nothing.
      const snapshot = await f.governor.proposalSnapshot(proposalId);
      const bobWeight = await f.governor.getVotes(bob.address, snapshot);
      expect(bobWeight).to.equal(ethers.parseEther("150"));
      const tx = await f.governor.connect(bob).castVote(proposalId, 1);
      const receipt = await tx.wait();
      const voteLog = receipt!.logs
        .map((l) => { try { return f.governor.interface.parseLog(l); } catch { return null; } })
        .find((l) => l?.name === "VoteCast");
      expect(voteLog!.args.weight).to.equal(ethers.parseEther("150"));

      // And alice cannot vote again at all.
      await expect(f.governor.connect(alice).castVote(proposalId, 1)).to.be.reverted;
    });

    it("the quorum snapshot is stable: supply minted after the snapshot does not move it", async function () {
      await f.moveToken.connect(alice).delegate(alice.address);
      const { proposalId } = await proposeAs(alice);
      await time.increase(DAY + 1);
      const snapshot = await f.governor.proposalSnapshot(proposalId);
      const quorumAtSnapshot = await f.governor.quorum(snapshot);
      // Mint a large amount after the snapshot.
      await mintMoveTo(f, bob.address, 5_000n);
      expect(await f.governor.quorum(snapshot)).to.equal(quorumAtSnapshot);
    });

    it("votes cannot be cast before the voting delay elapses or after the period ends", async function () {
      await f.moveToken.connect(alice).delegate(alice.address);
      const { proposalId } = await proposeAs(alice);
      await expect(f.governor.connect(alice).castVote(proposalId, 1)).to.be.reverted; // Pending
      await time.increase(DAY + 7 * DAY + 1);
      await expect(f.governor.connect(alice).castVote(proposalId, 1)).to.be.reverted; // ended
    });
  });

  describe("timelocked execution", function () {
    async function passProposal() {
      await f.moveToken.connect(alice).delegate(alice.address);
      await mine();
      const p = await proposeAs(alice);
      await time.increase(DAY + 1);
      await f.governor.connect(alice).castVote(p.proposalId, 1);
      await time.increase(7 * DAY + 1);
      expect(await f.governor.state(p.proposalId)).to.equal(4n); // Succeeded
      return p;
    }

    it("only queued successful proposals execute, and only after the timelock delay", async function () {
      const p = await passProposal();

      // Direct execution without queueing fails.
      await expect(
        f.governor.execute(p.targets, p.values, p.calldatas, p.descriptionHash)
      ).to.be.reverted;

      await f.governor.queue(p.targets, p.values, p.calldatas, p.descriptionHash);
      expect(await f.governor.state(p.proposalId)).to.equal(5n); // Queued

      // Still inside the 2-day execution delay.
      await expect(
        f.governor.execute(p.targets, p.values, p.calldatas, p.descriptionHash)
      ).to.be.reverted;

      await time.increase(Number(TIMELOCK_MIN_DELAY) + 1);
      await f.governor.execute(p.targets, p.values, p.calldatas, p.descriptionHash);
      expect(await f.governor.state(p.proposalId)).to.equal(7n); // Executed
      // The governed effect landed through the timelock's DAO_ROLE.
      expect(await f.moveVault.rewardRatePerSecond()).to.equal(123n);
    });

    it("a defeated proposal cannot be queued or executed", async function () {
      await f.moveToken.connect(alice).delegate(alice.address);
      await mine();
      const p = await proposeAs(alice);
      await time.increase(DAY + 1);
      await f.governor.connect(alice).castVote(p.proposalId, 0); // against
      await time.increase(7 * DAY + 1);
      expect(await f.governor.state(p.proposalId)).to.equal(3n); // Defeated
      await expect(
        f.governor.queue(p.targets, p.values, p.calldatas, p.descriptionHash)
      ).to.be.reverted;
    });

    it("a proposal below quorum cannot be queued", async function () {
      await f.moveToken.connect(bob).delegate(bob.address);
      await mine();
      const p = await proposeAs(bob);
      // Nobody votes: forVotes stays below the 10% quorum.
      await time.increase(DAY + 1);
      await time.increase(7 * DAY + 1);
      expect(await f.governor.state(p.proposalId)).to.equal(3n); // Defeated (no quorum)
      await expect(
        f.governor.queue(p.targets, p.values, p.calldatas, p.descriptionHash)
      ).to.be.reverted;
    });

    it("cancelled proposals do not execute", async function () {
      await f.moveToken.connect(alice).delegate(alice.address);
      await mine();
      const p = await proposeAs(alice);
      // Proposer cancels while still Pending.
      await f.governor.connect(alice).cancel(p.targets, p.values, p.calldatas, p.descriptionHash);
      expect(await f.governor.state(p.proposalId)).to.equal(2n); // Canceled
      await time.increase(10 * DAY);
      await expect(
        f.governor.queue(p.targets, p.values, p.calldatas, p.descriptionHash)
      ).to.be.reverted;
      await expect(
        f.governor.execute(p.targets, p.values, p.calldatas, p.descriptionHash)
      ).to.be.reverted;
    });

    it("arbitrary immediate execution through the timelock is impossible for outsiders", async function () {
      const calldata = f.moveVault.interface.encodeFunctionData("setRewardRate", [999n]);
      // Nobody but the governor holds PROPOSER_ROLE on the timelock.
      await expect(
        f.timelock.connect(alice).schedule(
          f.moveVault.target, 0n, calldata, ethers.ZeroHash, ethers.ZeroHash, TIMELOCK_MIN_DELAY
        )
      ).to.be.reverted;
      // And calling the vault directly without DAO_ROLE fails.
      await expect(f.moveVault.connect(alice).setRewardRate(999n)).to.be.reverted;
    });
  });
});
