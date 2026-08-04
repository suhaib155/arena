/**
 * The first mission — pure derivation, no persisted flag.
 *
 * "Has this user done anything yet?" is already answerable from authoritative
 * local gameplay state (session history, saved route reviews, captured zones),
 * so a `firstMissionComplete` boolean would just be a second copy of the truth
 * that could drift after a progress reset. It is derived instead.
 *
 * The copy is deliberately honest about capture: a saved session captures a
 * zone only when the route produces a capture candidate (see
 * `app/move/summary.tsx`), so this never promises a guaranteed first zone.
 */

export interface FirstMissionInput {
  /** Completed sessions/quests in local history. */
  historyCount: number;
  /** Saved route-review summaries. */
  routeTrustCount: number;
  /** Zones captured locally. */
  zonesOwned: number;
}

/**
 * True only when the user has no movement history, no saved route, and no
 * zone. Any authoritative first activity exits the first-mission state.
 */
export function isFirstMission(input: FirstMissionInput): boolean {
  return input.historyCount === 0 && input.routeTrustCount === 0 && input.zonesOwned === 0;
}

/** Semantic actions the first-mission panel offers; the screen maps them to
 *  the same routes the rest of Home already uses. */
export type FirstMissionAction = "move" | "territory";

export interface FirstMissionView {
  title: string;
  body: string;
  primaryLabel: string;
  primaryAction: Extract<FirstMissionAction, "move">;
  secondaryLabel: string;
  secondaryAction: Extract<FirstMissionAction, "territory">;
  /** Four plain-language steps — an explanation, not a forced tour. */
  steps: readonly string[];
}

const FIRST_MISSION: FirstMissionView = Object.freeze({
  title: "Your first mission",
  body: "Move for five minutes and work toward your first zone.",
  primaryLabel: "Start first move",
  primaryAction: "move",
  secondaryLabel: "Explore the territory map",
  secondaryAction: "territory",
  steps: Object.freeze([
    "Start moving",
    "Complete your route",
    "Capture or strengthen a zone",
    "Return later to defend it",
  ]),
});

export function buildFirstMission(): FirstMissionView {
  return FIRST_MISSION;
}
