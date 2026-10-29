/**
 * Stationary-risk classifier for uploaded on-foot routes (versioned rule,
 * default OFF).
 *
 * The problem (Track A fixture S03): a phone left still beside tall buildings
 * reports 6 m accuracy while its real error wanders about 15 m. The capture
 * rule trusts the reported accuracy circles, so every few fixes the error
 * clears them and is accepted as a step. Five minutes on one spot uploaded
 * 632 m, which the server verified.
 *
 * What the server can see is only the accepted points. A single geometric
 * ratio over them (path against ground extent) cannot separate that drift from
 * an honest lap of a small loop or a running track: both go round inside a
 * small envelope. This classifier therefore asks several independent questions
 * of each short window of the route and calls a window "stationary-like" only
 * when they agree:
 *
 *  - heading coherence: real movement keeps a direction or turns steadily one
 *    way (a loop); accepted drift points reverse direction at random;
 *  - temporal consistency: real movement at a steady pace is accepted at a
 *    steady cadence and speed; drift is accepted in irregular bursts, each one
 *    an excursion that happened to clear the circles;
 *  - stationary dwell: the window's points stay inside a radius that a
 *    stationary error cloud of the reported accuracy could explain;
 *  - reported accuracy scales that radius, so a phone that honestly reports
 *    poor accuracy is given a correspondingly larger allowance;
 *  - verified-fix continuity: windows never cross an evidence break (pause,
 *    foreground gap, unobserved bridge), so two places are never joined.
 *
 * A window is stationary-like only when it is BOTH incoherent (heading and
 * timing) AND contained (dwell). Coherent movement inside a small envelope
 * (small loops, tracks, slow walking) and incoherent fixes over a large
 * envelope (an honest walk under multipath) are both left alone.
 *
 * The verdict is never a penalty. `review` means the evidence does not support
 * awarding movement XP for this session; it says nothing about the player and
 * changes nothing else on the account. Short routes with too few accepted
 * segments to judge are not assessed and stay `eligible`: absence of evidence
 * is not evidence of drift.
 *
 * Residuals, stated so nobody mistakes this for a proof: an upload crafted to
 * look coherent (a scripted loop) is not stationary-like by construction, and
 * an honest walker under heavy multipath on a small loop can look exactly like
 * drift. Rates under stated synthetic assumptions are in
 * docs/play-launch/STATIONARY_RISK_RULE_28OCT.md.
 *
 * Pure: no I/O, no clock, no randomness.
 */
import { hasEvidenceBreak, type EvidencePoint } from "@movenrun/shared/evidence";
import type { PauseInterval } from "@movenrun/shared/session";

/** Selectable rule ids. `off` keeps the current live behaviour. */
export const STATIONARY_RISK_RULE_OFF = "off" as const;
export const STATIONARY_RISK_RULE_V1 = "stationary-risk/v1" as const;
export type StationaryRiskRuleId = typeof STATIONARY_RISK_RULE_OFF | typeof STATIONARY_RISK_RULE_V1;
export const DEFAULT_STATIONARY_RISK_RULE: StationaryRiskRuleId = STATIONARY_RISK_RULE_OFF;

/** Environment variable that selects the rule in the production wiring. */
export const STATIONARY_RISK_RULE_ENV = "MOVEMENT_STATIONARY_RISK_RULE";

/**
 * Parse the configured rule. Unset or empty means the default (off). An
 * unrecognised value is a configuration error, not a silent fallback either
 * way: enabling a rule by typo, or believing one enabled when it is not, are
 * both worse than refusing to start.
 */
export function parseStationaryRiskRule(value: string | undefined): StationaryRiskRuleId {
  const v = (value ?? "").trim();
  if (v === "" || v === STATIONARY_RISK_RULE_OFF) return STATIONARY_RISK_RULE_OFF;
  if (v === STATIONARY_RISK_RULE_V1) return STATIONARY_RISK_RULE_V1;
  throw new Error(`${STATIONARY_RISK_RULE_ENV} must be "${STATIONARY_RISK_RULE_OFF}" or "${STATIONARY_RISK_RULE_V1}"`);
}

