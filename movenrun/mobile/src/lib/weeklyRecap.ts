/**
 * Local weekly recap — Free Map Beta, on-device only.
 *
 * Derives a read-only summary of the user's recent movement and territory
 * progress (a rolling 7-day window) from data the app already keeps locally:
 * quest history, route-review summaries, and captured zones. Everything is
 * computed on demand and is deterministic — the same inputs at the same moment
 * always produce the same recap.
 *
 * It is a *preview / reflection*, not a leaderboard, payout, or on-chain record.
 * It does NOT affect XP, rewards, capture, defend, or ownership, and nothing is
 * sent anywhere. The shareable text is scalar-only: no raw GPS, coordinates,
 * route path, map image, or location names — nothing that can reconstruct where
 * the user went.
 */
import type { Zone } from "@/types";
import type { CompletionRecord } from "@/store/useGameStore";
import type { RouteTrustRecord } from "@/lib/routeTrust";
import { zoneStatus } from "@/lib/territory";

/** Rolling window length, in days. */
export const RECAP_WINDOW_DAYS = 7;
const WINDOW_MS = RECAP_WINDOW_DAYS * 86_400_000;

export type MomentumTone = "surging" | "climbing" | "building" | "warming" | "resting";

export interface WeeklyRecapInput {
  history: CompletionRecord[];
  routeTrustHistory: RouteTrustRecord[];
  zones: Zone[];
  streak: number;
  /** Selected club name, if any (display badge only). */
  clubName?: string | null;
  now?: number;
}

export interface WeeklyRecap {
  /** False when nothing happened in the window (drives the empty state). */
  hasActivity: boolean;
  /** Static window label, e.g. "Last 7 days". */
  weekLabel: string;
  /** Human date range, e.g. "Jun 18 – Jun 24". */
  rangeLabel: string;

  /* Movement totals (within the window) */
  routes: number;
  distanceMeters: number;
  durationSeconds: number;
  xpGained: number;
  questsCompleted: number;

  /* Territory activity (within the window) */
  zonesCaptured: number;
  defends: number;
  fortifies: number;

  /* Portfolio snapshot (current) */
  totalZones: number;
  healthyZones: number;
  atRiskZones: number;

  /* Route trust (within the window) */
  bestTrustScore: number | null;
  bestTrustLabel: string | null;
  averageTrustScore: number | null;

  /* Momentum — a friendly 0..100 blend of the week's activity */
  momentum: number;
  momentumLabel: string;
  momentumTone: MomentumTone;

  streak: number;
  clubName: string | null;

  /** One-line highlight of the week. */
  topAchievement: string;
  /** One-line suggestion for what to do next (gates nothing). */
  nextFocus: string;

