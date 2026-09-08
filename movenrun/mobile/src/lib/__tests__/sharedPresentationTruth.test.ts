import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function component(name: string): string {
  return readFileSync(join(process.cwd(), "src", "components", `${name}.tsx`), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function assertReadOnly(src: string): void {
  assert.doesNotMatch(src, /useGameStore|useAuthStore|AsyncStorage|setState|setTotalXp|awardXp|completeQuest|completeSession|fetch\s*\(/);
}

function assertPlayerTruth(src: string): void {
  assertReadOnly(src);
  assert.match(src, /const level = getLevelInfo\(totalXp\)/);
  assert.match(src, /<Text style=\{styles\.xp\}>\{totalXp\.toLocaleString\(\)\} XP<\/Text>/);
  assert.match(src, /LEVEL \{level\.level\}/);
  assert.match(src, /<XPBar progress=\{level\.progress\}/);
  assert.match(src, /\{level\.xpForLevel - level\.xpIntoLevel\} XP to level \{level\.level \+ 1\}/);
  assert.doesNotMatch(src, /Locked MOVE|balance|wallet|city rank/i);
}

function assertMissionTruth(src: string): void {
  assertReadOnly(src);
  assert.match(src, /task: Task/);
  assert.match(src, /<ScalePress onPress=\{onPress\}/);
  assert.match(src, /<Text style=\{styles\.title\}>\{task\.title\}<\/Text>/);
  assert.match(src, /<Text style=\{styles\.detail\}>\{task\.detail\}<\/Text>/);
  assert.match(src, /<Text style=\{styles\.progress\}>\{progressLabel\}<\/Text>/);
  assert.match(src, /\{task\.reward > 0 \? <Text style=\{styles\.reward\}>\{task\.reward\} XP objective<\/Text> : null\}/);
  assert.doesNotMatch(src, /XP earned|XP awarded|claim reward|reward unlocked/i);
}

test("PlayerHud presents caller XP and derived level without a fictional balance", () => {
  assertPlayerTruth(component("PlayerHud"));
});

test("MissionCard presents the real task and its pending objective reward without awarding it", () => {
  assertMissionTruth(component("MissionCard"));
});

for (const [name, file, guard, mutate] of [
  ["fake XP", "PlayerHud", assertPlayerTruth, (src: string) => src.replace("{totalXp.toLocaleString()}", "{99999}")],
  ["fake level", "PlayerHud", assertPlayerTruth, (src: string) => src.replace("getLevelInfo(totalXp)", "getLevelInfo(99999)")],
  ["fake mission reward", "MissionCard", assertMissionTruth, (src: string) => src.replace("{task.reward} XP objective", "{99999} XP objective")],
  ["pending reward described as earned", "MissionCard", assertMissionTruth, (src: string) => src.replace("XP objective", "XP earned")],
  ["reward mutation on press", "MissionCard", assertMissionTruth, (src: string) => src.replace("onPress={onPress}", "onPress={() => awardXp(task.reward)}")],
] as const) {
  test(`Shared presentation guard rejects ${name}`, () => {
    const src = component(file);
    const mutated = mutate(src);
    assert.notEqual(mutated, src, "mutation must exercise current source");
    assert.throws(() => guard(mutated), assert.AssertionError);
  });
}
