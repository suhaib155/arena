/**
 * Local Deed Preview Showroom — Free Map Beta, on-device only.
 *
 * A safe, non-transactional preview of the FUTURE Zone Deed layer, derived
 * entirely from already-built local overviews (captured zones, district
 * mastery, and the route-signal passport). It previews what a future Zone
 * Deed *might* look like — it is **not** real ownership, not a mint, not a
 * claim, not a marketplace, not tradable, has **no market or rarity value**,
 * and **no rewards or earnings**. Deterministic and read-only: same input,
 * same output, no randomness, no timers/countdowns, no backend, no chain, no
 * wallet, no raw GPS/coordinates/path, and **no real geography or location
 * inference** (district names are the same fixed fictional labels used by
 * `cityDistricts.ts`, resolved by hashing a zone's opaque id). The Deed
 * Preview Showroom gates nothing — XP, capture, defend, fortify, clubs, and
 * ownership state are entirely unaffected by anything here.
 */
import type { Zone } from "@/types";
import { DISTRICT_NAMES } from "@/lib/cityDistricts";
import type { DistrictMasteryOverview } from "@/lib/districtMastery";
import type { RouteSignalPassport } from "@/lib/routePassport";
import { zoneStatus, type ZoneStatus } from "@/lib/territory";

export type DeedPreviewType = "starter" | "fortified" | "district" | "signature" | "legacy";
export type DeedVisualTier = "preview" | "rising" | "fortified" | "signature";
/** Semantic CTA — resolved to a concrete route by the screen. */
export type DeedAction = "move" | "map" | "alerts" | "districtMastery" | "districts" | "signal";

export interface DeedPreviewCard {
  id: string;
  type: DeedPreviewType;
  typeLabel: string;
  visualTier: DeedVisualTier;
  /** Safe zone/district label — never a real place name. */
  label: string;
  /** Fixed fictional district name (see cityDistricts.ts). */
  districtName: string;
  ready: boolean;
  /** 0..100. */
  readinessScore: number;
  controlContribution: number;
  defenseContribution: number;
  activityContribution: number;
  signalContribution: number;
  masteryContribution: number;
  utilityBullets: string[];
  /** Why this preview isn't ready yet, or null once it is. */
  lockedExplanation: string | null;
  recommendation: string;
  ctaLabel: string;
  action: DeedAction;
  /** Daylight Cartography accent (theme palette hex). */
  accent: string;
  previewOnly: true;
}

export interface DeedShowroomOverview {
  cards: DeedPreviewCard[];
  hasZones: boolean;
  previewCount: number;
  readyCount: number;
  lockedCount: number;
  /** Highest-readiness ready card, or null when none are ready yet. */
  topCard: DeedPreviewCard | null;
  summaryLine: string;
  previewOnly: true;
}

export interface DeedPreviewInput {
  hasZones: boolean;
  zones: Zone[];
  districtMastery: DistrictMasteryOverview;
  passport: RouteSignalPassport;
  /** Overridable for tests; defaults to Date.now(). */
  now?: number;
}

const PALETTE = {
  baseBlue: "#246BFE",
  pulseGreen: "#18C987",
  moveGold: "#F7B955",
  deedViolet: "#7657FF",
  silverTrail: "#A3AAB8",
} as const;

const TIER_ACCENT: Record<DeedVisualTier, string> = {
  preview: PALETTE.silverTrail,
  rising: PALETTE.moveGold,
  fortified: PALETTE.pulseGreen,
  signature: PALETTE.deedViolet,
};

export const DEED_TIER_LABEL: Record<DeedVisualTier, string> = {
  preview: "Preview",
  rising: "Rising",
  fortified: "Fortified",
  signature: "Signature",
};

export const DEED_TYPE_LABEL: Record<DeedPreviewType, string> = {
  starter: "Starter preview",
  fortified: "Fortified preview",
  district: "District preview",
  signature: "Signature preview",
  legacy: "Legacy preview",
};