  /** Plain-text summary for the OS share sheet (no location data). */
  shareText: string;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** "Jun 18" — deterministic, locale-independent. */
function shortDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function fmtKm(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

function fmtDuration(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${total}s`;
}

function withinWindow(iso: string | null | undefined, from: number, now: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= from && t <= now;
}

function momentumLabelFor(score: number): { label: string; tone: MomentumTone } {
  if (score >= 80) return { label: "Surging", tone: "surging" };
  if (score >= 55) return { label: "Climbing", tone: "climbing" };
  if (score >= 30) return { label: "Building", tone: "building" };
  if (score > 0) return { label: "Warming up", tone: "warming" };
  return { label: "Resting", tone: "resting" };
}

/** Deterministically build the local weekly recap. */
export function buildWeeklyRecap(input: WeeklyRecapInput): WeeklyRecap {
  const now = input.now ?? Date.now();
  const from = now - WINDOW_MS;
  const clubName = input.clubName ?? null;

  // Movement this week — quests completed.
  const weekQuests = input.history.filter((r) => withinWindow(r.completedAt, from, now));
  const questsCompleted = weekQuests.length;
  const xpGained = weekQuests.reduce((s, r) => s + r.xp, 0);

  // Movement this week — saved routes (summaries only, no raw GPS).
  const weekRoutes = input.routeTrustHistory.filter((r) => withinWindow(r.createdAt, from, now));
  const routes = weekRoutes.length;
  const distanceMeters = weekRoutes.reduce((s, r) => s + r.distanceMeters, 0);
  const durationSeconds = weekRoutes.reduce((s, r) => s + r.durationSeconds, 0);
  const defends = weekRoutes.reduce((s, r) => s + r.defendedCount, 0);

  const trustScores = weekRoutes
    .map((r) => r.trustScore)
    .filter((n) => Number.isFinite(n));
  const bestRoute = weekRoutes.reduce<RouteTrustRecord | null>(
    (best, r) => (best == null || r.trustScore > best.trustScore ? r : best),
    null,
  );
  const bestTrustScore = bestRoute ? bestRoute.trustScore : null;
  const bestTrustLabel = bestRoute ? bestRoute.trustLabel : null;
  const averageTrustScore =
    trustScores.length > 0
      ? Math.round(trustScores.reduce((s, n) => s + n, 0) / trustScores.length)
      : null;

  // Territory this week — derived from zone timestamps.
  const zonesCaptured = input.zones.filter((z) => withinWindow(z.capturedAt, from, now)).length;
  const fortifies = input.zones.filter((z) => withinWindow(z.lastFortifiedAt, from, now)).length;

  // Portfolio snapshot (current health).
  const totalZones = input.zones.length;
  let healthyZones = 0;
  let atRiskZones = 0;
  for (const zone of input.zones) {
    if (zoneStatus(zone, now).health === "yours") healthyZones++;
    else atRiskZones++;
  }

  const hasActivity =
    questsCompleted > 0 || routes > 0 || zonesCaptured > 0 || defends > 0 || fortifies > 0;

  // Momentum — a friendly blend, each term capped so no single action dominates.
  const momentum = clamp(
    Math.round(
      Math.min(routes, 5) * 12 +
        Math.min(questsCompleted, 5) * 4 +
        Math.min(zonesCaptured, 3) * 6 +
        Math.min(defends, 4) * 4 +
        Math.min(input.streak, 7) * 3,
    ),
    0,
    100,
  );
  const { label: momentumLabel, tone: momentumTone } = momentumLabelFor(momentum);

  const topAchievement = pickAchievement({
    zonesCaptured,
    bestTrustScore,
    bestTrustLabel,
    routes,
    questsCompleted,
    defends,
    streak: input.streak,
  });
  const nextFocus = pickNextFocus({ atRiskZones, totalZones, routes });

  const shareText = buildShareText({
    weekLabel: "Last 7 days",
    routes,
    distanceMeters,
    questsCompleted,
    xpGained,
    zonesCaptured,
    totalZones,
    defends,
    bestTrustScore,
    bestTrustLabel,
    streak: input.streak,
    momentumLabel,
    momentum,
  });

  return {
    hasActivity,
    weekLabel: "Last 7 days",
    rangeLabel: `${shortDate(from)} – ${shortDate(now)}`,
    routes,
    distanceMeters,
    durationSeconds,
    xpGained,
    questsCompleted,
    zonesCaptured,
    defends,
    fortifies,
    totalZones,
    healthyZones,
    atRiskZones,
    bestTrustScore,
    bestTrustLabel,
    averageTrustScore,
    momentum,
    momentumLabel,
    momentumTone,
    streak: input.streak,
    clubName,
    topAchievement,
    nextFocus,
    shareText,
  };
}

function pickAchievement(a: {
  zonesCaptured: number;
  bestTrustScore: number | null;
  bestTrustLabel: string | null;
  routes: number;
  questsCompleted: number;
  defends: number;
  streak: number;
}): string {
  if (a.zonesCaptured > 0) {
    return `Captured ${a.zonesCaptured} new zone${a.zonesCaptured === 1 ? "" : "s"}`;
  }
  if (a.defends > 0) {
    return `Defended ${a.defends} time${a.defends === 1 ? "" : "s"} on the move`;
  }
  if (a.bestTrustScore != null && a.bestTrustScore >= 80) {
    return `Logged a ${a.bestTrustLabel ?? "Strong"} route · ${a.bestTrustScore}`;
  }
  if (a.routes > 0) {
    return `Saved ${a.routes} route${a.routes === 1 ? "" : "s"} this week`;
  }
  if (a.questsCompleted > 0) {
    return `Completed ${a.questsCompleted} quest${a.questsCompleted === 1 ? "" : "s"}`;
  }
  if (a.streak > 0) {
    return `Holding a ${a.streak}-day streak`;
  }
  return "A fresh week to move";
}

function pickNextFocus(a: { atRiskZones: number; totalZones: number; routes: number }): string {
  if (a.atRiskZones > 0) {
    return `Defend ${a.atRiskZones} zone${a.atRiskZones === 1 ? "" : "s"} that need attention`;
  }
  if (a.totalZones === 0) {
    return "Capture your first zone with a saved route";
  }
  if (a.routes === 0) {
    return "Start a move to keep your streak going";
  }
  return "Keep moving to hold your territory";
}

function buildShareText(a: {
  weekLabel: string;
  routes: number;
  distanceMeters: number;
  questsCompleted: number;
  xpGained: number;
  zonesCaptured: number;
  totalZones: number;
  defends: number;
  bestTrustScore: number | null;
  bestTrustLabel: string | null;
  streak: number;
  momentumLabel: string;
  momentum: number;
}): string {
  const lines = [
    "MovenRun Weekly Recap (preview)",
    a.weekLabel,
    `Routes: ${a.routes} · ${fmtKm(a.distanceMeters)}`,
    `Quests: ${a.questsCompleted} · +${a.xpGained} XP`,
    `Territory: ${a.zonesCaptured} captured · ${a.totalZones} held`,
  ];
  if (a.defends > 0) lines.push(`Defends: ${a.defends}`);
  if (a.bestTrustScore != null) {
    lines.push(`Best route trust: ${a.bestTrustLabel ?? "—"} · ${a.bestTrustScore}`);
  }
  lines.push(
    `Streak: ${a.streak} day${a.streak === 1 ? "" : "s"}`,
    `Momentum: ${a.momentumLabel} (${a.momentum})`,
    "",
    "Local preview · no raw GPS · not on-chain.",
  );
  return lines.join("\n");
}

/** Display helpers reused by the screen (kept here so formatting stays in one place). */
export const recapFormat = { fmtKm, fmtDuration };
