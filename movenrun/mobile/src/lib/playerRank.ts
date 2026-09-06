/**
 * The player's rank — the cosmetic half of progression.
 *
 * Levelling already exists (`lib/leveling.ts`) and is the arithmetic half: XP
 * in, level and a 0..1 bar out. What it does not give you is an *identity*.
 * "LV 12" is a number; "LV 12 · PATHFINDER" is a player, and the difference is
 * most of what makes a progress bar feel like a game rather than a form field.
 *
 * Two things this module deliberately is not:
 *
 *  - **Not a reward.** A rank confers nothing. It grants no XP, no territory,
 *    no Locked MOVE, no multiplier and no eligibility. It is a label computed
 *    from a level the store already holds, so it cannot be farmed, and there is
 *    nothing here for a server to disagree with later.
 *  - **Not a new curve.** `XP_PER_LEVEL` stays the single owner of how fast a
 *    level arrives. This module reads `getLevelInfo()` and never re-derives it,
 *    so a change to the curve moves the ranks with it automatically.
 *
 * Pure and platform-free, like everything else in `lib/`, so the bands are
 * verified off-device.
 */
import { getLevelInfo } from "./leveling";

/**
 * A rank band: the level it starts at, and what the player is called there.
 *
 * Ordered ascending and read from the top down, so the table is total by
 * construction — there is no level a `for` loop can fall off the end of, and
 * adding a band is one line rather than a new branch.
 *
 * The names come from the design guide's own vocabulary (its home mock reads
 * "LV 12 · PATHFINDER") and follow the loop the app is actually about: you
 * start out walking unfamiliar ground and end up holding it.
 */
export interface RankBand {
  /** First level in this band. The last band has no upper bound. */
  readonly from: number;
  /** Displayed in caps beside the level. Two words at most. */
  readonly title: string;
}

export const RANK_BANDS: readonly RankBand[] = [
  { from: 1, title: "Newcomer" },
  { from: 3, title: "Wayfarer" },
  { from: 6, title: "Scout" },
  { from: 10, title: "Pathfinder" },
  { from: 15, title: "Trailblazer" },
  { from: 21, title: "Cartographer" },
  { from: 30, title: "Landholder" },
] as const;

/** The rank title for a level. Levels below the first band read as the first. */
export function rankTitle(level: number): string {
  const safe = Number.isFinite(level) ? Math.floor(level) : 1;
  let title = RANK_BANDS[0]!.title;
  for (const band of RANK_BANDS) {
    if (safe >= band.from) title = band.title;
  }
  return title;
}

/**
 * Everything the resource header needs, pre-formatted.
 *
 * Pre-formatted on purpose: the header appears on four screens, and the moment
 * each one does its own `${xpForLevel - xpIntoLevel} XP to level ${level + 1}`
 * they start disagreeing about whether the next level is `level + 1` or the
 * level you are working towards. One string, one owner.
 */
export interface HudProgress {
  level: number;
  /** Cosmetic rank title for {@link level}. */
  rank: string;
  /** Total XP, grouped for display ("1,260"). */
  xpLabel: string;
  /** 0..1 through the current level. */
  progress: number;
  /** XP still owed before the next level. Zero only at an exact boundary. */
  xpToNext: number;
  /** "540 XP to level 13". */
  nextLevelLabel: string;
  /** Spoken form for the whole header — one sentence, no punctuation soup. */
  accessibilityLabel: string;
}

export function hudProgress(totalXp: number, name: string): HudProgress {
  const level = getLevelInfo(totalXp);
  const rank = rankTitle(level.level);
  const xpToNext = level.xpForLevel - level.xpIntoLevel;
  /* `toLocaleString` and not a hand-rolled grouper: the value is a plain
     integer and the platform already knows the user's separator. */
  const xpLabel = Math.max(0, Math.floor(totalXp)).toLocaleString();
  const nextLevelLabel = `${xpToNext.toLocaleString()} XP to level ${level.level + 1}`;
  return {
    level: level.level,
    rank,
    xpLabel,
    progress: level.progress,
    xpToNext,
    nextLevelLabel,
    /* One sentence rather than four adjacent labels: a screen reader landing on
       the header should hear who you are and how far you are, not "Mover",
       "LV", "12", "PATHFINDER", "1,260", "XP". */
    accessibilityLabel: `${name}, level ${level.level}, ${rank}. ${xpLabel} XP total, ${nextLevelLabel}.`,
  };
}
