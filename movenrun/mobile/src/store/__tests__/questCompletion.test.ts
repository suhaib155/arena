import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import { questService } from "../../services/questService";

// Execute the real store with only its native storage/queue boundaries replaced.
// The reward action, Zustand persistence and all quest definitions are unchanged.
async function loadStore(initial: string | null = null) {
  const root = resolve(__dirname, "../..");
  const filename = resolve(root, "store/useGameStore.ts");
  const require = createRequire(filename);
  let stored = initial;
  const storage = {
    getItem: () => stored,
    setItem: (_key: string, value: string) => { stored = value; },
    removeItem: () => { stored = null; },
  };
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
  return { store: module.exports.useGameStore, snapshot: () => stored };
}

test("Sunrise Sprint cannot award XP without a completed timed attempt", async () => {
  const { store } = await loadStore();
  const quest = questService.getQuestById("sunrise-sprint")!;
  assert.equal(quest.durationSeconds, 90);
  const outcome = store.getState().completeQuest(quest);
  assert.equal(outcome.xpGained, 0);
  assert.equal(store.getState().totalXp, 0);
  assert.equal(store.getState().questsCompleted, 0);
  assert.equal(store.getState().history.length, 0);
});

test("early Finish with 01:24 left settles abandoned and never changes XP, streak or history", async () => {
  const { store } = await loadStore();
  const attempt = store.getState().startQuest("sunrise-sprint")!;
  store.getState().advanceQuest(attempt.id, 6000);
  const outcome = store.getState().finishQuest(attempt.id)!;
  assert.equal(outcome.completionSatisfied, false);
  assert.equal(outcome.xpGained, 0);
  assert.equal(store.getState().questAttempt?.status, "abandoned");
  assert.equal(store.getState().streak, 0);
  assert.equal(store.getState().totalXp, 0);
  assert.equal(store.getState().history.length, 0);
  store.getState().resumeQuest(attempt.id);
  store.getState().advanceQuest(attempt.id, 90000);
  store.getState().finishQuest(attempt.id);
  assert.equal(store.getState().totalXp, 0);
});

test("duration boundary is exact: 89.999 seconds cannot complete, 90 seconds can", async () => {
  for (const elapsed of [0, 89999, 90000, 120000]) {
    const { store } = await loadStore();
    const attempt = store.getState().startQuest("sunrise-sprint")!;
    store.getState().advanceQuest(attempt.id, elapsed);
    const outcome = store.getState().finishQuest(attempt.id)!;
    assert.equal(outcome.completionSatisfied, elapsed >= 90000);
    assert.equal(store.getState().totalXp, elapsed >= 90000 ? 120 : 0);
  }
});

test("paused time and invalid elapsed samples never count; resume keeps earned foreground time", async () => {
  const { store } = await loadStore();
  const attempt = store.getState().startQuest("sunrise-sprint")!;
  store.getState().advanceQuest(attempt.id, 30000);
  store.getState().pauseQuest(attempt.id);
  store.getState().advanceQuest(attempt.id, 86400000);
  assert.equal(store.getState().questAttempt?.activeMs, 30000);
  store.getState().resumeQuest(attempt.id);
  for (const invalid of [-1000, Number.NaN, Infinity]) store.getState().advanceQuest(attempt.id, invalid);
  assert.equal(store.getState().questAttempt?.activeMs, 30000);
  store.getState().advanceQuest(attempt.id, 60000);
  assert.equal(store.getState().finishQuest(attempt.id)?.xpGained, 120);
});

test("valid completion, duplicate Finish, result retry and persisted relaunch grant exactly one reward", async () => {
  const { store, snapshot } = await loadStore();
  const attempt = store.getState().startQuest("sunrise-sprint")!;
  store.getState().advanceQuest(attempt.id, 90000);
  const first = store.getState().finishQuest(attempt.id)!;
  assert.equal(first.xpGained, 120);
  for (let i = 0; i < 3; i++) store.getState().finishQuest(attempt.id);
  assert.equal(store.getState().totalXp, 120);
  assert.equal(store.getState().questsCompleted, 1);
  assert.equal(store.getState().history.length, 1);
  const restored = (await loadStore(snapshot())).store;
  restored.getState().finishQuest(attempt.id);
  assert.equal(restored.getState().totalXp, 120);
  // A settled attempt cannot become another completion after midnight.
  restored.setState({ lastActiveDay: "2000-01-01" });
  restored.getState().finishQuest(attempt.id);
  assert.equal(restored.getState().totalXp, 120);
  assert.equal(restored.getState().questsCompleted, 1);
  assert.equal(restored.getState().history.length, 1);
});

