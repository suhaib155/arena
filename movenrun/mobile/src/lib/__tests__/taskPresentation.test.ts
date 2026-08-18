/**
 * Task presentation guards — the model owns how a task looks, not the screen.
 *
 * The spotlight button used to be `icon="play"`, a constant. Every task
 * rendered a ▶ regardless of what pressing it did, so "Browse clubs", "View
 * territory" and "See how it works" all advertised playback. The board had
 * carried the semantics the whole time (`action`, `tone`, `icon`); the button
 * simply never asked, and nothing failed when it didn't — which is why this
 * file exists.
 *
 * Two layers of proof:
 *  - **compile time** — the maps are `Record<Union, …>` and the coverage
 *    assertions below are type-level, so adding a `TaskAction` or `TaskKind`
 *    without deciding its presentation fails `tsc --noEmit`, not a test run.
 *  - **run time** — every task the board can actually emit is walked, and the
 *    screen source is checked for the constant that caused the bug.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  TASK_ACTION_ICON,
  buildTodayBoard,
  type Task,
  type TaskAction,
  type TaskKind,
  type TaskTone,
  type TodayBoardInput,
} from "../tasks";

/* ── compile-time exhaustiveness ──────────────────────────────────────────── */

/** Every action the board can ask for. `satisfies` pins each entry to the
 *  union; the `Exclude<>` check below pins the union to this list. */
const ALL_ACTIONS = ["move", "territory", "quest", "clubs"] as const satisfies readonly TaskAction[];
const ALL_TONES = ["primary", "danger", "gold", "green"] as const satisfies readonly TaskTone[];
const ALL_KINDS = [
  "resume",
  "defend",
  "move",
  "quest",
  "capture",
  "club",
] as const satisfies readonly TaskKind[];

/** `true` only while the list covers the whole union — otherwise this alias is
 *  `never` and the assignment below is a type error. Adding a new TaskAction
 *  therefore breaks the build here *and* at TASK_ACTION_ICON, which is exactly
 *  the "fail loudly" behaviour a silent icon fallback denied us. */
type Covers<Union extends string, Listed extends string> = [Exclude<Union, Listed>] extends [never]
  ? true
  : never;

const ACTIONS_ARE_EXHAUSTIVE: Covers<TaskAction, (typeof ALL_ACTIONS)[number]> = true;
const TONES_ARE_EXHAUSTIVE: Covers<TaskTone, (typeof ALL_TONES)[number]> = true;
const KINDS_ARE_EXHAUSTIVE: Covers<TaskKind, (typeof ALL_KINDS)[number]> = true;

/* ── the whole space of boards the app can produce ────────────────────────── */

const BASE: TodayBoardInput = {
  hasRecoverableMovement: false,
  movedToday: false,
  atRiskZoneCount: 0,
  zonesOwned: 0,
  dailyQuestTitle: "Sunrise Mobility",
  dailyQuestXp: 40,
  dailyQuestDone: false,
  hasClub: false,
};

/** Inputs chosen to surface every one of the six task kinds at least once. */
const INPUTS: TodayBoardInput[] = [
  BASE,
  { ...BASE, hasRecoverableMovement: true },
  { ...BASE, atRiskZoneCount: 1, zonesOwned: 2 },
  { ...BASE, atRiskZoneCount: 3, zonesOwned: 5, hasClub: true },
  { ...BASE, movedToday: true, dailyQuestDone: true },
  { ...BASE, zonesOwned: 1, hasClub: true },
  { ...BASE, movedToday: true, zonesOwned: 4, hasClub: true, dailyQuestDone: true },
];

/** Every task the board can emit, spotlight included, deduplicated by id. */
function everyTask(): Task[] {
  const seen = new Map<TaskKind, Task>();
  for (const input of INPUTS) {
    const board = buildTodayBoard(input);
    for (const task of [board.focus, ...board.tasks]) {
      if (task && !seen.has(task.id)) seen.set(task.id, task);
    }
  }
  return [...seen.values()];
}

/* ── presentation ─────────────────────────────────────────────────────────── */

test("the input space really does reach every task kind", () => {
  // Otherwise the assertions below would pass by never looking.
  assert.deepEqual(everyTask().map((t) => t.id).sort(), [...ALL_KINDS].sort());
  assert.ok(ACTIONS_ARE_EXHAUSTIVE && TONES_ARE_EXHAUSTIVE && KINDS_ARE_EXHAUSTIVE);
});

test("every task resolves a CTA glyph and an accent from its own semantics", () => {
  for (const task of everyTask()) {
    const icon = TASK_ACTION_ICON[task.action];
    assert.ok(icon, `${task.id} (action ${task.action}) has no CTA glyph`);
    assert.ok(
      ALL_TONES.includes(task.tone),
      `${task.id} carries tone ${task.tone}, which TASK_TINT does not cover`,
    );
  }
});

