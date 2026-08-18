/**
 * The task board — the one thing MovenRun asks you to do today.
 *
 * Home used to stack a hero, a mission card, an "up next" list, a daily quest
 * and a warmup quest list, each built by its own module with its own vocabulary
 * ("mission", "objective", "questline step", "quest"). Five names for one idea:
 * *something the player should do*. The screen had to reconcile them, so the
 * reconciliation logic lived in the screen — which is exactly where it could
 * not be tested.
 *
 * There is now one noun. A {@link Task} is anything the app asks of you, and
 * {@link buildTodayBoard} is the single function that decides which tasks are
 * on today's board, which are already done, and which one gets the spotlight.
 *
 * Pure: no store, no React, no I/O. The screen passes plain state in and
 * renders what comes back.
 */
import type { IoniconName, Zone } from "@/types";
import { getLocalDateKey } from "./date";
import { isMovementSession } from "./sessionQuest";
import { zoneStatus } from "./territory";

/** The closed set of tasks the board can ask for. Each one appears at most
 *  once, so this doubles as a task's identity — see {@link Task.id}. */
export type TaskKind = "resume" | "defend" | "move" | "quest" | "capture" | "club";

/** Done or not. There is no third state — a task you cannot do yet is simply
 *  not on the board. */
export type TaskState = "todo" | "done";

/** Where a task goes when tapped. Semantic, so this module never names a
 *  route; the screen owns that mapping. */
export type TaskAction = "move" | "territory" | "quest" | "clubs";

/**
 * The glyph on a task's call-to-action button.
 *
 * Keyed on the destination — what pressing the button *does* — and not on the
 * task's own {@link Task.icon}, which is its identity in the leading disc. The
 * two answer different questions: `defend` is a shield that opens the
 * territory map, so the disc is a shield and the button is a map. Drawing the
 * task icon in both places says the same thing twice and leaves the
 * destination unannounced.
 *
 * It lives here rather than beside the colour map in `components/taskTone.ts`
 * because a glyph name is model data — `Task.icon` is already an
 * `IoniconName` — while a colour needs the palette, and the palette needs
 * React Native. Keeping it here is what lets the offline suite verify it.
 *
 * This exists because the hero button hardcoded `icon="play"`. Every spotlight
 * rendered a play triangle regardless of destination, so "Browse clubs",
 * "View territory" and "See how it works" all advertised playback. The board
 * had carried the semantics all along; the button simply never asked.
 *
 * `Record<TaskAction, …>`: a new action without a decided glyph is a type
 * error, not a silent fallback.
 */
export const TASK_ACTION_ICON: Record<TaskAction, IoniconName> = {
  move: "walk-outline",
  territory: "map-outline",
  quest: "flash-outline",
  clubs: "people-outline",
};

/** Colour intent. Semantic, never decorative — see the tone map in the screen. */
export type TaskTone = "primary" | "danger" | "gold" | "green";

export interface Task {
  /**
   * The task's identity AND its semantic kind — they were always the same
   * value. A separate `kind: TaskKind` field sat beside this one, set to the
   * identical literal in all six builders and read by nothing: not the hero,
   * not the row, not a test, not a screen. It looked like the presentation
   * discriminator without being one, which is how the hero ended up hardcoding
   * its icon instead of asking the model. Presentation derives from `action`
   * (see TASK_ACTION_ICON above) and `tone` (see components/taskTone.ts);
   * identity is this.
   */
  id: TaskKind;
  /** Imperative and second person: "Move for 10 minutes", not "Movement". */
  title: string;
  /** One supporting line. Never a second sentence. */
  detail: string;
  /** Button text when this task is in the spotlight. Lives on the task rather
   *  than in a lookup beside the button, so wording can never drift from the
   *  title it belongs to. */
  cta: string;
  state: TaskState;
  action: TaskAction;
  tone: TaskTone;
  icon: IoniconName;
  /** XP awarded on completion, or 0 when the task isn't XP-bearing. */
  reward: number;
}

export interface TodayBoardInput {
  /** A movement session can be picked back up. */
  hasRecoverableMovement: boolean;
  /** A session was completed today (local day). */
  movedToday: boolean;
  /** Owned zones currently needing defence. */
  atRiskZoneCount: number;
  /** Zones captured so far. */
  zonesOwned: number;
  /** Title of today's quest. */
  dailyQuestTitle: string;
  /** XP today's quest awards. */
  dailyQuestXp: number;
  /** Today's quest was already completed this local day. */
  dailyQuestDone: boolean;
  /** The player has picked a club. */
  hasClub: boolean;
}

