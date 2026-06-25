/**
 * Local event zones — Free Map Beta, on-device only.
 *
 * A read-only, deterministic *preview* of fictional limited-time-style activity
 * zones across the city layer, built entirely from existing local state
 * (districts, rivals, sponsors, momentum). Events are flavor only — there are
 * **no real/live events, tickets, RSVPs, countdowns, timers, push
 * notifications, real sponsors/brands, ads, paid placements, payments, coupons,
 * rewards, backend, chain, wallet, map SDK, or raw GPS**, and **no
 * geography/coordinate/route/location inference**. It is a preview only — not a
 * live event, ad, or real sponsorship — and it gates nothing. No `Date.now()`,
 * no real-time: "active preview" / "cooling down" are derived from zone state,
 * not the clock.
 */
import type { CityDistrictsOverview, DistrictStatus } from "@/lib/cityDistricts";
import type { RivalGhostsOverview } from "@/lib/rivalGhosts";
import type { SponsorZonesOverview } from "@/lib/sponsorZones";

export type EventType =
  | "district-surge"
  | "defense-hour"
  | "ghost-chase"
  | "sponsor-preview"
  | "club-rally"
  | "recovery-loop";

export type EventStatus = "locked" | "preview" | "active-preview" | "cooling-down";
/** Semantic CTA — resolved to a concrete route by the screen. */
export type EventAction =
  | "districts"
  | "rivals"
  | "alerts"
  | "sponsor"
  | "war"
  | "map"
  | "move";

/** Fixed fictional event names — flavor only, never real events. */
export const EVENT_NAMES = [
  "Dawn Surge",
  "Volt Rally",
  "Ghost Chase",
  "Pulse Hour",
  "Beacon Loop",
  "Mist Recovery",
  "Signal Sprint",
  "District Flash",
] as const;

export interface EventZone {
  id: string;
  name: string;
  type: EventType;
  /** Fictional district/zone tie (safe preset label), or null when untied. */
  districtName: string | null;
  status: EventStatus;
  /** 0..100. */
  intensityScore: number;
  readinessScore: number;
  recommendation: string;
  ctaLabel: string;
  action: EventAction;
  /** Higher = surfaced sooner. */
  priority: number;
  /** Daylight Cartography accent (theme palette hex). */
  accent: string;
  /** Ionicons name. */
  icon: string;
  previewOnly: true;
}

export interface EventZonesOverview {
  events: EventZone[];
  /** Non-locked preview events. */
  previewEvents: number;
  activePreviewCount: number;
  /** Average readiness across preview events (0..100). */
  averageReadiness: number;
  nextAction: { label: string; action: EventAction };
  hasZones: boolean;
  summaryLine: string;
}

export interface EventZonesInput {
  hasZones: boolean;
  city: CityDistrictsOverview;
  rivals: RivalGhostsOverview;
  sponsors: SponsorZonesOverview;
  /** Weekly/city-war momentum, 0..100 (lifts readiness). */
  momentum: number;
  /** Season-objective progress, 0..100 (lifts readiness). */
  objectivesProgress: number;
  streak: number;
}

const MAX_EVENTS = 8;

/** Theme palette hexes (resolved by the screen). */
const PALETTE = {
  baseBlue: "#246BFE",
  pulseGreen: "#18C987",
  moveGold: "#F7B955",
  heatCoral: "#FF6B4A",
  deedViolet: "#7657FF",
  silverTrail: "#A3AAB8",
} as const;

interface TypeMeta {
  label: string;
  accent: string;
  icon: string;
  baseIntensity: number;
  ctaLabel: string;
  action: EventAction;
}

