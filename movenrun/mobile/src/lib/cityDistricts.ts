/**
 * Local city districts — Free Map Beta, on-device only.
 *
 * Groups captured zones into larger fictional "districts" to give the territory
 * a city scale. Everything is deterministic and derived on read from existing
 * local zone state: zones are bucketed into preset districts purely by hashing
 * their safe zone id — there is **no geography, coordinate, grid, route, or
 * location inference**, and the district names are fixed fictional labels, never
 * real neighborhoods. It is a **local preview only** — not a real map, not
 * rewards, not on-chain ownership — and it touches no backend, network, wallet,
 * chain, map SDK, or raw GPS. Districts gate nothing.
 */
import type { Zone } from "@/types";
import { zoneStatus } from "@/lib/territory";

export type DistrictStatus =
  | "locked"
  | "emerging"
  | "controlled"
  | "contested"
  | "dormant";

/** Semantic CTA — resolved to a concrete route by the screen. */
export type DistrictAction = "move" | "map" | "alerts";

/** Fixed fictional district names — safe presets, no real locations. */
export const DISTRICT_NAMES = [
  "North Loop",
  "Glass Quarter",
  "Signal Yard",
  "Riverline",
  "Pulse Market",
  "Beacon Park",
  "Volt Junction",
  "Dawn Grid",
] as const;

export interface CityDistrict {
  id: string;
  name: string;
  status: DistrictStatus;
  /** Captured zones bucketed into this district. */
  zoneCount: number;
  healthy: number;
  atRisk: number;
  dormant: number;
  /** Average control / defense across the district's zones (0..100). */
  controlPct: number;
  defensePct: number;
  /** Higher = more urgent; drives selection + the priority district. */
  priority: number;
  /** Daylight Cartography accent (theme palette hex). */
  accent: string;
  /** Ionicons name. */
  icon: string;
  previewOnly: true;
}

export interface CityDistrictsOverview {
  cityLabel: string;
  districts: CityDistrict[];
  /** Districts that hold at least one zone. */
  activeDistricts: number;
  controlledDistricts: number;
  totalDistricts: number;
  /** 0..100 — controlled out of revealed (active) districts. */
  cityProgressPct: number;
  /** Most urgent active district, or null when none are active. */
  priorityDistrict: CityDistrict | null;
  /** One-line, safe suggested action. */
  nextAction: { label: string; action: DistrictAction };
  /** Whether any zones exist yet (drives the empty state). */
  hasZones: boolean;
  summaryLine: string;
}

/** Status → accent (theme palette hex, resolved by the screen). */
const STATUS_ACCENT: Record<DistrictStatus, string> = {
  locked: "#A3AAB8", // Silver Trail
  emerging: "#F7B955", // MOVE Gold
  controlled: "#18C987", // Pulse Green
  contested: "#FF6B4A", // Heat Coral
  dormant: "#A3AAB8", // Silver Trail
};

const STATUS_ICON: Record<DistrictStatus, string> = {
  locked: "lock-closed-outline",
  emerging: "sparkles-outline",
  controlled: "shield-checkmark-outline",
  contested: "alert-circle-outline",
  dormant: "moon-outline",
};

const STATUS_SEVERITY: Record<DistrictStatus, number> = {
  dormant: 4,
  contested: 3,
  emerging: 2,
  controlled: 1,
  locked: 0,
};

