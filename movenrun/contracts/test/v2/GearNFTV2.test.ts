import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { deployV2, V2Fixture, mintMoveTo } from "./helpers";

describe("GearNFTV2", function () {
  let f: V2Fixture;
  let admin: SignerWithAddress;
  let oracle: SignerWithAddress;
  let treasury: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  const ONE = ethers.parseEther("1");

  beforeEach(async function () {
    [admin, oracle, treasury, alice, bob] = await ethers.getSigners();
    f = await deployV2(admin, oracle, treasury);
    await mintMoveTo(f, alice.address, 10_000n); // 100 MOVE for gear purchases
    await f.moveToken.connect(alice).approve(await f.gearNFT.getAddress(), ethers.MaxUint256);
  });

  async function addGear(bps: number, slot = 0, cost = ONE): Promise<bigint> {
    const id = await f.gearNFT.nextGearId();
    await f.gearNFT.addGearType(`Gear ${id}`, slot, bps, cost);
    return id;
  }

  describe("addGearType bounds", function () {
    it("rejects multiplier below 10000 bps", async function () {
      await expect(
        f.gearNFT.addGearType("Weak", 0, 9_999, ONE)
      ).to.be.revertedWith("GearNFTV2: multiplier out of bounds");
    });

    it("rejects multiplier above 30000 bps", async function () {
      await expect(
        f.gearNFT.addGearType("OP", 0, 30_001, ONE)
      ).to.be.revertedWith("GearNFTV2: multiplier out of bounds");
    });

    it("accepts the boundary values", async function () {
      await f.gearNFT.addGearType("Min", 0, 10_000, ONE);
      await f.gearNFT.addGearType("Max", 1, 30_000, ONE);
    });

    it("only GEAR_ADMIN_ROLE can add gear types", async function () {
      await expect(f.gearNFT.connect(alice).addGearType("X", 0, 15_000, ONE)).to.be.reverted;
    });
  });

  describe("equip / unequip", function () {
    it("cannot equip gear that is not owned", async function () {
      const id = await addGear(15_000);
      await expect(f.gearNFT.connect(alice).equipGear(id)).to.be.revertedWith(
        "GearNFTV2: not owned"
      );
    });

    it("cannot equip an inactive gear type", async function () {
      const id = await addGear(15_000);
      await f.gearNFT.connect(alice).mintGear(id, 1);
      await f.gearNFT.setGearActive(id, false);
      await expect(f.gearNFT.connect(alice).equipGear(id)).to.be.revertedWith(
        "GearNFTV2: gear type not active"
      );
    });

    it("explicit unequip clears the slot", async function () {
      const id = await addGear(15_000);
      await f.gearNFT.connect(alice).mintGear(id, 1);
      await f.gearNFT.connect(alice).equipGear(id);
      expect(await f.gearNFT.getUserMultiplier(alice.address)).to.equal(
        ethers.parseEther("1.5")
      );
      await f.gearNFT.connect(alice).unequipGear(0);
      expect(await f.gearNFT.getUserMultiplier(alice.address)).to.equal(ONE);
    });

    it("unequip on an empty slot reverts", async function () {
      await expect(f.gearNFT.connect(alice).unequipGear(0)).to.be.revertedWith(
        "GearNFTV2: slot empty"
      );
    });
  });

  describe("getUserMultiplier live-ownership rules", function () {
    it("multiplies across slots and starts at 1e18", async function () {
      expect(await f.gearNFT.getUserMultiplier(alice.address)).to.equal(ONE);
      const shoes = await addGear(15_000, 0); // 1.5x
      const watch = await addGear(12_000, 2); // 1.2x
      await f.gearNFT.connect(alice).mintGear(shoes, 1);
      await f.gearNFT.connect(alice).mintGear(watch, 1);
      await f.gearNFT.connect(alice).equipGear(shoes);
      await f.gearNFT.connect(alice).equipGear(watch);
      expect(await f.gearNFT.getUserMultiplier(alice.address)).to.equal(
        ethers.parseEther("1.8") // 1.5 * 1.2
      );
    });

    it("transferring away the last copy immediately removes its effect", async function () {
      const id = await addGear(20_000);
      await f.gearNFT.connect(alice).mintGear(id, 1);
      await f.gearNFT.connect(alice).equipGear(id);
      await f.gearNFT.connect(alice).safeTransferFrom(alice.address, bob.address, id, 1, "0x");
      expect(await f.gearNFT.getUserMultiplier(alice.address)).to.equal(ONE);
    });

    it("keeps the effect while at least one copy remains", async function () {
      const id = await addGear(20_000);
      await f.gearNFT.connect(alice).mintGear(id, 2);
      await f.gearNFT.connect(alice).equipGear(id);
      await f.gearNFT.connect(alice).safeTransferFrom(alice.address, bob.address, id, 1, "0x");
      expect(await f.gearNFT.getUserMultiplier(alice.address)).to.equal(
        ethers.parseEther("2")
      );
    });

    it("burning the last copy removes its effect", async function () {
      const id = await addGear(20_000);
      await f.gearNFT.connect(alice).mintGear(id, 1);
      await f.gearNFT.connect(alice).equipGear(id);
      await f.gearNFT.connect(alice).burn(alice.address, id, 1);
      expect(await f.gearNFT.getUserMultiplier(alice.address)).to.equal(ONE);
    });

    it("gear deactivated after equipping contributes nothing", async function () {
      const id = await addGear(20_000);
      await f.gearNFT.connect(alice).mintGear(id, 1);
      await f.gearNFT.connect(alice).equipGear(id);
      await f.gearNFT.setGearActive(id, false);
      expect(await f.gearNFT.getUserMultiplier(alice.address)).to.equal(ONE);
      await f.gearNFT.setGearActive(id, true);
      expect(await f.gearNFT.getUserMultiplier(alice.address)).to.equal(
        ethers.parseEther("2")
      );
    });

    it("caps the combined multiplier at 3x", async function () {
      // 3x in each of the four slots would be 81x uncapped.
      for (let slot = 0; slot < 4; slot++) {
        const id = await addGear(30_000, slot);
        await f.gearNFT.connect(alice).mintGear(id, 1);
        await f.gearNFT.connect(alice).equipGear(id);
      }
      expect(await f.gearNFT.getUserMultiplier(alice.address)).to.equal(
        ethers.parseEther("3")
      );
    });
  });

  describe("mintGear", function () {
    it("burns the $MOVE cost", async function () {
      const id = await addGear(15_000, 0, ethers.parseEther("5"));
      const before = await f.moveToken.balanceOf(alice.address);
      const supplyBefore = await f.moveToken.totalSupply();
      await f.gearNFT.connect(alice).mintGear(id, 2);
      expect(before - (await f.moveToken.balanceOf(alice.address))).to.equal(
        ethers.parseEther("10")
      );
      expect(supplyBefore - (await f.moveToken.totalSupply())).to.equal(
        ethers.parseEther("10")
      );
    });

    it("cannot mint an inactive gear type", async function () {
      const id = await addGear(15_000);
      await f.gearNFT.setGearActive(id, false);
      await expect(f.gearNFT.connect(alice).mintGear(id, 1)).to.be.revertedWith(
        "GearNFTV2: gear type not active"
      );
    });
  });
});
