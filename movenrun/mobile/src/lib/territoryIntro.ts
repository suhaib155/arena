/**
 * Territory onboarding — pure derivation, no persisted flag of its own.
 *
 * The task-board refactor removed the only place that explained what territory
 * *is*. `firstMission.ts` used to derive "has this user done anything yet?"
 * from authoritative gameplay state and render a four-step plain-language
 * account of the core loop, plus the single Home affordance that pointed a
 * zero-zone user at the territory map. All of it went, and nothing replaced the
 * explanation: the board can say "Capture your first zone", but nothing on it
 * says what a zone is, why it decays, or what ownership does and does not mean.
 *
 * This module is that explanation's one owner. It deliberately keeps the two
 * properties the deleted version got right:
 *
 *  - **Derived, never stored.** "Is this a brand-new user?" is already
 *    answerable from history, saved route reviews and captured zones. A
 *    `seenTerritoryIntro` boolean would be a second copy of the truth that
 *    drifts the moment progress is reset — which is exactly the bug the
 *    first-run rewrite (`lib/firstRun.ts`) was written to end. There is no new
 *    persisted flag here, and the intro needs no dismissal state: completion is
 *    *capturing a zone*, and the full walkthrough stays replayable from Profile
 *    (`/opening?source=replay`).
 *  - **Semantic actions, not routes.** Nothing here names a screen. The caller
 *    maps {@link TerritoryIntroView.ctaAction} to a route, the same way
 *    `lib/tasks.ts` does, so the movement flow has exactly one definition.
 *
 * Pure: no store, no React, no I/O.
 */
import type { IoniconName } from "@/types";

/** Where the user stands relative to owning territory. Exactly one holds. */
export type TerritoryStage =
  /** No zones, and no movement history at all — has never seen the loop work. */
  | "new"
  /** No zones, but has moved before — needs a next action, not a tutorial. */
  | "returning"
  /** Holds at least one zone — gets the real board, never beginner education. */
  | "active";

/** The authoritative gameplay state the stage is derived from. Structural, so
 *  tests build one without importing the store. */
export interface TerritoryIntroInput {
  /** Zones captured locally. */
  zonesOwned: number;
  /** Completed sessions/quests in local history. */
  historyCount: number;
  /** Saved route-review summaries. */
  routeTrustCount: number;
}

/**
 * Derive the stage.
 *
 * Owning ground always wins: a user with a zone is `active` no matter what the
 * rest of their history looks like, so real territory information is never
 * replaced by a beginner panel. Below that, any authoritative first activity —
 * a completed session, a saved route review — exits `new`, which is the rule
 * the deleted `isFirstMission` enforced.
 */
export function territoryStage(input: TerritoryIntroInput): TerritoryStage {
  if (input.zonesOwned > 0) return "active";
  const untouched = input.historyCount === 0 && input.routeTrustCount === 0;
  return untouched ? "new" : "returning";
}

/** One concept of the core loop. `key` is the concept, not a route. */
export interface LoopStep {
  key: "move" | "capture" | "defend" | "own";
  label: string;
  detail: string;
  icon: IoniconName;
}

/**
 * Move → Capture → Defend → Own, in the app's own words.
 *
 * Stated once, here, so the wording cannot drift between the territory screen
 * and anything that explains the loop later. Every line is bounded by what the
 * repository actually does today:
 *
 *  - *Capture* is conditional. A saved session captures a zone only when the
 *    route produces a capture candidate (`app/move/summary.tsx`), so this
 *    promises movement, never a guaranteed zone.
 *  - *Defend* describes the decay that `lib/territory.ts` already models.
 *  - *Own* is the one that has to be careful. Zone Deeds are a **preview of a
 *    future layer**: the Base Sepolia deployment is testnet, the app's access
 *    is read-only (`data/contractStatus.ts` — `appAccess: "Preview only"`,
 *    Zone Deed NFTs "Arrive later"), and `lib/deedPreview.ts` states plainly
 *    that the showroom is "not real ownership, not a mint, not a claim, not a
 *    marketplace, not tradable, has no market or rarity value, and no rewards
 *    or earnings". The copy below says exactly that and no more. No mainnet,
 *    no wallet, no earning, no guaranteed reward.
 */
export const CORE_LOOP: readonly LoopStep[] = Object.freeze([
  Object.freeze({
    key: "move",
    label: "Move",
    detail:
      "Start a movement session. MovenRun measures distance and pace while the session is open, in the foreground.",
    icon: "walk-outline",
  }),
  Object.freeze({
    key: "capture",
    label: "Capture",
    detail:
      "Moving through eligible ground can capture a new zone or strengthen one you already hold. Not every route captures.",
    icon: "flag-outline",
  }),
  Object.freeze({
    key: "defend",
    label: "Defend",
    detail:
      "Control fades between visits. Move through your zones again to refresh their defence before they slip.",
    icon: "shield-half-outline",
  }),
  Object.freeze({
    key: "own",
    label: "Own",
    detail:
      "Zone Deeds are a preview of a future layer, on a public testnet and read-only in the app. No wallet, no minting, no rewards, and no value.",
    icon: "ribbon-outline",
  }),
]) as readonly LoopStep[];

/** Semantic destination. The screen resolves it; this module never names one. */
export type TerritoryIntroAction = "move";

export interface TerritoryIntroView {
  /** Which of the two guidance stages produced this view. */
  stage: Exclude<TerritoryStage, "active">;
  title: string;
  body: string;
  /**
   * The core-loop walkthrough — the full four concepts for a brand-new user,
   * and empty for a returning one. A user who has already moved does not need
   * to be taught what moving is; they need a reason and a next action, which
   * {@link body} and {@link ctaLabel} carry. This is what stops a returning
   * zero-zone user being trapped behind beginner onboarding.
   */
  steps: readonly LoopStep[];
  ctaLabel: string;
  ctaAction: TerritoryIntroAction;
}

const NEW_USER: TerritoryIntroView = Object.freeze({
  stage: "new",
  title: "This is your territory",
  body: "Territory is the ground you have moved through and held. It is empty because you have not moved yet — here is how it fills up.",
  steps: CORE_LOOP,
  ctaLabel: "Start my first move",
  ctaAction: "move",
}) as TerritoryIntroView;

const RETURNING_USER: TerritoryIntroView = Object.freeze({
  stage: "returning",
  title: "No zones held yet",
  body: "You have movement on record, but nothing captured. Capture happens when a route covers eligible ground, so another session is the way to claim your first zone.",
  steps: Object.freeze([]) as readonly LoopStep[],
  ctaLabel: "Start move",
  ctaAction: "move",
}) as TerritoryIntroView;

/**
 * The guidance for a user with no territory, or `null` once they hold ground.
 *
 * Returning `null` — rather than an "active" variant — is deliberate: it makes
 * "an established user is shown beginner education" unrepresentable rather than
 * merely untested. The screen renders its real board whenever this is null.
 */
export function buildTerritoryIntro(input: TerritoryIntroInput): TerritoryIntroView | null {
  const stage = territoryStage(input);
  if (stage === "active") return null;
  return stage === "new" ? NEW_USER : RETURNING_USER;
}
