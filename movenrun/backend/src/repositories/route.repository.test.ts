/**
 * InMemoryRouteRepository tests — the dedup query semantics that
 * DrizzleRouteRepository mirrors in SQL (see route.repository.drizzle.ts).
 * No network, no Postgres, no `@movenrun/shared` (node:test + tsx only).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryRouteRepository } from "./route.repository.js";

const WALLET_A = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const WALLET_B = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

test("create returns a SUBMITTED record with null lifecycle fields", async () => {
  const repo = new InMemoryRouteRepository();
  const record = await repo.create({ id: "r1", walletAddress: WALLET_A, startTime: 100, endTime: 200 });

  assert.equal(record.status, "SUBMITTED");
  assert.equal(record.routeHash, null);
  assert.equal(record.distanceMeters, null);
  assert.equal(record.hexId, null);
  assert.equal(record.oracleSig, null);
  assert.equal(record.confidence, null);
  assert.equal(record.rejectionReasons, null);
  assert.ok(record.createdAt instanceof Date);
  assert.ok(record.updatedAt instanceof Date);
});

test("findById returns null for an unknown id", async () => {
  const repo = new InMemoryRouteRepository();
  assert.equal(await repo.findById("nope"), null);
});

test("update merges the patch and bumps updatedAt", async () => {
  const repo = new InMemoryRouteRepository();
  const created = await repo.create({ id: "r2", walletAddress: WALLET_A, startTime: 100, endTime: 200 });
  await new Promise((r) => setTimeout(r, 2)); // ensure a distinct timestamp

  const updated = await repo.update("r2", { status: "PROCESSING" });
  assert.equal(updated?.status, "PROCESSING");
  assert.ok(updated!.updatedAt.getTime() >= created.updatedAt.getTime());
  // Unrelated fields are preserved.
  assert.equal(updated?.walletAddress, WALLET_A);
});

test("update on an unknown id returns null", async () => {
  const repo = new InMemoryRouteRepository();
  assert.equal(await repo.update("nope", { status: "REJECTED" }), null);
});

test("findByRouteHash excludes the given id and matches on exact routeHash", async () => {
  const repo = new InMemoryRouteRepository();
  const hash = "0x" + "aa".repeat(32);
  await repo.create({ id: "r3", walletAddress: WALLET_A, startTime: 1, endTime: 2 });
  await repo.update("r3", { routeHash: hash, status: "VERIFIED" });
  await repo.create({ id: "r4", walletAddress: WALLET_B, startTime: 10, endTime: 20 });

  // r4 looking for duplicates of `hash` finds r3.
  const dup = await repo.findByRouteHash(hash, "r4");
  assert.equal(dup?.id, "r3");

  // r3 excluding itself finds no duplicate of its own hash.
  const self = await repo.findByRouteHash(hash, "r3");
  assert.equal(self, null);

  // A different hash matches nothing.
  assert.equal(await repo.findByRouteHash("0x" + "bb".repeat(32), "r4"), null);
});

test("multiple null routeHash rows never collide in findByRouteHash", async () => {
  const repo = new InMemoryRouteRepository();
  await repo.create({ id: "r5", walletAddress: WALLET_A, startTime: 1, endTime: 2 });
  await repo.create({ id: "r6", walletAddress: WALLET_A, startTime: 3, endTime: 4 });
  // Neither has a routeHash yet — querying with an empty-ish value must not match nulls.
  assert.equal(await repo.findByRouteHash("", "r6"), null);
});

test("findOverlappingVerified only matches VERIFIED routes for the SAME wallet with an overlapping window", async () => {
  const repo = new InMemoryRouteRepository();
  await repo.create({ id: "r7", walletAddress: WALLET_A, startTime: 1000, endTime: 2000 });
  await repo.update("r7", { status: "VERIFIED" });

  // Overlaps.
  assert.equal(
    (await repo.findOverlappingVerified(WALLET_A, 1500, 2500, "r8"))?.id,
    "r7"
  );
  // Adjacent, non-overlapping (touches but doesn't cross) — not an overlap.
  assert.equal(await repo.findOverlappingVerified(WALLET_A, 2000, 3000, "r8"), null);
  // Different wallet — never matches even with the same window.
  assert.equal(await repo.findOverlappingVerified(WALLET_B, 1500, 2500, "r8"), null);
  // Excluding the route itself — a route never "overlaps" itself.
  assert.equal(await repo.findOverlappingVerified(WALLET_A, 1500, 2500, "r7"), null);
});

test("findOverlappingVerified ignores non-VERIFIED routes even if the window overlaps", async () => {
  const repo = new InMemoryRouteRepository();
  await repo.create({ id: "r9", walletAddress: WALLET_A, startTime: 1000, endTime: 2000 });
  await repo.update("r9", { status: "REJECTED" });

  assert.equal(await repo.findOverlappingVerified(WALLET_A, 1500, 2500, "r10"), null);
});
