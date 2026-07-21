/**
 * Home mission priority — pure presentation selector (no store, no I/O).
 *
 * The Home screen answers "what should I do next?" with exactly ONE prioritized
 * mission plus a single hero movement CTA. This module derives both from safe,
 * already-computed local state so the screen stays a thin renderer and the
 * decision is unit-testable off-device.
 *
 * It invents no gameplay: every branch maps to state the app already tracks
 * (recoverable session, at-risk zones, the current objective, whether you've
 * ever moved, zones owned, the weekly objective). It gates nothing — XP,
 * capture, defend, ownership, and rewards are unchanged.
 *
 * Priority order (highest first) — the product spec:
 *   1. Resume an active / recoverable movement
 *   2. Territory defence warning
 *   3. Existing current objective
 *   4. First movement
 *   5. First zone capture
 *   6. Weekly objective
 */

/** Where a mission or the hero CTA points. Resolved to a concrete route by the
 *  screen so this module stays platform-free. */
export type MissionAction =
  | "resume-move"
  | "move"
  | "territory"
  | "objective"
  | "weekly";

/** Colour intent for the mission accent — semantic, never decorative. */
export type MissionTone = "primary" | "danger" | "gold" | "green";

export type MissionKind =
  | "resume"
  | "defend"
  | "objective"
  | "first-move"
  | "first-zone"
  | "weekly";

export interface HomeMission {
  kind: MissionKind;
  /** Short kicker above the title (e.g. "Resume", "Defend"). */
  kicker: string;
  title: string;
  subtitle: string;
  ctaLabel: string;
  action: MissionAction;
  tone: MissionTone;
  icon: string;
}

export interface HomeMissionInput {
  /** A movement session can be resumed/recovered (persisted or in-flight). */
  hasRecoverableMovement: boolean;
  /** Owned zones currently needing defence (health !== "yours"). */
  atRiskZoneCount: number;
  /** Name of the single most-urgent at-risk zone, when one exists. */
  topRiskZoneName: string | null;
  /** Title of the player's active objective, or null when there isn't a
   *  meaningful one yet (the screen passes null for brand-new users so the
   *  mission falls through to "first movement"). */
  currentObjectiveTitle: string | null;
  /** Any completed session/quest in local history. */
  hasMovedEver: boolean;
  /** Zones captured locally. */
  zonesOwned: number;
  /** Title of the next weekly objective (the terminal fallback). */
  weeklyObjectiveTitle: string | null;
}

/** The three adaptive hero states, each with its single movement CTA. */
export type HeroStateKind = "new" | "returning" | "recoverable";

export interface HeroState {
  kind: HeroStateKind;
  ctaLabel: string;
  /** Always a movement-family action — the screen's single primary CTA. */
  action: Extract<MissionAction, "move" | "resume-move">;
}

/** Movement-family actions — the ones the hero's primary button owns. Used to
 *  guarantee the mission card never duplicates the hero's Start/Resume Move. */
const MOVE_FAMILY: ReadonlySet<MissionAction> = new Set<MissionAction>([
  "move",
  "resume-move",
]);

export function isMoveAction(action: MissionAction): boolean {
  return MOVE_FAMILY.has(action);
}

/**
 * Resolve the single adaptive hero state + its one movement CTA.
 *
 * - recoverable movement → "Resume Move"
 * - never moved          → "Start First Move"
 * - otherwise            → "Start Move"
 */
export function resolveHeroState(input: HomeMissionInput): HeroState {
  if (input.hasRecoverableMovement) {
    return { kind: "recoverable", ctaLabel: "Resume Move", action: "resume-move" };
  }
  if (!input.hasMovedEver) {
    return { kind: "new", ctaLabel: "Start First Move", action: "move" };
  }
  return { kind: "returning", ctaLabel: "Start Move", action: "move" };
}

