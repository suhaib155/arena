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
  | "saved-captured"
  | "saved-defended"
  | "saved";

export interface CompletionInput {
  mode: "gps" | "demo";
  /** Meets the minimum distance/duration to be a real save. */
  saveable: boolean;
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
    if (input.outcome === "captured") {
      return {
        kind: "saved-captured",
        kicker: "Session saved",
        headline: "Territory captured",
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
        headline: `${input.defendedCount} zone${input.defendedCount === 1 ? "" : "s"} defended`,
        detail: "Moving through your territory refreshed its defence.",
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
      headline: "Too short to save",
      detail: "Move at least 200 m or 5 minutes to save a session and earn XP.",
      progressPersisted: false,
      xpAwardedNow: false,
      rewardStatus,
      tone: "warning",
      showRewards: false,
    };
  }

  if (input.alreadySavedToday) {
    return {
      kind: "already-saved",
      kicker: "Session complete",
      headline: "Already saved today",
      detail:
        "You've saved a session today — extra sessions don't earn more XP, but your route still counts.",
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
    detail: "Save this session to bank your XP and claim any territory you reached.",
    progressPersisted: false,
    xpAwardedNow: false,
    rewardStatus,
    tone: "primary",
    showRewards: true,
  };
}
