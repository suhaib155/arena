/**
 * Local rival ghosts — Free Map Beta, on-device only.
 *
 * Generates fictional "rival" pressure around the user's territory to make the
 * world feel contested — entirely deterministically and on read, from existing
 * local zone state. Rivals are bucketed/derived purely from safe zone ids and
 * zone health: there are **no real users, accounts, contacts, PvP, backend,
 * network, chain, wallet, map SDK, or raw GPS**, and **no geography, coordinate,
 * route, or location inference**. Ghosts are a **local preview only** — not real
 * opponents, rewards, or on-chain activity — and they gate nothing.
 */
import type { Zone } from "@/types";
import { zoneStatus, fortifiedToday } from "@/lib/territory";
import { buildCityDistricts } from "@/lib/cityDistricts";

export type GhostPressure = "low" | "medium" | "high";
export type GhostStatus = "scouting" | "contesting" | "fading" | "blocked";
/** Semantic CTA — resolved to a concrete route by the screen. */
export type GhostAction = "zone" | "map" | "district" | "move";

/** Fixed fictional rival names — flavor only, never real users. */
export const GHOST_NAMES = [
  "Neon Fox",
  "Static Runner",
  "Volt Hare",
  "Glass Lynx",
  "Signal Crow",
  "Dust Wolf",
  "Pulse Raven",
  "Beacon Moth",
] as const;

/** Flavor icons (Ionicons) picked deterministically by avatar seed. */
const GHOST_ICONS = [
  "paw-outline",
  "flash-outline",
  "eye-outline",
  "footsteps-outline",
  "magnet-outline",
  "planet-outline",
  "color-wand-outline",
  "skull-outline",
] as const;

export interface RivalGhost {
  id: string;
  name: string;
  /** Deterministic seed for the avatar icon/accent variant. */
  avatarSeed: number;
  /** Affected zone, when zone-level (safe fictional zone label only). */
  zoneId?: string;
  zoneName?: string;
  /** Affected district, when district-level (safe fictional label only). */
  districtName?: string;
  pressure: GhostPressure;
  status: GhostStatus;
  /** 0..100. */
  threatScore: number;
  recommendation: string;
  ctaLabel: string;
  action: GhostAction;
  /** Higher = surfaced sooner; drives ordering + the top response. */
  priority: number;
  /** Daylight Cartography accent (theme palette hex). */
  accent: string;
  /** Ionicons name. */
  icon: string;
  previewOnly: true;
}

export interface RivalGhostsOverview {
  ghosts: RivalGhost[];
  /** Total ghosts shown. */
  active: number;
  highPressure: number;
  /** Guarded/blocked (+ fading) count — rivals you're holding off. */
  blocked: number;
  /** Highest-priority ghost that needs a response, or null. */
  topResponse: RivalGhost | null;
  /** Any medium/high pressure exists (drives the Today chip + calm state). */
  hasPressure: boolean;
  summaryLine: string;
}

/** Keep the list focused. */
const MAX_GHOSTS = 8;

/** Theme palette hexes (resolved by the screen). */
const ACCENT = {
  heatCoral: "#FF6B4A",
  moveGold: "#F7B955",
  pulseGreen: "#18C987",
  silverTrail: "#A3AAB8",
  deedViolet: "#7657FF",
} as const;

