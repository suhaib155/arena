/**
 * Task board rules.
 *
 * The invariants here are the ones that were previously enforced by hand
 * across four modules and a screen: one spotlight task, never rendered twice,
 * priority that doesn't drift, and a progress line that matches what's on
 * screen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boardInputFromState,
  buildTodayBoard,
  TASK_CAP,
  xpEarnedToday,
  type TodayBoardInput,
  type TaskKind,
} from "../tasks";
import { SESSION_QUEST_ID, isMovementSession } from "../sessionQuest";
import type { Zone } from "@/types";

/** A player mid-game with nothing outstanding but the daily tasks. */
const BASE: TodayBoardInput = {
  hasRecoverableMovement: false,
  movedToday: false,
  atRiskZoneCount: 0,
  zonesOwned: 3,
  dailyQuestTitle: "Sunrise Mobility",
  dailyQuestXp: 40,
  dailyQuestDone: false,
  hasClub: true,
};

const board = (over: Partial<TodayBoardInput> = {}) => buildTodayBoard({ ...BASE, ...over });
const ids = (over: Partial<TodayBoardInput> = {}) => {
  const b = board(over);
  return [...(b.focus ? [b.focus.id] : []), ...b.tasks.map((t) => t.id)];
};

/** Every meaningfully different player state, for the property tests below. */
function everyInput(): TodayBoardInput[] {
  const out: TodayBoardInput[] = [];
  for (const hasRecoverableMovement of [false, true])
    for (const movedToday of [false, true])
      for (const atRiskZoneCount of [0, 1, 4])
        for (const zonesOwned of [0, 1, 9])
          for (const dailyQuestDone of [false, true])
            for (const hasClub of [false, true]) {
              // At-risk zones you don't own is not a state the game can be in.
              if (atRiskZoneCount > zonesOwned) continue;
              out.push({
                ...BASE,
                hasRecoverableMovement,
                movedToday,
                atRiskZoneCount,
                zonesOwned,
                dailyQuestDone,
                hasClub,
              });
            }
  return out;
}

// ---- the invariants --------------------------------------------------------

test("the spotlight task is never also a row", () => {
  // This is the duplicate-CTA bug expressed as a property: Home rendered a
  // "start moving" hero AND a "start moving" card for brand-new users.
  for (const input of everyInput()) {
    const b = buildTodayBoard(input);
    if (!b.focus) continue;
    assert.ok(
      !b.tasks.some((t) => t.id === b.focus!.id),
      `${b.focus.id} appears in both the spotlight and the list`,
    );
  }
});

test("the spotlight is always the highest-priority unfinished task", () => {
  for (const input of everyInput()) {
    const b = buildTodayBoard(input);
    if (!b.focus) {
      assert.ok(b.tasks.every((t) => t.state === "done"), "no spotlight implies nothing left to do");
      continue;
    }
    assert.equal(b.focus.state, "todo", "the spotlight is something still to do");
    // Nothing before it in the rendered order is also outstanding.
    const order = ids(input as Partial<TodayBoardInput>);
    const firstTodo = [b.focus, ...b.tasks].find((t) => t.state === "todo");
    assert.equal(firstTodo?.id, b.focus.id);
    assert.equal(order[0], b.focus.id, "the spotlight leads the board");
  }
});

test("allDone agrees with the spotlight and with the counts", () => {
  for (const input of everyInput()) {
    const b = buildTodayBoard(input);
    assert.equal(b.allDone, b.focus === null);
    if (b.allDone) assert.equal(b.doneCount, b.totalCount);
    else assert.ok(b.doneCount < b.totalCount);
  }
});

test("the progress line matches the tasks actually on the board", () => {
  for (const input of everyInput()) {
    const b = buildTodayBoard(input);
    const rendered = [...(b.focus ? [b.focus] : []), ...b.tasks];
    assert.equal(rendered.length, b.totalCount, "totalCount counts what is shown");
    assert.equal(rendered.filter((t) => t.state === "done").length, b.doneCount);
    assert.equal(b.progressLabel, `${b.doneCount} of ${b.totalCount} done`);
    assert.ok(b.progress >= 0 && b.progress <= 1);
  }
});

test("the board never outgrows its cap and never repeats a task", () => {
  for (const input of everyInput()) {
    const list = ids(input as Partial<TodayBoardInput>);
    assert.ok(list.length <= TASK_CAP, `${list.length} tasks exceeds the cap`);
    assert.ok(list.length > 0, "the board is never empty");
    assert.equal(new Set(list).size, list.length, `duplicate task in ${list.join(", ")}`);
  }
});

