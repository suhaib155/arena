/**
 * DeedRegistry — the security matrix.
 *
 * The registry makes four promises, and every test below is one of them:
 *
 *   1. a cell can be claimed exactly once, ever;
 *   2. an authorization works only for the person, cell and window it names,
 *      and only once;
 *   3. a deed is ordinary property — transferable, and never destroyable or
 *      seizable by any role;
 *   4. claiming needs no token, balance, allowance or burn.
 */
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import type { HDNodeWallet, Signer } from "ethers";

const BASE_URI = "https://metadata.movenrun.example/deed/";
/** A plausible H3 resolution-8 cell id (64-bit). */
const CELL_A = 613196570331971583n;
const CELL_B = 613196570331971584n;

const HOUR = 60 * 60;

async function fixture() {
  const [deployer, admin, claimant, other, recipient] = await ethers.getSigners();
  // The oracle is a standalone key, never one of the privileged accounts.
  const oracle = ethers.Wallet.createRandom().connect(ethers.provider);

  const Registry = await ethers.getContractFactory("DeedRegistry");
  const registry = await Registry.deploy(
    await admin.getAddress(),
    await oracle.getAddress(),
    BASE_URI,
  );
  await registry.waitForDeployment();

  return { registry, deployer, admin, claimant, other, recipient, oracle };
}

interface ClaimFields {
  cellId: bigint;
  claimant: string;
  claimId: string;
  deadline: number;
}

async function signClaim(
  registry: any,
  signer: HDNodeWallet | Signer,
  fields: ClaimFields,
): Promise<string> {
  const domain = {
    name: "MovenRunDeedRegistry",
    version: "1",
    chainId: (await ethers.provider.getNetwork()).chainId,
    verifyingContract: await registry.getAddress(),
  };
  const types = {
    DeedClaim: [
      { name: "cellId", type: "uint64" },
      { name: "claimant", type: "address" },
      { name: "claimId", type: "bytes32" },
      { name: "deadline", type: "uint256" },
    ],
  };
  return (signer as any).signTypedData(domain, types, fields);
}

async function futureDeadline(): Promise<number> {
  return (await time.latest()) + HOUR;
}

const claimIdOf = (label: string) => ethers.id(label);

/* ══ 1. a valid claim ═════════════════════════════════════════════════════ */

describe("DeedRegistry — valid claim", () => {
  it("mints exactly one deed to the signed claimant", async () => {
    const { registry, claimant, oracle } = await loadFixture(fixture);
    const deadline = await futureDeadline();
    const claimId = claimIdOf("claim-1");
    const sig = await signClaim(registry, oracle, {
      cellId: CELL_A,
      claimant: await claimant.getAddress(),
      claimId,
      deadline,
    });

    await expect(registry.connect(claimant).claim(CELL_A, claimId, deadline, sig))
      .to.emit(registry, "DeedClaimed")
      .withArgs(CELL_A, CELL_A, await claimant.getAddress(), claimId);

    expect(await registry.totalSupply()).to.equal(1n);
    expect(await registry.ownerOf(CELL_A)).to.equal(await claimant.getAddress());
    expect(await registry.balanceOf(await claimant.getAddress())).to.equal(1n);
  });

  it("maps cell to token and token back to cell losslessly", async () => {
    const { registry } = await loadFixture(fixture);
    expect(await registry.tokenIdForCell(CELL_A)).to.equal(CELL_A);
    expect(await registry.cellIdForToken(CELL_A)).to.equal(CELL_A);
    // The widening is the identity function, so it round-trips at the extremes.
    const MAX_U64 = (1n << 64n) - 1n;
    expect(await registry.cellIdForToken(await registry.tokenIdForCell(MAX_U64))).to.equal(MAX_U64);
    expect(await registry.cellIdForToken(0)).to.equal(0n);
  });

  it("rejects a token id that no cell could produce", async () => {
    const { registry } = await loadFixture(fixture);
    await expect(registry.cellIdForToken(1n << 64n)).to.be.revertedWith(
      "DeedRegistry: token id out of cell range",
    );
  });

  it("reports cell occupancy and holder", async () => {
    const { registry, claimant, oracle } = await loadFixture(fixture);
    expect(await registry.isCellClaimed(CELL_A)).to.equal(false);
    expect(await registry.deedHolder(CELL_A)).to.equal(ethers.ZeroAddress);

    const deadline = await futureDeadline();
    const claimId = claimIdOf("occupancy");
    const sig = await signClaim(registry, oracle, {
      cellId: CELL_A, claimant: await claimant.getAddress(), claimId, deadline,
    });
    await registry.connect(claimant).claim(CELL_A, claimId, deadline, sig);

    expect(await registry.isCellClaimed(CELL_A)).to.equal(true);
    expect(await registry.deedHolder(CELL_A)).to.equal(await claimant.getAddress());
  });

  it("declares the H3 resolution its cell ids are issued at", async () => {
    const { registry } = await loadFixture(fixture);
    // Matches shared/src/constants/h3.ts. Recorded, not validated — the
    // contract cannot check H3 geometry and does not pretend to.
    expect(await registry.H3_RESOLUTION()).to.equal(8);
  });
});

