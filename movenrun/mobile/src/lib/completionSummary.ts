/**
 * Completion / route-summary state — pure, truthful, testable.
 *
 * MovenRun's rewards are a local, on-device "Free Map Beta" simulation: XP is
 * awarded through the store's once-per-day gate, Locked MOVE is an in-app
 * *preview* ("progress, not a payout"), and route trust is a local preview that
 * does not affect rewards or ownership. There is deliberately **no backend
 * reward pipeline** yet (see CLAUDE.md's hard guardrail), so this module models
 * only the states that genuinely exist and never fabricates a backend
 * "pending / under review / rejected" outcome.
 *
 * Its one job is to keep the summary honest: it reports whether real progress
 * persisted and whether XP was actually awarded, and it always tags rewards as
 * local preview — so the UI can never present preview rewards as a confirmed
 * payout or on-chain truth.
 */

export type SaveOutcome = "captured" | "defended" | "saved";

export type CompletionKind =
  | "demo-preview"
  | "too-short"
  | "already-saved"
  | "ready-to-save"
  /** Long enough to keep, with no movement to reward. */
  | "ready-to-record"
  | "saved-captured"
  | "saved-defended"
  | "saved"
  /** Kept in route history; earned nothing, because nothing moved. */
  | "saved-unqualified";

export interface CompletionInput {
  mode: "gps" | "demo";
  /** Meets the minimum distance/duration to be a real save. */
  saveable: boolean;
  /**
   * The session actually produced movement evidence — a route that can honestly
   * be drawn.
   *
   * Deliberately a *separate* axis from `saveable`, because the two answer
   * different questions and `isSaveable` answers its own with distance **OR**
   * duration. Five minutes of standing still satisfies the duration branch, so
   * it is saveable while having moved nowhere. Treating those as one fact is how
   * a motionless session came to bank XP, bump the streak, refresh territory
   * defence and play the capture celebration.
   *
   * Defaults to true so that older callers and fixtures — which predate the
   * distinction and describe sessions that did move — keep their behaviour.
   */
  movedOverGround?: boolean;
  /** A session was already saved earlier today (no additional XP today). */
  alreadySavedToday: boolean;
  /** The user has completed the save action this session. */
  saved: boolean;
  /** Set once saved: what happened to territory. */
  outcome: SaveOutcome | null;
  /** Owned zones refreshed by the route (defence). */
  defendedCount: number;
}

export interface CompletionSummary {
  kind: CompletionKind;
  kicker: string;
  headline: string;
  detail: string;
  /** True only when a real (non-demo) save persisted progress this session. */
  progressPersisted: boolean;
  /** XP was actually awarded now (real save, not demo, not already-saved). */
  xpAwardedNow: boolean;
  /** Rewards shown are always in-app progress previews, never a confirmed
   *  payout or on-chain truth. This is the invariant the UI relies on to avoid
   *  presenting preview rewards as confirmed. */
  rewardStatus: "local-preview";
  tone: "primary" | "green" | "warning" | "neutral";
  /** Whether the reward block should render at all (hidden for demo/too-short
   *  where no XP is earned). */
  showRewards: boolean;
}

/** Resolve the truthful completion state from real session/save inputs. */
export function resolveCompletion(input: CompletionInput): CompletionSummary {
  const rewardStatus = "local-preview" as const;
  const moved = input.movedOverGround ?? true;

  // Demo routes are preview only — never saved as territory, never rewarded.
  if (input.mode === "demo") {
    return {
      kind: "demo-preview",
      kicker: "Demo session",
      headline: "Demo route — preview only",
      detail:
        "Demo routes aren't real GPS. They're never saved as territory and earn no XP.",
      progressPersisted: false,
      xpAwardedNow: false,
      rewardStatus,
      tone: "neutral",
      showRewards: false,
    };
  }

  if (input.saved) {
    /* Recorded, and honest about what that did not do. A session with no
       movement keeps its place in route history and earns nothing — checked
       before the outcome branches, because an unqualified session can never
       have produced a capture or a defence to report. */
    if (!moved) {
      return {
        kind: "saved-unqualified",
        kicker: "Session recorded",
        headline: "Recorded — no movement to reward",
        detail: "It is in your route history. No XP, no streak and no territory change, because no movement was recorded.",
        progressPersisted: false,
        xpAwardedNow: false,
        rewardStatus,
        tone: "neutral",
        showRewards: false,
      };
    }
    if (input.outcome === "captured") {
      return {
        kind: "saved-captured",
        kicker: "Session saved",
        headline: "Local capture saved",
        detail:
          input.defendedCount > 0
            ? `New zone captured, and ${input.defendedCount} of yours defended on the way.`
            : "A new common zone is now on your local map.",
        progressPersisted: true,
        xpAwardedNow: true,
        rewardStatus,
        tone: "green",
        showRewards: true,
      };
    }
    if (input.outcome === "defended") {
      return {
        kind: "saved-defended",
        kicker: "Session saved",
        headline: `${input.defendedCount} local zone${input.defendedCount === 1 ? "" : "s"} refreshed`,
        detail: "Your local territory preview has been updated.",
        progressPersisted: true,
        xpAwardedNow: true,
        rewardStatus,
        tone: "primary",
        showRewards: true,
      };
    }
    // Saved, but no capture or defend this time (zero-capture).
    return {
      kind: "saved",
      kicker: "Session saved",
      headline: "Route saved — streak safe",
      detail: "No new territory this time. Keep moving to reach a fresh zone.",
      progressPersisted: true,
      xpAwardedNow: true,
      rewardStatus,
      tone: "primary",
      showRewards: true,
    };
  }

  // Not yet saved — explain why saving is/ isn't available.
  if (!input.saveable) {
    return {
      kind: "too-short",
      kicker: "Session complete",
      headline: "Not enough movement",
      detail: "Move at least 200 m or 5 minutes to save a session and earn XP.",
      progressPersisted: false,
      xpAwardedNow: false,
      rewardStatus,
      tone: "warning",
      showRewards: false,
    };
  }

  /* Long enough to keep and with nothing to reward. Stated *before* saving so
     the screen never previews XP it will not award — the reward block used to
     promise it on the strength of `saveable` alone. */
  if (!moved) {
    return {
      kind: "ready-to-record",
      kicker: "Session complete",
      headline: "No movement recorded",
      detail: "Saving keeps this session in your route history. It earns no XP and changes no territory.",
      progressPersisted: false,
      xpAwardedNow: false,
      rewardStatus,
      tone: "neutral",
      showRewards: false,
    };
  }

  if (input.alreadySavedToday) {
    return {
      kind: "already-saved",
      kicker: "Session complete",
      headline: "Already saved today",
      detail:
        "Today's session XP is already earned.",
      progressPersisted: false,
      xpAwardedNow: false,
      rewardStatus,
      tone: "neutral",
      showRewards: false,
    };
  }

  // Saveable and not yet saved: the reward preview is shown but clearly not yet
  // banked — pressing Save persists it.
  return {
    kind: "ready-to-save",
    kicker: "Session complete",
    headline: "Ready to save",
    detail: "Keep this route summary and earn your session XP.",
    progressPersisted: false,
    xpAwardedNow: false,
    rewardStatus,
    tone: "primary",
    showRewards: true,
  };
}
