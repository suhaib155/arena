/**
 * DeedOracleService — the authorization it produces, and the ones it refuses.
 *
 * The property under test: a signature authorizes exactly one claimant to take
 * exactly one cell, once, before a deadline, on one chain, against one
 * registry — and changing any of those makes the signature worthless rather
 * than transferable.
 *
 * These tests also guard the thing most likely to break silently: that the
 * scheme here matches the one DeedRegistry verifies. The backend already has an
 * oracle that signs EIP-191 over packed keccak for the V1 contracts; a
 * signature from that one will never verify against the registry, and nothing
 * but a test says so.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { ethers } from "ethers";
import {
  DEED_CLAIM_TTL_SECONDS,
  DEED_CLAIM_TYPES,
  DEED_DOMAIN_NAME,
  DEED_DOMAIN_VERSION,
  DeedOracleService,
  type DeedClaimFields,
} from "./deedOracle.service.js";

const ORACLE_KEY = "0x" + "11".repeat(32);
const REGISTRY = "0x1111111111111111111111111111111111111111";
const CLAIMANT = "0x2222222222222222222222222222222222222222";
const CHAIN_ID = 8453;
const CELL = 613196570331971583n;

function service(over: Partial<ConstructorParameters<typeof DeedOracleService>[0]> = {}) {
  return new DeedOracleService({
    privateKey: ORACLE_KEY,
    chainId: CHAIN_ID,
    registryAddress: REGISTRY,
    ...over,
  });
}

function fields(over: Partial<DeedClaimFields> = {}): DeedClaimFields {
  return {
    cellId: CELL,
    claimant: CLAIMANT,
    claimId: "0x" + "ab".repeat(32),
    deadline: 2_000_000_000,
    ...over,
  };
}

/* ── scheme compatibility with the contract ───────────────────────────────── */

test("the signed type is byte-identical to the registry's typehash", () => {
  /* DeedRegistry.DEED_CLAIM_TYPEHASH is keccak256 of exactly this string. If
     the two ever diverge — a reordered field, a renamed one, uint64 becoming
     uint256 — every authorization this service issues stops verifying, and it
     would look like a signing bug rather than a schema change. */
  const encoded = ethers.TypedDataEncoder.from(DEED_CLAIM_TYPES as never).encodeType("DeedClaim");
  assert.equal(encoded, "DeedClaim(uint64 cellId,address claimant,bytes32 claimId,uint256 deadline)");
  assert.equal(
    ethers.id(encoded),
    ethers.id("DeedClaim(uint64 cellId,address claimant,bytes32 claimId,uint256 deadline)"),
  );
});

test("the domain matches the registry's constants", () => {
  const s = service();
  assert.equal(s.domain.name, "MovenRunDeedRegistry");
  assert.equal(s.domain.version, "1");
  assert.equal(DEED_DOMAIN_NAME, "MovenRunDeedRegistry");
  assert.equal(DEED_DOMAIN_VERSION, "1");
  assert.equal(s.domain.chainId, BigInt(CHAIN_ID));
  assert.equal(s.domain.verifyingContract, REGISTRY);
});

test("this is EIP-712, not the EIP-191 scheme the V1 oracle uses", () => {
  /* The two are not interchangeable, and mixing them up at a call site is the
     realistic mistake. A typed-data signature must NOT equal a personal_sign
     over the same struct hash. */
  const s = service();
  const digest = ethers.TypedDataEncoder.hash(s.domain, DEED_CLAIM_TYPES as never, fields());
  const wallet = new ethers.Wallet(ORACLE_KEY);
  const personal = wallet.signMessageSync(ethers.getBytes(digest));
  return s.signClaim(fields(), true).then((typed) => {
    assert.notEqual(typed, personal, "EIP-712 and EIP-191 must not coincide");
  });
});

/* ── a valid authorization ────────────────────────────────────────────────── */

test("an authorization recovers to the oracle address", async () => {
  const s = service();
  const f = fields();
  const sig = await s.signClaim(f, true);
  assert.equal(s.verify(f, sig), s.address);
  assert.equal(s.address, new ethers.Wallet(ORACLE_KEY).address);
});

test("is deterministic for identical fields", async () => {
  const s = service();
  const f = fields();
  assert.equal(await s.signClaim(f, true), await s.signClaim(f, true));
});

/* ── binding ──────────────────────────────────────────────────────────────── */

test("changing any signed field invalidates the authorization", async () => {
  const s = service();
  const f = fields();
  const sig = await s.signClaim(f, true);

  const tampered: [string, DeedClaimFields][] = [
    ["a different cell", fields({ cellId: CELL + 1n })],
    ["a different claimant", fields({ claimant: "0x3333333333333333333333333333333333333333" })],
    ["a different claim id", fields({ claimId: "0x" + "cd".repeat(32) })],
    ["a later deadline", fields({ deadline: 2_000_000_001 })],
  ];
  for (const [label, altered] of tampered) {
    assert.notEqual(
      s.verify(altered, sig),
      s.address,
      `${label} must not still recover to the oracle`,
    );
  }
});

