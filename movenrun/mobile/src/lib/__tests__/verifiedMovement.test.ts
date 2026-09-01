/**
 * Verified movement reconciliation — and the trust boundary it must hold.
 *
 * The property under test, stated once:
 *
 *   the app may say "this session was verified and traversed N areas"
 *   without ever implying "you now own or captured them".
 *
 * Everything below is either an assertion about that boundary, or about the
 * separation between what the device observed and what the server measured.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  findVerification,
  mergeVerification,
  presentMeasurement,
  toVerifiedRecord,
  verificationLabel,
  type VerifiedMovementRecord,
} from "../verifiedMovement";
import type { VerificationState } from "../movementVerification";

const SRC = join(process.cwd(), "src");
const read = (p: string) => readFileSync(p, "utf8");

const AT = "2026-08-25T19:00:00.000Z";
const now = () => AT;

const verified: VerificationState = {
  kind: "verified",
  distanceMeters: 431,
  durationSeconds: 300,
  traversedHexIds: ["8a1fb46622dffff", "8a1fb46622d7fff", "8a1fb46622cffff"],
};
const rejected: VerificationState = {
  kind: "rejected",
  reasons: ["Implausible speed at index 2"],
};

const localMeasurement = { distanceMeters: 420, durationSeconds: 305 };

/* ── attaching a result to the right session ──────────────────────────────── */

test("a settled result becomes a record keyed by its own session", () => {
  const record = toVerifiedRecord("mv-session-a", verified, now);
  assert.ok(record);
  assert.equal(record.clientSessionId, "mv-session-a");
  assert.equal(record.status, "verified");
  assert.equal(record.verifiedDistanceMeters, 431);
  assert.equal(record.verifiedDurationSeconds, 300);
  assert.equal(record.recordedAt, AT);
});

test("unsettled states produce no record at all", () => {
  for (const state of [
    { kind: "local" },
    { kind: "submitting" },
    { kind: "pending", reason: "offline" },
    { kind: "pending", reason: "malformed_response" },
  ] as VerificationState[]) {
    assert.equal(
      toVerifiedRecord("mv-session-a", state, now),
      null,
      `${state.kind} must not be recorded as a verdict`,
    );
  }
});

test("a record for session A can never be read as session B's", () => {
  const records = [
    toVerifiedRecord("mv-session-a", verified, now)!,
    toVerifiedRecord("mv-session-b", rejected, now)!,
  ];
  assert.equal(findVerification(records, "mv-session-a")?.status, "verified");
  assert.equal(findVerification(records, "mv-session-b")?.status, "rejected");
  assert.equal(findVerification(records, "mv-session-c"), null);
});

/* ── monotonic settlement ─────────────────────────────────────────────────── */

test("a duplicate idempotent response converges on the held result", () => {
  const first = toVerifiedRecord("mv-session-a", verified, () => AT)!;
  const replay = toVerifiedRecord("mv-session-a", verified, () => "2026-08-25T19:05:00.000Z")!;
  const merged = mergeVerification(first, replay);
  assert.deepEqual(merged, first, "the first settled record wins; a replay does not rewrite it");
});

