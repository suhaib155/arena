import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { MAX_LIFETIME_MINTED, ONE } from "./helpers";

/**
 * MovenRunToken's own rules, exercised directly. The settlement and rewards slots are wired
 * to plain accounts here so the token's issuance ceiling and locked-balance rules can be
 * driven to their limits without going through the settlement contract's separate budget.
 */
async function bareToken() {
  const [deployer, admin, settlement, rewards, feeBurner, alice, bob] = await ethers.getSigners();
  const token: any = await (
    await ethers.getContractFactory("MovenRunToken")
  ).deploy(admin.address, deployer.address);
  await (
    await token.configureCore(settlement.address, rewards.address, [feeBurner.address])
  ).wait();
  await (await token.finalizeBootstrap()).wait();
  return { token, deployer, admin, settlement, rewards, feeBurner, alice, bob };
}

async function unwiredToken() {
  const [deployer, admin, settlement, rewards, feeBurner, alice] = await ethers.getSigners();
  const token: any = await (
    await ethers.getContractFactory("MovenRunToken")
  ).deploy(admin.address, deployer.address);
  return { token, deployer, admin, settlement, rewards, feeBurner, alice };
}

describe("V3 MovenRunToken", () => {
  describe("lifetime issuance cap", () => {
    it("caps lifetime issuance at one billion MOVE", async () => {
      const { token } = await loadFixture(bareToken);
      expect(await token.MAX_LIFETIME_MINTED()).to.equal(1_000_000_000n * ONE);
      expect(await token.remainingMintCapacity()).to.equal(MAX_LIFETIME_MINTED);
    });

    it("issues up to the cap and refuses the next wei", async () => {
      const { token, settlement } = await loadFixture(bareToken);

      await (await token.connect(settlement).settlementIssue(MAX_LIFETIME_MINTED, 0)).wait();
      expect(await token.cumulativeMinted()).to.equal(MAX_LIFETIME_MINTED);
      expect(await token.remainingMintCapacity()).to.equal(0n);

      await expect(token.connect(settlement).settlementIssue(1n, 0))
        .to.be.revertedWithCustomError(token, "LifetimeCapExceeded")
        .withArgs(1n, 0n);
    });

    it("burning reduces supply without reopening mint capacity", async () => {
      const { token, settlement, rewards } = await loadFixture(bareToken);

      await (await token.connect(settlement).settlementIssue(MAX_LIFETIME_MINTED, 0)).wait();
      await (await token.connect(rewards).burn(100_000n * ONE)).wait();

      expect(await token.totalSupply()).to.equal(MAX_LIFETIME_MINTED - 100_000n * ONE);
      expect(await token.cumulativeMinted()).to.equal(MAX_LIFETIME_MINTED);
      expect(await token.remainingMintCapacity()).to.equal(0n);

      await expect(token.connect(settlement).settlementIssue(1n, 0)).to.be.revertedWithCustomError(
        token,
        "LifetimeCapExceeded"
      );
    });

    it("charges the full gross against the cap even when part of it is burned at once", async () => {
      const { token, settlement } = await loadFixture(bareToken);

      await (await token.connect(settlement).settlementIssue(1_000n * ONE, 600n * ONE)).wait();

      expect(await token.cumulativeMinted()).to.equal(1_000n * ONE);
      expect(await token.totalSupply()).to.equal(400n * ONE);
    });

    it("refuses a burn larger than the issuance it accompanies", async () => {
      const { token, settlement } = await loadFixture(bareToken);
      await expect(token.connect(settlement).settlementIssue(100n, 101n))
        .to.be.revertedWithCustomError(token, "BurnExceedsIssuance")
        .withArgs(101n, 100n);
    });

    it("accepts issuance only from the settlement contract", async () => {
      const { token, alice } = await loadFixture(bareToken);
      await expect(token.connect(alice).settlementIssue(1n, 0)).to.be.revertedWithCustomError(
        token,
        "NotSettlement"
      );
    });
  });

  describe("locked and liquid balances", () => {
    it("refuses to transfer locked MOVE and allows liquid MOVE", async () => {
      const { token, settlement, rewards, alice, bob } = await loadFixture(bareToken);

      await (await token.connect(settlement).settlementIssue(1_000n * ONE, 0)).wait();
      await (await token.connect(rewards).releaseLocked(alice.address, 400n * ONE)).wait();
      await (await token.connect(rewards).transfer(alice.address, 100n * ONE)).wait();

      expect(await token.lockedBalanceOf(alice.address)).to.equal(400n * ONE);
      expect(await token.liquidBalanceOf(alice.address)).to.equal(100n * ONE);

      await expect(token.connect(alice).transfer(bob.address, 101n * ONE))
        .to.be.revertedWithCustomError(token, "LockedBalanceNotTransferable")
        .withArgs(alice.address, 101n * ONE, 100n * ONE);

      await (await token.connect(alice).transfer(bob.address, 100n * ONE)).wait();
      expect(await token.balanceOf(bob.address)).to.equal(100n * ONE);
      expect(await token.lockedBalanceOf(alice.address)).to.equal(400n * ONE);
    });

    it("refuses to move locked MOVE through an approved spender", async () => {
      const { token, settlement, rewards, alice, bob } = await loadFixture(bareToken);

      await (await token.connect(settlement).settlementIssue(1_000n * ONE, 0)).wait();
      await (await token.connect(rewards).releaseLocked(alice.address, 500n * ONE)).wait();
      await (await token.connect(alice).approve(bob.address, 500n * ONE)).wait();

      await expect(
        token.connect(bob).transferFrom(alice.address, bob.address, 1n)
      ).to.be.revertedWithCustomError(token, "LockedBalanceNotTransferable");
    });

    it("burns the locked portion of a balance before the liquid portion", async () => {
      const { token, settlement, rewards, alice } = await loadFixture(bareToken);

      await (await token.connect(settlement).settlementIssue(1_000n * ONE, 0)).wait();
      await (await token.connect(rewards).releaseLocked(alice.address, 300n * ONE)).wait();
      await (await token.connect(rewards).transfer(alice.address, 200n * ONE)).wait();

      await (await token.connect(alice).burn(120n * ONE)).wait();
      expect(await token.lockedBalanceOf(alice.address)).to.equal(180n * ONE);
      expect(await token.liquidBalanceOf(alice.address)).to.equal(200n * ONE);

      await (await token.connect(alice).burn(230n * ONE)).wait();
      expect(await token.lockedBalanceOf(alice.address)).to.equal(0n);
      expect(await token.liquidBalanceOf(alice.address)).to.equal(150n * ONE);
    });

    it("never lets a burn increase the transferable portion of a balance", async () => {
      const { token, settlement, rewards, alice, bob } = await loadFixture(bareToken);

      await (await token.connect(settlement).settlementIssue(1_000n * ONE, 0)).wait();
      await (await token.connect(rewards).releaseLocked(alice.address, 300n * ONE)).wait();
      await (await token.connect(rewards).transfer(alice.address, 200n * ONE)).wait();

      const liquidBefore = await token.liquidBalanceOf(alice.address);
      await (await token.connect(alice).burn(300n * ONE)).wait();
      expect(await token.liquidBalanceOf(alice.address)).to.equal(liquidBefore);

      await expect(
        token.connect(alice).transfer(bob.address, liquidBefore + 1n)
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });

    it("releases locked balance only on behalf of the rewards contract", async () => {
      const { token, settlement, alice } = await loadFixture(bareToken);
      await (await token.connect(settlement).settlementIssue(1_000n * ONE, 0)).wait();
      await expect(
        token.connect(alice).releaseLocked(alice.address, 1n)
      ).to.be.revertedWithCustomError(token, "NotRewards");
    });
  });

  describe("fee burning", () => {
    it("lets a registered fee sink burn only within the holder's allowance", async () => {
      const { token, settlement, rewards, feeBurner, alice } = await loadFixture(bareToken);

      await (await token.connect(settlement).settlementIssue(1_000n * ONE, 0)).wait();
      await (await token.connect(rewards).releaseLocked(alice.address, 500n * ONE)).wait();
      await (await token.connect(alice).approve(feeBurner.address, 50n * ONE)).wait();

      await expect(
        token.connect(feeBurner).burnFrom(alice.address, 51n * ONE)
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");

      await (await token.connect(feeBurner).burnFrom(alice.address, 50n * ONE)).wait();
      expect(await token.lockedBalanceOf(alice.address)).to.equal(450n * ONE);
    });

    it("refuses a fee burn from an address without the fee burner role", async () => {
      const { token, settlement, rewards, alice, bob } = await loadFixture(bareToken);

      await (await token.connect(settlement).settlementIssue(1_000n * ONE, 0)).wait();
      await (await token.connect(rewards).releaseLocked(alice.address, 500n * ONE)).wait();
      await (await token.connect(alice).approve(bob.address, 500n * ONE)).wait();

      await expect(
        token.connect(bob).burnFrom(alice.address, 1n)
      ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    });
  });

  describe("bootstrap wiring", () => {
    it("permanently freezes the wiring and discards the bootstrapper", async () => {
      const { token, deployer, settlement, rewards } = await loadFixture(bareToken);

      expect(await token.bootstrapFrozen()).to.equal(true);
      expect(await token.bootstrapper()).to.equal(ethers.ZeroAddress);

      await expect(
        token.connect(deployer).configureCore(settlement.address, rewards.address, [])
      ).to.be.revertedWithCustomError(token, "NotBootstrapper");
      await expect(token.connect(deployer).finalizeBootstrap()).to.be.revertedWithCustomError(
        token,
        "NotBootstrapper"
      );
    });

    it("refuses a second wiring even before it is frozen", async () => {
      const { token, deployer, settlement, rewards, alice } = await loadFixture(unwiredToken);

      await (await token.configureCore(settlement.address, rewards.address, [])).wait();
      await expect(
        token.connect(deployer).configureCore(alice.address, alice.address, [])
      ).to.be.revertedWithCustomError(token, "BootstrapAlreadyConfigured");
    });

    it("refuses to freeze an incomplete wiring", async () => {
      const { token } = await loadFixture(unwiredToken);
      await expect(token.finalizeBootstrap()).to.be.revertedWithCustomError(
        token,
        "BootstrapIncomplete"
      );
    });

    it("refuses wiring from anybody but the bootstrapper", async () => {
      const { token, settlement, rewards, alice } = await loadFixture(unwiredToken);
      await expect(
        token.connect(alice).configureCore(settlement.address, rewards.address, [])
      ).to.be.revertedWithCustomError(token, "NotBootstrapper");
    });
  });
});