/* ══ 2. uniqueness ════════════════════════════════════════════════════════ */

describe("DeedRegistry — one deed per cell", () => {
  it("refuses a second claim for the same cell, by anyone", async () => {
    const { registry, claimant, other, oracle } = await loadFixture(fixture);
    const deadline = await futureDeadline();

    const first = claimIdOf("first");
    await registry.connect(claimant).claim(
      CELL_A, first, deadline,
      await signClaim(registry, oracle, {
        cellId: CELL_A, claimant: await claimant.getAddress(), claimId: first, deadline,
      }),
    );

    // A different person, a fresh claim id, a valid oracle signature — and it
    // still cannot happen, because the cell is taken.
    const second = claimIdOf("second");
    const sig = await signClaim(registry, oracle, {
      cellId: CELL_A, claimant: await other.getAddress(), claimId: second, deadline,
    });
    await expect(registry.connect(other).claim(CELL_A, second, deadline, sig))
      .to.be.revertedWithCustomError(registry, "CellAlreadyClaimed")
      .withArgs(CELL_A);

    expect(await registry.totalSupply()).to.equal(1n);
  });

  it("keeps the cell singular after the deed changes hands", async () => {
    const { registry, claimant, other, recipient, oracle } = await loadFixture(fixture);
    const deadline = await futureDeadline();
    const claimId = claimIdOf("transfer-then-reclaim");
    await registry.connect(claimant).claim(
      CELL_A, claimId, deadline,
      await signClaim(registry, oracle, {
        cellId: CELL_A, claimant: await claimant.getAddress(), claimId, deadline,
      }),
    );

    await registry.connect(claimant).transferFrom(
      await claimant.getAddress(), await recipient.getAddress(), CELL_A,
    );

    const retry = claimIdOf("after-transfer");
    const sig = await signClaim(registry, oracle, {
      cellId: CELL_A, claimant: await other.getAddress(), claimId: retry, deadline,
    });
    await expect(registry.connect(other).claim(CELL_A, retry, deadline, sig))
      .to.be.revertedWithCustomError(registry, "CellAlreadyClaimed");

    expect(await registry.totalSupply()).to.equal(1n);
    expect(await registry.ownerOf(CELL_A)).to.equal(await recipient.getAddress());
  });

  it("lets distinct cells be claimed independently", async () => {
    const { registry, claimant, other, oracle } = await loadFixture(fixture);
    const deadline = await futureDeadline();
    for (const [cell, who, label] of [
      [CELL_A, claimant, "a"],
      [CELL_B, other, "b"],
    ] as const) {
      const claimId = claimIdOf(label);
      await registry.connect(who).claim(
        cell, claimId, deadline,
        await signClaim(registry, oracle, {
          cellId: cell, claimant: await who.getAddress(), claimId, deadline,
        }),
      );
    }
    expect(await registry.totalSupply()).to.equal(2n);
  });
});

/* ══ 3. authorization ═════════════════════════════════════════════════════ */