test("every task carries what a row needs to render", () => {
  for (const input of everyInput()) {
    const b = buildTodayBoard(input);
    for (const t of [...(b.focus ? [b.focus] : []), ...b.tasks]) {
      assert.ok(t.title.length > 0 && t.title.length <= 40, `bad title: ${t.title}`);
      assert.ok(t.detail.endsWith("."), `detail should read as a sentence: ${t.detail}`);
      assert.ok(t.icon.length > 0);
      assert.ok(t.reward >= 0);
      // The spotlight button takes its words from the task, so every task
      // must be able to fill it — including the ones that are already done.
      assert.ok(t.cta.length > 0 && t.cta.length <= 20, `bad cta: ${t.cta}`);
    }
  }
});

// ---- priority --------------------------------------------------------------

test("an interrupted session outranks everything", () => {
  assert.equal(board({ hasRecoverableMovement: true }).focus?.id, "resume");
  // Even with ground at stake, finishing the session comes first.
  assert.equal(
    board({ hasRecoverableMovement: true, atRiskZoneCount: 3 }).focus?.id,
    "resume",
  );
});

test("losable ground outranks the daily routine", () => {
  const b = board({ atRiskZoneCount: 2 });
  assert.equal(b.focus?.id, "defend");
  assert.equal(b.focus?.tone, "danger");
  assert.match(b.focus!.title, /2 zones/);
});

test("a single at-risk zone reads in the singular", () => {
  assert.equal(board({ atRiskZoneCount: 1, zonesOwned: 1 }).focus?.title, "Defend your zone");
});

// ---- the three flavours of task -------------------------------------------

test("daily tasks are always on the board, done or not", () => {
  for (const movedToday of [false, true])
    for (const dailyQuestDone of [false, true]) {
      const list = ids({ movedToday, dailyQuestDone });
      assert.ok(list.includes("move"), "move is a daily task");
      assert.ok(list.includes("quest"), "the daily quest is a daily task");
    }
});

test("milestone tasks leave the board once achieved", () => {
  assert.ok(ids({ zonesOwned: 0 }).includes("capture"));
  assert.ok(!ids({ zonesOwned: 1 }).includes("capture"), "first capture is not repeatable");
  assert.ok(ids({ hasClub: false }).includes("club"));
  assert.ok(!ids({ hasClub: true }).includes("club"), "you only pick a club once");
});

test("conditional tasks appear only while their condition holds", () => {
  assert.ok(!ids().includes("resume"));
  assert.ok(ids({ hasRecoverableMovement: true }).includes("resume"));
  assert.ok(!ids().includes("defend"));
  assert.ok(ids({ atRiskZoneCount: 1 }).includes("defend"));
});

test("a brand new player gets a board they can finish", () => {
  const b = board({ zonesOwned: 0, hasClub: false, movedToday: false, dailyQuestDone: false });
  assert.equal(b.focus?.id, "move");
  assert.equal(b.focus?.title, "Make your first move");
  assert.deepEqual(b.tasks.map((t) => t.id), ["quest", "capture", "club"] satisfies TaskKind[]);
  assert.equal(b.progressLabel, "0 of 4 done");
});

test("a player who has done everything sees no spotlight", () => {
  const b = board({ movedToday: true, dailyQuestDone: true });
  assert.equal(b.focus, null);
  assert.ok(b.allDone);
  assert.equal(b.progressLabel, "2 of 2 done");
  assert.equal(b.progress, 1);
});

test("the daily quest carries its own title and reward", () => {
  const b = board({ dailyQuestTitle: "Hill Repeats", dailyQuestXp: 75 });
  const quest = [b.focus, ...b.tasks].find((t) => t?.id === "quest");
  assert.equal(quest?.title, "Hill Repeats");
  assert.equal(quest?.reward, 75);
});

// ---- store state → board input ---------------------------------------------
//
// These are the tests that were missing. `buildTodayBoard` takes `movedToday`
// as an *input*, so no amount of testing it could ever catch a wrong
// derivation — and the derivation was wrong: it counted any completion today,
// so an indoor warmup quest ticked "Move today".

const NOW = new Date("2026-08-09T14:00:00Z");
const at = (iso: string) => new Date(iso).toISOString();

/** A completion record as the store writes it. */
const completion = (questId: string, iso: string, xp = 10) => ({
  questId,
  completedAt: at(iso),
  xp,
});

/** A zone last defended `daysAgo`, so its derived health is controllable. */
function zone(id: string, daysAgo: number, defensePercent = 100): Zone {
  const touched = new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();
  return {
    id,
    name: `Zone ${id}`,
    state: "yours",
    controlPercent: 100,
    defensePercent,
    lastTouchedAt: touched,
    capturedAt: touched,
    lastDefendedAt: touched,
    lastFortifiedAt: null,
    fortifyCount: 0,
    isDeedPreview: false,
    isDemo: false,
  };
}

