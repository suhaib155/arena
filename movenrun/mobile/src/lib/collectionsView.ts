/**
 * Collections presentation view — pure, platform-free, testable.
 *
 * Reshapes the existing `CollectionsOverview` (the single source of truth for
 * badge logic) into the redesigned archive: one dominant completion summary,
 * the nearest unlock, in-progress badges, and collapsed unlocked/locked
 * archives. It fabricates NO rarity, market value, ownership, minting,
 * scarcity, or unlock probability — badges carry only real title / description /
 * current / target / status, and locked entries surface their real requirement.
 */
import type { Badge, BadgeCollection, CollectionsOverview } from "@/lib/zoneCollections";

export interface CollectionsView {
  unlocked: number;
  total: number;
  completionPct: number;
  nextBadge: Badge | null;
  /** Badges with real partial progress (status "in-progress"), closest first. */
  inProgress: Badge[];
  unlockedBadges: Badge[];
  /** Not-yet-started badges (status "locked", zero progress). */
  lockedBadges: Badge[];
  /** Passthrough of the grouped collections for compact summary rows. */
  collections: BadgeCollection[];
  hasProgress: boolean;
  allComplete: boolean;
  statement: string;
}

export function buildCollectionsView(o: CollectionsOverview): CollectionsView {
  const all = o.collections.flatMap((c) => c.badges);
  const inProgress = all
    .filter((b) => b.status === "in-progress")
    .sort((a, b) => b.current / b.target - a.current / a.target);
  const unlockedBadges = all.filter((b) => b.status === "unlocked");
  const lockedBadges = all.filter((b) => b.status === "locked");
  const allComplete = o.total > 0 && o.unlocked === o.total;
  const hasProgress = o.unlocked > 0 || inProgress.length > 0;

  const statement = allComplete
    ? "Every local badge unlocked — nice work."
    : o.nextBadge
      ? `${o.unlocked} of ${o.total} unlocked · nearest: ${o.nextBadge.title}`
      : "Start moving to earn your first local badge";

  return {
    unlocked: o.unlocked,
    total: o.total,
    completionPct: o.completionPct,
    nextBadge: o.nextBadge,
    inProgress,
    unlockedBadges,
    lockedBadges,
    collections: o.collections,
    hasProgress,
    allComplete,
    statement,
  };
}

/**
 * The real, honest requirement for a badge (its description + target). Used by
 * the locked-state rows so a locked entry always explains what it needs — never
 * a fabricated rarity or probability.
 */
export function lockedRequirement(badge: Badge): string {
  if (badge.target > 1) {
    return `${badge.description} (${badge.current}/${badge.target})`;
  }
  return badge.description;
}
