/**
 * Pure movement verification — structural checks, then measurement.
 *
 * Dependency-injected rather than importing `@movenrun/shared`, `gps.service`
 * or `hex.service` directly, for the same reason `services/route.service.ts`
 * does it: `tsc` resolves this without the shared-package build step, and the
 * whole lifecycle is exercisable with plain stubs — no Postgres, no Redis, no
 * H3 runtime. The real GpsService/HexService are wired in at the edge.
 *
 * No I/O, no clock of its own (`now` is injected), no randomness.
 */
import { sessionMetadataProblems } from "@movenrun/shared/session";
import { evaluateSealing } from "@movenrun/shared/sealing";

import type {
  MovementObservation,
  MovementVerificationResult,
  ObservedPoint,
} from "./types.js";

export interface AnomalyVerdict {
  isAnomaly: boolean;
  reasons: string[];
  confidence: number;
}

export interface VerifyMovementDeps {
  /** Speed/accuracy/duration anomaly detection — GpsService.validateRoute. */
  detectAnomalies: (observation: MovementObservation) => AnomalyVerdict;
  /** Haversine total — GpsService.calculateDistance. */
  calculateDistance: (points: ObservedPoint[]) => number;
  /** H3 cells covered — HexService.getHexIdsForPoints. */
  traversedHexIds: (points: ObservedPoint[]) => string[];
  /** Injected for determinism. */
  now: () => number;
}

/** A session may not be reported from further ahead than this (clock skew). */
export const MAX_FUTURE_SKEW_MS = 5 * 60_000;
/** A session older than this is not accepted for verification. Bounds how far
 *  back a client may reach, and with it the offline-retry window. */
export const MAX_SESSION_AGE_MS = 30 * 24 * 60 * 60_000;
/** Upper bound on a single session's wall-clock span. */
export const MAX_SESSION_DURATION_MS = 24 * 60 * 60_000;

/**
 * Cross-field structural checks the per-point anomaly pass cannot express.
 *
 * These run FIRST and independently: the anomaly detector walks consecutive
 * pairs, so on its own it never notices that the points sit outside the
 * declared session window, that the window is inverted, or that the whole
 * thing is dated next year. Returned as reasons rather than thrown so one
 * response can name everything that is wrong.
 */
export function structuralRejections(
  observation: MovementObservation,
  now: number,
): string[] {
  const { startTime, endTime, points } = observation;
  const reasons: string[] = [];

  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return ["Session window is not a finite time range"];
  }
  if (endTime <= startTime) {
    reasons.push("Session end time must be after its start time");
  }
  if (endTime - startTime > MAX_SESSION_DURATION_MS) {
    reasons.push("Session duration exceeds 24 hours");
  }
  if (startTime > now + MAX_FUTURE_SKEW_MS) {
    reasons.push("Session starts in the future");
  }
  if (endTime > now + MAX_FUTURE_SKEW_MS) {
    reasons.push("Session ends in the future");
  }
  if (now - endTime > MAX_SESSION_AGE_MS) {
    reasons.push("Session is too old to verify");
  }

  /* Session metadata, when present, is structurally checked before any
     measurement — same as the observation window above, and for the same
     reason: a self-inconsistent session should not produce a distance that
     looks authoritative. The rules live in the shared domain, so the phone
     rejects the same shapes the server does rather than discovering them as a
     400 after uploading a route. */
  if (observation.session) {
    reasons.push(...sessionMetadataProblems(observation.session));
    /* The lifecycle must contain the observations it claims to describe. A
       finish before the last fix, or a start after the first, means the two
       clocks disagree about the same session — and the pair, not either alone,
       is what makes that detectable. */
    const { startedAt, finishedAt } = observation.session;
    if (Number.isFinite(startedAt) && Number.isFinite(finishedAt)) {
      if (startTime < startedAt) reasons.push("Observations begin before the session started");
      if (endTime > finishedAt) reasons.push("Observations continue after the session finished");
    }
  }

  let previous: number | null = null;
  let outOfWindow = 0;
  let unordered = 0;
  let nonFinite = 0;
  for (const point of points) {
    if (
      !Number.isFinite(point.lat) ||
      !Number.isFinite(point.lng) ||
      !Number.isFinite(point.accuracy) ||
      !Number.isFinite(point.timestamp)
    ) {
      nonFinite += 1;
      continue;
    }
    if (point.timestamp < startTime || point.timestamp > endTime) outOfWindow += 1;
    if (previous !== null && point.timestamp <= previous) unordered += 1;
    previous = point.timestamp;
  }
  if (nonFinite > 0) reasons.push(`${nonFinite} point(s) carry a non-finite value`);
  if (outOfWindow > 0) reasons.push(`${outOfWindow} point(s) fall outside the session window`);
  if (unordered > 0) reasons.push(`${unordered} point(s) are not in increasing time order`);

  return reasons;
}

/**
 * Verify one observation.
 *
 * Structural rejection short-circuits before any measurement: a self-
 * inconsistent payload should not produce a distance that looks authoritative.
 */
export function verifyMovement(
  observation: MovementObservation,
  deps: VerifyMovementDeps,
): MovementVerificationResult {
  const structural = structuralRejections(observation, deps.now());
  if (structural.length > 0) {
    return {
      status: "rejected",
      distanceMeters: null,
      durationSeconds: null,
      traversedHexIds: [],
      confidence: null,
      rejectionReasons: structural,
      sealEvaluation: null,
    };
  }

  const anomaly = deps.detectAnomalies(observation);
  const durationSeconds = Math.round((observation.endTime - observation.startTime) / 1000);

  if (anomaly.isAnomaly) {
    return {
      status: "rejected",
      distanceMeters: null,
      durationSeconds,
      traversedHexIds: [],
      confidence: anomaly.confidence,
      rejectionReasons: anomaly.reasons,
      sealEvaluation: null,
    };
  }

  return {
    status: "verified",
    distanceMeters: Math.round(deps.calculateDistance(observation.points)),
    durationSeconds,
    traversedHexIds: deps.traversedHexIds(observation.points),
    confidence: anomaly.confidence,
    rejectionReasons: [],
    sealEvaluation: sealFor(observation),
  };
}

/**
 * Seal the accepted route — and only an accepted one.
 *
 * Placed after the anomaly check on purpose. A rejected route is one the server
 * does not believe happened, and a loop closed inside a route that did not
 * happen is not a loop; running sealing first would produce an authoritative
 * answer about evidence that had just been refused.
 *
 * Absent provenance means no seal rather than a seal under today's rules. The
 * rules version says which interpretation applies, and a submission from before
 * the session model carries none — inventing one would score a session under
 * rules that did not exist when it ran.
 *
 * `heldCells` is deliberately **null**: finishing on ground you already hold is
 * a real method and the domain implements it fully, but it needs a trusted
 * held-cell set, and no server-authoritative territory exists to supply one.
 * Null means "nobody who can be believed has been asked", which the engine
 * reports as unavailable rather than as a failed seal. It is not the client's
 * to supply — a client that could name its own held ground could seal at will.
 */
function sealFor(observation: MovementObservation) {
  if (!observation.session) return null;
  return evaluateSealing({
    session: observation.session,
    points: observation.points.map((p) => ({
      latitude: p.lat,
      longitude: p.lng,
      timestamp: p.timestamp,
    })),
    heldCells: null,
  });
}
