/**
 * Local crew missions — Free Map Beta, on-device only.
 *
 * Turns the user's existing local previews (territory, districts, rivals, city
 * war, club territory, sponsor/event previews, season objectives, weekly recap)
 * into clear weekly team-style "crew missions". It is pure, deterministic, and
 * clock-free — there are **no real members/users/accounts/contacts, no
 * chat/invites, no multiplayer/PvP, no leaderboards/rankings, no rewards, no
 * real/live events, no real sponsors/ads/payments, no backend, network, chain,
 * wallet, map SDK, raw GPS, timers, or push** — and **no geography/coordinate/
 * route/location inference**. Callers pass already-built local overviews. It
 * gates nothing.
 */
import type { CityDistrictsOverview } from "@/lib/cityDistricts";
import type { RivalGhostsOverview } from "@/lib/rivalGhosts";
import type { CityWarBoard } from "@/lib/cityWarBoard";
import type { ClubTerritory } from "@/lib/clubTerritory";
import type { SponsorZonesOverview } from "@/lib/sponsorZones";
import type { EventZonesOverview } from "@/lib/eventZones";
import type { SeasonObjectivesOverview } from "@/lib/seasonObjectives";

export type MissionCategory =
  | "movement"
  | "territory"
  | "defense"
  | "district"
  | "rival"
  | "club"
  | "event-preview"
  | "sponsor-preview"
  | "signal";

export type MissionStatus = "locked" | "ready" | "in-progress" | "complete-preview";

export type MissionIntent =
  | "capture"
  | "defend"
  | "fortify"
  | "review"
  | "rally"
  | "scout"
  | "stabilize";

/** Semantic CTA — resolved to a concrete route by the screen. */
export type MissionAction =
  | "move"
  | "alerts"
  | "map"
  | "districts"
  | "rivals"
  | "club"
  | "war"
  | "events"
  | "sponsor"
  | "objectives"
  | "signal"
  | "recap";

export interface CrewMission {
  id: string;
  title: string;
  category: MissionCategory;
  intent: MissionIntent;
  status: MissionStatus;
  /** 0..100. */
  progress: number;
  recommendation: string;
  ctaLabel: string;
  action: MissionAction;
  /** Higher = surfaced sooner. */
  priority: number;
  /** Daylight Cartography accent (theme palette hex). */
  accent: string;
  /** Ionicons name. */
  icon: string;
  previewOnly: true;
}

export interface CrewMissionsOverview {
  title: string;
  crewLabel: string;
  weekLabel: string;
  missions: CrewMission[];
  total: number;
  ready: number;
  inProgress: number;
  completePreview: number;
  topPriority: CrewMission | null;
  hasZones: boolean;
  summaryLine: string;
}

export interface CrewMissionsInput {
  clubName: string | null;
  hasZones: boolean;
  zonesOwned: number;
  atRiskOrWorse: number;
  city: CityDistrictsOverview;
  rivals: RivalGhostsOverview;
  war: CityWarBoard;
  club: ClubTerritory;
  sponsors: SponsorZonesOverview;
  events: EventZonesOverview;
  objectives: SeasonObjectivesOverview;
  savedRoutes: number;
  hasStrongTrust: boolean;
  /** Human week range, e.g. "Jun 18 – Jun 24" (recap.rangeLabel). */
  weekLabel: string;
}

const PALETTE = {
  baseBlue: "#246BFE",
  pulseGreen: "#18C987",
  moveGold: "#F7B955",
  heatCoral: "#FF6B4A",
  deedViolet: "#7657FF",
  silverTrail: "#A3AAB8",
} as const;

