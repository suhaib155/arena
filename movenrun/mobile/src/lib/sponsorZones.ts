/**
 * Local sponsor zones — Free Map Beta, on-device only.
 *
 * A read-only, deterministic *preview* of how future brand/sponsor activations
 * could appear in the MovenRun city layer. It is built entirely from existing
 * local state (captured zones + the district overview) and uses **fixed
 * fictional sponsor names** mapped onto districts by hashed safe ids — there are
 * **no real sponsors/brands, ads, paid placements, payments, coupons, offers,
 * rewards, backend, network, chain, wallet, map SDK, or raw GPS**, and **no
 * geography/coordinate/route/location inference**. It is a preview only — not an
 * ad, deal, or real sponsorship — and it gates nothing.
 */
import type { CityDistrictsOverview, DistrictStatus } from "@/lib/cityDistricts";

export type SponsorCategory =
  | "hydration"
  | "gear"
  | "cafe"
  | "recovery"
  | "community"
  | "event";

export type SponsorStatus = "locked" | "preview" | "warming-up" | "active-preview";
/** Semantic CTA — resolved to a concrete route by the screen. */
export type SponsorAction = "districts" | "war" | "move" | "objectives" | "recap";

interface SponsorDef {
  name: string;
  category: SponsorCategory;
  icon: string;
}

/** Fixed fictional sponsors — flavor only, never real brands. */
const SPONSORS: SponsorDef[] = [
  { name: "Cloud Cup", category: "cafe", icon: "cafe-outline" },
  { name: "Volt Fuel", category: "hydration", icon: "flash-outline" },
  { name: "Dawn Gear", category: "gear", icon: "shirt-outline" },
  { name: "Pulse Café", category: "cafe", icon: "cafe-outline" },
  { name: "Signal Hydrate", category: "hydration", icon: "water-outline" },
  { name: "Beacon Recovery", category: "recovery", icon: "fitness-outline" },
  { name: "Mist Market", category: "community", icon: "storefront-outline" },
  { name: "Runner's Yard", category: "event", icon: "flag-outline" },
];

export interface SponsorZone {
  id: string;
  name: string;
  category: SponsorCategory;
  /** Fictional district tie (safe preset name), or null when not yet tied. */
  districtName: string | null;
  status: SponsorStatus;
  /** 0..100. */
  visibilityScore: number;
  localFitScore: number;
  recommendation: string;
  ctaLabel: string;
  action: SponsorAction;
  /** Higher = surfaced sooner. */
  priority: number;
  /** Ionicons name. */
  icon: string;
  previewOnly: true;
}

export interface SponsorZonesOverview {
  sponsors: SponsorZone[];
  /** Non-locked preview slots. */
  previewSlots: number;
  activePreviewCount: number;
  /** Average local-fit across preview slots (0..100). */
  averageLocalFit: number;
  nextAction: { label: string; action: SponsorAction };
  hasZones: boolean;
  summaryLine: string;
}

export interface SponsorZonesInput {
  /** Whether any territory exists yet. */
  hasZones: boolean;
  city: CityDistrictsOverview;
  /** City-war / weekly momentum, 0..100 (lifts warming-up fit). */
  momentum: number;
  /** Season-objective progress, 0..100 (lifts local fit). */
  objectivesProgress: number;
  /** Any movement logged this week (lifts local fit). */
  weeklyActive: boolean;
}

const MAX_SPONSORS = 8;
const CATEGORY_ACCENT: Record<SponsorCategory, string> = {
  hydration: "#246BFE", // Base Blue
  gear: "#7657FF", // Deed Violet
  cafe: "#F7B955", // MOVE Gold
  recovery: "#18C987", // Pulse Green
  community: "#246BFE", // Base Blue
  event: "#7657FF", // Deed Violet
};

export const SPONSOR_STATUS_LABEL: Record<SponsorStatus, string> = {
  locked: "Locked",
  preview: "Preview",
  "warming-up": "Warming up",
  "active-preview": "Active preview",
};

export const SPONSOR_CATEGORY_LABEL: Record<SponsorCategory, string> = {
  hydration: "Hydration",
  gear: "Gear",
  cafe: "Café",
  recovery: "Recovery",
  community: "Community",
  event: "Event",
};

