/**
 * Deeds presentation view — pure, platform-free, testable.
 *
 * Reshapes the existing `DeedShowroomOverview` (the single source of truth for
 * deed-preview logic) into a calm ownership-preview archive. It invents no
 * market value, rarity, floor price, scarcity, yield, resale value, or
 * ownership certainty, and it never labels a preview as "owned". Every deed is a
 * local, on-device preview record — not a mint, claim, or on-chain asset.
 */
import type { DeedPreviewCard, DeedShowroomOverview } from "@/lib/deedPreview";

export interface DeedsView {
  hasZones: boolean;
  total: number;
  ready: number;
  locked: number;
  /** 0..100 — ready previews as a share of all previews. */
  readyPct: number;
  /** Highest-readiness ready preview, or null. */
  featured: DeedPreviewCard | null;
  readyCards: DeedPreviewCard[];
  lockedCards: DeedPreviewCard[];
  statement: string;
}

export function buildDeedsView(o: DeedShowroomOverview): DeedsView {
  const readyCards = o.cards.filter((c) => c.ready);
  const lockedCards = o.cards.filter((c) => !c.ready);
  const readyPct = o.previewCount > 0 ? Math.round((o.readyCount / o.previewCount) * 100) : 0;
  const statement = o.hasZones
    ? `${o.readyCount} of ${o.previewCount} previews ready · earned on this device`
    : "Capture zones to unlock local deed previews";
  return {
    hasZones: o.hasZones,
    total: o.previewCount,
    ready: o.readyCount,
    locked: o.lockedCount,
    readyPct,
    featured: o.topCard,
    readyCards,
    lockedCards,
    statement,
  };
}

/**
 * Honest status label for a deed preview — never "owned", never financial.
 * Ready previews are earned locally on this device; locked ones are not yet.
 */
export function deedStatusLabel(card: DeedPreviewCard): string {
  return card.ready ? "Preview record · earned on this device" : "Locked preview";
}