/** Select the single prioritized Home mission. Deterministic and total. */
export function selectHomeMission(input: HomeMissionInput): HomeMission {
  // 1. Resume active / recoverable movement.
  if (input.hasRecoverableMovement) {
    return {
      kind: "resume",
      kicker: "Resume",
      title: "You have a move in progress",
      subtitle: "Pick your session back up before it expires.",
      ctaLabel: "Resume Move",
      action: "resume-move",
      tone: "primary",
      icon: "play-circle-outline",
    };
  }

  // 2. Territory defence warning.
  if (input.atRiskZoneCount > 0) {
    const many = input.atRiskZoneCount > 1;
    const name = input.topRiskZoneName;
    return {
      kind: "defend",
      kicker: "Defend",
      title: many
        ? `${input.atRiskZoneCount} zones need defending`
        : name
          ? `${name} needs defending`
          : "A zone needs defending",
      subtitle: "Move through your territory to refresh its defence.",
      ctaLabel: "View Territory",
      action: "territory",
      tone: "danger",
      icon: "shield-half-outline",
    };
  }

  // 3. Existing current objective.
  if (input.currentObjectiveTitle) {
    return {
      kind: "objective",
      kicker: "Objective",
      title: input.currentObjectiveTitle,
      subtitle: "Your current objective — keep the momentum going.",
      ctaLabel: "View Objective",
      action: "objective",
      tone: "primary",
      icon: "flag-outline",
    };
  }

  // 4. First movement.
  if (!input.hasMovedEver) {
    return {
      kind: "first-move",
      kicker: "Start here",
      title: "Make your first move",
      subtitle: "Start a session to put yourself on the map.",
      ctaLabel: "Start First Move",
      action: "move",
      tone: "primary",
      icon: "walk-outline",
    };
  }

  // 5. First zone capture.
  if (input.zonesOwned === 0) {
    return {
      kind: "first-zone",
      kicker: "Capture",
      title: "Capture your first territory",
      subtitle: "Move through a new zone to claim it locally.",
      ctaLabel: "Start Move",
      action: "move",
      tone: "green",
      icon: "flag-outline",
    };
  }

  // 6. Weekly objective (terminal fallback).
  return {
    kind: "weekly",
    kicker: "This week",
    title: input.weeklyObjectiveTitle ?? "Keep your streak alive",
    subtitle: "Add a session this week to grow your territory.",
    ctaLabel: "Start Move",
    action: input.weeklyObjectiveTitle ? "weekly" : "move",
    tone: "gold",
    icon: "ribbon-outline",
  };
}

/**
 * Whether the mission card should render its own CTA button.
 *
 * The hero already owns the single primary movement CTA (Start/Resume Move), so
 * a mission whose action is also a movement action must NOT show a second
 * Start/Resume button — that would duplicate the primary CTA. Non-movement
 * missions (defend, objective, weekly) get their own contextual button.
 */
export function missionHasOwnCta(mission: HomeMission, hero: HeroState): boolean {
  if (!isMoveAction(mission.action)) return true;
  // Both are movement actions → the hero's button already covers it.
  return isMoveAction(hero.action) ? false : true;
}

/**
 * Count the primary movement CTAs a composed Home would show. Invariant: this
 * must be exactly 1 for every input (the hero's), so the screen never presents
 * a duplicated Start/Resume Move button.
 */
export function countPrimaryMoveCtas(
  hero: HeroState,
  mission: HomeMission,
): number {
  let n = isMoveAction(hero.action) ? 1 : 0;
  if (missionHasOwnCta(mission, hero) && isMoveAction(mission.action)) n += 1;
  return n;
}

/* ── "Up Next" — a capped, prioritized list of secondary destinations ── */

/** Max secondary rows Home shows below the mission — hard product cap. */
export const UP_NEXT_CAP = 3;

/** Semantic id for an Up Next row; the screen maps it to a concrete route. */
export type UpNextId =
  | "objectives"
  | "weekly-recap"
  | "club"
  | "questline"
  | "city"
  | "collections";

export interface UpNextItem {
  id: UpNextId;
  title: string;
  subtitle: string;
  icon: string;
}

export interface UpNextInput {
  /** The mission already surfaced above — its source is not repeated here. */
  missionKind: MissionKind;
  hasSeasonObjective: boolean;
  seasonObjectiveSubtitle: string;
  hasWeeklyActivity: boolean;
  weeklyRecapSubtitle: string;
  hasClub: boolean;
  clubSubtitle: string;
  questlineComplete: boolean;
  questlineSubtitle: string;
  hasZones: boolean;
  citySubtitle: string;
}

/**
 * Build the "Up Next" list: the most relevant secondary destinations, in
 * priority order, capped at {@link UP_NEXT_CAP}. Rows only appear when their
 * underlying data exists, so Home never shows an empty or fabricated row. The
 * mission's own source is skipped to avoid repeating it directly beneath.
 */
export function buildUpNext(input: UpNextInput): UpNextItem[] {
  const candidates: (UpNextItem | null)[] = [
    input.questlineComplete
      ? null
      : {
          id: "questline",
          title: "MovenRun Questline",
          subtitle: input.questlineSubtitle,
          icon: "compass-outline",
        },
    input.hasSeasonObjective && input.missionKind !== "objective"
      ? {
          id: "objectives",
          title: "Season Objectives",
          subtitle: input.seasonObjectiveSubtitle,
          icon: "ribbon-outline",
        }
      : null,
    input.hasWeeklyActivity
      ? {
          id: "weekly-recap",
          title: "Weekly Recap",
          subtitle: input.weeklyRecapSubtitle,
          icon: "bar-chart-outline",
        }
      : null,
    input.hasZones
      ? {
          id: "city",
          title: "City Districts",
          subtitle: input.citySubtitle,
          icon: "business-outline",
        }
      : null,
    {
      id: "club",
      title: input.hasClub ? "Your Club" : "Choose your club",
      subtitle: input.clubSubtitle,
      icon: "people-outline",
    },
  ];

  return candidates.filter((c): c is UpNextItem => c !== null).slice(0, UP_NEXT_CAP);
}