/** Small deterministic FNV-1a hash → unsigned int. */
function hashId(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function ghostNameFor(seed: number): string {
  return GHOST_NAMES[seed % GHOST_NAMES.length];
}

function ghostIconFor(seed: number): string {
  return GHOST_ICONS[seed % GHOST_ICONS.length];
}

function accentFor(status: GhostStatus, pressure: GhostPressure): string {
  if (status === "blocked") return ACCENT.pulseGreen;
  if (status === "scouting" || status === "fading") return ACCENT.silverTrail;
  // contesting
  return pressure === "high" ? ACCENT.heatCoral : ACCENT.moveGold;
}

/** Deterministically build the rival ghosts overview from local zones. */
export function buildRivalGhosts(zones: Zone[], now: number = Date.now()): RivalGhostsOverview {
  const ghosts: RivalGhost[] = [];

  for (const zone of zones) {
    const s = zoneStatus(zone, now);
    const seed = hashId(`${zone.id}|rival`);
    const name = ghostNameFor(seed);
    const icon = ghostIconFor(seed);

    let status: GhostStatus;
    let pressure: GhostPressure;
    let threatScore: number;
    let recommendation: string;
    let ctaLabel: string;
    let action: GhostAction;
    let priority: number;

    if (s.health === "dormant") {
      status = "scouting";
      pressure = s.risk >= 60 ? "medium" : "low";
      threatScore = s.risk;
      recommendation = `${name} is scouting ${zone.name} — move through it to push back.`;
      ctaLabel = "Open zone";
      action = "zone";
      priority = 180 + s.risk;
    } else if (s.health === "atRisk" || s.health === "contestedPreview") {
      status = "contesting";
      pressure = s.risk >= 65 ? "high" : "medium";
      threatScore = s.risk;
      recommendation = `${name} is contesting ${zone.name} — defend it soon.`;
      ctaLabel = "Defend zone";
      action = "zone";
      priority = (pressure === "high" ? 300 : 240) + s.risk;
    } else if (fortifiedToday(zone, now) || s.defense >= 70) {
      status = "blocked";
      pressure = "low";
      threatScore = Math.max(0, 30 - s.defense / 4);
      recommendation = `${zone.name} is holding strong — ${name} is blocked.`;
      ctaLabel = "View Map";
      action = "map";
      priority = 80;
    } else {
      status = "fading";
      pressure = "low";
      threatScore = Math.max(0, 40 - s.defense / 3);
      recommendation = `${name} is fading near ${zone.name} — keep moving to hold it.`;
      ctaLabel = "View Map";
      action = "map";
      priority = 60;
    }

    ghosts.push({
      id: `ghost-${zone.id}`,
      name,
      avatarSeed: seed,
      zoneId: zone.id,
      zoneName: zone.name,
      pressure,
      status,
      threatScore: Math.round(threatScore),
      recommendation,
      ctaLabel,
      action,
      priority,
      accent: accentFor(status, pressure),
      icon,
      previewOnly: true,
    });
  }

  // District-level rival pressure preview: a district with 2+ zones under
  // pressure (at-risk or dormant) gets a single higher-level rival ghost.
  const city = buildCityDistricts(zones, now);
  for (const district of city.districts) {
    const pressured = district.atRisk + district.dormant;
    if (pressured >= 2) {
      const seed = hashId(`${district.id}|rival`);
      const name = ghostNameFor(seed + 1);
      ghosts.push({
        id: `ghost-${district.id}`,
        name,
        avatarSeed: seed,
        districtName: district.name,
        pressure: "high",
        status: "contesting",
        threatScore: Math.min(100, 60 + pressured * 8),
        recommendation: `${name} is pressuring ${district.name} — ${pressured} zones under threat.`,
        ctaLabel: "View District",
        action: "district",
        priority: 320 + pressured,
        accent: ACCENT.deedViolet,
        icon: ghostIconFor(seed),
        previewOnly: true,
      });
    }
  }

  const sorted = [...ghosts].sort((a, b) => b.priority - a.priority).slice(0, MAX_GHOSTS);

  const highPressure = sorted.filter((g) => g.pressure === "high").length;
  const blocked = sorted.filter((g) => g.status === "blocked" || g.status === "fading").length;
  const hasPressure = sorted.some((g) => g.pressure === "high" || g.pressure === "medium");
  const topResponse =
    sorted.find((g) => g.status === "contesting" || g.status === "scouting") ?? null;

  return {
    ghosts: sorted,
    active: sorted.length,
    highPressure,
    blocked,
    topResponse,
    hasPressure,
    summaryLine: summaryFor(sorted.length, highPressure, topResponse),
  };
}

function summaryFor(active: number, highPressure: number, top: RivalGhost | null): string {
  if (active === 0) return "No rival pressure right now.";
  if (top) {
    return highPressure > 0
      ? `${highPressure} high-pressure rival${highPressure === 1 ? "" : "s"} · ${top.name} active`
      : `${active} rival${active === 1 ? "" : "s"} active · ${top.name} circling`;
  }
  return `${active} rival${active === 1 ? "" : "s"} held off`;
}

export const GHOST_STATUS_LABEL: Record<GhostStatus, string> = {
  scouting: "Scouting",
  contesting: "Contesting",
  fading: "Fading",
  blocked: "Blocked",
};

export const GHOST_PRESSURE_LABEL: Record<GhostPressure, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};
