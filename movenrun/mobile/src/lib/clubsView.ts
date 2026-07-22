/**
 * Clubs presentation view — pure, platform-free, testable.
 *
 * Derives display state and the single "current club mission" from the player's
 * real local stats and the existing ranking result (`RankedClub`). It changes
 * no ranking logic (that stays in `lib/clubs.ts`), fabricates no live/global
 * competition, and always marks the data as a local preview. Honestly labels
 * rank-unavailable and zero-contribution states.
 */
import type { RankedClub } from "@/lib/clubs";

export type ClubMissionKind =
  | "join"
  | "first-contribution"
  | "defend"
  | "climb"
  | "hold"
  | "capture";

export interface ClubMission {
  kind: ClubMissionKind;
  title: string;
  detail: string;
  /** Semantic CTA the screen maps to a route. */
  action: "clubs" | "move" | "map";
  ctaLabel: string;
}

export interface ClubMissionInput {
  hasClub: boolean;
  /** The player's contribution to their club's score (0 when none yet). */
  userContribution: number;
  /** The user club's rank, or null when unavailable. */
  rank: number | null;
  zonesOwned: number;
  atRiskZones: number;
}

/**
 * Select the one recommended club action. Priority: join (no club) → defend
 * at-risk zones → capture first zone → make a first contribution → climb (not
 * rank 1) → hold (rank 1).
 */
export function selectClubMission(input: ClubMissionInput): ClubMission {
  if (!input.hasClub) {
    return {
      kind: "join",
      title: "Join a club",
      detail: "Pick a local club — your movement powers its weekly score.",
      action: "clubs",
      ctaLabel: "Choose a club",
    };
  }
  if (input.atRiskZones > 0) {
    return {
      kind: "defend",
      title: `Defend ${input.atRiskZones} zone${input.atRiskZones === 1 ? "" : "s"}`,
      detail: "Move through your at-risk territory to strengthen your club.",
      action: "map",
      ctaLabel: "View Territory",
    };
  }
  if (input.zonesOwned === 0) {
    return {
      kind: "capture",
      title: "Capture your first zone",
      detail: "Territory you hold adds to your club's score.",
      action: "move",
      ctaLabel: "Start Move",
    };
  }
  if (input.userContribution <= 0) {
    return {
      kind: "first-contribution",
      title: "Make your first contribution",
      detail: "Save a route this week to add your score to the club.",
      action: "move",
      ctaLabel: "Start Move",
    };
  }
  if (input.rank == null || input.rank > 1) {
    return {
      kind: "climb",
      title: input.rank == null ? "Climb the leaderboard" : `Climb from #${input.rank}`,
      detail: "Keep moving this week to lift your club up the city board.",
      action: "move",
      ctaLabel: "Start Move",
    };
  }
  return {
    kind: "hold",
    title: "Hold your lead",
    detail: "Your club is #1 — keep moving to defend the top spot.",
    action: "move",
    ctaLabel: "Start Move",
  };
}

/** Display label for a club rank (honest when unavailable). */
export function rankLabel(rank: number | null): string {
  return rank == null ? "Unranked" : `#${rank}`;
}

/** Display label for the player's contribution (honest at zero). */
export function contributionLabel(contribution: number): string {
  return contribution > 0 ? `+${contribution}` : "No contribution yet";
}

export interface ClubHeroView {
  rankLabel: string;
  contributionLabel: string;
  hasContribution: boolean;
  rankAvailable: boolean;
  /** Always true — Clubs is a local, on-device preview (no live/global data). */
  localPreview: true;
}

export function buildClubHeroView(mine: RankedClub | null): ClubHeroView {
  const rank = mine?.rank ?? null;
  const contribution = mine?.userContribution ?? 0;
  return {
    rankLabel: rankLabel(rank),
    contributionLabel: contributionLabel(contribution),
    hasContribution: contribution > 0,
    rankAvailable: rank != null,
    localPreview: true,
  };
}
