/**
 * Local club scoring — Free Map Beta, on-device preview only.
 *
 * The leaderboard is a deterministic blend of static rival seeds and the
 * player's real local progress. There is no server, no sync, and no economy:
 * "your movement strengthens your club" means exactly the math below.
 *
 * Territory score, in plain words:
 *   zones owned × 30  +  zones defended × 12  +  weekly km × 4
 * The user's club additionally earns the player's contribution:
 *   your zones × 30  +  your defends × 12  +  your XP ÷ 20  +  sessions this week × 8  +  streak × 5
 */
import type { Club } from "@/types";
import type { CompletionRecord } from "@/store/useGameStore";

export interface UserClubInput {
  zonesOwned: number;
  timesDefended: number;
  totalXp: number;
  /** Current daily streak. */
  streak: number;
  /** Saved movement sessions in the last 7 days (max 1/day by design). */
  sessionsThisWeek: number;
}

export interface RankedClub {
  club: Club;
  /** Total territory score driving the rank. */
  score: number;
  /** The player's share of the score (0 for rivals). */
  userContribution: number;
  rank: number;
  /** vs. the seeded cityRank: up / down / steady. */
  trend: "up" | "down" | "steady";
  isUserClub: boolean;
}

/** Rival baseline = the club's seeded territory score (see data/clubs.ts).
 *  Seeds were derived as zonesOwned×30 + zonesDefended×12 + weeklyKm×4. */
export function baseClubScore(club: Club): number {
  return club.territoryScore;
}

export function userContribution(input: UserClubInput): number {
  return Math.round(
    input.zonesOwned * 30 +
      input.timesDefended * 12 +
      input.totalXp / 20 +
      input.sessionsThisWeek * 8 +
      input.streak * 5,
  );
}

/** Saved movement sessions within the past 7 days, from real local history. */
export function sessionsThisWeek(history: readonly CompletionRecord[]): number {
  const weekAgo = Date.now() - 7 * 86_400_000;
  return history.filter(
    (rec) =>
      rec.questId === "move-session" &&
      new Date(rec.completedAt).getTime() >= weekAgo,
  ).length;
}

/** Rank all clubs, blending the player's real stats into their club. */
export function rankClubs(
  clubs: Club[],
  selectedClubId: string | null,
  input: UserClubInput,
): RankedClub[] {
  const scored = clubs.map((club) => {
    const isUser = club.id === selectedClubId;
    const contribution = isUser ? userContribution(input) : 0;
    return {
      club,
      isUserClub: isUser,
      userContribution: contribution,
      score: baseClubScore(club) + contribution,
    };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry, i) => {
    const rank = i + 1;
    const trend: RankedClub["trend"] =
      rank < entry.club.cityRank ? "up" : rank > entry.club.cityRank ? "down" : "steady";
    return { ...entry, rank, trend };
  });
}

/** "Resets in 3d 14h" — time until next Monday 00:00 local (season preview). */
export function seasonResetLabel(now: number = Date.now()): string {
  const d = new Date(now);
  const day = d.getDay(); // 0 Sun .. 6 Sat
  const daysToMonday = ((8 - day) % 7) || 7;
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + daysToMonday);
  const ms = next.getTime() - now;
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  return days > 0 ? `Resets in ${days}d ${hours}h` : `Resets in ${hours}h`;
}