export interface StationaryRiskPolicy {
  /** Longest time a window spans (ms). */
  windowMs: number;
  /** Fewest accepted segments a window needs to be judged at all. */
  minWindowSegments: number;
  /** A turn sharper than this (degrees) counts as a reversal. */
  reversalDegrees: number;
  /** Share of reversals at which the reversal signal is fully drift-like. */
  reversalShareFull: number;
  /**
   * Heading coherence, three ways a real route keeps its bearings; the window
   * is as coherent as the best of them. Each is [incoherent at, coherent at].
   *  - persistence: mean cosine of the turning angle (keeps going forward);
   *  - turning: |mean sine| of the turning angle (keeps turning one way: a loop
   *    or track, even when the accepted chords are long);
   *  - axis: concentration of segment bearings on one axis (a straight line,
   *    an out-and-back, a shuttle; reversals along one axis are deliberate).
   */
  persistence: readonly [number, number];
  turning: readonly [number, number];
  axis: readonly [number, number];
  /** Coefficient of variation of segment speed: [regular at, irregular at]. */
  speedCv: readonly [number, number];
  /** Coefficient of variation of the interval between accepted fixes. */
  intervalCv: readonly [number, number];
  /** Mean of the four normalised signals at or above which a window is incoherent. */
  incoherenceThreshold: number;
  /** Dwell radius (radius of gyration) allowance: the larger of this ... */
  dwellRadiusMeters: number;
  /** ... and this multiple of the window's median reported accuracy. */
  dwellAccuracyMultiple: number;
  /**
   * Progress allowance: a window whose second-half centroid has moved more
   * than the larger of this and `progressAccuracyMultiple` x accuracy from its
   * first-half centroid is getting somewhere, and is not a dwell however noisy
   * its fixes are (a slow walk seen through poor accuracy).
   */
  progressMeters: number;
  progressAccuracyMultiple: number;
  /** Session goes to review when stationary-like metres reach this share of the path ... */
  reviewShare: number;
  /** ... or this many metres, whichever comes first. */
  reviewMeters: number;
}

/** stationary-risk/v1. Thresholds and their sensitivity are documented in the rule doc. */
export const STATIONARY_RISK_V1_POLICY: Readonly<StationaryRiskPolicy> = Object.freeze({
  windowMs: 180_000,
  minWindowSegments: 6,
  reversalDegrees: 135,
  reversalShareFull: 0.3,
  persistence: [-0.2, 0.4] as const,
  turning: [0.35, 0.65] as const,
  axis: [0.6, 0.85] as const,
  speedCv: [0.25, 0.55] as const,
  intervalCv: [0.25, 0.6] as const,
  incoherenceThreshold: 0.6,
  dwellRadiusMeters: 45,
  dwellAccuracyMultiple: 2.5,
  progressMeters: 25,
  progressAccuracyMultiple: 2,
  reviewShare: 0.5,
  reviewMeters: 500,
});

export type StationaryRiskVerdict = "eligible" | "review";

export interface StationaryRiskAssessment {
  ruleId: typeof STATIONARY_RISK_RULE_V1;
  verdict: StationaryRiskVerdict;
  /** Measured path over continuous stretches (m). */
  pathMeters: number;
  /** Path covered by at least one stationary-like window (m). */
  stationaryLikeMeters: number;
  /** stationaryLikeMeters / pathMeters (0 when there is no path). */
  stationaryLikeShare: number;
  /** Windows judged, and how many were stationary-like. */
  windowsAssessed: number;
  windowsStationaryLike: number;
  /** Median window incoherence (0..1); null when no window was judged. */
  medianIncoherence: number | null;
}

export interface RiskPoint extends EvidencePoint {
  accuracy: number;
}

/** One accepted step: length, time, bearing (radians), index of its first point. */
export interface WindowSegment {
  meters: number;
  seconds: number;
  heading: number;
  startIndex: number;
}

