import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  deployV2,
  V2Fixture,
  farDeadline,
  v2Domain,
  ROUTE_PROOF_TYPES,
} from "./helpers";

describe("GPSOracleV2", function () {
  let f: V2Fixture;
  let admin: SignerWithAddress;
  let oracle: SignerWithAddress;
  let treasury: SignerWithAddress;
  let alice: SignerWithAddress;
  let mallory: SignerWithAddress;

  beforeEach(async function () {
    [admin, oracle, treasury, alice, mallory] = await ethers.getSigners();
    f = await deployV2(admin, oracle, treasury);
  });

  async function buildRouteSig(overrides: Partial<{
    signer: SignerWithAddress;
    chainId: bigint;
    verifyingContract: string;
    recipient: string;
    routeHash: string;
    distanceMeters: bigint;
    hexId: bigint;
    deadline: bigint;
  }> = {}) {
    const deadline = overrides.deadline ?? (await farDeadline());
    const routeHash = overrides.routeHash ?? ethers.hexlify(ethers.randomBytes(32));
    const value = {
      recipient: overrides.recipient ?? alice.address,
      routeHash,
      distanceMeters: overrides.distanceMeters ?? 1_000n,
      hexId: overrides.hexId ?? 0n,
      deadline,
    };
    const sig = await (overrides.signer ?? oracle).signTypedData(
      v2Domain(
        overrides.chainId ?? f.chainId,
        overrides.verifyingContract ?? (await f.gpsOracle.getAddress())
      ),
      ROUTE_PROOF_TYPES,
      value
    );
    return { ...value, sig };
  }

  it("accepts a valid typed route proof and mints", async function () {
    const p = await buildRouteSig();
    await f.gpsOracle.submitRoute(p.recipient, p.routeHash, p.distanceMeters, p.hexId, p.deadline, p.sig);
    expect(await f.moveToken.balanceOf(alice.address)).to.equal(ethers.parseEther("10"));
  });

  it("rejects wrong chain", async function () {
    const p = await buildRouteSig({ chainId: f.chainId + 1n });
    await expect(
      f.gpsOracle.submitRoute(p.recipient, p.routeHash, p.distanceMeters, p.hexId, p.deadline, p.sig)
    ).to.be.revertedWith("GPSOracleV2: invalid sig");
  });

  it("rejects a signature bound to a different contract", async function () {
    const p = await buildRouteSig({ verifyingContract: await f.zoneNFT.getAddress() });
    await expect(
      f.gpsOracle.submitRoute(p.recipient, p.routeHash, p.distanceMeters, p.hexId, p.deadline, p.sig)
    ).to.be.revertedWith("GPSOracleV2: invalid sig");
  });

  it("rejects a signature from another V2 oracle deployment (same chain)", async function () {
    const other = await (await ethers.getContractFactory("GPSOracleV2", admin)).deploy(oracle.address);
    await other.waitForDeployment();
    const p = await buildRouteSig({ verifyingContract: await other.getAddress() });
    await expect(
      f.gpsOracle.submitRoute(p.recipient, p.routeHash, p.distanceMeters, p.hexId, p.deadline, p.sig)
    ).to.be.revertedWith("GPSOracleV2: invalid sig");
  });

  it("rejects tampered fields (recipient, distance, hexId)", async function () {
    const p = await buildRouteSig();
    await expect(
      f.gpsOracle.submitRoute(mallory.address, p.routeHash, p.distanceMeters, p.hexId, p.deadline, p.sig)
    ).to.be.revertedWith("GPSOracleV2: invalid sig");
    await expect(
      f.gpsOracle.submitRoute(p.recipient, p.routeHash, p.distanceMeters + 1n, p.hexId, p.deadline, p.sig)
    ).to.be.revertedWith("GPSOracleV2: invalid sig");
    await expect(
      f.gpsOracle.submitRoute(p.recipient, p.routeHash, p.distanceMeters, 7n, p.deadline, p.sig)
    ).to.be.revertedWith("GPSOracleV2: invalid sig");
  });

  it("rejects an expired deadline", async function () {
    const past = BigInt(await time.latest()) - 1n;
    const p = await buildRouteSig({ deadline: past });
    await expect(
      f.gpsOracle.submitRoute(p.recipient, p.routeHash, p.distanceMeters, p.hexId, past, p.sig)
    ).to.be.revertedWith("GPSOracleV2: signature expired");
  });

  it("rejects a non-operator signer", async function () {
    const p = await buildRouteSig({ signer: mallory });
    await expect(
      f.gpsOracle.submitRoute(p.recipient, p.routeHash, p.distanceMeters, p.hexId, p.deadline, p.sig)
    ).to.be.revertedWith("GPSOracleV2: invalid sig");
  });

  it("rejects a V1-style personal-sign route tuple", async function () {
    const routeHash = ethers.hexlify(ethers.randomBytes(32));
    const v1Hash = ethers.solidityPackedKeccak256(
      ["uint256", "address", "bytes32", "uint256", "uint64"],
      [f.chainId, alice.address, routeHash, 1_000n, 0n]
    );
    const v1Sig = await oracle.signMessage(ethers.getBytes(v1Hash));
    const deadline = await farDeadline();
    await expect(
      f.gpsOracle.submitRoute(alice.address, routeHash, 1_000n, 0n, deadline, v1Sig)
    ).to.be.revertedWith("GPSOracleV2: invalid sig");
  });

  it("only admin can rotate the operator or set the token", async function () {
    await expect(f.gpsOracle.connect(alice).updateOperator(mallory.address)).to.be.reverted;
    await expect(f.gpsOracle.connect(alice).setMoveToken(mallory.address)).to.be.reverted;
    await f.gpsOracle.updateOperator(mallory.address);
    // Old operator's signatures stop working immediately.
    const p = await buildRouteSig();
    await expect(
      f.gpsOracle.submitRoute(p.recipient, p.routeHash, p.distanceMeters, p.hexId, p.deadline, p.sig)
    ).to.be.revertedWith("GPSOracleV2: invalid sig");
  });
});
