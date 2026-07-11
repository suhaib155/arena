import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  deployV2,
  V2Fixture,
  mintMoveTo,
  signRouteProof,
  farDeadline,
} from "./helpers";

describe("MoveTokenV2", function () {
  let f: V2Fixture;
  let admin: SignerWithAddress;
  let oracle: SignerWithAddress;
  let treasury: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  beforeEach(async function () {
    [admin, oracle, treasury, alice, bob] = await ethers.getSigners();
    f = await deployV2(admin, oracle, treasury);
  });

  describe("deployment", function () {
    it("has correct name/symbol and zero supply", async function () {
      expect(await f.moveToken.name()).to.equal("MoveToken");
      expect(await f.moveToken.symbol()).to.equal("$MOVE");
      expect(await f.moveToken.totalSupply()).to.equal(0n);
    });
  });

  describe("timestamp voting clock (ERC-6372)", function () {
    it("clock() returns the block timestamp", async function () {
      const block = await ethers.provider.getBlock("latest");
      expect(await f.moveToken.clock()).to.equal(BigInt(block!.timestamp));
    });

    it("CLOCK_MODE() reports timestamp mode", async function () {
      expect(await f.moveToken.CLOCK_MODE()).to.equal("mode=timestamp");
    });

    it("vote snapshots are keyed by timestamp", async function () {
      await mintMoveTo(f, alice.address, 10_000n); // 100 MOVE
      await f.moveToken.connect(alice).delegate(alice.address);
      const t1 = await time.latest();
      await time.increase(100);
      // mine one more block so t1 is strictly in the past for getPastVotes
      await mintMoveTo(f, bob.address, 1_000n);
      expect(await f.moveToken.getPastVotes(alice.address, t1)).to.equal(
        ethers.parseEther("100")
      );
    });
  });

  describe("mintMOVE via GPSOracleV2", function () {
    it("mints 10 MOVE per km at the initial rate", async function () {
      await mintMoveTo(f, alice.address, 5_000n);
      expect(await f.moveToken.balanceOf(alice.address)).to.equal(ethers.parseEther("50"));
    });

    it("rejects direct calls without ORACLE_ROLE", async function () {
      await expect(
        f.moveToken.connect(alice).mintMOVE(alice.address, ethers.ZeroHash, 1000n, 0n)
      ).to.be.reverted;
    });

    it("rejects route replay (same routeHash)", async function () {
      const routeHash = ethers.hexlify(ethers.randomBytes(32));
      const deadline = await farDeadline();
      const value = { recipient: alice.address, routeHash, distanceMeters: 1_000n, hexId: 0n, deadline };
      const sig = await signRouteProof(oracle, f.chainId, await f.gpsOracle.getAddress(), value);
      await f.gpsOracle.submitRoute(alice.address, routeHash, 1_000n, 0n, deadline, sig);
      await expect(
        f.gpsOracle.submitRoute(alice.address, routeHash, 1_000n, 0n, deadline, sig)
      ).to.be.revertedWith("MoveTokenV2: route already used");
    });

    it("rejects distances above 100km", async function () {
      const routeHash = ethers.hexlify(ethers.randomBytes(32));
      const deadline = await farDeadline();
      const sig = await signRouteProof(oracle, f.chainId, await f.gpsOracle.getAddress(), {
        recipient: alice.address, routeHash, distanceMeters: 100_001n, hexId: 0n, deadline,
      });
      await expect(
        f.gpsOracle.submitRoute(alice.address, routeHash, 100_001n, 0n, deadline, sig)
      ).to.be.revertedWith("MoveTokenV2: distance too large");
    });

    it("enforces the daily cap", async function () {
      await mintMoveTo(f, alice.address, 100_000n); // 1000 MOVE requested → capped at 200
      expect(await f.moveToken.balanceOf(alice.address)).to.equal(ethers.parseEther("200"));
      await expect(mintMoveTo(f, alice.address, 1_000n)).to.be.revertedWith(
        "MoveTokenV2: daily cap reached"
      );
    });
  });

  describe("season mint pause (direct enforcement)", function () {
    it("only SEASON_ROLE can pause", async function () {
      await expect(f.moveToken.connect(alice).setMintingPaused(true)).to.be.reverted;
    });

    it("route minting reverts while paused and resumes after unpause", async function () {
      const SEASON_ROLE = ethers.id("SEASON_ROLE");
      await f.moveToken.grantRole(SEASON_ROLE, admin.address);
      await f.moveToken.setMintingPaused(true);
      await expect(mintMoveTo(f, alice.address, 1_000n)).to.be.revertedWith(
        "MoveTokenV2: minting paused"
      );
      await f.moveToken.setMintingPaused(false);
      await mintMoveTo(f, alice.address, 1_000n);
      expect(await f.moveToken.balanceOf(alice.address)).to.equal(ethers.parseEther("10"));
    });
  });

  describe("gear multiplier integration (single source of truth)", function () {
    it("has no independently mutable per-user multiplier setter", async function () {
      expect((f.moveToken as any).setGearMultiplier).to.equal(undefined);
      expect((f.moveToken as any).gearMultiplier).to.equal(undefined);
    });

    it("reads the multiplier live from GearNFTV2 at mint time", async function () {
      // 1.5x shoes
      await f.gearNFT.addGearType("Speed Shoes", 0, 15_000, ethers.parseEther("1"));
      await mintMoveTo(f, alice.address, 1_000n); // 10 MOVE to buy gear
      await f.moveToken.connect(alice).approve(await f.gearNFT.getAddress(), ethers.MaxUint256);
      await f.gearNFT.connect(alice).mintGear(1, 1);
      await f.gearNFT.connect(alice).equipGear(1);

      const before = await f.moveToken.balanceOf(alice.address);
      await mintMoveTo(f, alice.address, 1_000n); // 10 MOVE * 1.5 = 15
      expect((await f.moveToken.balanceOf(alice.address)) - before).to.equal(
        ethers.parseEther("15")
      );
    });

    it("transferring away the equipped gear removes its effect at the next mint", async function () {
      await f.gearNFT.addGearType("Speed Shoes", 0, 20_000, ethers.parseEther("1"));
      await mintMoveTo(f, alice.address, 1_000n);
      await f.moveToken.connect(alice).approve(await f.gearNFT.getAddress(), ethers.MaxUint256);
      await f.gearNFT.connect(alice).mintGear(1, 1);
      await f.gearNFT.connect(alice).equipGear(1);
      await f.gearNFT.connect(alice).safeTransferFrom(alice.address, bob.address, 1, 1, "0x");

      const before = await f.moveToken.balanceOf(alice.address);
      await mintMoveTo(f, alice.address, 1_000n); // back to 1.0x
      expect((await f.moveToken.balanceOf(alice.address)) - before).to.equal(
        ethers.parseEther("10")
      );
    });

    it("mints at 1.0x when no gear contract interaction applies", async function () {
      await mintMoveTo(f, bob.address, 2_000n);
      expect(await f.moveToken.balanceOf(bob.address)).to.equal(ethers.parseEther("20"));
    });
  });

  describe("zone tax", function () {
    it("credits 2% of zone-route earnings to the zone via pull payment", async function () {
      const HEX_ID = 613177413693333503n;
      await mintMoveTo(f, alice.address, 20_000n);
      const { mintZoneTo } = await import("./helpers");
      await mintZoneTo(f, alice, HEX_ID, ethers.parseEther("100"));

      const zoneAddr = await f.zoneNFT.getAddress();
      const zoneBalBefore = await f.moveToken.balanceOf(zoneAddr);
      await time.increase(24 * 3600 + 1); // reset alice's daily cap
      await mintMoveTo(f, bob.address, 10_000n, HEX_ID); // 100 MOVE, 2 MOVE tax
      expect((await f.moveToken.balanceOf(zoneAddr)) - zoneBalBefore).to.equal(
        ethers.parseEther("2")
      );
      expect(await f.zoneNFT.accumulatedYield(HEX_ID)).to.equal(ethers.parseEther("2"));
    });
  });

  describe("burning", function () {
    it("burnMOVE reduces supply and tracks weeklyBurn", async function () {
      await mintMoveTo(f, alice.address, 10_000n);
      const supplyBefore = await f.moveToken.totalSupply();
      await f.moveToken.connect(alice).burnMOVE(ethers.parseEther("10"));
      expect(await f.moveToken.totalSupply()).to.equal(supplyBefore - ethers.parseEther("10"));
      expect(await f.moveToken.weeklyBurn()).to.equal(ethers.parseEther("10"));
    });

    it("burnFrom requires allowance", async function () {
      await mintMoveTo(f, alice.address, 10_000n);
      await expect(
        f.moveToken.connect(bob).burnFrom(alice.address, 1n)
      ).to.be.reverted;
    });
  });
});