test("restart restores an unfinished quest paused and never credits offline wall time", async () => {
  const { store, snapshot } = await loadStore();
  const attempt = store.getState().startQuest("sunrise-sprint")!;
  store.getState().advanceQuest(attempt.id, 35000);
  const restored = (await loadStore(snapshot())).store;
  assert.equal(restored.getState().questAttempt?.status, "paused");
  assert.equal(restored.getState().startQuest("sunrise-sprint")?.id, attempt.id);
  restored.getState().advanceQuest(attempt.id, 86400000);
  assert.equal(restored.getState().questAttempt?.activeMs, 35000);
  restored.getState().resumeQuest(attempt.id);
  restored.getState().advanceQuest(attempt.id, 55000);
  assert.equal(restored.getState().finishQuest(attempt.id)?.xpGained, 120);
});

test("same-day replay requires completion but does not earn another reward", async () => {
  const { store } = await loadStore();
  for (let replay = 0; replay < 2; replay++) {
    const attempt = store.getState().startQuest("sunrise-sprint")!;
    store.getState().advanceQuest(attempt.id, 90000);
    const outcome = store.getState().finishQuest(attempt.id)!;
    assert.equal(outcome.xpGained, replay === 0 ? 120 : 0);
    assert.equal(outcome.alreadyAwarded, replay === 1);
  }
  assert.equal(store.getState().totalXp, 120);
  assert.equal(store.getState().questsCompleted, 1);
});

test("caller cannot substitute another attempt, shorten definition, or inflate its reward", async () => {
  const { store } = await loadStore();
  const quest = questService.getQuestById("sunrise-sprint")!;
  const attempt = store.getState().startQuest(quest.id)!;
  store.getState().advanceQuest(attempt.id, 89999);
  assert.equal(store.getState().completeQuest({ ...quest, durationSeconds: 1 }, "wrong-id").xpGained, 0);
  store.getState().advanceQuest(attempt.id, 1);
  const outcome = store.getState().completeQuest({ ...quest, xpReward: 99999 }, attempt.id);
  assert.equal(outcome.xpGained, 120);
});

test("GPS summary reward path retains its existing independent saveability caller gate", async () => {
  const { store } = await loadStore();
  const quest = { ...questService.getQuestById("sunrise-sprint")!, id: "move-session", xpReward: 35 };
  assert.equal(store.getState().completeQuest(quest).xpGained, 35);
  assert.equal(store.getState().completeQuest(quest).xpGained, 0);
  assert.equal(store.getState().totalXp, 35);
});

test("reset removes the persisted attempt; hydration is required before starting", async () => {
  const { store } = await loadStore();
  store.setState({ _hydrated: false });
  assert.equal(store.getState().startQuest("sunrise-sprint"), null);
  store.setState({ _hydrated: true });
  store.getState().startQuest("sunrise-sprint");
  await store.getState().reset();
  assert.equal(store.getState().questAttempt, null);
});

test("result screen cannot award and active route uses persisted guarded settlement", () => {
  const mobile = resolve(__dirname, "../../..");
  const result = readFileSync(resolve(mobile, "app/result.tsx"), "utf8");
  const active = readFileSync(resolve(mobile, "app/active.tsx"), "utf8");
  assert.ok(!/completeQuest\s*\(|finishQuest\s*\(/.test(result));
  assert.ok(result.includes("attempt.id === attemptId"));
  assert.ok(result.includes("outcome?.completionSatisfied"));
  assert.ok(active.includes("finishQuest(current.id)"));
  assert.ok(active.includes("AppState.addEventListener"));
  assert.ok(active.includes("performance.now()"));
  assert.ok(!active.includes("setRemaining"));
});