const CATEGORY_META: Record<MissionCategory, { accent: string; icon: string; urgency: number }> = {
  movement: { accent: PALETTE.baseBlue, icon: "navigate-outline", urgency: 30 },
  territory: { accent: PALETTE.baseBlue, icon: "flag-outline", urgency: 22 },
  defense: { accent: PALETTE.heatCoral, icon: "shield-outline", urgency: 40 },
  district: { accent: PALETTE.baseBlue, icon: "grid-outline", urgency: 25 },
  rival: { accent: PALETTE.deedViolet, icon: "color-wand-outline", urgency: 35 },
  club: { accent: PALETTE.deedViolet, icon: "people-outline", urgency: 16 },
  "event-preview": { accent: PALETTE.deedViolet, icon: "sparkles-outline", urgency: 10 },
  "sponsor-preview": { accent: PALETTE.moveGold, icon: "storefront-outline", urgency: 8 },
  signal: { accent: PALETTE.pulseGreen, icon: "pulse-outline", urgency: 12 },
};

export const MISSION_CATEGORY_LABEL: Record<MissionCategory, string> = {
  movement: "Movement",
  territory: "Territory",
  defense: "Defense",
  district: "District",
  rival: "Rival",
  club: "Club",
  "event-preview": "Event preview",
  "sponsor-preview": "Sponsor preview",
  signal: "Signal",
};

export const MISSION_STATUS_LABEL: Record<MissionStatus, string> = {
  locked: "Locked",
  ready: "Ready",
  "in-progress": "In progress",
  "complete-preview": "Complete preview",
};

