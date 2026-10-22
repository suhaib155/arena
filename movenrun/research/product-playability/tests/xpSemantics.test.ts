/**
 * Earned-progress semantics through the real game store
 * (mobile/src/store/useGameStore.ts), with AsyncStorage replaced by memory.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useGameStore } from "../../../mobile/src/store/useGameStore";
import { questService } from "../../../mobile/src/services/questService";
import { SESSION_QUEST_ID } from "../../../mobile/src/lib/sessionQuest";
import type { Quest } from "../../../mobile/src/types";

const movementQuest = (xp: number): Quest => ({
  id: SESSION_QUEST_ID, title: "Movement Session", summary: "", description: "", category: "Cardio",
  difficulty: "Medium", durationSeconds: 300, xpReward: xp, icon: "navigate", instructions: [],
});

function fresh() { useGameStore.getState().reset(); }

test("a timed quest finished before its time awards nothing and is closed", () => {
  fresh();
  const quest = questService.listQuests()[0]!;
  const attempt = useGameStore.getState().startQuest(quest.id)!;
  useGameStore.getState().advanceQuest(attempt.id, (quest.durationSeconds - 5) * 1000);
  const outcome = useGameStore.getState().finishQuest(attempt.id)!;
  assert.equal(outcome.xpGained, 0);
  assert.equal(useGameStore.getState().totalXp, 0);
  assert.equal(useGameStore.getState().questAttempt?.status, "abandoned");
});

test("finishing the same timed attempt twice (double tap, remount) awards once", () => {
  fresh();
  const quest = questService.listQuests()[0]!;
  const attempt = useGameStore.getState().startQuest(quest.id)!;
  useGameStore.getState().advanceQuest(attempt.id, quest.durationSeconds * 1000);
  const first = useGameStore.getState().finishQuest(attempt.id)!;
  const second = useGameStore.getState().finishQuest(attempt.id)!;
  assert.equal(first.xpGained, quest.xpReward);
  assert.deepEqual(second, first, "the settled outcome is replayed, not re-earned");
  assert.equal(useGameStore.getState().totalXp, quest.xpReward);
});

test("movement XP banks once per local day: a second saved walk the same day earns 0", () => {
  fresh();
  const a = useGameStore.getState().completeQuest(movementQuest(40));
  const b = useGameStore.getState().completeQuest(movementQuest(90));
  assert.equal(a.xpGained, 40);
  assert.equal(b.xpGained, 0);
  assert.equal(b.alreadyAwarded, true);
  assert.equal(useGameStore.getState().totalXp, 40);
});

test("FINDING MR-A-08: the day key is the phone's clock, so moving the date forward re-opens movement XP", () => {
  fresh();
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 22, 12, 0, 0) });
  try {
    useGameStore.getState().completeQuest(movementQuest(40));
    mock.timers.setTime(Date.UTC(2026, 9, 23, 12, 0, 0)); // the player changes the date in Settings
    const again = useGameStore.getState().completeQuest(movementQuest(40));
    assert.equal(again.xpGained, 40, "XP is local-only in v1, so the impact is the player's own number");
    assert.equal(useGameStore.getState().streak, 2, "and the streak advances");
  } finally {
    mock.timers.reset();
  }
});

test("verification and its retry queue cannot award XP: they never reach the game store", () => {
  const services = join(__dirname, "../../../mobile/src/services");
  for (const file of ["verifySession.ts", "verificationQueue.ts", "verificationQueueStorage.ts", "movementApi.ts"]) {
    const code = readFileSync(join(services, file), "utf8");
    assert.ok(!/useGameStore|completeQuest/.test(code), `${file} must not touch earned progress`);
  }
  const lib = readFileSync(join(__dirname, "../../../mobile/src/lib/pendingVerification.ts"), "utf8");
  assert.ok(!/useGameStore|completeQuest/.test(lib));
});

test("FINDING MR-A-09: XP is banked at Save, before and regardless of the server verdict", () => {
  const summary = readFileSync(join(__dirname, "../../../mobile/app/move/summary.tsx"), "utf8");
  const award = summary.indexOf("if (movedOverGround) completeQuest(sessionQuest);");
  const submit = summary.indexOf("void submitCompletedSession(");
  assert.ok(award > 0 && submit > award, "award precedes the fire-and-forget submission");
});
