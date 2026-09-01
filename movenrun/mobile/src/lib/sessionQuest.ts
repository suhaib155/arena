/**
 * The identity of a saved movement session.
 *
 * A finished GPS session is recorded through the same store action as a warmup
 * quest — `completeQuest()` with a synthetic quest — so that XP, the
 * once-per-local-day gate, the streak and the history entry all behave
 * identically and there is no second earning path. That is a good decision, but
 * it has one consequence that has to be handled deliberately:
 *
 *   **`history` holds both real movement sessions and indoor warmup quests.**
 *
 * Anything asking "did the user actually *move* today?" must therefore filter
 * by this id rather than by "is there a history record today". Without the
 * filter, a sixty-second indoor mobility quest satisfies the movement task —
 * which is exactly the defect this module exists to make impossible to
 * reintroduce.
 *
 * The id lives here, not in `app/move/summary.tsx`, so the writer and every
 * reader share one constant instead of a repeated string literal.
 */

/** Quest id under which a saved movement session is recorded. */
export const SESSION_QUEST_ID = "move-session";

/** The minimum a record needs for us to tell what produced it. */
export interface QuestCompletionLike {
  questId: string;
}

/** True only for a real GPS movement session — never for a warmup quest. */
export function isMovementSession(record: QuestCompletionLike): boolean {
  return record.questId === SESSION_QUEST_ID;
}
