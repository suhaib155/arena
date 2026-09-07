/**
 * What the quest result screen says, for both outcomes.
 *
 * ## Why the failure case needed its own design
 *
 * Ending Sunrise Sprint early correctly earns nothing — the timed-attempt rule
 * is right and this module does not touch it. What was wrong was the telling:
 * the screen fell back to five centred lines in the middle of an otherwise
 * empty page, which reads less like a result than like a screen that failed to
 * load. A player who ends a quest early has done something ordinary and
 * reversible, and the screen should say so and offer the way back.
 *
 * ## One system, two outcomes
 *
 * Completion and non-completion are the same layout with different values, not
 * two screens. That is deliberate: a separate "failure screen" drifts, and the
 * drift always goes the same way — the success path gets the attention and the
 * other one becomes the afterthought it was here.
 *
 * The difference between them is emphasis, never structure: `celebrate` gates
 * the badge and the pop animation, and nothing else moves. There is no
 * consolation confetti. A quest that was not completed is reported plainly.
 *
 * ## What this module must not do
 *
 * Decide anything about reward qualification. `completionSatisfied` arrives
 * already settled from the store, computed by `questCompletionSatisfied`
 * against the persisted attempt, and this module only reads it. It awards
 * nothing, and `xpEarned` is whatever the settled outcome already recorded.
 */

export type QuestResultKind = "completed" | "not-completed" | "ended";
export type QuestResultTone = "green" | "neutral";

export interface QuestResultInput {
  /** The quest this result is about, when it could be resolved at all. */
  questTitle: string | null;
  /** The settled outcome's verdict. Never recomputed here. */
  completionSatisfied: boolean;
  /** XP the settled outcome recorded. Zero for a non-completion. */
  xpGained: number;
  /** Active time the attempt accumulated, in ms. */
  activeMs: number;
  /** Time the quest required, in ms. */
  requiredMs: number;
  /** This quest's XP was already banked earlier today. */
  alreadyAwardedToday: boolean;
  /** No attempt is live, so starting a fresh one cannot collide with one. */
  attemptSettled: boolean;
}

export interface QuestResultView {
  kind: QuestResultKind;
  /** Crest icon name, as Ionicons spells it. */
  icon: string;
  title: string;
  /** One short line. Never a paragraph, and never an apology. */
  reason: string;
  xpEarned: number;
  /** Always rendered, including the zero — a hidden zero is a missing answer. */
  xpLabel: string;
  /** How much of the required time was held, 0..1. */
  progress: number;
  tone: QuestResultTone;
  /** The badge and the pop. False for every non-completion. */
  celebrate: boolean;
  /** Offer another attempt. Only when a fresh one can actually earn. */
  retry: boolean;
}

/** 0..1, clamped, and 1 for a quest with no duration requirement. */
export function heldFraction(activeMs: number, requiredMs: number): number {
  if (!Number.isFinite(activeMs) || activeMs <= 0) return 0;
  if (!Number.isFinite(requiredMs) || requiredMs <= 0) return 1;
  return Math.max(0, Math.min(1, activeMs / requiredMs));
}

export function resolveQuestResult(input: QuestResultInput): QuestResultView {
  const progress = heldFraction(input.activeMs, input.requiredMs);

  if (input.questTitle === null) {
    /* The quest could not be resolved — a deep link to a stale attempt, or a
       result opened after the attempt was spent. There is nothing to retry
       because there is nothing identified to retry. */
    return {
      kind: "ended",
      icon: "flag-outline",
      title: "Quest ended",
      reason: "This quest is no longer available to settle.",
      xpEarned: 0,
      xpLabel: "0 XP",
      progress: 0,
      tone: "neutral",
      celebrate: false,
      retry: false,
    };
  }

  if (input.completionSatisfied) {
    return {
      kind: "completed",
      icon: "checkmark",
      title: "Quest complete",
      reason: input.alreadyAwardedToday
        ? "Already completed today, so no extra XP this time."
        : "You held the full countdown.",
      xpEarned: input.xpGained,
      xpLabel: `+${input.xpGained} XP`,
      progress: 1,
      tone: "green",
      celebrate: true,
      retry: false,
    };
  }

  return {
    kind: "not-completed",
    icon: "time-outline",
    title: "Not completed",
    /* Says what happened, and what would have finished it. No "you failed",
       and no invented encouragement either. */
    reason: progress > 0
      ? "Ended before the countdown finished, so no XP this time."
      : "The countdown did not start, so no XP this time.",
    xpEarned: 0,
    xpLabel: "0 XP",
    progress,
    tone: "neutral",
    celebrate: false,
    /* Offered only when a fresh attempt could actually earn something. A retry
       button on a quest whose XP is already banked for today is a button that
       spends the player's time for nothing, and a retry while an attempt is
       still live would race the one they are in. */
    retry: input.attemptSettled && !input.alreadyAwardedToday,
  };
}