const TYPE_META: Record<EventType, TypeMeta> = {
  "district-surge": { label: "District surge", accent: PALETTE.baseBlue, icon: "trending-up-outline", baseIntensity: 55, ctaLabel: "View District", action: "districts" },
  "defense-hour": { label: "Defense hour", accent: PALETTE.heatCoral, icon: "shield-outline", baseIntensity: 80, ctaLabel: "View Alerts", action: "alerts" },
  "ghost-chase": { label: "Ghost chase", accent: PALETTE.deedViolet, icon: "color-wand-outline", baseIntensity: 70, ctaLabel: "View Rivals", action: "rivals" },
  "sponsor-preview": { label: "Sponsor preview", accent: PALETTE.moveGold, icon: "storefront-outline", baseIntensity: 50, ctaLabel: "View Sponsors", action: "sponsor" },
  "club-rally": { label: "Club rally", accent: PALETTE.pulseGreen, icon: "people-outline", baseIntensity: 45, ctaLabel: "View City War", action: "war" },
  "recovery-loop": { label: "Recovery loop", accent: PALETTE.pulseGreen, icon: "fitness-outline", baseIntensity: 35, ctaLabel: "View Map", action: "map" },
};

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  "district-surge": "District surge",
  "defense-hour": "Defense hour",
  "ghost-chase": "Ghost chase",
  "sponsor-preview": "Sponsor preview",
  "club-rally": "Club rally",
  "recovery-loop": "Recovery loop",
};

export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  locked: "Locked",
  preview: "Preview",
  "active-preview": "Active preview",
  "cooling-down": "Cooling down",
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

function eventNameFor(seed: number): string {
  return EVENT_NAMES[seed % EVENT_NAMES.length];
}

/** Map a district's health to an event type + status (no clock involved). */
function typeForDistrict(status: DistrictStatus): { type: EventType; status: EventStatus } {
  switch (status) {
    case "controlled":
      return { type: "club-rally", status: "active-preview" };
    case "emerging":
      return { type: "district-surge", status: "preview" };
    case "contested":
      return { type: "defense-hour", status: "active-preview" };
    case "dormant":
      return { type: "ghost-chase", status: "cooling-down" };
    default:
      return { type: "district-surge", status: "preview" };
  }
}

function accentFor(type: EventType, status: EventStatus): string {
  if (status === "locked" || status === "cooling-down") return PALETTE.silverTrail;
  return TYPE_META[type].accent;
}

function statusPriority(status: EventStatus): number {
  if (status === "active-preview") return 300;
  if (status === "preview") return 200;
  if (status === "cooling-down") return 100;
  return 0;
}

function recommendationFor(type: EventType, where: string): string {
  switch (type) {
    case "district-surge":
      return `Grow ${where} during this surge.`;
    case "defense-hour":
      return `Hold ${where} through the defense window.`;
    case "ghost-chase":
      return `Chase rivals out of ${where}.`;
    case "sponsor-preview":
      return `Preview a fictional sponsor activation in ${where}.`;
    case "club-rally":
      return `Rally your crew around ${where}.`;
    case "recovery-loop":
      return `Recover and hold ${where}.`;
  }
}