interface MissionDef {
  id: string;
  title: string;
  category: MissionCategory;
  intent: MissionIntent;
  action: MissionAction;
  ctaLabel: string;
  recommendation: string;
  unlocked: (i: CrewMissionsInput) => boolean;
  progress: (i: CrewMissionsInput) => number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

const MISSION_DEFS: MissionDef[] = [
  {
    id: "capture-zones",
    title: "Capture new zones",
    category: "movement",
    intent: "capture",
    action: "move",
    ctaLabel: "Start Move",
    recommendation: "Start a move and save a route to capture local ground.",
    unlocked: () => true,
    progress: (i) => clamp(Math.round((i.zonesOwned / 3) * 100), 0, 100),
  },
  {
    id: "defend-at-risk",
    title: "Defend an at-risk zone",
    category: "defense",
    intent: "defend",
    action: "alerts",
    ctaLabel: "View Alerts",
    recommendation: "Move through zones under pressure to refresh their defense.",
    unlocked: (i) => i.zonesOwned > 0,
    progress: (i) =>
      i.zonesOwned === 0
        ? 0
        : clamp(Math.round(100 - i.rivals.highPressure * 30 - i.atRiskOrWorse * 15), 0, 100),
  },
  {
    id: "stabilize-district",
    title: "Stabilize a district",
    category: "district",
    intent: "stabilize",
    action: "districts",
    ctaLabel: "View District",
    recommendation: "Grow and hold a district until it's controlled.",
    unlocked: (i) => i.city.activeDistricts > 0,
    progress: (i) =>
      i.city.activeDistricts > 0
        ? clamp(Math.round((i.city.controlledDistricts / i.city.activeDistricts) * 100), 0, 100)
        : 0,
  },
  {
    id: "hold-rival",
    title: "Hold off a ghost rival",
    category: "rival",
    intent: "scout",
    action: "rivals",
    ctaLabel: "View Rivals",
    recommendation: "Keep rivals from gaining ground around your zones.",
    unlocked: (i) => i.zonesOwned > 0,
    progress: (i) =>
      i.zonesOwned === 0 ? 0 : i.rivals.hasPressure ? clamp(Math.round(100 - i.rivals.highPressure * 30), 0, 100) : 100,
  },
  {
    id: "boost-club",
    title: "Boost club presence",
    category: "club",
    intent: "rally",
    action: "club",
    ctaLabel: "View Club Territory",
    recommendation: "Strengthen your crew's hold across the city.",
    unlocked: () => true,
    progress: (i) => clamp(i.club.territoryScore, 0, 100),
  },
  {
    id: "club-rally",
    title: "Join a club rally preview",
    category: "event-preview",
    intent: "rally",
    action: "events",
    ctaLabel: "View Event Zones",
    recommendation: "Check the fictional event previews around your territory.",
    unlocked: (i) => i.hasZones,
    progress: (i) =>
      i.events.activePreviewCount > 0 ? 100 : i.events.previewEvents > 0 ? 50 : 0,
  },
  {
    id: "sponsor-readiness",
    title: "Preview sponsor readiness",
    category: "sponsor-preview",
    intent: "review",
    action: "sponsor",
    ctaLabel: "View Sponsor Zones",
    recommendation: "See how fictional sponsor slots could light up your city.",
    unlocked: (i) => i.hasZones,
    progress: (i) =>
      i.sponsors.activePreviewCount > 0
        ? 100
        : i.sponsors.previewSlots > 0
          ? clamp(Math.round(i.sponsors.averageLocalFit), 0, 100)
          : 0,
  },
  {
    id: "review-signal",
    title: "Review your route signal",
    category: "signal",
    intent: "review",
    action: "signal",
    ctaLabel: "View Route Review",
    recommendation: "Check your local GPS-quality trend in Route Review.",
    unlocked: () => true,
    progress: (i) => (i.savedRoutes > 0 ? (i.hasStrongTrust ? 100 : 60) : 0),
  },
  {
    id: "weekly-objectives",
    title: "Finish weekly objectives",
    category: "territory",
    intent: "stabilize",
    action: "objectives",
    ctaLabel: "View Objectives",
    recommendation: "Complete this week's season objectives.",
    unlocked: () => true,
    progress: (i) => clamp(i.objectives.progressPct, 0, 100),
  },
];

function statusFor(unlocked: boolean, progress: number): MissionStatus {
  if (!unlocked) return "locked";
  if (progress >= 100) return "complete-preview";
  if (progress > 0) return "in-progress";
  return "ready";
}

function statusBase(status: MissionStatus): number {
  if (status === "ready") return 200;
  if (status === "in-progress") return 170;
  if (status === "complete-preview") return 60;
  return 20; // locked
}

/** Deterministically build the crew missions board from local overviews. */
export function buildCrewMissions(input: CrewMissionsInput): CrewMissionsOverview {
  const crewLabel = input.clubName ?? "Your Crew";

  const missions: CrewMission[] = MISSION_DEFS.map((d) => {
    const unlocked = input.hasZones && d.unlocked(input);
    const rawProgress = input.hasZones ? d.progress(input) : 0;
    const progress = clamp(Math.round(rawProgress), 0, 100);
    const status = statusFor(unlocked, progress);
    const meta = CATEGORY_META[d.category];
    return {
      id: d.id,
      title: d.title,
      category: d.category,
      intent: d.intent,
      status,
      progress,
      recommendation: d.recommendation,
      ctaLabel: status === "locked" ? "Start Move" : d.ctaLabel,
      action: status === "locked" ? "move" : d.action,
      priority: statusBase(status) + meta.urgency + Math.round(progress / 10),
      accent: meta.accent,
      icon: meta.icon,
      previewOnly: true,
    };
  });

  const sorted = missions.sort((a, b) => b.priority - a.priority);
  const ready = sorted.filter((m) => m.status === "ready").length;
  const inProgress = sorted.filter((m) => m.status === "in-progress").length;
  const completePreview = sorted.filter((m) => m.status === "complete-preview").length;
  const topPriority =
    sorted.find((m) => m.status === "ready" || m.status === "in-progress") ?? null;

  return {
    title: "Crew Missions",
    crewLabel,
    weekLabel: input.weekLabel,
    missions: sorted,
    total: sorted.length,
    ready,
    inProgress,
    completePreview,
    topPriority,
    hasZones: input.hasZones,
    summaryLine: input.hasZones
      ? `${crewLabel} · ${ready} ready · ${inProgress} in progress · ${completePreview} complete`
      : "Capture zones to unlock your local crew missions.",
  };
}
