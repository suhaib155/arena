/**
 * DeedClaimBridge — what it will authorize, and what it refuses.
 *
 * The property under test: an authorization can only ever name a cell the
 * SERVER derived for a session it actually verified, bound to the participant's
 * own wallet — and the operator's inputs are selectors, never evidence.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { ethers } from "ethers";
import * as h3 from "h3-js";
/* Deep source path, matching services/hex.service.ts: the shared package's
   `dist` is not built in this workspace, so the package root does not resolve
   at runtime, while this path does. One source of truth, no build step. */
import { H3_RESOLUTION } from "@movenrun/shared/src/constants/h3.js";
import { DeedOracleService, DEED_CLAIM_TYPES } from "./deedOracle.service.js";
import {
  ClaimBridgeError,
  DeedClaimBridge,
  type ClaimRefusal,
  type VerifiedMovementLookup,
  type VerifiedMovementRecordView,
} from "./deedClaimBridge.js";

const ORACLE_KEY = "0x" + "11".repeat(32);
const REGISTRY = "0x1111111111111111111111111111111111111111";
const CLAIMANT = "0x2222222222222222222222222222222222222222";
const OTHER = "0x3333333333333333333333333333333333333333";
const CHAIN_ID = 84532;
const USER = "usr_pilot_0001";
const SESSION = "mv-pilot-session-01";

/* Real H3 res-8 cells, derived rather than invented, so `isValidCell` and
   `getResolution` are exercised against genuine indexes. */
const CELL = h3.latLngToCell(51.5007, -0.1246, H3_RESOLUTION);
const CELL_B = h3.latLngToCell(51.5033, -0.1195, H3_RESOLUTION);
const UNTRAVERSED = h3.latLngToCell(48.8584, 2.2945, H3_RESOLUTION);
const RES9 = h3.latLngToCell(51.5007, -0.1246, 9);

function record(over: Partial<VerifiedMovementRecordView> = {}): VerifiedMovementRecordView {
  return {
    id: "mv_row_1",
    userId: USER,
    clientSessionId: SESSION,
    status: "verified",
    traversedHexIds: [CELL, CELL_B],
    ...over,
  };
}

function lookup(rec: VerifiedMovementRecordView | null): VerifiedMovementLookup {
  return {
    async findByUserSession(userId, clientSessionId) {
      if (!rec) return null;
      // Mirrors the real repository's scoping exactly.
      if (rec.userId !== userId || rec.clientSessionId !== clientSessionId) return null;
      return rec;
    },
  };
}

function bridge(rec: VerifiedMovementRecordView | null = record()) {
  const oracle = new DeedOracleService({
    privateKey: ORACLE_KEY,
    chainId: CHAIN_ID,
    registryAddress: REGISTRY,
  });
  return { oracle, bridge: new DeedClaimBridge(oracle, lookup(rec)) };
}

const request = (over: Record<string, unknown> = {}) => ({
  userId: USER,
  clientSessionId: SESSION,
  cellId: CELL,
  claimant: CLAIMANT,
  ...over,
});

async function refusal(fn: () => Promise<unknown>): Promise<ClaimRefusal> {
  try {
    await fn();
  } catch (err) {
    assert.ok(err instanceof ClaimBridgeError, `expected a refusal, got ${String(err)}`);
    return err.reason;
  }
  throw new Error("expected a refusal, but the bridge produced a bundle");
}

/* ── the happy path ───────────────────────────────────────────────────────── */

test("a verified session and a traversed cell produce a bundle", async () => {
  const { bridge: b, oracle } = bridge();
  const bundle = await b.issue(request());

  assert.equal(bundle.claimant, CLAIMANT);
  assert.equal(bundle.h3Cell, CELL);
  assert.equal(bundle.cellId, BigInt(`0x${CELL}`).toString());
  assert.equal(bundle.chainId, CHAIN_ID);
  assert.equal(bundle.registryAddress, REGISTRY);
  assert.match(bundle.claimId, /^0x[0-9a-f]{64}$/);
  assert.ok(bundle.deadline > Math.floor(Date.now() / 1000));

  // The signature is the oracle's, over exactly the bundle's own message.
  const recovered = ethers.verifyTypedData(
    oracle.domain,
    DEED_CLAIM_TYPES as never,
    {
      cellId: BigInt(bundle.cellId),
      claimant: bundle.claimant,
      claimId: bundle.claimId,
      deadline: bundle.deadline,
    },
    bundle.signature,
  );
  assert.equal(recovered, oracle.address);
});

test("the bundle carries the typed data a participant can check for themselves", async () => {
  const { bridge: b } = bridge();
  const bundle = await b.issue(request());
  assert.equal(bundle.typedData.primaryType, "DeedClaim");
  assert.equal(bundle.typedData.domain.verifyingContract, REGISTRY);
  assert.equal(bundle.typedData.domain.chainId, CHAIN_ID);
  assert.equal(bundle.typedData.message.claimant, CLAIMANT);
  assert.equal(bundle.typedData.message.cellId, bundle.cellId);
  assert.equal(bundle.typedData.message.claimId, bundle.claimId);
  assert.equal(bundle.typedData.message.deadline, bundle.deadline);
});