const SOURCE = {
  history: [] as { questId: string; completedAt: string; xp: number }[],
  zones: [] as Zone[],
  dailyQuestTitle: "Sunrise Mobility",
  dailyQuestXp: 40,
  dailyQuestDone: false,
  hasClub: true,
  now: NOW,
};
const from = (over: Partial<typeof SOURCE> = {}) => boardInputFromState({ ...SOURCE, ...over });

test("a warmup quest completed today is NOT a move", () => {
  // The regression, stated directly. A sixty-second indoor mobility quest must
  // never satisfy the movement task.
  const input = from({ history: [completion("warmup-mobility", "2026-08-09T09:00:00Z")] });
  assert.equal(input.movedToday, false);

  const board = buildTodayBoard(input);
  const move = [board.focus, ...board.tasks].find((t) => t?.id === "move");
  assert.equal(move?.state, "todo", "the board must still be asking the user to move");
});

test("a movement session completed today IS a move", () => {
  const input = from({ history: [completion(SESSION_QUEST_ID, "2026-08-09T09:00:00Z")] });
  assert.equal(input.movedToday, true);

  const board = buildTodayBoard(input);
  const move = [board.focus, ...board.tasks].find((t) => t?.id === "move");
  assert.equal(move?.state, "done");
});

test("only TODAY's movement counts", () => {
  assert.equal(from({ history: [completion(SESSION_QUEST_ID, "2026-08-08T23:59:00Z")] }).movedToday,
    false, "yesterday's session does not carry over");
  assert.equal(from({ history: [completion(SESSION_QUEST_ID, "2026-08-10T00:01:00Z")] }).movedToday,
    false, "a future-dated record is not today");
});

test("a mixed history is judged only on its movement sessions", () => {
  const input = from({
    history: [
      completion("warmup-mobility", "2026-08-09T12:00:00Z"),
      completion("warmup-cardio", "2026-08-09T08:00:00Z"),
      completion(SESSION_QUEST_ID, "2026-08-07T08:00:00Z"),
    ],
  });
  assert.equal(input.movedToday, false, "two warmups today plus an old session is not moving today");

  const withSession = from({
    history: [
      completion("warmup-mobility", "2026-08-09T12:00:00Z"),
      completion(SESSION_QUEST_ID, "2026-08-09T07:00:00Z"),
    ],
  });
  assert.equal(withSession.movedToday, true);
});

test("XP today counts every completion, movement or warmup", () => {
  // Deliberately different from movedToday: a warmup really did award its XP.
  const history = [
    completion("warmup-mobility", "2026-08-09T12:00:00Z", 40),
    completion(SESSION_QUEST_ID, "2026-08-09T07:00:00Z", 120),
    completion("warmup-cardio", "2026-08-08T12:00:00Z", 999),
  ];
  assert.equal(xpEarnedToday(history, NOW), 160);
});

test("the movement-session predicate has exactly one owner", () => {
  assert.equal(SESSION_QUEST_ID, "move-session");
  assert.equal(isMovementSession({ questId: SESSION_QUEST_ID }), true);
  assert.equal(isMovementSession({ questId: "warmup-mobility" }), false);
});

test("zone counts are derived from zone health, not from raw ownership", () => {
  const fresh = zone("a", 0);
  const neglected = zone("b", 6, 20);
  const input = from({ zones: [fresh, neglected] });
  assert.equal(input.zonesOwned, 2, "both are owned");
  assert.equal(input.atRiskZoneCount, 1, "only the neglected one needs defending");
  assert.equal(from({ zones: [fresh] }).atRiskZoneCount, 0);
  assert.equal(from().zonesOwned, 0);
});

test("the daily quest is passed through unchanged", () => {
  const input = from({ dailyQuestTitle: "Hill Repeats", dailyQuestXp: 75, dailyQuestDone: true });
  assert.equal(input.dailyQuestTitle, "Hill Repeats");
  assert.equal(input.dailyQuestXp, 75);
  assert.equal(input.dailyQuestDone, true);
});

test("resume is honestly false until movement recovery exists", () => {
  // Recovery is not implemented: a finished route lives only in memory during
  // the summary flow. Claiming otherwise would surface an unusable task.
  assert.equal(from({ history: [completion(SESSION_QUEST_ID, "2026-08-09T09:00:00Z")] })
    .hasRecoverableMovement, false);
});
