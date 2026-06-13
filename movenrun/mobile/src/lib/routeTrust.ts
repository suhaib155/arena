/**
 * Local route-verification trust preview — Free Map Beta, on-device only.
 *
 * Computes a deterministic, explainable "trust" score for a finished movement
 * session from data the app already has in memory (mode, accepted GPS points,
 * distance, duration). It is a *preview* of the kind of signal a future GPS
 * oracle would weigh — it does NOT affect rewards, XP, capture, or ownership,
 * and nothing is sent anywhere. No raw GPS points are persisted; callers store
 * only the small summary (score + label).
 */
import {
  distanceMeters,
  MAX_PLAUSIBLE_SPEED_MS,
  type TrackPoint,
} from "@/lib/geo";
import { isSaveable, type FinishedSession } from "@/services/moveSession";

export type TrustLabel =
  | "Strong"
  | "Good"
  | "Needs more signal"
  | "Demo only"
  | "Not enough movement";

export type TrustTone = "strong" | "good" | "caution" | "neutral";

/** What happened to the saved route (for the review-history outcome chip). */
export type RouteOutcome = "saved" | "captured" | "defended" | "summary-only";

/**
 * A persisted route-review record — **summary only**. It deliberately holds no
 * coordinates, polyline, path, or place names: nothing here can reconstruct
 * where the user went. Used for the local Route Review history.
 */
export interface RouteTrustRecord {
  id: string;
  createdAt: string;
  trustScore: number;
  trustLabel: string;
  explanation: string;
  positiveSignals: string[];
  riskFlags: string[];
  distanceMeters: number;
  durationSeconds: number;
  routeOutcome: RouteOutcome;
  zoneCountTouched: number;
  defendedCount: number;
}

export interface RouteTrust {
  /** 0–100, deterministic. */
  score: number;
  label: TrustLabel;
  /** Accent role for the UI. */
  tone: TrustTone;
  /** Things that lowered confidence (Heat Coral). */
  riskFlags: string[];
  /** Things that raised confidence (Pulse Green). */
  positiveSignals: string[];
  /** Short, non-technical sentence. */
  explanation: string;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function accuracyStats(points: TrackPoint[]): { avg: number | null; worst: number | null } {
  const accs = points
    .map((p) => p.accuracy)
    .filter((a): a is number => a != null);
  if (accs.length === 0) return { avg: null, worst: null };
  const avg = accs.reduce((s, a) => s + a, 0) / accs.length;
  return { avg, worst: Math.max(...accs) };
}

/** Fastest single segment between accepted points, in m/s. */
function maxSegmentSpeed(points: TrackPoint[]): number {
  let max = 0;
  for (let i = 1; i < points.length; i++) {
    const d = distanceMeters(points[i - 1], points[i]);
    const dt = Math.max(0.5, (points[i].timestamp - points[i - 1].timestamp) / 1000);
    max = Math.max(max, d / dt);
  }
  return max;
}

/**
 * Score a finished session. Pure and deterministic — same input, same output.
 */
export function scoreRoute(session: FinishedSession): RouteTrust {
  const { mode, points, distanceM, durationMs } = session;
  const minutes = durationMs / 60_000;
  const n = points.length;

  // Demo routes never build verification signal.
  if (mode === "demo") {
    return {
      score: 0,
      label: "Demo only",
      tone: "neutral",
      riskFlags: ["Demo route"],
      positiveSignals: [],
      explanation:
        "Demo route — not real GPS, so it doesn't build verification signal.",
    };
  }

  // Too little real movement to assess.
  if (!isSaveable(distanceM, durationMs) || distanceM < 150 || n < 4) {
    return {
      score: 20,
      label: "Not enough movement",
      tone: "neutral",
      riskFlags: ["Short route", ...(n < 6 ? ["Too few points"] : [])],
      positiveSignals: [],
      explanation:
        "Move a bit further with steady GPS to build a verifiable route.",
    };
  }

  let score = 100;
  const riskFlags: string[] = [];
  const positiveSignals: string[] = [];

  // GPS accuracy (accepted points are already filtered to <= 40 m).
  const { avg } = accuracyStats(points);
  if (avg == null) {
    score -= 10;
  } else if (avg <= 12) {
    positiveSignals.push("Steady GPS");
  } else if (avg <= 22) {
    score -= 12;
  } else {
    score -= 25;
    riskFlags.push("Low GPS signal");
  }

  // Point density — enough samples for the distance/time covered.
  const ptsPerMin = n / Math.max(0.2, minutes);
  if (n >= 8 && ptsPerMin >= 5) {
    positiveSignals.push("Enough points");
  } else if (n < 6 || ptsPerMin < 2.5) {
    score -= 22;
    riskFlags.push("Too few points");
  } else {
    score -= 8;
  }

  // Speed plausibility.
  const overallMs = distanceM / Math.max(1, durationMs / 1000);
  const maxSpd = maxSegmentSpeed(points);
  if (maxSpd >= MAX_PLAUSIBLE_SPEED_MS - 1 || overallMs > 6.5) {
    score -= 15;
    riskFlags.push("Speed spike");
  } else if (overallMs >= 0.4 && overallMs <= 6.5) {
    positiveSignals.push("Realistic pace");
  }

  // Amount of movement.
  if (distanceM >= 600) {
    positiveSignals.push("Enough movement");
  } else if (distanceM < 250) {
    score -= 8;
    riskFlags.push("Short route");
  }

  if (riskFlags.length === 0) positiveSignals.push("Clean route");

  score = clamp(Math.round(score), 0, 100);
  const label: TrustLabel =
    score >= 80 ? "Strong" : score >= 60 ? "Good" : "Needs more signal";

  const explanation =
    label === "Strong"
      ? "Steady GPS, a realistic pace, and enough points — this looks like a clean route."
      : label === "Good"
        ? "A solid route — a few things could be cleaner next time."
        : "Thin signal — steadier GPS and a bit more movement would raise this.";

  return { score, label, tone: trustTone(label), riskFlags, positiveSignals, explanation };
}

/** Accent role for a label, resolved against the theme in the UI. */
export function trustTone(label: TrustLabel): TrustTone {
  if (label === "Strong") return "strong";
  if (label === "Good") return "good";
  if (label === "Needs more signal") return "caution";
  return "neutral"; // Demo only / Not enough movement
}
