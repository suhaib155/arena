/**
 * MR-C item 4: local Save banks estimated, reversible XP; only an
 * authoritative server verdict banks verified XP, once per session.
 * SYNTHETIC: session ids and verdicts are made up; no network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import type { Quest } from "../../types";
import type { VerifiedMovementRecord } from "../../lib/verifiedMovement";
import { movementXpStatus, recordEstimate, settle } from "../../lib/movementXp";
import { sessionXp } from "../../services/moveSession";
import { SESSION_QUEST_ID } from "../../lib/sessionQuest";

async function loadStore() {
  const root = resolve(__dirname, "../..");
  const filename = resolve(root, "store/useGameStore.ts");
  const require = createRequire(filename);
  let stored: string | null = null;
  const storage = { getItem: () => stored, setItem: (_k: string, v: string) => { stored = v; }, removeItem: () => { stored = null; } };
  const module = { exports: {} as typeof import("../useGameStore") };
  const source = transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  runInNewContext(source, {
    module, exports: module.exports, console, Date,
    require: (id: string) => {
      if (id === "@react-native-async-storage/async-storage") return storage;
      if (id === "@/services/verificationQueue") return { discardPendingVerifications: async () => undefined };
      return require(id.startsWith("@/") ? resolve(root, id.slice(2)) : id);
    },
  }, { filename });
  await module.exports.useGameStore.persist.rehydrate();
  return module.exports.useGameStore;
}

const sessionQuest = (xp: number): Quest => ({
  id: SESSION_QUEST_ID, title: "Movement Session", summary: "", description: "", category: "Cardio",
  difficulty: "Medium", durationSeconds: 120, xpReward: xp, icon: "navigate", instructions: [],
});
const verdict = (id: string, over: Partial<VerifiedMovementRecord>): VerifiedMovementRecord => ({
  clientSessionId: id, status: "verified", verifiedDistanceMeters: 300, verifiedDurationSeconds: 240,
  traversedHexCount: 1, rejectionReasons: [], recordedAt: "2026-10-22T09:10:00.000Z", ...over,
});

test("Save banks an estimate; a rejected verdict takes it back exactly once", async () => {
  const store = await loadStore();
  const outcome = store.getState().completeQuest(sessionQuest(53));
  store.getState().recordMovementXpEstimate("mv-synthetic-s03", outcome.xpGained, true);
  assert.equal(store.getState().totalXp, 53);
  const rejected = verdict("mv-synthetic-s03", { status: "rejected", verifiedDistanceMeters: null,
    verifiedDurationSeconds: null, rejectionReasons: ["Route wanders in place like stationary GPS drift"] });
  store.getState().recordMovementVerification(rejected);
  store.getState().settleMovementXp(rejected);
  store.getState().settleMovementXp(rejected); // duplicate response / retry
  const s = store.getState();
  assert.equal(s.totalXp, 0);
  assert.equal(s.verifiedXp, 0);
  assert.equal(movementXpStatus(s.movementXp[0]!), "not_eligible");
  assert.equal(s.history.length, 1, "the session stays saved");
});

test("a verified verdict banks verified XP once, capped by the server's measurement", async () => {
  const store = await loadStore();
  store.getState().completeQuest(sessionQuest(191));
  store.getState().recordMovementXpEstimate("mv-synthetic-c02", 191, true);
  store.getState().recordMovementXpEstimate("mv-synthetic-c02", 191, true); // re-save cannot double
  const v = verdict("mv-synthetic-c02", { verifiedDistanceMeters: 150, verifiedDurationSeconds: 110 });
  for (let i = 0; i < 3; i++) store.getState().settleMovementXp(v);
  const s = store.getState();
  const server = sessionXp(150, 110_000);
  assert.equal(s.verifiedXp, server);
  assert.equal(s.totalXp, server, "the provisional excess is taken back");
  assert.equal(s.movementXp.length, 1);
  assert.equal(movementXpStatus(s.movementXp[0]!), "verified");
});

test("no verdict: the estimate stands as Pending verification or Saved locally", () => {
  const pending = recordEstimate([], { clientSessionId: "mv-a", estimatedXp: 30, submitted: true, savedAt: "x" })[0]!;
  const local = recordEstimate([], { clientSessionId: "mv-b", estimatedXp: 30, submitted: false, savedAt: "x" })[0]!;
  assert.equal(movementXpStatus(pending), "pending_verification");
  assert.equal(movementXpStatus(pending, { kind: "pending", reason: "offline" }), "pending_verification");
  assert.equal(movementXpStatus(local), "saved_locally");
  assert.equal(movementXpStatus(local, { kind: "rejected", reasons: [] }), "not_eligible");
  /* A verdict for another session settles nothing. */
  const other = settle([pending], verdict("mv-z", {}), sessionXp);
  assert.deepEqual([other.totalXpDelta, other.verifiedXpDelta], [0, 0]);
});

test("Save and retry both settle estimated XP; the store ledger is reset-clearing", () => {
  const root = resolve(__dirname, "../../..");
  const summary = readFileSync(resolve(root, "app/move/summary.tsx"), "utf8");
  const retry = readFileSync(resolve(root, "src/hooks/useVerificationRetry.ts"), "utf8");
  assert.match(summary, /recordMovementXpEstimate\(session\.clientSessionId, outcome\.xpGained,/);
  assert.match(summary, /settleMovementXp\(record\)/);
  assert.match(retry, /settleMovementXp\(record\)/);
  const store = readFileSync(resolve(root, "src/store/useGameStore.ts"), "utf8");
  const reset = store.slice(store.indexOf("reset: () =>"));
  assert.match(reset, /movementXp: \[\],\s*verifiedXp: 0,/);
});