test("a settled result cannot be displaced by a later, different one", () => {
  const settled = toVerifiedRecord("mv-session-a", verified, now)!;
  const contradiction = toVerifiedRecord("mv-session-a", rejected, now)!;
  assert.equal(mergeVerification(settled, contradiction).status, "verified");
  // And the store action is terminal-first for the same reason.
  const store = read(join(SRC, "store", "useGameStore.ts"));
  assert.match(store, /if \(existing\) \{[\s\S]{0,160}return \{ movementVerifications: state\.movementVerifications \};/);
});

test("verified never regresses to pending or local, because neither is recordable", () => {
  const settled = toVerifiedRecord("mv-session-a", verified, now)!;
  for (const stale of [
    { kind: "pending", reason: "offline" },
    { kind: "local" },
  ] as VerificationState[]) {
    assert.equal(toVerifiedRecord("mv-session-a", stale, now), null);
  }
  assert.equal(mergeVerification(settled, settled).status, "verified");
});

/* ── local observation vs server measurement ──────────────────────────────── */

test("before verification the local reading is shown, and says so", () => {
  const shown = presentMeasurement(localMeasurement, null);
  assert.equal(shown.distanceMeters, 420, "the device's own reading");
  assert.equal(shown.source, "local");
  assert.equal(shown.serverVerified, false);
});

test("after verification the server measurement is shown, and says so", () => {
  const record = toVerifiedRecord("mv-session-a", verified, now)!;
  const shown = presentMeasurement(localMeasurement, record);
  assert.equal(shown.distanceMeters, 431, "the server's independent measurement");
  assert.equal(shown.durationSeconds, 300);
  assert.equal(shown.source, "server");
  assert.equal(shown.serverVerified, true);
});

test("a rejected session keeps the local reading — declining to verify is not a correction", () => {
  const record = toVerifiedRecord("mv-session-a", rejected, now)!;
  const shown = presentMeasurement(localMeasurement, record);
  assert.equal(shown.distanceMeters, 420);
  assert.equal(shown.source, "local");
  assert.equal(shown.serverVerified, false);
});

test("the local observation is never destroyed or overwritten by a server value", () => {
  const local = { ...localMeasurement };
  const record = toVerifiedRecord("mv-session-a", verified, now)!;
  presentMeasurement(local, record);
  assert.deepEqual(local, localMeasurement, "presenting must not mutate the local reading");
  // And the record has no field that could stand in for raw route history.
  assert.ok(!("points" in record));
  assert.ok(!("route" in record));
});

/* ── traversal is not territory ───────────────────────────────────────────── */

test("a record carries a traversed COUNT, never the trail", () => {
  const record = toVerifiedRecord("mv-session-a", verified, now)!;
  assert.equal(record.traversedHexCount, 3);
  assert.ok(!("traversedHexIds" in record), "persisting the cells would be location history");
  const serialized = JSON.stringify(record);
  for (const hex of verified.kind === "verified" ? verified.traversedHexIds : []) {
    assert.ok(!serialized.includes(hex), "a persisted record must not contain a hex id");
  }
});

test("no record field means captured, owned, defended, deeded or awarded", () => {
  const record = toVerifiedRecord("mv-session-a", verified, now)!;
  for (const forbidden of [
    "capturedZones", "zones", "zonesOwned", "owned", "ownership", "controlPercent",
    "defensePercent", "defended", "deed", "isDeedPreview", "xp", "lockedMove",
    "reward", "trustScore", "walletAddress",
  ]) {
    assert.ok(!(forbidden in record), `the record leaked an authority field: ${forbidden}`);
  }
});

test("the reconciliation module cannot reach territory or reward authority", () => {
  // A precise module-boundary check rather than a repo-wide regex: this ONE
  // file is where a hex could be turned into a zone, so this is where the
  // temptation has to be structurally denied.
  const src = read(join(SRC, "lib", "verifiedMovement.ts"));
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
  for (const forbidden of [
    "newCapturedZone", "captureZone", "defendZones", "fortifyZone", "useGameStore",
    "completeQuest", "lockedMovePreview", "deriveZonesFromRoute", "wallet", "deed",
  ]) {
    assert.ok(
      !new RegExp(`\\b${forbidden}\\b`).test(code),
      `verifiedMovement.ts references ${forbidden} — traversal must not become territory here`,
    );
  }
  // It may only import from the verification model.
  const imports = code.match(/^import .*$/gm) ?? [];
  assert.deepEqual(
    imports.filter((l) => !l.includes("./movementVerification")),
    [],
    "the reconciliation layer imports something outside the verification domain",
  );
});

/* ── vocabulary ───────────────────────────────────────────────────────────── */

test("every user-facing label describes verification, never territory or reward", () => {
  const labels = (
    [
      { kind: "local" },
      { kind: "submitting" },
      verified,
      rejected,
      { kind: "pending", reason: "offline" },
    ] as VerificationState[]
  ).map(verificationLabel);

  assert.deepEqual(labels, [
    "Not submitted",
    "Verifying movement",
    "Verified movement",
    "Needs review",
    "Verification pending",
  ]);

  const joined = labels.join(" ").toLowerCase();
  for (const forbidden of [
    "captur", "owned", "own ", "defend", "deed", "earned", "reward", "approved",
    "on-chain", "token", "mint", "xp",
  ]) {
    assert.ok(!joined.includes(forbidden), `a label claims "${forbidden.trim()}"`);
  }
  // A rejection is "needs review", not an accusation.
  assert.ok(!joined.includes("fraud") && !joined.includes("cheat") && !joined.includes("invalid"));
});

/* ── the store slice ──────────────────────────────────────────────────────── */

test("the verification slice is bounded, reset-clearing, and migration-safe", () => {
  const store = read(join(SRC, "store", "useGameStore.ts"));
  assert.match(store, /const MAX_VERIFICATIONS = \d+;/, "the record list must be bounded");
  assert.match(store, /\.slice\(\s*0,\s*MAX_VERIFICATIONS,?\s*\)/);
  // Cleared by reset, alongside the other local history.
  const resetBlock = store.slice(store.lastIndexOf("reset: () =>"));
  assert.match(resetBlock.slice(0, 1200), /movementVerifications: \[\]/);
  // Persisted-state upgrades backfill it rather than crashing.
  assert.match(store, /if \(!Array\.isArray\(state\.movementVerifications\)\) \{/);
  assert.match(store, /version: 11,/, "adding a persisted field requires a version bump");
});

test("recording a verification touches no reward or territory state", () => {
  const store = read(join(SRC, "store", "useGameStore.ts"));
  const start = store.indexOf("recordMovementVerification: (record) =>");
  assert.ok(start > 0);
  const action = store.slice(start, store.indexOf("markViewedPassport"));
  for (const forbidden of [
    "totalXp", "zones", "captureZone", "newCapturedZone", "timesDefended",
    "completedQuestIds", "streak", "history",
  ]) {
    assert.ok(
      !new RegExp(`\\b${forbidden}\\b`).test(action),
      `recordMovementVerification writes ${forbidden} — it must only append a record`,
    );
  }
});

/* ── the pre-existing local simulation is untouched ───────────────────────── */

test("local territory capture is unchanged and still the only path to a zone", () => {
  const summary = read(join(process.cwd(), "app", "move", "summary.tsx"));
  // The pre-existing local capture path is intact...
  assert.match(summary, /captureZone\(newCapturedZone\(candidate, false\)\)/);
  assert.match(summary, /deriveZonesFromRoute|candidate/);
  // ...and the verification result feeds none of it.
  const recordBlock = summary.slice(summary.indexOf("toVerifiedRecord("));
  const nextLines = recordBlock.slice(0, 400);
  for (const forbidden of ["captureZone", "newCapturedZone", "defendZones", "completeQuest"]) {
    assert.ok(
      !nextLines.includes(forbidden),
      `the verification callback calls ${forbidden} — traversal must not become capture`,
    );
  }
});

test("zone counts still come from local zones, not from verification records", () => {
  const profile = read(join(process.cwd(), "app", "(tabs)", "profile.tsx"));
  assert.match(profile, /zonesOwned: zones\.length/, "ownership count stays the local zone list");
  assert.ok(
    !/movementVerifications/.test(profile),
    "profile must not derive territory from verification records",
  );
  /* Home's territory model is `tasks.ts` once the task-board work is present
     and `homeMission.ts` before it. Pinning one filename made this guard
     ENOENT the moment both stacks were integrated — it stopped asserting
     anything rather than asserting something false, but a guard that vanishes
     on a rename is no guard. Assert against whichever model actually ships,
     and fail closed if neither does. */
  const homeModels = ["tasks.ts", "homeMission.ts"]
    .map((f) => join(SRC, "lib", f))
    .filter((f) => existsSync(f));
  assert.ok(
    homeModels.length > 0,
    "no home territory model found — this guard has lost its subject",
  );
  for (const model of homeModels) {
    assert.ok(
      !/movementVerifications|traversedHex/.test(read(model)),
      `${model} must not treat verified traversal as territory`,
    );
  }
});