describe("DeedRegistry — oracle authorization", () => {
  it("refuses a replay of the exact same authorization", async () => {
    const { registry, claimant, oracle } = await loadFixture(fixture);
    const deadline = await futureDeadline();
    const claimId = claimIdOf("replay");
    const sig = await signClaim(registry, oracle, {
      cellId: CELL_A, claimant: await claimant.getAddress(), claimId, deadline,
    });

    await registry.connect(claimant).claim(CELL_A, claimId, deadline, sig);
    // Same bytes, same everything. The cell check would also catch this, so
    // aim the replay at a DIFFERENT cell to isolate the claim-id defence.
    const sigB = await signClaim(registry, oracle, {
      cellId: CELL_B, claimant: await claimant.getAddress(), claimId, deadline,
    });
    await expect(registry.connect(claimant).claim(CELL_B, claimId, deadline, sigB))
      .to.be.revertedWithCustomError(registry, "ClaimIdAlreadyUsed")
      .withArgs(claimId);
  });

  it("marks a claim id used and exposes it", async () => {
    const { registry, claimant, oracle } = await loadFixture(fixture);
    const deadline = await futureDeadline();
    const claimId = claimIdOf("used-flag");
    expect(await registry.claimIdUsed(claimId)).to.equal(false);
    await registry.connect(claimant).claim(
      CELL_A, claimId, deadline,
      await signClaim(registry, oracle, {
        cellId: CELL_A, claimant: await claimant.getAddress(), claimId, deadline,
      }),
    );
    expect(await registry.claimIdUsed(claimId)).to.equal(true);
  });

  it("refuses an expired authorization", async () => {
    const { registry, claimant, oracle } = await loadFixture(fixture);
    const deadline = (await time.latest()) + HOUR;
    const claimId = claimIdOf("expired");
    const sig = await signClaim(registry, oracle, {
      cellId: CELL_A, claimant: await claimant.getAddress(), claimId, deadline,
    });
    await time.increaseTo(deadline + 1);

    await expect(registry.connect(claimant).claim(CELL_A, claimId, deadline, sig))
      .to.be.revertedWithCustomError(registry, "AuthorizationExpired")
      .withArgs(deadline);
  });

  it("refuses an authorization presented by anyone but its named claimant", async () => {
    const { registry, claimant, other, oracle } = await loadFixture(fixture);
    const deadline = await futureDeadline();
    const claimId = claimIdOf("wrong-claimant");
    // Signed for `claimant`; `other` tries to front-run it.
    const sig = await signClaim(registry, oracle, {
      cellId: CELL_A, claimant: await claimant.getAddress(), claimId, deadline,
    });
    await expect(
      registry.connect(other).claim(CELL_A, claimId, deadline, sig),
    ).to.be.revertedWithCustomError(registry, "NotOracleSignature");
  });

  it("refuses an authorization pointed at a different cell", async () => {
    const { registry, claimant, oracle } = await loadFixture(fixture);
    const deadline = await futureDeadline();
    const claimId = claimIdOf("wrong-cell");
    const sig = await signClaim(registry, oracle, {
      cellId: CELL_A, claimant: await claimant.getAddress(), claimId, deadline,
    });
    await expect(
      registry.connect(claimant).claim(CELL_B, claimId, deadline, sig),
    ).to.be.revertedWithCustomError(registry, "NotOracleSignature");
  });

  it("refuses a deadline other than the signed one", async () => {
    const { registry, claimant, oracle } = await loadFixture(fixture);
    const deadline = await futureDeadline();
    const claimId = claimIdOf("wrong-deadline");
    const sig = await signClaim(registry, oracle, {
      cellId: CELL_A, claimant: await claimant.getAddress(), claimId, deadline,
    });
    await expect(
      registry.connect(claimant).claim(CELL_A, claimId, deadline + 1, sig),
    ).to.be.revertedWithCustomError(registry, "NotOracleSignature");
  });

  it("refuses a signature from a key that is not the oracle", async () => {
    const { registry, admin, claimant, deployer } = await loadFixture(fixture);
    const deadline = await futureDeadline();
    const claimId = claimIdOf("wrong-signer");
    const impostors = [admin, deployer, ethers.Wallet.createRandom()];
    for (const impostor of impostors) {
      const sig = await signClaim(registry, impostor as any, {
        cellId: CELL_A, claimant: await claimant.getAddress(), claimId, deadline,
      });
      await expect(
        registry.connect(claimant).claim(CELL_A, claimId, deadline, sig),
      ).to.be.revertedWithCustomError(registry, "NotOracleSignature");
    }
    // Not even the administrator may authorize a claim.
    expect(await registry.hasRole(await registry.ORACLE_SIGNER_ROLE(), await admin.getAddress()))
      .to.equal(false);
  });

  it("refuses a malformed signature rather than recovering a junk address", async () => {
    const { registry, claimant } = await loadFixture(fixture);
    const deadline = await futureDeadline();
    const claimId = claimIdOf("malformed");
    for (const bad of ["0x", "0x00", "0x" + "11".repeat(65), "0x" + "22".repeat(64)]) {
      await expect(registry.connect(claimant).claim(CELL_A, claimId, deadline, bad)).to.be.reverted;
    }
    expect(await registry.totalSupply()).to.equal(0n);
  });

  it("is bound to this chain and this deployment", async () => {
    const { registry, claimant, oracle } = await loadFixture(fixture);
    const deadline = await futureDeadline();
    const claimId = claimIdOf("wrong-domain");
    const net = await ethers.provider.getNetwork();

    // Right struct, wrong chain id.
    const wrongChain = await (oracle as any).signTypedData(
      {
        name: "MovenRunDeedRegistry",
        version: "1",
        chainId: net.chainId + 1n,
        verifyingContract: await registry.getAddress(),
      },
      {
        DeedClaim: [
          { name: "cellId", type: "uint64" },
          { name: "claimant", type: "address" },
          { name: "claimId", type: "bytes32" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { cellId: CELL_A, claimant: await claimant.getAddress(), claimId, deadline },
    );
    await expect(
      registry.connect(claimant).claim(CELL_A, claimId, deadline, wrongChain),
    ).to.be.revertedWithCustomError(registry, "NotOracleSignature");

    // Right struct, wrong verifying contract.
    const wrongContract = await (oracle as any).signTypedData(
      {
        name: "MovenRunDeedRegistry",
        version: "1",
        chainId: net.chainId,
        verifyingContract: ethers.ZeroAddress,
      },
      {
        DeedClaim: [
          { name: "cellId", type: "uint64" },
          { name: "claimant", type: "address" },
          { name: "claimId", type: "bytes32" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { cellId: CELL_A, claimant: await claimant.getAddress(), claimId, deadline },
    );
    await expect(
      registry.connect(claimant).claim(CELL_A, claimId, deadline, wrongContract),
    ).to.be.revertedWithCustomError(registry, "NotOracleSignature");
  });

  it("binds the claimant into the signed type itself", async () => {
    /* A direct assertion on the typehash, because the front-running test above
       does NOT isolate this. Remove `address claimant` from the struct and that
       test still passes — vacuously, since no signature validates any more.
       This one fails for the actual reason: the authorization would no longer
       name who it is for, and anyone watching the mempool could take it. */
    const { registry } = await loadFixture(fixture);
    expect(await registry.DEED_CLAIM_TYPEHASH()).to.equal(
      ethers.id("DeedClaim(uint64 cellId,address claimant,bytes32 claimId,uint256 deadline)"),
    );
  });

  it("exposes a domain separator an off-chain signer can cross-check", async () => {
    const { registry } = await loadFixture(fixture);
    const net = await ethers.provider.getNetwork();
    const expected = ethers.TypedDataEncoder.hashDomain({
      name: "MovenRunDeedRegistry",
      version: "1",
      chainId: net.chainId,
      verifyingContract: await registry.getAddress(),
    });
    expect(await registry.domainSeparator()).to.equal(expected);
  });

  it("cannot be minted twice by varying calldata the signature does not cover", async () => {
    /* Everything the caller supplies is inside the signed struct, so there is
       no free parameter left to wiggle. */
    const { registry, claimant, oracle } = await loadFixture(fixture);
    const deadline = await futureDeadline();
    const claimId = claimIdOf("no-wiggle");
    const sig = await signClaim(registry, oracle, {
      cellId: CELL_A, claimant: await claimant.getAddress(), claimId, deadline,
    });
    await registry.connect(claimant).claim(CELL_A, claimId, deadline, sig);

    for (const [cell, id, dl] of [
      [CELL_A, claimIdOf("variant"), deadline],
      [CELL_A, claimId, deadline + 5],
      [CELL_B, claimId, deadline],
    ] as const) {
      await expect(registry.connect(claimant).claim(cell, id, dl, sig)).to.be.reverted;
    }
    expect(await registry.totalSupply()).to.equal(1n);
  });
});

/* ══ 4. transferability and permanence ════════════════════════════════════ */

describe("DeedRegistry — the deed is ordinary property", () => {
  async function claimed() {
    const ctx = await loadFixture(fixture);
    const deadline = await futureDeadline();
    const claimId = claimIdOf("held");
    await ctx.registry.connect(ctx.claimant).claim(
      CELL_A, claimId, deadline,
      await signClaim(ctx.registry, ctx.oracle, {
        cellId: CELL_A, claimant: await ctx.claimant.getAddress(), claimId, deadline,
      }),
    );
    return ctx;
  }

  it("transfers by every standard ERC-721 path", async () => {
    const { registry, claimant, other, recipient } = await claimed();
    const owner = await claimant.getAddress();

    await registry.connect(claimant).transferFrom(owner, await other.getAddress(), CELL_A);
    expect(await registry.ownerOf(CELL_A)).to.equal(await other.getAddress());

    await registry.connect(other)["safeTransferFrom(address,address,uint256)"](
      await other.getAddress(), await recipient.getAddress(), CELL_A,
    );
    expect(await registry.ownerOf(CELL_A)).to.equal(await recipient.getAddress());

    // Approval path.
    await registry.connect(recipient).approve(await claimant.getAddress(), CELL_A);
    expect(await registry.getApproved(CELL_A)).to.equal(await claimant.getAddress());
    await registry.connect(claimant).transferFrom(
      await recipient.getAddress(), await claimant.getAddress(), CELL_A,
    );
    expect(await registry.ownerOf(CELL_A)).to.equal(owner);

    // Operator path.
    await registry.connect(claimant).setApprovalForAll(await other.getAddress(), true);
    await registry.connect(other).transferFrom(owner, await other.getAddress(), CELL_A);
    expect(await registry.ownerOf(CELL_A)).to.equal(await other.getAddress());
  });

  it("has no path that destroys or reclaims a deed", async () => {
    const { registry } = await claimed();
    const surface = registry.interface.fragments
      .filter((f: any) => f.type === "function")
      .map((f: any) => f.name);
    for (const forbidden of [
      "burn", "markDormant", "reclaimDormant", "reclaim", "seize",
      "adminMint", "mint", "adminTransfer", "resolveChallengeTransfer",
      "setChallengeLock", "forceTransfer",
    ]) {
      expect(surface, `${forbidden} must not exist on a permanent registry`)
        .to.not.include(forbidden);
    }
  });

  it("gives no role the power to move, mint or take a deed", async () => {
    const { registry, admin, oracle, claimant } = await claimed();
    const owner = await claimant.getAddress();

    // The admin has no transfer authority over someone else's deed.
    await expect(
      registry.connect(admin).transferFrom(owner, await admin.getAddress(), CELL_A),
    ).to.be.revertedWithCustomError(registry, "ERC721InsufficientApproval");

    // Nor does the oracle.
    await ethers.provider.send("hardhat_setBalance", [
      await oracle.getAddress(), "0x56BC75E2D63100000",
    ]);
    await expect(
      registry.connect(oracle).transferFrom(owner, await oracle.getAddress(), CELL_A),
    ).to.be.revertedWithCustomError(registry, "ERC721InsufficientApproval");

    expect(await registry.ownerOf(CELL_A)).to.equal(owner);
  });

  it("keeps transfers working while claims are paused", async () => {
    /* Pausing is about stopping a compromised signer from minting. It must
       never freeze property that has already been issued. */
    const { registry, admin, claimant, recipient, oracle, other } = await claimed();
    await registry.connect(admin).setClaimsPaused(true);

    await registry.connect(claimant).transferFrom(
      await claimant.getAddress(), await recipient.getAddress(), CELL_A,
    );
    expect(await registry.ownerOf(CELL_A)).to.equal(await recipient.getAddress());

    const deadline = await futureDeadline();
    const claimId = claimIdOf("while-paused");
    const sig = await signClaim(registry, oracle, {
      cellId: CELL_B, claimant: await other.getAddress(), claimId, deadline,
    });
    await expect(
      registry.connect(other).claim(CELL_B, claimId, deadline, sig),
    ).to.be.revertedWithCustomError(registry, "ClaimsArePaused");

    await registry.connect(admin).setClaimsPaused(false);
    await registry.connect(other).claim(CELL_B, claimId, deadline, sig);
    expect(await registry.totalSupply()).to.equal(2n);
  });
});

/* ══ 5. roles ═════════════════════════════════════════════════════════════ */

describe("DeedRegistry — admin and oracle are separate", () => {
  it("assigns each role to its own address and grants the deployer nothing", async () => {
    const { registry, admin, oracle, deployer } = await loadFixture(fixture);
    const ADMIN = await registry.DEFAULT_ADMIN_ROLE();
    const ORACLE = await registry.ORACLE_SIGNER_ROLE();

    expect(await registry.hasRole(ADMIN, await admin.getAddress())).to.equal(true);
    expect(await registry.hasRole(ORACLE, await oracle.getAddress())).to.equal(true);

    // Neither role bleeds into the other.
    expect(await registry.hasRole(ORACLE, await admin.getAddress())).to.equal(false);
    expect(await registry.hasRole(ADMIN, await oracle.getAddress())).to.equal(false);

    // And the EOA that ran the deployment keeps nothing.
    expect(await registry.hasRole(ADMIN, await deployer.getAddress())).to.equal(false);
    expect(await registry.hasRole(ORACLE, await deployer.getAddress())).to.equal(false);
  });

  it("refuses a deployment that would collapse the two roles into one key", async () => {
    const [, admin] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("DeedRegistry");
    await expect(
      Registry.deploy(await admin.getAddress(), await admin.getAddress(), BASE_URI),
    ).to.be.revertedWithCustomError(Registry, "AdminCannotBeOracle");
  });

  it("refuses a zero address for either role", async () => {
    const [, admin] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("DeedRegistry");
    await expect(
      Registry.deploy(ethers.ZeroAddress, await admin.getAddress(), BASE_URI),
    ).to.be.revertedWithCustomError(Registry, "ZeroAddress");
    await expect(
      Registry.deploy(await admin.getAddress(), ethers.ZeroAddress, BASE_URI),
    ).to.be.revertedWithCustomError(Registry, "ZeroAddress");
  });

  it("does not let the oracle reach any admin function", async () => {
    const { registry, oracle } = await loadFixture(fixture);
    await ethers.provider.send("hardhat_setBalance", [
      await oracle.getAddress(), "0x56BC75E2D63100000",
    ]);
    for (const call of [
      () => registry.connect(oracle).setBaseURI("https://evil.example/"),
      () => registry.connect(oracle).setClaimsPaused(true),
      () => registry.connect(oracle).grantRole(
        registry.ORACLE_SIGNER_ROLE(), ethers.Wallet.createRandom().address,
      ),
    ]) {
      await expect(call()).to.be.revertedWithCustomError(
        registry, "AccessControlUnauthorizedAccount",
      );
    }
  });

  it("lets the admin rotate the oracle signer without touching any deed", async () => {
    const { registry, admin, claimant, oracle } = await loadFixture(fixture);
    const ORACLE = await registry.ORACLE_SIGNER_ROLE();
    const replacement = ethers.Wallet.createRandom();

    await registry.connect(admin).revokeRole(ORACLE, await oracle.getAddress());
    await registry.connect(admin).grantRole(ORACLE, replacement.address);

    const deadline = await futureDeadline();
    const stale = claimIdOf("stale-oracle");
    await expect(
      registry.connect(claimant).claim(
        CELL_A, stale, deadline,
        await signClaim(registry, oracle, {
          cellId: CELL_A, claimant: await claimant.getAddress(), claimId: stale, deadline,
        }),
      ),
    ).to.be.revertedWithCustomError(registry, "NotOracleSignature");

    const fresh = claimIdOf("fresh-oracle");
    await registry.connect(claimant).claim(
      CELL_A, fresh, deadline,
      await signClaim(registry, replacement as any, {
        cellId: CELL_A, claimant: await claimant.getAddress(), claimId: fresh, deadline,
      }),
    );
    expect(await registry.totalSupply()).to.equal(1n);
  });
});

/* ══ 6. metadata ══════════════════════════════════════════════════════════ */

describe("DeedRegistry — metadata", () => {
  it("resolves tokenURI deterministically from the base URI", async () => {
    const { registry, claimant, oracle } = await loadFixture(fixture);
    const deadline = await futureDeadline();
    const claimId = claimIdOf("metadata");
    await registry.connect(claimant).claim(
      CELL_A, claimId, deadline,
      await signClaim(registry, oracle, {
        cellId: CELL_A, claimant: await claimant.getAddress(), claimId, deadline,
      }),
    );
    expect(await registry.tokenURI(CELL_A)).to.equal(`${BASE_URI}${CELL_A.toString()}`);
  });

  it("reverts tokenURI for a cell nobody holds", async () => {
    const { registry } = await loadFixture(fixture);
    await expect(registry.tokenURI(CELL_A)).to.be.revertedWithCustomError(
      registry, "ERC721NonexistentToken",
    );
  });

  it("lets only the admin update the base URI", async () => {
    const { registry, admin, claimant, oracle } = await loadFixture(fixture);
    const next = "https://metadata.movenrun.example/v2/";
    await expect(registry.connect(claimant).setBaseURI(next)).to.be.revertedWithCustomError(
      registry, "AccessControlUnauthorizedAccount",
    );

    await expect(registry.connect(admin).setBaseURI(next))
      .to.emit(registry, "BaseURIUpdated").withArgs(next);
    expect(await registry.baseURI()).to.equal(next);

    const deadline = await futureDeadline();
    const claimId = claimIdOf("after-uri-change");
    await registry.connect(claimant).claim(
      CELL_A, claimId, deadline,
      await signClaim(registry, oracle, {
        cellId: CELL_A, claimant: await claimant.getAddress(), claimId, deadline,
      }),
    );
    expect(await registry.tokenURI(CELL_A)).to.equal(`${next}${CELL_A.toString()}`);
  });

  it("advertises the interfaces a marketplace looks for", async () => {
    const { registry } = await loadFixture(fixture);
    for (const id of ["0x01ffc9a7", "0x80ac58cd", "0x5b5e139f", "0x780e9d63", "0x7965db0b"]) {
      expect(await registry.supportsInterface(id), id).to.equal(true);
    }
  });
});

/* ══ 7. no token dependency ═══════════════════════════════════════════════ */

describe("DeedRegistry — independent of MOVE", () => {
  it("mints for a claimant holding no token, with no approval given", async () => {
    /* The claimant here has never touched an ERC-20. If the registry needed a
       balance, an allowance, or a burn, this could not succeed. */
    const { registry, oracle } = await loadFixture(fixture);
    const stranger = ethers.Wallet.createRandom().connect(ethers.provider);
    await ethers.provider.send("hardhat_setBalance", [
      stranger.address, "0x56BC75E2D63100000",
    ]);

    const deadline = await futureDeadline();
    const claimId = claimIdOf("no-token");
    const sig = await signClaim(registry, oracle, {
      cellId: CELL_A, claimant: stranger.address, claimId, deadline,
    });
    await registry.connect(stranger).claim(CELL_A, claimId, deadline, sig);

    expect(await registry.ownerOf(CELL_A)).to.equal(stranger.address);
    expect(await registry.totalSupply()).to.equal(1n);
  });

  it("has no token address, cost, or burn anywhere in its surface", async () => {
    const { registry } = await loadFixture(fixture);
    const names = registry.interface.fragments
      .filter((f: any) => f.type === "function" || f.type === "event")
      .map((f: any) => f.name.toLowerCase());
    for (const banned of [
      "movetoken", "burnfrom", "burn", "mintcost", "basemintcost",
      "accumulatedyield", "withdrawyield", "creditzoneyield", "loyalty",
    ]) {
      expect(names.some((n: string) => n.includes(banned)), `${banned} must not exist`)
        .to.equal(false);
    }
  });

  it("performs no external call that could burn or transfer a token", async () => {
    /* A claim touches exactly one contract: this one. `_safeMint` may call an
       ERC-721 receiver, and that is the only outbound call in the path. */
    const { registry, claimant, oracle } = await loadFixture(fixture);
    const deadline = await futureDeadline();
    const claimId = claimIdOf("no-external");
    const tx = await registry.connect(claimant).claim(
      CELL_A, claimId, deadline,
      await signClaim(registry, oracle, {
        cellId: CELL_A, claimant: await claimant.getAddress(), claimId, deadline,
      }),
    );
    const receipt = await tx.wait();
    // Every log emitted belongs to the registry — nothing else was invoked.
    for (const log of receipt!.logs) {
      expect(log.address).to.equal(await registry.getAddress());
    }
  });
});