/** Deterministically build the event-zone preview from local state. */
export function buildEventZones(input: EventZonesInput): EventZonesOverview {
  const { city, rivals, sponsors } = input;

  // No territory yet → a locked "future" event board (no district ties).
  if (!input.hasZones) {
    const events: EventZone[] = EVENT_NAMES.map((name, i) => {
      const type = (Object.keys(TYPE_META) as EventType[])[i % 6];
      return {
        id: `event-locked-${i}`,
        name,
        type,
        districtName: null,
        status: "locked",
        intensityScore: 0,
        readinessScore: 0,
        recommendation: "Capture zones to unlock this event preview.",
        ctaLabel: "Start Move",
        action: "move",
        priority: 0,
        accent: PALETTE.silverTrail,
        icon: TYPE_META[type].icon,
        previewOnly: true,
      };
    });
    return {
      events,
      previewEvents: 0,
      activePreviewCount: 0,
      averageReadiness: 0,
      nextAction: { label: "Capture zones to preview future city events", action: "move" },
      hasZones: false,
      summaryLine: "Capture zones to preview future city events.",
    };
  }

  const readinessBase = clamp(
    Math.round(
      35 + input.momentum * 0.2 + input.objectivesProgress * 0.2 + Math.min(input.streak, 7) * 3,
    ),
    0,
    100,
  );

  const events: EventZone[] = [];

  // One event per active district, typed by district health.
  for (const d of city.districts) {
    if (d.zoneCount === 0) continue;
    const seed = hashId(`${d.id}|event`);
    const { type, status } = typeForDistrict(d.status);
    const meta = TYPE_META[type];
    const intensityScore = clamp(meta.baseIntensity + d.zoneCount * 4 + (d.atRisk + d.dormant) * 6, 0, 100);
    const readinessScore = clamp(readinessBase + d.healthy * 6, 0, 100);
    events.push({
      id: `event-${d.id}`,
      name: eventNameFor(seed),
      type,
      districtName: d.name,
      status,
      intensityScore,
      readinessScore,
      recommendation: recommendationFor(type, d.name),
      ctaLabel: meta.ctaLabel,
      action: meta.action,
      priority: statusPriority(status) + intensityScore,
      accent: accentFor(type, status),
      icon: meta.icon,
      previewOnly: true,
    });
  }

  // A ghost-chase headline when rivals are pressing.
  if (rivals.highPressure > 0 && rivals.topResponse) {
    const where = rivals.topResponse.districtName ?? rivals.topResponse.zoneName ?? "your territory";
    const seed = hashId(`${rivals.topResponse.id}|event`);
    const meta = TYPE_META["ghost-chase"];
    const intensityScore = clamp(60 + rivals.highPressure * 10, 0, 100);
    events.push({
      id: `event-rival-${rivals.topResponse.id}`,
      name: eventNameFor(seed + 2),
      type: "ghost-chase",
      districtName: where,
      status: "active-preview",
      intensityScore,
      readinessScore: readinessBase,
      recommendation: recommendationFor("ghost-chase", where),
      ctaLabel: meta.ctaLabel,
      action: meta.action,
      priority: statusPriority("active-preview") + intensityScore + 5,
      accent: accentFor("ghost-chase", "active-preview"),
      icon: meta.icon,
      previewOnly: true,
    });
  }

  // A fictional sponsor-preview event when a sponsor slot is active.
  if (sponsors.activePreviewCount > 0) {
    const tie = sponsors.sponsors.find((s) => s.districtName)?.districtName ?? null;
    const seed = hashId(`sponsor|event`);
    const meta = TYPE_META["sponsor-preview"];
    const where = tie ?? "your city";
    events.push({
      id: "event-sponsor",
      name: eventNameFor(seed + 1),
      type: "sponsor-preview",
      districtName: tie,
      status: "preview",
      intensityScore: clamp(meta.baseIntensity, 0, 100),
      readinessScore: clamp(readinessBase + sponsors.averageLocalFit * 0.1, 0, 100),
      recommendation: recommendationFor("sponsor-preview", where),
      ctaLabel: meta.ctaLabel,
      action: meta.action,
      priority: statusPriority("preview") + meta.baseIntensity,
      accent: accentFor("sponsor-preview", "preview"),
      icon: meta.icon,
      previewOnly: true,
    });
  }

  const sorted = events.sort((a, b) => b.priority - a.priority).slice(0, MAX_EVENTS);
  const previewEvents = sorted.length;
  const activePreviewCount = sorted.filter((e) => e.status === "active-preview").length;
  const averageReadiness =
    previewEvents > 0
      ? Math.round(sorted.reduce((sum, e) => sum + e.readinessScore, 0) / previewEvents)
      : 0;

  return {
    events: sorted,
    previewEvents,
    activePreviewCount,
    averageReadiness,
    nextAction: pickNextAction(sorted),
    hasZones: true,
    summaryLine: `${previewEvents} preview event${previewEvents === 1 ? "" : "s"} · ${activePreviewCount} active · readiness ${averageReadiness}`,
  };
}

function pickNextAction(events: EventZone[]): { label: string; action: EventAction } {
  const active = events.find((e) => e.status === "active-preview");
  if (active) {
    return { label: active.recommendation, action: active.action };
  }
  const preview = events.find((e) => e.status === "preview");
  if (preview) {
    return { label: preview.recommendation, action: preview.action };
  }
  return { label: "Keep moving to warm up future city events", action: "move" };
}