export interface TodayBoard {
  /**
   * The single task in the spotlight — the highest-priority thing still to do,
   * and the owner of the screen's one primary button.
   *
   * `null` means every task on the board is done. The screen shows its "all
   * clear" state rather than inventing a task to fill the space.
   */
  focus: Task | null;
  /** The rest of the board, in priority order. Never contains {@link focus}. */
  tasks: Task[];
  doneCount: number;
  totalCount: number;
  /** "2 of 5 done" — pre-formatted so the screen does no arithmetic. */
  progressLabel: string;
  /** 0..1, for the progress bar. 1 when the board is empty (nothing owed). */
  progress: number;
  allDone: boolean;
}

/** Hard cap on board size. A checklist you can't see the end of is a backlog. */
export const TASK_CAP = 5;

/* ── Store state → board input ────────────────────────────────────────────── */

/** The slice of store state the board is derived from. Structural, so the test
 *  suite can build one without importing the store. */
export interface BoardSourceState {
  /** Completion history, newest first. Holds BOTH movement sessions and warmup
   *  quests — see `lib/sessionQuest.ts`. */
  history: readonly { questId: string; completedAt: string }[];
  zones: readonly Zone[];
  dailyQuestTitle: string;
  dailyQuestXp: number;
  dailyQuestDone: boolean;
  hasClub: boolean;
  /** Injectable for tests; defaults to now. */
  now?: Date;
}

/**
 * Turn raw store state into a {@link TodayBoardInput}.
 *
 * This exists as its own pure function because the first version lived inline
 * in the Home screen, and that is where it went wrong: `movedToday` was
 * `history.length > 0` for today, which counts warmup quests as movement — so
 * finishing a sixty-second indoor mobility quest ticked "Move today" and the
 * board stopped asking the user to move.
 *
 * A screen can't be unit-tested here; a function can. Moving the derivation out
 * is what makes the rule testable at all, which is why the fix is a refactor
 * rather than a one-line predicate change.
 */
export function boardInputFromState(state: BoardSourceState): TodayBoardInput {
  const todayKey = getLocalDateKey(state.now);
  const onToday = (iso: string) => getLocalDateKey(new Date(iso)) === todayKey;

  return {
    /* Persistent movement recovery isn't implemented — a finished route lives
       only in memory during the summary flow — so there is genuinely never a
       session to resume. Honest today; the board already supports the state. */
    hasRecoverableMovement: false,
    // Movement sessions ONLY. A warmup quest is not a move.
    movedToday: state.history.some((rec) => isMovementSession(rec) && onToday(rec.completedAt)),
    /* `state.now` has to reach zoneStatus too. It did not, so zone health was
       derived from the wall clock while every other field honoured the injected
       time — the function was non-deterministic against its own documented
       seam, and the suite failed by calendar drift rather than by any code
       change. Fixed here because it blocks this branch's gate; see the PR. */
    atRiskZoneCount: state.zones.filter(
      (z) => zoneStatus(z, state.now?.getTime()).health !== "yours",
    ).length,
    zonesOwned: state.zones.length,
    dailyQuestTitle: state.dailyQuestTitle,
    dailyQuestXp: state.dailyQuestXp,
    dailyQuestDone: state.dailyQuestDone,
    hasClub: state.hasClub,
  };
}

/** XP earned today, from every completion — movement and warmup alike. Unlike
 *  `movedToday` this deliberately counts both: a warmup quest really did award
 *  the XP it shows. */
export function xpEarnedToday(
  history: readonly { xp: number; completedAt: string }[],
  now?: Date,
): number {
  const todayKey = getLocalDateKey(now);
  return history
    .filter((rec) => getLocalDateKey(new Date(rec.completedAt)) === todayKey)
    .reduce((sum, rec) => sum + rec.xp, 0);
}

/**
 * Build today's board.
 *
 * Tasks come in three flavours, and the difference is the whole design:
 *
 *  - **Daily** (`move`, `quest`) are always on the board and reset each day.
 *    They are what makes it a *daily* checklist rather than a to-do pile.
 *  - **Conditional** (`resume`, `defend`) appear only while the condition
 *    holds, and are the highest priority when they do — an interrupted session
 *    or losable ground outranks routine.
 *  - **Milestone** (`capture`, `club`) appear only until they're achieved, then
 *    leave the board for good. Showing a permanently-ticked "capture your first
 *    zone" forever would pad the count and cheapen the progress line.
 *
 * The order below IS the priority order, and it is the only place it is stated.
 */