test("the CTA glyph tracks the destination, so unrelated actions never share one", () => {
  const icons = ALL_ACTIONS.map((a) => TASK_ACTION_ICON[a]);
  assert.equal(new Set(icons).size, icons.length, "two different destinations drew the same glyph");

  // The concrete regression: these three used to be identical (all ▶).
  const defend = everyTask().find((t) => t.id === "defend");
  const club = everyTask().find((t) => t.id === "club");
  const quest = everyTask().find((t) => t.id === "quest");
  assert.ok(defend && club && quest);
  const glyphs = [defend, club, quest].map((t) => TASK_ACTION_ICON[t.action]);
  assert.equal(new Set(glyphs).size, 3, "territory, clubs and quest must not look alike");
});

test("a movement task and a non-movement task never share a CTA glyph", () => {
  const move = TASK_ACTION_ICON.move;
  for (const action of ALL_ACTIONS) {
    if (action === "move") continue;
    assert.notEqual(TASK_ACTION_ICON[action], move, `${action} must not look like starting a move`);
  }
});

/* ── the hero asks the model rather than hardcoding ───────────────────────── */

const HERO = readFileSync(join(process.cwd(), "src", "components", "TaskHero.tsx"), "utf8");

test("TaskHero derives its button glyph and hardcodes none", () => {
  assert.match(HERO, /icon=\{TASK_ACTION_ICON\[task\.action\]\}/, "the CTA must ask the model");
  // The exact regression: a literal glyph on any Button in the hero.
  const literalIcons = [...HERO.matchAll(/icon="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(literalIcons, [], `TaskHero hardcodes ${literalIcons.join(", ")}`);
  assert.ok(!/icon="play"/.test(HERO), "the play-icon regression is back");
});

test("the all-clear state is the only place a glyph is chosen without a task", () => {
  // There is no task to derive from when the board is finished, so the
  // checkmark is spelled out — but the "move anyway" button still routes
  // through the map, because it IS a move.
  assert.match(HERO, /name=\{task \? task\.icon : "checkmark-done"\}/);
  assert.match(HERO, /icon=\{TASK_ACTION_ICON\.move\}/);
});

/* ── routing is unchanged ─────────────────────────────────────────────────── */

test("Home still resolves every action to a route, and only there", () => {
  const home = readFileSync(join(process.cwd(), "app", "(tabs)", "index.tsx"), "utf8");
  for (const action of ALL_ACTIONS) {
    assert.match(home, new RegExp(`case "${action}":`), `no route for action ${action}`);
  }
  // The model owns glyphs and the screen owns routes; neither takes the other's
  // job. `lib/tasks.ts` must stay free of routes...
  const model = readFileSync(join(process.cwd(), "src", "lib", "tasks.ts"), "utf8");
  assert.ok(!/router\.|push\("\//.test(model), "the model must not name routes");
  // ...and TASK_TINT must still cover every tone, checked from source because
  // it reaches the palette and therefore React Native, which this runner
  // cannot load.
  const tone = readFileSync(join(process.cwd(), "src", "components", "taskTone.ts"), "utf8");
  for (const t of ALL_TONES) {
    assert.match(tone, new RegExp(`\\b${t}:`), `TASK_TINT has no colour for tone ${t}`);
  }
});

/* ── the dead field is gone, and nothing else moved ───────────────────────── */

test("Task carries no redundant `kind` beside its id", () => {
  for (const task of everyTask()) {
    assert.ok(
      !("kind" in task),
      "`kind` duplicated `id` in every builder and was read by nothing — a model " +
        "field that looks like the presentation discriminator without being one is " +
        "how the hero came to hardcode its icon",
    );
  }
  const src = readFileSync(join(process.cwd(), "src", "lib", "tasks.ts"), "utf8");
  assert.ok(!/^\s*kind: "/m.test(src), "a builder is setting `kind` again");
});

test("XP, completion and priority semantics are untouched", () => {
  const board = buildTodayBoard(BASE);
  assert.equal(board.focus?.id, "move", "movement still takes the spotlight");
  assert.equal(board.progressLabel, "0 of 4 done");

  const done = buildTodayBoard({ ...BASE, movedToday: true, dailyQuestDone: true, zonesOwned: 1, hasClub: true });
  assert.equal(done.focus, null);
  assert.ok(done.allDone);
  assert.equal(done.progress, 1);

  // Only the daily quest is XP-bearing, and its reward passes through verbatim.
  const rewarded = everyTask().filter((t) => t.reward > 0);
  assert.deepEqual(rewarded.map((t) => t.id), ["quest"]);
  assert.equal(rewarded[0].reward, BASE.dailyQuestXp);
});