const M_PER_DEG = 111_320;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** 0 at `from`, 1 at `to`, linear and clamped between; either direction. */
const ramp = (x: number, from: number, to: number) => clamp01((x - from) / (to - from));

function coefficientOfVariation(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (!(mean > 0)) return 0;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function wrap(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

export interface WindowSignals {
  /** Raw measurements. */
  reversalShare: number;
  persistence: number;
  turning: number;
  axis: number;
  speedCv: number;
  intervalCv: number;
  dwellRadius: number;
  dwellAllowance: number;
  progress: number;
  progressAllowance: number;
  /** Normalised 0 (movement-like) .. 1 (drift-like). */
  headingIncoherence: number;
  reversalSignal: number;
  speedSignal: number;
  intervalSignal: number;
  incoherence: number;
  stationaryLike: boolean;
}

/** The signals of one window: `segments` consecutive, `xy` their endpoints. */
export function windowSignals(
  segments: readonly WindowSegment[],
  xy: readonly { x: number; y: number; accuracy: number }[],
  policy: Readonly<StationaryRiskPolicy> = STATIONARY_RISK_V1_POLICY,
): WindowSignals {
  const turns: number[] = [];
  for (let i = 1; i < segments.length; i++) turns.push(wrap(segments[i]!.heading - segments[i - 1]!.heading));
  const n = Math.max(1, turns.length);
  const reversalLimit = (policy.reversalDegrees * Math.PI) / 180;
  const reversalShare = turns.filter((a) => Math.abs(a) > reversalLimit).length / n;
  const persistence = turns.reduce((s, a) => s + Math.cos(a), 0) / n;
  const turning = Math.abs(turns.reduce((s, a) => s + Math.sin(a), 0)) / n;
  const axis = Math.hypot(
    segments.reduce((s, g) => s + Math.cos(2 * g.heading), 0),
    segments.reduce((s, g) => s + Math.sin(2 * g.heading), 0)) / Math.max(1, segments.length);
  const speedCv = coefficientOfVariation(segments.map((s) => s.meters / s.seconds));
  const intervalCv = coefficientOfVariation(segments.map((s) => s.seconds));

  const coherence = Math.max(
    ramp(persistence, ...policy.persistence),
    ramp(turning, ...policy.turning),
    ramp(axis, ...policy.axis));
  const headingIncoherence = 1 - coherence;
  // A reversal is drift-like only when the route is not otherwise keeping its
  // bearings: the far end of a shuttle, or a tight loop seen through wide
  // accuracy circles, reverses on purpose.
  const reversalSignal = ramp(reversalShare, 0, policy.reversalShareFull) * headingIncoherence;
  const speedSignal = ramp(speedCv, ...policy.speedCv);
  const intervalSignal = ramp(intervalCv, ...policy.intervalCv);
  const incoherence = (headingIncoherence + reversalSignal + speedSignal + intervalSignal) / 4;

  const cx = xy.reduce((s, p) => s + p.x, 0) / xy.length;
  const cy = xy.reduce((s, p) => s + p.y, 0) / xy.length;
  const dwellRadius = Math.sqrt(xy.reduce((s, p) => s + (p.x - cx) ** 2 + (p.y - cy) ** 2, 0) / xy.length);
  const accuracy = median(xy.map((p) => p.accuracy));
  const dwellAllowance = Math.max(policy.dwellRadiusMeters, policy.dwellAccuracyMultiple * accuracy);
  const half = xy.length >> 1;
  const centroid = (ps: readonly { x: number; y: number }[]) =>
    ({ x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length });
  const first = centroid(xy.slice(0, half)), second = centroid(xy.slice(xy.length - half));
  const progress = Math.hypot(second.x - first.x, second.y - first.y);
  const progressAllowance = Math.max(policy.progressMeters, policy.progressAccuracyMultiple * accuracy);
  return {
    reversalShare, persistence, turning, axis, speedCv, intervalCv, dwellRadius, dwellAllowance,
    progress, progressAllowance, headingIncoherence, reversalSignal, speedSignal, intervalSignal, incoherence,
    stationaryLike: incoherence >= policy.incoherenceThreshold && dwellRadius <= dwellAllowance &&
      progress <= progressAllowance,
  };
}

/**
 * Assess one uploaded route. `points` are the accepted fixes in upload order;
 * `pauses` are the session's declared pauses.
 */
export function assessStationaryRisk(
  points: readonly RiskPoint[],
  pauses: readonly PauseInterval[] = [],
  policy: Readonly<StationaryRiskPolicy> = STATIONARY_RISK_V1_POLICY,
): StationaryRiskAssessment {
  const origin = points[0];
  const east = origin ? Math.cos((origin.latitude * Math.PI) / 180) * M_PER_DEG : M_PER_DEG;
  const xy = points.map((p) => ({
    x: origin ? (p.longitude - origin.longitude) * east : 0,
    y: origin ? (p.latitude - origin.latitude) * M_PER_DEG : 0,
    accuracy: p.accuracy,
    t: p.timestamp,
  }));

  /* Continuous stretches of segments. A break never joins two places. */
  const stretches: WindowSegment[][] = [[]];
  for (let i = 1; i < points.length; i++) {
    if (hasEvidenceBreak(points[i - 1]!, points[i]!, pauses)) { stretches.push([]); continue; }
    const dx = xy[i]!.x - xy[i - 1]!.x, dy = xy[i]!.y - xy[i - 1]!.y;
    const seconds = (xy[i]!.t - xy[i - 1]!.t) / 1000;
    if (!(seconds > 0)) continue;
    stretches[stretches.length - 1]!.push({ meters: Math.hypot(dx, dy), seconds, heading: Math.atan2(dy, dx), startIndex: i - 1 });
  }

  let pathMeters = 0;
  let stationaryLikeMeters = 0;
  let windowsAssessed = 0;
  let windowsStationaryLike = 0;
  const incoherences: number[] = [];
  for (const stretch of stretches) {
    const flagged = new Array<boolean>(stretch.length).fill(false);
    for (const s of stretch) pathMeters += s.meters;
    for (let i = 0; i < stretch.length; i++) {
      const startT = xy[stretch[i]!.startIndex]!.t;
      let k = i;
      while (k + 1 < stretch.length && xy[stretch[k + 1]!.startIndex + 1]!.t - startT <= policy.windowMs) k++;
      const count = k - i + 1;
      if (count < policy.minWindowSegments) continue;
      const window = stretch.slice(i, k + 1);
      const ends = window.map((s) => xy[s.startIndex]!);
      ends.push(xy[window[window.length - 1]!.startIndex + 1]!);
      const signals = windowSignals(window, ends, policy);
      windowsAssessed += 1;
      incoherences.push(signals.incoherence);
      if (!signals.stationaryLike) continue;
      windowsStationaryLike += 1;
      for (let j = i; j <= k; j++) flagged[j] = true;
    }
    stretch.forEach((s, j) => { if (flagged[j]) stationaryLikeMeters += s.meters; });
  }

  const stationaryLikeShare = pathMeters > 0 ? stationaryLikeMeters / pathMeters : 0;
  const review = stationaryLikeMeters > 0 &&
    (stationaryLikeShare >= policy.reviewShare || stationaryLikeMeters >= policy.reviewMeters);
  return {
    ruleId: STATIONARY_RISK_RULE_V1,
    verdict: review ? "review" : "eligible",
    pathMeters,
    stationaryLikeMeters,
    stationaryLikeShare,
    windowsAssessed,
    windowsStationaryLike,
    medianIncoherence: incoherences.length > 0 ? median(incoherences) : null,
  };
}

/** The public reason a review verdict carries. Plain, non-accusatory, no data. */
export const STATIONARY_RISK_REVIEW_REASON =
  "Movement XP needs review: much of this route looks like GPS drift around one spot (stationary-risk/v1)";