/** Small deterministic FNV-1a hash → unsigned int (for stable id bucketing). */
function hashId(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** kebab id from a preset name (safe — names are fixed fictional labels). */
function slug(name: string): string {
  return `district-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function round(n: number): number {
  return Math.round(n);
}

/** Deterministically build the city districts overview from local zones. */
export function buildCityDistricts(zones: Zone[], now: number = Date.now()): CityDistrictsOverview {
  const total = DISTRICT_NAMES.length;
  // Bucket zones into preset districts by hashed id only — no geography.
  const buckets: Zone[][] = Array.from({ length: total }, () => []);
  for (const zone of zones) {
    buckets[hashId(zone.id) % total].push(zone);
  }

  const districts: CityDistrict[] = DISTRICT_NAMES.map((name, i) => {
    const zoneList = buckets[i];
    const zoneCount = zoneList.length;

    if (zoneCount === 0) {
      return {
        id: slug(name),
        name,
        status: "locked",
        zoneCount: 0,
        healthy: 0,
        atRisk: 0,
        dormant: 0,
        controlPct: 0,
        defensePct: 0,
        priority: 0,
        accent: STATUS_ACCENT.locked,
        icon: STATUS_ICON.locked,
        previewOnly: true,
      };
    }

    let healthy = 0;
    let atRisk = 0;
    let dormant = 0;
    let controlSum = 0;
    let defenseSum = 0;
    for (const zone of zoneList) {
      const s = zoneStatus(zone, now);
      controlSum += s.control;
      defenseSum += s.defense;
      if (s.health === "dormant") dormant++;
      else if (s.health === "yours") healthy++;
      else atRisk++; // atRisk + contestedPreview
    }

    const status: DistrictStatus =
      dormant > 0
        ? "dormant"
        : atRisk > 0
          ? "contested"
          : zoneCount >= 2
            ? "controlled"
            : "emerging";

    // Priority: status severity dominates, then how many zones need attention.
    const priority = STATUS_SEVERITY[status] * 100 + (atRisk + dormant) * 10 + zoneCount;

    return {
      id: slug(name),
      name,
      status,
      zoneCount,
      healthy,
      atRisk,
      dormant,
      controlPct: round(controlSum / zoneCount),
      defensePct: round(defenseSum / zoneCount),
      priority,
      accent: STATUS_ACCENT[status],
      icon: STATUS_ICON[status],
      previewOnly: true,
    };
  });

  const active = districts.filter((d) => d.zoneCount > 0);
  const controlledDistricts = districts.filter((d) => d.status === "controlled").length;
  const priorityDistrict =
    [...active].sort((a, b) => b.priority - a.priority)[0] ?? null;
  const cityProgressPct = active.length > 0 ? round((controlledDistricts / active.length) * 100) : 0;
  const hasZones = zones.length > 0;

  return {
    cityLabel: "Local City Preview",
    districts,
    activeDistricts: active.length,
    controlledDistricts,
    totalDistricts: total,
    cityProgressPct,
    priorityDistrict,
    nextAction: nextActionFor(priorityDistrict, hasZones),
    hasZones,
    summaryLine: summaryFor(controlledDistricts, active.length, priorityDistrict, hasZones),
  };
}

function nextActionFor(
  priority: CityDistrict | null,
  hasZones: boolean,
): { label: string; action: DistrictAction } {
  if (!hasZones || !priority) {
    return { label: "Capture zones to reveal your city", action: "move" };
  }
  if (priority.status === "dormant") {
    return { label: `Move through ${priority.name} to revive it`, action: "map" };
  }
  if (priority.status === "contested") {
    return { label: `Defend ${priority.name}`, action: "alerts" };
  }
  return { label: "Your city is stable — keep moving to grow it", action: "map" };
}

function summaryFor(
  controlled: number,
  active: number,
  priority: CityDistrict | null,
  hasZones: boolean,
): string {
  if (!hasZones) return "No districts yet — capture a zone to begin your city.";
  if (priority && (priority.status === "contested" || priority.status === "dormant")) {
    return `${controlled}/${active} controlled · ${priority.name} needs attention`;
  }
  return `${controlled}/${active} districts controlled`;
}

export const DISTRICT_STATUS_LABEL: Record<DistrictStatus, string> = {
  locked: "Locked",
  emerging: "Emerging",
  controlled: "Controlled",
  contested: "Contested",
  dormant: "Dormant",
};