/** Future-only, non-financial utility copy — never ownership/reward language. */
const UTILITY_BULLETS: Record<DeedPreviewType, string[]> = {
  starter: ["Future zone identity marker", "Future city layer placement", "No wallet required to preview"],
  fortified: ["Future defense-linked utility", "Future zone identity marker", "Educational preview only"],
  district: ["Future district-linked utility", "Future city layer placement"],
  signature: ["Future signature-tier utility", "Future governance/utility possibilities"],
  legacy: ["Future route-signal-linked identity", "Future proof-of-movement recognition"],
};

const FORTIFIED_DEFENSE_THRESHOLD = 60;
const LEGACY_SIGNAL_THRESHOLD = 70;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function tierFor(score: number): DeedVisualTier {
  if (score >= 85) return "signature";
  if (score >= 65) return "fortified";
  if (score >= 35) return "rising";
  return "preview";
}

/** Small deterministic FNV-1a hash — the same algorithm cityDistricts.ts
 *  uses to bucket a zone into a fixed fictional district, kept in sync here
 *  only so a deed preview's label agrees with the City Districts screen. No
 *  geography, coordinates, or real names are ever involved. */
function hashId(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function districtNameForZone(zoneId: string): string {
  return DISTRICT_NAMES[hashId(zoneId) % DISTRICT_NAMES.length];
}

/** The zone that scores highest under `metric`, tie-broken by earliest capture. */
function bestZone(
  zones: Zone[],
  now: number,
  metric: (s: ZoneStatus) => number,
): { zone: Zone; status: ZoneStatus } {
  let best = zones[0];
  let bestStatus = zoneStatus(best, now);
  let bestValue = metric(bestStatus);
  for (const zone of zones.slice(1)) {
    const status = zoneStatus(zone, now);
    const value = metric(status);
    if (
      value > bestValue ||
      (value === bestValue && new Date(zone.capturedAt).getTime() < new Date(best.capturedAt).getTime())
    ) {
      best = zone;
      bestStatus = status;
      bestValue = value;
    }
  }
  return { zone: best, status: bestStatus };
}

function lockedCard(
  type: DeedPreviewType,
  label: string,
  districtName: string,
  explanation: string,
  action: DeedAction,
  ctaLabel: string,
): DeedPreviewCard {
  return {
    id: `${type}-locked`,
    type,
    typeLabel: DEED_TYPE_LABEL[type],
    visualTier: "preview",
    label,
    districtName,
    ready: false,
    readinessScore: 0,
    controlContribution: 0,
    defenseContribution: 0,
    activityContribution: 0,
    signalContribution: 0,
    masteryContribution: 0,
    utilityBullets: UTILITY_BULLETS[type],
    lockedExplanation: explanation,
    recommendation: explanation,
    ctaLabel,
    action,
    accent: TIER_ACCENT.preview,
    previewOnly: true,
  };
}

/** captured zone -> starter deed preview (ready as soon as one zone exists). */
function buildStarterCard(zones: Zone[], now: number): DeedPreviewCard {
  if (zones.length === 0) {
    return lockedCard(
      "starter",
      "Future Starter Deed",
      "Not yet discovered",
      "Capture a zone to unlock a starter deed preview.",
      "move",
      "Start Move",
    );
  }
  const { zone, status } = bestZone(zones, now, (s) => s.control);
  const controlContribution = Math.round(status.control * 0.6);
  const defenseContribution = Math.round(status.defense * 0.3);
  const activityContribution = clamp(Math.round((zone.fortifyCount ?? 0) * 4), 0, 10);
  const readinessScore = clamp(controlContribution + defenseContribution + activityContribution, 0, 100);
  const tier = tierFor(readinessScore);
  return {
    id: `starter-${zone.id}`,
    type: "starter",
    typeLabel: DEED_TYPE_LABEL.starter,
    visualTier: tier,
    label: zone.name,
    districtName: districtNameForZone(zone.id),
    ready: true,
    readinessScore,
    controlContribution,
    defenseContribution,
    activityContribution,
    signalContribution: 0,
    masteryContribution: 0,
    utilityBullets: UTILITY_BULLETS.starter,
    lockedExplanation: null,
    recommendation: `Keep moving through ${zone.name} to strengthen this preview.`,
    ctaLabel: "View Territory",
    action: "map",
    accent: TIER_ACCENT[tier],
    previewOnly: true,
  };
}

/** zone with good defense -> fortified deed preview. */
function buildFortifiedCard(zones: Zone[], now: number): DeedPreviewCard {
  if (zones.length === 0) {
    return lockedCard(
      "fortified",
      "Future Fortified Deed",
      "Not yet discovered",
      "Capture and defend a zone to unlock a fortified deed preview.",
      "move",
      "Start Move",
    );
  }
  const { zone, status } = bestZone(zones, now, (s) => s.defense);
  const ready = status.defense >= FORTIFIED_DEFENSE_THRESHOLD;
  const controlContribution = Math.round(status.control * 0.2);
  const defenseContribution = Math.round(status.defense * 0.6);
  const activityContribution = clamp(Math.round((zone.fortifyCount ?? 0) * 4), 0, 20);
  const readinessScore = clamp(controlContribution + defenseContribution + activityContribution, 0, 100);
  const tier = ready ? tierFor(readinessScore) : "preview";
  return {
    id: `fortified-${zone.id}`,
    type: "fortified",
    typeLabel: DEED_TYPE_LABEL.fortified,
    visualTier: tier,
    label: zone.name,
    districtName: districtNameForZone(zone.id),
    ready,
    readinessScore,
    controlContribution,
    defenseContribution,
    activityContribution,
    signalContribution: 0,
    masteryContribution: 0,
    utilityBullets: UTILITY_BULLETS.fortified,
    lockedExplanation: ready
      ? null
      : `Raise ${zone.name}'s defense above ${FORTIFIED_DEFENSE_THRESHOLD}% to unlock a fortified deed preview.`,
    recommendation: ready
      ? `${zone.name} is well-defended — fortified preview ready.`
      : `Defend and fortify ${zone.name} to raise its defense.`,
    ctaLabel: ready ? "View Territory" : "View Alerts",
    action: ready ? "map" : "alerts",
    accent: TIER_ACCENT[tier],
    previewOnly: true,
  };
}

/** strong district mastery -> district deed preview (Fortified+ mastery). */
function buildDistrictCard(dm: DistrictMasteryOverview): DeedPreviewCard {
  const top = dm.topDistrict;
  if (!top) {
    return lockedCard(
      "district",
      "Future District Deed",
      "Not yet discovered",
      "Build district mastery to unlock a district deed preview.",
      "districtMastery",
      "View District Mastery",
    );
  }
  const ready = top.level === "fortified" || top.level === "signature";
  const tier = ready ? (top.level === "signature" ? "signature" : "fortified") : tierFor(top.masteryScore);
  return {
    id: `district-${top.id}`,
    type: "district",
    typeLabel: DEED_TYPE_LABEL.district,
    visualTier: tier,
    label: top.name,
    districtName: top.name,
    ready,
    readinessScore: top.masteryScore,
    controlContribution: top.controlContribution,
    defenseContribution: top.defenseContribution,
    activityContribution: top.activityContribution,
    signalContribution: top.signalContribution,
    masteryContribution: top.masteryScore,
    utilityBullets: UTILITY_BULLETS.district,
    lockedExplanation: ready
      ? null
      : `Raise ${top.name} to Fortified mastery to unlock a district deed preview.`,
    recommendation: ready
      ? `${top.name} has strong enough mastery for a district preview.`
      : `Keep building mastery in ${top.name}.`,
    ctaLabel: "View District Mastery",
    action: "districtMastery",
    accent: TIER_ACCENT[tier],
    previewOnly: true,
  };
}

/** strongest local district -> signature deed preview (Signature mastery only). */
function buildSignatureCard(dm: DistrictMasteryOverview): DeedPreviewCard {
  const top = dm.topDistrict;
  if (!top) {
    return lockedCard(
      "signature",
      "Future Signature Deed",
      "Not yet discovered",
      "Reach Signature district mastery to unlock a signature deed preview.",
      "districts",
      "View City Districts",
    );
  }
  const ready = top.level === "signature";
  const tier = ready ? "signature" : tierFor(top.masteryScore);
  return {
    id: `signature-${top.id}`,
    type: "signature",
    typeLabel: DEED_TYPE_LABEL.signature,
    visualTier: tier,
    label: top.name,
    districtName: top.name,
    ready,
    readinessScore: top.masteryScore,
    controlContribution: top.controlContribution,
    defenseContribution: top.defenseContribution,
    activityContribution: top.activityContribution,
    signalContribution: top.signalContribution,
    masteryContribution: top.masteryScore,
    utilityBullets: UTILITY_BULLETS.signature,
    lockedExplanation: ready
      ? null
      : `Reach Signature mastery in ${top.name} to unlock a signature deed preview.`,
    recommendation: ready
      ? `${top.name} is your strongest district — signature preview ready.`
      : `${top.name} is your strongest district so far. Keep pushing it toward Signature.`,
    ctaLabel: "View City Districts",
    action: "districts",
    accent: TIER_ACCENT[tier],
    previewOnly: true,
  };
}

/** high route signal / proof history -> legacy deed preview. */
function buildLegacyCard(passport: RouteSignalPassport): DeedPreviewCard {
  const ready = passport.readinessScore >= LEGACY_SIGNAL_THRESHOLD;
  const tier = ready ? tierFor(passport.readinessScore) : "preview";
  return {
    id: "legacy-signal",
    type: "legacy",
    typeLabel: DEED_TYPE_LABEL.legacy,
    visualTier: tier,
    label: "City-wide Route Signal",
    districtName: "Signal Archive",
    ready,
    readinessScore: passport.readinessScore,
    controlContribution: 0,
    defenseContribution: 0,
    activityContribution: 0,
    signalContribution: passport.readinessScore,
    masteryContribution: 0,
    utilityBullets: UTILITY_BULLETS.legacy,
    lockedExplanation: ready ? null : "Build cleaner route signal to unlock a legacy deed preview.",
    recommendation: ready
      ? "Your route signal is strong enough for a legacy preview."
      : "Save cleaner routes to raise your signal.",
    ctaLabel: "View Signal Passport",
    action: "signal",
    accent: TIER_ACCENT[tier],
    previewOnly: true,
  };
}

/** Deterministically build the Deed Preview Showroom from local overviews. */
export function buildDeedShowroom(input: DeedPreviewInput): DeedShowroomOverview {
  const now = input.now ?? Date.now();
  const cards: DeedPreviewCard[] = [
    buildStarterCard(input.zones, now),
    buildFortifiedCard(input.zones, now),
    buildDistrictCard(input.districtMastery),
    buildSignatureCard(input.districtMastery),
    buildLegacyCard(input.passport),
  ];

  const readyCards = cards.filter((c) => c.ready);
  const readyCount = readyCards.length;
  const lockedCount = cards.length - readyCount;
  const topCard = [...readyCards].sort((a, b) => b.readinessScore - a.readinessScore)[0] ?? null;

  return {
    cards,
    hasZones: input.hasZones,
    previewCount: cards.length,
    readyCount,
    lockedCount,
    topCard,
    summaryLine: input.hasZones
      ? `${readyCount} ready · ${lockedCount} locked preview${lockedCount === 1 ? "" : "s"}`
      : "Capture zones to unlock local deed previews.",
    previewOnly: true,
  };
}