/** Small deterministic FNV-1a hash → unsigned int. */
function hashId(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function statusForDistrict(d: DistrictStatus): SponsorStatus {
  if (d === "controlled") return "active-preview";
  if (d === "emerging") return "preview";
  // contested / dormant
  return "warming-up";
}

/** Deterministically build the sponsor-zone preview from local state. */
export function buildSponsorZones(input: SponsorZonesInput): SponsorZonesOverview {
  const { city } = input;

  // No territory yet → a locked "future" sponsor board (no district ties).
  if (!input.hasZones) {
    const sponsors: SponsorZone[] = SPONSORS.map((s, i) => ({
      id: `sponsor-locked-${i}`,
      name: s.name,
      category: s.category,
      districtName: null,
      status: "locked",
      visibilityScore: 0,
      localFitScore: 0,
      recommendation: "Capture zones to unlock this sponsor preview.",
      ctaLabel: "Start Move",
      action: "move",
      priority: 0,
      icon: s.icon,
      previewOnly: true,
    }));
    return {
      sponsors,
      previewSlots: 0,
      activePreviewCount: 0,
      averageLocalFit: 0,
      nextAction: { label: "Capture zones to preview future sponsor activations", action: "move" },
      hasZones: false,
      summaryLine: "Capture zones to preview future sponsor activations.",
    };
  }

  const activeDistricts = city.districts.filter((d) => d.zoneCount > 0);
  const sponsors: SponsorZone[] = activeDistricts.map((d) => {
    const seed = hashId(`${d.id}|sponsor`);
    const def = SPONSORS[seed % SPONSORS.length];
    const status = statusForDistrict(d.status);

    const visibilityScore = clamp(
      Math.round(d.controlPct * 0.6 + d.zoneCount * 10 + 20),
      0,
      100,
    );
    const localFitScore = clamp(
      Math.round(
        35 +
          input.objectivesProgress * 0.25 +
          input.momentum * 0.15 +
          (input.weeklyActive ? 12 : 0) +
          d.healthy * 8 +
          (status === "warming-up" ? input.momentum * 0.1 : 0),
      ),
      0,
      100,
    );

    let recommendation: string;
    let ctaLabel: string;
    let action: SponsorAction;
    let priority: number;
    if (status === "active-preview") {
      recommendation = `${def.name} fits ${d.name} well — see it on the war board.`;
      ctaLabel = "View City War";
      action = "war";
      priority = 90 + localFitScore;
    } else if (status === "preview") {
      recommendation = `${def.name} is previewing ${d.name} — grow this district.`;
      ctaLabel = "View District";
      action = "districts";
      priority = 60 + localFitScore;
    } else {
      recommendation = `${def.name} is warming up to ${d.name} — keep it defended.`;
      ctaLabel = "View District";
      action = "districts";
      priority = 40 + localFitScore;
    }

    return {
      id: `sponsor-${d.id}`,
      name: def.name,
      category: def.category,
      districtName: d.name,
      status,
      visibilityScore,
      localFitScore,
      recommendation,
      ctaLabel,
      action,
      priority,
      icon: def.icon,
      previewOnly: true,
    };
  });

  const sorted = sponsors.sort((a, b) => b.priority - a.priority).slice(0, MAX_SPONSORS);
  const previewSlots = sorted.length;
  const activePreviewCount = sorted.filter((s) => s.status === "active-preview").length;
  const averageLocalFit =
    previewSlots > 0
      ? Math.round(sorted.reduce((sum, s) => sum + s.localFitScore, 0) / previewSlots)
      : 0;

  const nextAction = pickNextAction(sorted);

  return {
    sponsors: sorted,
    previewSlots,
    activePreviewCount,
    averageLocalFit,
    nextAction,
    hasZones: true,
    summaryLine: `${previewSlots} preview slot${previewSlots === 1 ? "" : "s"} · ${activePreviewCount} active · avg fit ${averageLocalFit}`,
  };
}

function pickNextAction(sponsors: SponsorZone[]): { label: string; action: SponsorAction } {
  const warming = sponsors.find((s) => s.status === "warming-up");
  if (warming) {
    return { label: `Defend ${warming.districtName} to attract ${warming.name}`, action: "districts" };
  }
  const preview = sponsors.find((s) => s.status === "preview");
  if (preview) {
    return { label: `Grow ${preview.districtName} to activate ${preview.name}`, action: "districts" };
  }
  return { label: "Keep moving to grow your sponsor preview", action: "move" };
}

/** Accent for a category, resolved against the theme by the screen. */
export function sponsorAccent(category: SponsorCategory): string {
  return CATEGORY_ACCENT[category];
}
