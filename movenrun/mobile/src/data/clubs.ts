/**
 * Mock club catalogue — Free Map Beta, local preview only.
 *
 * Like `data/quests.ts`, this module is raw seed *data*. Clubs do not sync
 * anywhere yet ("Local preview · clubs sync later"): the rival numbers are
 * static seeds, and the user's club is brought to life by blending in the
 * player's real local stats (see `lib/clubs.ts`). No treasury, no economy.
 */
import { palette } from "@/theme";
import type { Club } from "@/types";

export const CLUBS: Club[] = [
  {
    id: "base-builders",
    name: "Base Builders",
    shortName: "BB",
    color: palette.baseBlue,
    motto: "Lay a tile every day.",
    memberCount: 124,
    weeklyDistanceKm: 312,
    zonesOwned: 18,
    zonesDefended: 22,
    territoryScore: 2052,
    cityRank: 1,
    isUserClub: false,
  },
  {
    id: "riverside-runners",
    name: "Riverside Runners",
    shortName: "RR",
    color: palette.heatCoral,
    motto: "Own the waterline.",
    memberCount: 97,
    weeklyDistanceKm: 268,
    zonesOwned: 15,
    zonesDefended: 19,
    territoryScore: 1750,
    cityRank: 2,
    isUserClub: false,
  },
  {
    id: "morning-miles",
    name: "Morning Miles",
    shortName: "MM",
    color: palette.moveGold,
    motto: "First light, first claim.",
    memberCount: 86,
    weeklyDistanceKm: 224,
    zonesOwned: 12,
    zonesDefended: 14,
    territoryScore: 1424,
    cityRank: 3,
    isUserClub: false,
  },
  {
    id: "campus-crew",
    name: "Campus Crew",
    shortName: "CC",
    color: palette.deedViolet,
    motto: "Every block between classes.",
    memberCount: 73,
    weeklyDistanceKm: 187,
    zonesOwned: 9,
    zonesDefended: 11,
    territoryScore: 1150,
    cityRank: 4,
    isUserClub: false,
  },
];

export function getClubById(id: string | null | undefined): Club | null {
  return CLUBS.find((c) => c.id === id) ?? null;
}