test("an authorization for one chain does not work on another", async () => {
  const mainnet = service({ chainId: 8453 });
  const sepolia = service({ chainId: 84532 });
  const f = fields();
  const sig = await sepolia.signClaim(f, true);
  assert.notEqual(
    mainnet.verify(f, sig),
    mainnet.address,
    "a Sepolia authorization must not be replayable on mainnet",
  );
  assert.notEqual(await mainnet.signClaim(f, true), sig);
});

test("an authorization for one registry does not work against another", async () => {
  const a = service({ registryAddress: REGISTRY });
  const b = service({ registryAddress: "0x4444444444444444444444444444444444444444" });
  const f = fields();
  const sig = await a.signClaim(f, true);
  assert.notEqual(b.verify(f, sig), b.address);
});

/* ── refusals ─────────────────────────────────────────────────────────────── */

test("refuses to sign a claim not established as eligible", async () => {
  const s = service();
  await assert.rejects(
    () => s.signClaim(fields(), false),
    /has not been established as eligible/,
    "signing must require the caller to have checked verified movement",
  );
});

test("refuses malformed claim fields", async () => {
  const s = service();
  const bad: [string, DeedClaimFields][] = [
    ["the zero address", fields({ claimant: ethers.ZeroAddress })],
    ["a non-address claimant", fields({ claimant: "not-an-address" as string })],
    ["a cell above uint64", fields({ cellId: 1n << 64n })],
    ["a negative cell", fields({ cellId: -1n })],
    ["a short claim id", fields({ claimId: "0xabcd" })],
    ["a non-hex claim id", fields({ claimId: "z".repeat(66) })],
    ["a zero deadline", fields({ deadline: 0 })],
    ["a negative deadline", fields({ deadline: -1 })],
    ["a fractional deadline", fields({ deadline: 1.5 })],
  ];
  for (const [label, f] of bad) {
    await assert.rejects(() => s.signClaim(f, true), `${label} must be refused`);
  }
});

test("refuses construction without a real registry address", () => {
  assert.throws(
    () => new DeedOracleService({ privateKey: ORACLE_KEY, chainId: CHAIN_ID, registryAddress: "0x0" }),
    /valid address/,
  );
});

/* ── claim ids ────────────────────────────────────────────────────────────── */

test("claim ids are 32 random bytes and do not repeat", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const id = DeedOracleService.newClaimId();
    assert.match(id, /^0x[0-9a-f]{64}$/);
    ids.add(id);
  }
  assert.equal(ids.size, 2000, "claim ids collided");
});

test("a claim id encodes nothing about the cell or the claimant", () => {
  /* Derived ids would leak who is about to claim what to anyone watching the
     mempool, and would collide predictably. */
  const id = DeedOracleService.newClaimId();
  assert.ok(!id.includes(CELL.toString(16)));
  assert.ok(!id.toLowerCase().includes(CLAIMANT.slice(2).toLowerCase()));
});

/* ── lifetime ─────────────────────────────────────────────────────────────── */

test("the authorization lifetime is short and stated", () => {
  assert.equal(DEED_CLAIM_TTL_SECONDS, 15 * 60);
  assert.ok(DEED_CLAIM_TTL_SECONDS <= 3600, "an authorization is not a session");
});

/* ── secrecy ──────────────────────────────────────────────────────────────── */

test("the signing key is unreachable from outside the service", () => {
  /* TypeScript's `private` is erased at compile time: with it, the wallet — and
     therefore the key — was reachable as `(service as any).wallet.privateKey`.
     A `#` field is enforced by the runtime, so this asserts a real boundary
     rather than a type-checker convention. */
  const s = service();
  assert.equal((s as unknown as Record<string, unknown>).wallet, undefined);
  assert.ok(!Object.keys(s).includes("wallet"));
  assert.ok(!Object.getOwnPropertyNames(s).includes("wallet"));

  const serialize = (v: unknown) =>
    JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val)) ?? "";
  const surface = [
    serialize(s),
    serialize({ ...s }),
    serialize(s.domain),
    Object.keys(s).join(","),
    Object.getOwnPropertyNames(s).join(","),
    String(s.address),
    inspect(s, { depth: 5 }),
  ].join("|");

  assert.ok(!surface.includes(ORACLE_KEY.slice(2)), "the private key must not be reachable");
  assert.ok(!surface.includes("11".repeat(32)));
  // Only the public address is offered.
  assert.match(s.address, /^0x[0-9a-fA-F]{40}$/);
});