/* ── eligibility comes from the record ────────────────────────────────────── */

test("no verification means no authorization", async () => {
  const { bridge: b } = bridge(null);
  assert.equal(await refusal(() => b.issue(request())), "verification_not_found");
});

test("a rejected session cannot authorize anything", async () => {
  const { bridge: b } = bridge(record({ status: "rejected" }));
  assert.equal(await refusal(() => b.issue(request())), "verification_not_verified");
});

test("an unknown verification status fails closed rather than open", async () => {
  for (const status of ["pending", "", "VERIFIED", "ok", "true"]) {
    const { bridge: b } = bridge(record({ status }));
    assert.equal(
      await refusal(() => b.issue(request())),
      "verification_not_verified",
      `status "${status}" must not be treated as verified`,
    );
  }
});

test("a cell the route never entered is refused", async () => {
  const { bridge: b } = bridge();
  assert.equal(await refusal(() => b.issue(request({ cellId: UNTRAVERSED }))), "cell_not_traversed");
});

test("an empty traversed set authorizes nothing", async () => {
  const { bridge: b } = bridge(record({ traversedHexIds: [] }));
  assert.equal(await refusal(() => b.issue(request())), "cell_not_traversed");
});

test("the record is scoped by user and session, so neither can be substituted", async () => {
  const { bridge: b } = bridge();
  assert.equal(await refusal(() => b.issue(request({ userId: "usr_someone_else" }))), "verification_not_found");
  assert.equal(await refusal(() => b.issue(request({ clientSessionId: "mv-other" }))), "verification_not_found");
});

test("a cell at the wrong resolution is refused even if it is in the set", async () => {
  /* Resolution is proven from the index, not assumed from the constant. */
  const { bridge: b } = bridge(record({ traversedHexIds: [RES9] }));
  assert.equal(await refusal(() => b.issue(request({ cellId: RES9 }))), "cell_wrong_resolution");
  assert.notEqual(h3.getResolution(RES9), H3_RESOLUTION);
});

test("a malformed cell is refused", async () => {
  for (const bad of ["", "zzzz", "0x8828308281fffff", "../..", "8".repeat(40)]) {
    const { bridge: b } = bridge(record({ traversedHexIds: [bad] }));
    const reason = await refusal(() => b.issue(request({ cellId: bad })));
    assert.ok(
      reason === "cell_malformed" || reason === "cell_not_traversed",
      `"${bad}" must be refused, got ${reason}`,
    );
  }
});

/* ── claimant binding ─────────────────────────────────────────────────────── */

test("the bundle binds the participant's own wallet and no other", async () => {
  const { bridge: b, oracle } = bridge();
  const bundle = await b.issue(request());

  // Swapping the claimant after the fact invalidates the signature.
  const tampered = ethers.verifyTypedData(
    oracle.domain,
    DEED_CLAIM_TYPES as never,
    {
      cellId: BigInt(bundle.cellId),
      claimant: OTHER,
      claimId: bundle.claimId,
      deadline: bundle.deadline,
    },
    bundle.signature,
  );
  assert.notEqual(tampered, oracle.address, "a bundle must not be transferable to another wallet");
});

test("swapping the cell after signing invalidates the bundle", async () => {
  const { bridge: b, oracle } = bridge();
  const bundle = await b.issue(request());
  const tampered = ethers.verifyTypedData(
    oracle.domain,
    DEED_CLAIM_TYPES as never,
    {
      cellId: BigInt(`0x${CELL_B}`),
      claimant: bundle.claimant,
      claimId: bundle.claimId,
      deadline: bundle.deadline,
    },
    bundle.signature,
  );
  assert.notEqual(tampered, oracle.address);
});

test("an invalid claimant is refused before anything is signed", async () => {
  const { bridge: b } = bridge();
  for (const bad of ["", "not-an-address", ethers.ZeroAddress, "0x1234"]) {
    assert.equal(await refusal(() => b.issue(request({ claimant: bad }))), "claimant_invalid");
  }
});

/* ── replay ───────────────────────────────────────────────────────────────── */

test("two issuances for the same cell carry different claim ids", async () => {
  /* The registry consumes the claim id, so two bundles are two distinct
     authorizations — not a way to mint the same cell twice, which the cell
     uniqueness check on-chain refuses regardless. */
  const { bridge: b } = bridge();
  const first = await b.issue(request());
  const second = await b.issue(request());
  assert.notEqual(first.claimId, second.claimId);
  assert.notEqual(first.signature, second.signature);
});

test("the deadline is short and derived from the injected clock", async () => {
  const { bridge: b } = bridge();
  const fixed = 1_800_000_000_000;
  const bundle = await b.issue(request({ now: () => fixed }));
  assert.equal(bundle.deadline, Math.floor(fixed / 1000) + 15 * 60);
});