export function buildTodayBoard(input: TodayBoardInput): TodayBoard {
  const board: Task[] = [];

  // Conditional — an interrupted session is the most perishable thing here.
  if (input.hasRecoverableMovement) {
    board.push({
      id: "resume",
      title: "Finish your move",
      detail: "You have a session in progress.",
      cta: "Resume move",
      state: "todo",
      action: "move",
      tone: "primary",
      icon: "play-circle-outline",
      reward: 0,
    });
  }

  // Conditional — ground you already own is at stake.
  if (input.atRiskZoneCount > 0) {
    const many = input.atRiskZoneCount > 1;
    board.push({
      id: "defend",
      title: many ? `Defend ${input.atRiskZoneCount} zones` : "Defend your zone",
      detail: "Move through your territory to refresh its defence.",
      cta: "View territory",
      state: "todo",
      action: "territory",
      tone: "danger",
      icon: "shield-half-outline",
      reward: 0,
    });
  }

  // Daily — the core of the product, so it is on the board every single day.
  board.push({
    id: "move",
    title: input.zonesOwned === 0 && !input.movedToday ? "Make your first move" : "Move today",
    detail: input.movedToday
      ? "Session logged. Move again any time."
      : "Any distance counts. Your route is tracked on-device.",
    cta: input.movedToday ? "Move again" : "Start move",
    state: input.movedToday ? "done" : "todo",
    action: "move",
    tone: "primary",
    icon: "walk-outline",
    reward: 0,
  });

  // Daily — the streak-safe warmup, so there is always something achievable
  // indoors on a day movement isn't possible.
  board.push({
    id: "quest",
    title: input.dailyQuestTitle,
    detail: input.dailyQuestDone ? "Completed today." : "Today's warmup quest.",
    cta: input.dailyQuestDone ? "View quest" : "Start quest",
    state: input.dailyQuestDone ? "done" : "todo",
    action: "quest",
    tone: "gold",
    icon: "flash-outline",
    reward: input.dailyQuestXp,
  });

  /* Milestone — drops off the board once the first zone is captured.
     This is also Home's only territory affordance for a player who owns
     nothing: `defend` is the board's other territory task and it requires
     `atRiskZoneCount > 0`, which a zero-zone player can never satisfy, so
     without this row Home never mentions territory to exactly the audience
     that has never seen it. It used to send them to `move`, which merely
     repeated the CTA the `move` task above already owns — two rows, one
     action, and nothing anywhere explaining what a zone is. It now opens the
     territory map, where lib/territoryIntro.ts explains the loop. The primary
     movement CTA is unaffected: `move` is pushed first, so it still takes the
     spotlight. */
  if (input.zonesOwned === 0) {
    board.push({
      id: "capture",
      title: "Capture your first zone",
      detail: "See what territory is and how zones are captured.",
      cta: "See how it works",
      state: "todo",
      action: "territory",
      tone: "green",
      icon: "map-outline",
      reward: 0,
    });
  }

  // Milestone — drops off the board once a club is chosen.
  if (!input.hasClub) {
    board.push({
      id: "club",
      title: "Pick a club",
      detail: "Your movement adds to their city score.",
      cta: "Browse clubs",
      state: "todo",
      action: "clubs",
      tone: "green",
      icon: "people-outline",
      reward: 0,
    });
  }

  const capped = board.slice(0, TASK_CAP);
  const doneCount = capped.filter((t) => t.state === "done").length;
  const totalCount = capped.length;

  /* The spotlight is simply the first task still to do. Pulling it OUT of the
     list — rather than flagging it in place — is what stops Home from ever
     rendering the same task twice, once as a hero and once as a row. That was
     the original duplicate-CTA bug, and this makes it unrepresentable. */
  const focusIndex = capped.findIndex((t) => t.state === "todo");
  const focus = focusIndex === -1 ? null : capped[focusIndex];
  const tasks = focusIndex === -1 ? capped : capped.filter((_, i) => i !== focusIndex);

  return {
    focus,
    tasks,
    doneCount,
    totalCount,
    progressLabel: `${doneCount} of ${totalCount} done`,
    progress: totalCount === 0 ? 1 : doneCount / totalCount,
    allDone: focus === null,
  };
}
