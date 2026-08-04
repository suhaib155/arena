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
import {
  isMoveAction,
  missionHasOwnCta,
  type HeroState,
  type HomeMission,
} from "./homeMission";

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

/* ── Home composition: exactly ONE dominant primary action ── */

/**
 * Which blocks Home renders, and how many primary movement CTAs that produces.
 *
 * This lives here, as one pure rule, because the first version put the choice
 * in four separate conditionals inside the screen — and the brand-new user
 * ended up with two competing "start moving" buttons (the hero's and a
 * first-mission card's). With the rule expressed once, the "exactly one
 * primary CTA" invariant is a property that can be tested for every input
 * rather than an arrangement that has to be eyeballed.
 */
export interface HomeComposition {
  /** The hero renders the first mission instead of the usual territory stats. */
  showFirstMissionHero: boolean;
  /** The hero's normal Start/Resume Move button (and level path). */
  showNormalHeroCta: boolean;
  /** The prioritized mission card below the hero. */
  showMissionCard: boolean;
  /** The secondary destination list. */
  showUpNext: boolean;
  /** Primary movement CTAs the composed screen presents. Always exactly 1. */
  primaryMoveCtaCount: number;
}

export interface HomeCompositionInput {
  firstMissionActive: boolean;
  /** The hero state chosen by `homeMission.resolveHeroState`. */
  hero: HeroState;
  /** The prioritized mission chosen by `homeMission.selectHomeMission`. */
  mission: HomeMission;
  /** Number of available secondary destinations. */
  upNextCount: number;
}

/**
 * Compose Home. For a brand-new user the hero IS the first mission: the normal
 * hero CTA, the mission card and the secondary list all stand down, leaving one
 * unmistakable next action. Once any real activity exists, normal Home returns.
 */
export function composeHome(input: HomeCompositionInput): HomeComposition {
  const first = input.firstMissionActive;
  const showNormalHeroCta = !first;
  const showMissionCard = !first;
  /* Whether the mission card contributes a movement button is DERIVED here
     from the existing `missionHasOwnCta` rule rather than trusted from a
     caller-supplied boolean — so a contradictory combination (hero showing
     Start Move while the card also does) cannot be constructed at all. */
  const missionShowsMoveCta =
    showMissionCard &&
    missionHasOwnCta(input.mission, input.hero) &&
    isMoveAction(input.mission.action);
  return {
    showFirstMissionHero: first,
    showNormalHeroCta,
    showMissionCard,
    showUpNext: !first && input.upNextCount > 0,
    // The first-mission hero owns one primary CTA; otherwise the normal hero
    // owns it, and the mission card is guaranteed not to add a second.
    primaryMoveCtaCount:
      (first ? 1 : 0) + (showNormalHeroCta ? 1 : 0) + (missionShowsMoveCta ? 1 : 0),
  };
}
