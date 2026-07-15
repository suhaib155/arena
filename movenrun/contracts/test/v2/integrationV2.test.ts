import { expect } from "chai";
import { ethers } from "hardhat";
import { time, mine } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  deployV2,
  V2Fixture,
  mintMoveTo,
  mintZoneTo,
  declareChallengeOn,
  submitScoreFor,
  signGreatBurn,
  farDeadline,
  TIMELOCK_MIN_DELAY,
} from "./helpers";

describe("MovenRun V2 Integration", function () {
  let f: V2Fixture;
  let admin: SignerWithAddress;
  let oracle: SignerWithAddress;
  let treasury: SignerWithAddress;
  let alice: SignerWithAddress; // runner / zone owner
  let bob: SignerWithAddress;   // challenger

  const HEX_ID = 613177413693333503n;
  const MINT_COST = ethers.parseEther("100");
  const DAY = 24 * 3600;

  before(async function () {
    [admin, oracle, treasury, alice, bob] = await ethers.getSigners();
    f = await deployV2(admin, oracle, treasury);
  });

  it("Step 1: season starts, both mint paths open", async function () {
    await f.seasonController.startSeason();
    expect(await f.seasonController.isMintingAllowed()).to.equal(true);
  });

  it("Step 2: signed GPS route mints $MOVE with gear multiplier applied", async function () {
    // Alice buys and equips 1.5x shoes after an initial funding run.
    await mintMoveTo(f, alice.address, 10_000n); // 100 MOVE
    await f.gearNFT.addGearType("Speed Shoes", 0, 15_000, ethers.parseEther("10"));
    await f.moveToken.connect(alice).approve(await f.gearNFT.getAddress(), ethers.MaxUint256);
    await f.gearNFT.connect(alice).mintGear(1, 1);
    await f.gearNFT.connect(alice).equipGear(1);

    const before = await f.moveToken.balanceOf(alice.address);
    await mintMoveTo(f, alice.address, 4_000n); // 40 MOVE * 1.5 = 60
    expect((await f.moveToken.balanceOf(alice.address)) - before).to.equal(
      ethers.parseEther("60")
    );
  });

  it("Step 3: zone deed minted; zone tax accrues to the deed", async function () {
    await time.increase(DAY + 1);
    await mintMoveTo(f, alice.address, 10_000n);
    await mintZoneTo(f, alice, HEX_ID, MINT_COST);
    expect(await f.zoneNFT.ownerOf(HEX_ID)).to.equal(alice.address);

    // Bob runs through the zone → 2% tax credited to the deed.
    await mintMoveTo(f, bob.address, 10_000n, HEX_ID);
    expect(await f.zoneNFT.accumulatedYield(HEX_ID)).to.be.gt(0n);
  });

  it("Step 4: challenge lifecycle — challenger wins and takes the deed with no approval", async function () {
    await time.increase(DAY + 1);
    await mintMoveTo(f, bob.address, 20_000n);
    const challengeId = await declareChallengeOn(f, bob, HEX_ID, 0n);
    expect(await f.zoneNFT.challengeLocked(HEX_ID)).to.equal(true);

    // Deed is frozen during the battle.
    await expect(
      f.zoneNFT.connect(alice).transferFrom(alice.address, bob.address, HEX_ID)
    ).to.be.revertedWith("ZoneNFTV2: challenge-locked");

    await submitScoreFor(f, bob, challengeId, HEX_ID, ethers.parseEther("1000"));
    await time.increase(14 * DAY + 1);
    await f.zoneChallenge.resolveChallenge(challengeId);

    expect(await f.zoneNFT.ownerOf(HEX_ID)).to.equal(bob.address);
    expect(await f.zoneNFT.challengeLocked(HEX_ID)).to.equal(false);
    // Accumulated yield followed the deed to the new owner.
    expect(await f.zoneNFT.accumulatedYield(HEX_ID)).to.be.gt(0n);
  });

  it("Step 5: staking accrues checkpointed rewards and pays what the treasury can", async function () {
    await time.increase(DAY + 1);
    await mintMoveTo(f, alice.address, 10_000n);
    await f.moveToken.connect(alice).approve(await f.moveVault.getAddress(), ethers.MaxUint256);
    await f.moveVault.setRewardRate(ethers.parseEther("0.0001"));
    await f.moveVault.connect(alice).stake(ethers.parseEther("50"));

    await time.increase(1000);
    const pending = await f.moveVault.pendingReward(alice.address);
    expect(pending).to.be.gt(0n);

    // Treasury has nothing yet: claim retains everything.
    await f.moveVault.connect(alice).claimReward();
    expect((await f.moveVault.stakes(alice.address)).unpaidRewards).to.be.gt(0n);

    // Fund and claim the remainder.
    await f.moveVault.setRewardRate(0n);
    const remainder = await f.moveVault.pendingReward(alice.address);
    await f.moveToken.connect(alice).approve(await f.moveVault.getAddress(), ethers.MaxUint256);
    await f.moveVault.connect(alice).depositTreasury(ethers.parseEther("10"));
    const balBefore = await f.moveToken.balanceOf(alice.address);
    await f.moveVault.connect(alice).claimReward();
    expect((await f.moveToken.balanceOf(alice.address)) - balBefore).to.equal(remainder);
  });

  it("Step 6: season ends — pause hits both mint paths, Great Burn destroys 10% of top-zone yield", async function () {
    // Move to the pause window of the (long-running) season.
    const seasonEnd = await f.seasonController.seasonEnd();
    const now = BigInt(await time.latest());
    await time.increase(Number(seasonEnd - now) - 7 * DAY);
    await f.seasonController.pauseMinting();
    await expect(mintMoveTo(f, alice.address, 1_000n)).to.be.revertedWith(
      "MoveTokenV2: minting paused"
    );

    await time.increase(8 * DAY);
    const seasonNumber = await f.seasonController.seasonNumber();
    const yieldAmount = ethers.parseEther("50");
    const expectedBurn = ethers.parseEther("5");

    // Bob (current deed owner) allows the burn.
    await f.moveToken.connect(bob).approve(await f.seasonController.getAddress(), ethers.MaxUint256);
    const deadline = await farDeadline();
    const sig = await signGreatBurn(oracle, f.chainId, await f.seasonController.getAddress(), {
      seasonNumber,
      topHexIds: [HEX_ID],
      yields: [yieldAmount],
      deadline,
    });

    const supplyBefore = await f.moveToken.totalSupply();
    const treasuryBefore = await f.moveToken.balanceOf(treasury.address);
    await expect(f.seasonController.greatBurn([HEX_ID], [yieldAmount], deadline, sig))
      .to.emit(f.seasonController, "GreatBurn")
      .withArgs(seasonNumber, expectedBurn);
    expect(supplyBefore - (await f.moveToken.totalSupply())).to.equal(expectedBurn);
    expect(await f.moveToken.balanceOf(treasury.address)).to.equal(treasuryBefore);

    // Next season reopens minting.
    await f.seasonController.startSeason();
    expect(await f.seasonController.isMintingAllowed()).to.equal(true);
  });

  it("Step 7: governance — a proposal changes the vault reward rate through the timelock", async function () {
    await mintMoveTo(f, alice.address, 20_000n);
    await f.moveToken.connect(alice).delegate(alice.address);
    await mine();

    const calldata = f.moveVault.interface.encodeFunctionData("setRewardRate", [777n]);
    const description = "integration: set reward rate to 777";
    const targets = [f.moveVault.target as string];
    const values = [0n];
    const calldatas = [calldata];

    const tx = await f.governor.connect(alice).propose(targets, values, calldatas, description);
    const receipt = await tx.wait();
    const proposalId = receipt!.logs
      .map((l) => { try { return f.governor.interface.parseLog(l); } catch { return null; } })
      .find((l) => l?.name === "ProposalCreated")!.args.proposalId as bigint;

    await time.increase(DAY + 1);
    await f.governor.connect(alice).castVote(proposalId, 1);
    await time.increase(7 * DAY + 1);
    expect(await f.governor.state(proposalId)).to.equal(4n); // Succeeded

    const descriptionHash = ethers.id(description);
    await f.governor.queue(targets, values, calldatas, descriptionHash);
    await time.increase(Number(TIMELOCK_MIN_DELAY) + 1);
    await f.governor.execute(targets, values, calldatas, descriptionHash);

    expect(await f.moveVault.rewardRatePerSecond()).to.equal(777n);
  });
});
