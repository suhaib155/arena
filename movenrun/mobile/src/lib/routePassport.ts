/**
 * Route Signal Passport — Free Map Beta, local preview only.
 *
 * A derived, read-only summary of the player's GPS-quality trend, computed on
 * read from the already-persisted route-review summaries (`routeTrustHistory`)
 * plus a little scalar context (zones owned / times defended). It adds NO new
 * persisted state, NO raw GPS, NO coordinates, NO path, and sends nothing
 * anywhere. It is a *readiness preview* — not official verification, and it
 * does not gate XP, capture, defend, fortify, clubs, or ownership.
 */
import type { RouteTrustRecord } from "@/lib/routeTrust";

export type ReadinessLabel =
  | "Needs more routes"
  | "Building signal"
  | "Clean signal"
  | "Strong signal";

export interface PassportChecklistItem {
  label: string;
  done: boolean;
}

export interface RouteSignalPassport {
  readinessScore: number; // 0–100, deterministic
  readinessLabel: ReadinessLabel;
  explanation: string;
  reviewedRouteCount: number;
  cleanRouteCount: number;
  averageTrustScore: number;
  cleanRouteStreak: number;
  /** Total risk flags across the most recent few routes. */
  recentRiskCount: number;
  topStrengths: string[];
  improvementTips: string[];
  checklist: PassportChecklistItem[];
  previewOnly: true;
}

/** Scalar gameplay context (no coordinates) used only for the checklist. */
export interface PassportContext {
  zonesOwned: number;
  timesDefended: number;
}

const RECENT_WINDOW = 5;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Most frequent entries in a list of string arrays, up to `max`. */
function topCounted(lists: string[][], max: number): string[] {
  const counts = new Map<string, number>();
  for (const list of lists) {
    for (const item of list) counts.set(item, (counts.get(item) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map((e) => e[0]);
}

/** Map a risk flag to a friendly improvement tip. */
const TIP_FOR_RISK: Record<string, string> = {
  "Low GPS signal": "Wait for a strong GPS lock before you start.",
  "Too few points": "Keep the app open with a clear view of the sky.",
  "Speed spike": "Avoid sudden jumps — pause instead of drifting indoors.",
  "Short route": "Move a little further to build a clearer signal.",
  "Demo route": "Record a real route to build your signal.",
};

/**
 * Compute the passport deterministically from persisted summaries. Same input,
 * same output — no randomness, no I/O, no network.
 */
export function computePassport(
  history: readonly RouteTrustRecord[],
  ctx: PassportContext,
): RouteSignalPassport {
  const reviewedRouteCount = history.length;

  if (reviewedRouteCount === 0) {
    return {
      readinessScore: 5,
      readinessLabel: "Needs more routes",
      explanation:
        "Save a few real movement sessions to start building your local signal.",
      reviewedRouteCount: 0,
      cleanRouteCount: 0,
      averageTrustScore: 0,
      cleanRouteStreak: 0,
      recentRiskCount: 0,
      topStrengths: [],
      improvementTips: ["Record and save a real route to begin."],
      checklist: buildChecklist(0, 0, 0, ctx),
      previewOnly: true,
    };
  }

  const cleanRouteCount = history.filter((r) => r.riskFlags.length === 0).length;
  const averageTrustScore = Math.round(
    history.reduce((s, r) => s + r.trustScore, 0) / reviewedRouteCount,
  );

  // History is stored newest-first; count the leading clean streak.
  let cleanRouteStreak = 0;
  for (const r of history) {
    if (r.riskFlags.length === 0) cleanRouteStreak++;
    else break;
  }

  const recent = history.slice(0, RECENT_WINDOW);
  const recentRiskCount = recent.reduce((s, r) => s + r.riskFlags.length, 0);

  const topStrengths = topCounted(
    history.map((r) => r.positiveSignals),
    3,
  );
  const riskTips = topCounted(history.map((r) => r.riskFlags), 3)
    .map((flag) => TIP_FOR_RISK[flag])
    .filter((t): t is string => Boolean(t));
  const improvementTips =
    riskTips.length > 0
      ? riskTips
      : ["Keep recording clean routes to strengthen your signal."];

  // Deterministic score: average trust, dampened when few routes, with a small
  // clean-streak bonus and a recent-risk penalty.
  const coverage = Math.min(1, reviewedRouteCount / 3);
  let score = averageTrustScore * (0.6 + 0.4 * coverage);
  score += Math.min(10, cleanRouteStreak * 3);
  score -= Math.min(20, recentRiskCount * 4);
  const readinessScore = clamp(Math.round(score), 0, 100);

  let readinessLabel: ReadinessLabel;
  if (reviewedRouteCount < 3) {
    readinessLabel = "Building signal";
  } else if (averageTrustScore >= 85 && cleanRouteStreak >= 3) {
    readinessLabel = "Strong signal";
  } else if (averageTrustScore >= 70) {
    readinessLabel = "Clean signal";
  } else {
    readinessLabel = "Building signal";
  }

  const explanation =
    readinessLabel === "Strong signal"
      ? "Consistently clean routes — a strong local signal trend."
      : readinessLabel === "Clean signal"
        ? "Your routes look clean on average. Keep it steady."
        : "You're building signal — more clean routes will raise this.";

  return {
    readinessScore,
    readinessLabel,
    explanation,
    reviewedRouteCount,
    cleanRouteCount,
    averageTrustScore,
    cleanRouteStreak,
    recentRiskCount,
    topStrengths,
    improvementTips,
    checklist: buildChecklist(
      reviewedRouteCount,
      averageTrustScore,
      recentRiskCount,
      ctx,
    ),
    previewOnly: true,
  };
}

function buildChecklist(
  reviewedRouteCount: number,
  averageTrustScore: number,
  recentRiskCount: number,
  ctx: PassportContext,
): PassportChecklistItem[] {
  return [
    { label: "Complete 3 real saved routes", done: reviewedRouteCount >= 3 },
    {
      label: "Keep average trust above 70",
      done: reviewedRouteCount > 0 && averageTrustScore >= 70,
    },
    { label: "Avoid repeated low-signal routes", done: recentRiskCount <= 1 },
    {
      label: "Capture or defend territory through movement",
      done: ctx.zonesOwned > 0 || ctx.timesDefended > 0,
    },
  ];
}

/** Accent role for a readiness label (resolved in the UI). */
export type ReadinessTone = "strong" | "clean" | "building" | "empty";

export function readinessTone(label: ReadinessLabel): ReadinessTone {
  if (label === "Strong signal") return "strong";
  if (label === "Clean signal") return "clean";
  if (label === "Building signal") return "building";
  return "empty";
}