/* ── privacy and secrecy ──────────────────────────────────────────────────── */

test("the bundle carries the claimed cell, never the route or the rest of the set", async () => {
  const { bridge: b } = bridge(
    record({ traversedHexIds: [CELL, CELL_B, UNTRAVERSED] }),
  );
  const bundle = await b.issue(request());
  const text = JSON.stringify(bundle);

  assert.ok(text.includes(CELL), "the claimed cell is needed");
  for (const other of [CELL_B, UNTRAVERSED]) {
    assert.ok(!text.includes(other), "a bundle must not become a location trail");
  }
  // Nor any of the session's internals.
  for (const leak of ["51.5", "-0.12", "lat", "lng", "points", "mv_row_1", "traversedHexIds"]) {
    assert.ok(!text.includes(leak), `"${leak}" must not appear in a claim bundle`);
  }
});

test("the bundle carries no credential of any kind", async () => {
  const { bridge: b } = bridge();
  const text = JSON.stringify(await b.issue(request())).toLowerCase();
  for (const secret of [
    "bearer", "authorization", "accesstoken", "access_token", "refreshtoken",
    "refresh_token", "privatekey", "private_key", "password", "email", "cookie",
  ]) {
    assert.ok(!text.includes(secret), `"${secret}" must not appear in a claim bundle`);
  }
  assert.ok(!text.includes(ORACLE_KEY.slice(2)), "the oracle key must never be emitted");
});

test("a refusal names a category and echoes no payload", async () => {
  const { bridge: b } = bridge();
  try {
    await b.issue(request({ cellId: UNTRAVERSED }));
    assert.fail("expected a refusal");
  } catch (err) {
    const text = String((err as Error).message) + inspect(err, { depth: 5 });
    assert.ok(text.includes("cell_not_traversed"));
    for (const leak of [CELL, CELL_B, UNTRAVERSED, USER, SESSION]) {
      assert.ok(!text.includes(leak), "a refusal must not echo the request or the record");
    }
  }
});

test("the oracle key is unreachable through the bridge", async () => {
  const { bridge: b } = bridge();
  const surface = [
    inspect(b, { depth: 6 }),
    Object.getOwnPropertyNames(b).join(","),
    JSON.stringify(b, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) ?? "",
  ].join("|");
  assert.ok(!surface.includes(ORACLE_KEY.slice(2)), "the key must not be reachable via the bridge");
  assert.ok(!surface.includes("11".repeat(32)));
});

/* ── what the bridge must not depend on ───────────────────────────────────── */

test("the H3 resolution agrees across shared, the bridge, and the contract", async () => {
  /* Three places name resolution 8: shared/constants/h3.ts, this bridge (via
     that constant), and DeedRegistry.H3_RESOLUTION. A deed issued at the wrong
     granularity is not a bug anyone would notice from a passing test suite, so
     the three are tied together here rather than trusted to stay aligned. */
  const { readFileSync, existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  assert.equal(H3_RESOLUTION, 8);

  const sharedSrc = readFileSync(
    join(process.cwd(), "..", "shared", "src", "constants", "h3.ts"),
    "utf8",
  );
  assert.match(sharedSrc, /export const H3_RESOLUTION = 8;/);

  /* The contract lives on another branch while both are in review, so this
     asserts against it only when it is present in the working tree. It is a
     cross-branch tie, not a hard dependency. */
  const contract = join(process.cwd(), "..", "contracts", "src", "registry", "DeedRegistry.sol");
  if (existsSync(contract)) {
    assert.match(
      readFileSync(contract, "utf8"),
      /uint8 public constant H3_RESOLUTION = 8;/,
      "the registry must issue deeds at the same resolution the bridge authorizes",
    );
  }
});

test("nothing in the bridge reaches for a non-authoritative source", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const source = readFileSync(join(process.cwd(), "src/services/deedClaimBridge.ts"), "utf8")
    // Comments explain what is NOT used, so scan the code only.
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");

  for (const banned of [
    "hex_activities",     // has no writer; cannot be authority
    "hexActivities",
    "newCapturedZone",    // mobile local simulation
    "deriveZonesFromRoute",
    "moveToken",          // the registry has no token dependency
    "burnFrom",
    "mintCost",
    "MIN_ACTIVITY_THRESHOLD", // a V1 ZoneNFT rule, not evaluable here
    "signZoneMint",       // the V1 personal_sign scheme
    "signRouteProof",
  ]) {
    assert.ok(!source.includes(banned), `the bridge must not depend on ${banned}`);
  }
  /* And it must use the EIP-712 signer, not the V1 one. A plain substring test
     for "OracleService" is wrong here — `DeedOracleService` contains it — so
     this excludes the Deed-prefixed name explicitly rather than by hoping the
     two never appear together. */
  assert.ok(source.includes("DeedOracleService"), "the bridge must use the EIP-712 signer");
  assert.ok(
    !/(?<!Deed)OracleService/.test(source),
    "the bridge must not reach for the V1 personal_sign OracleService",
  );
});
