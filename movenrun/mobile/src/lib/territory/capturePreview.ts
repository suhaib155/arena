/**
 * Capture preview state and copy.
 *
 * ## The rule this module exists to enforce
 * The app may *estimate*. It may never *claim*. Ownership is decided by the
 * server, so every string here is careful about tense: an on-device estimate
 * says "estimate", a submitted route says "verifying", and only a server
 * response says "captured". A preview must never be presented as a capture —
 * telling a runner they took twelve zones and then taking them back is worse
 * than telling them nothing.
 *
 * Pure module — no React, no fetch — so the state machine and every piece of
 * copy are verifiable offline.
 */

/** Where a run is in the capture lifecycle. */
export type CaptureStage =
  /** Running, loop still open. */
  | "open"
  /** Running, close enough that closing the loop is in reach. */
  | "nearClosure"
  /** The client thinks the loop closed. An estimate, nothing more. */
  | "closedLocally"
  /** Uploaded; the server is deciding. */
  | "submitted"
  /** The server awarded territory. */
  | "confirmed"
  /** The server declined. */
  | "rejected";

/** Machine-readable rejection reasons — mirrors the backend's set exactly. */
export type CaptureRejectionReason =
  | "insufficientPoints"
  | "insufficientDistance"
  | "insufficientDuration"
  | "loopNotClosed"
  | "invalidCoordinates"
  | "timestampReversal"
  | "impossibleSpeed"
  | "impossibleJump"
  | "poorGpsAccuracy"
  | "selfIntersectingRoute"
  | "degenerateGeometry"
  | "areaBelowMinimum"
  | "areaAboveMaximum"
  | "restrictedTerritory"
  | "duplicateRoute"
  | "serverVerificationFailed";

/** Human-readable copy for each rejection reason. Plain, never blaming. */
export const REJECTION_COPY: Record<CaptureRejectionReason, string> = {
  insufficientPoints: "Not enough GPS points were recorded to verify the route.",
  insufficientDistance: "Route too short to claim territory.",
  insufficientDuration: "Session too short to claim territory.",
  loopNotClosed: "The loop wasn't closed — the route didn't return near its start.",
  invalidCoordinates: "Some locations were outside the valid range.",
  timestampReversal: "Timestamps went backwards, so the route couldn't be verified.",
  impossibleSpeed: "Movement faster than a run was detected.",
  impossibleJump: "The route jumped further than a person can travel between fixes.",
  poorGpsAccuracy: "GPS accuracy was too low across the route.",
  selfIntersectingRoute: "The route crossed itself, so the enclosed area is ambiguous.",
  degenerateGeometry: "The route didn't enclose an area.",
  areaBelowMinimum: "The enclosed area was below the minimum.",
  areaAboveMaximum: "The enclosed area was above the allowed maximum.",
  restrictedTerritory: "Some of the enclosed ground can't be claimed.",
  duplicateRoute: "This route has already been submitted.",
  serverVerificationFailed: "Verification failed on the server.",
};

const KNOWN_REASONS = new Set<string>(Object.keys(REJECTION_COPY));

/** Turn backend reason codes into copy, dropping any the app doesn't know. */
export function describeRejections(reasons: string[]): string[] {
  const described: string[] = [];
  for (const reason of reasons) {
    if (KNOWN_REASONS.has(reason)) {
      described.push(REJECTION_COPY[reason as CaptureRejectionReason]);
    }
  }
  // Never leave a rejection unexplained: an unrecognised code from a newer
  // backend still gets an honest, non-specific line rather than silence.
  if (described.length === 0 && reasons.length > 0) {
    described.push("Capture wasn't awarded for this route.");
  }
  return described;
}

/**
 * Client-side mirrors of the backend's capture thresholds.
 *
 * These exist **only so the live preview can say something useful mid-run**.
 * The server owns the real values (`TERRITORY_*` in backend/.env.example) and
 * its decision is the only one that counts, so drift here changes the wording
 * of a nudge and nothing else — it can never award or deny territory. They are
 * kept in one place, named after the environment variables they mirror, so the
 * relationship is obvious the next time the backend defaults move.
 */
export const CAPTURE_PREVIEW_DEFAULTS = {
  /** TERRITORY_MAX_CLOSURE_DISTANCE_METERS */
  closureToleranceMeters: 50,
  /** TERRITORY_MIN_ROUTE_DISTANCE_METERS */
  minDistanceMeters: 800,
  /** TERRITORY_MIN_DURATION_SECONDS */
  minDurationSeconds: 300,
  /** TERRITORY_MIN_AREA_SQUARE_METERS */
  minAreaSquareMeters: 10_000,
  /** Distance at which the UI starts nudging back toward the start point. */
  nearClosureMeters: 150,
  /** Average area of one H3 resolution-9 cell, used only for a rough count. */
  cellAreaSquareMeters: 105_332,
} as const;

/**
 * Rough number of cells an enclosed area could cover. Deliberately a floor
 * rather than a round: over-promising a capture estimate is exactly the failure
 * this whole module is written to avoid.
 */
export function estimateCellCount(
  areaSquareMeters: number,
  cellAreaSquareMeters = CAPTURE_PREVIEW_DEFAULTS.cellAreaSquareMeters,
): number {
  if (areaSquareMeters <= 0) return 0;
  return Math.max(1, Math.floor(areaSquareMeters / cellAreaSquareMeters));
}

export interface CapturePreviewInput {
  /** Metres from the current position back to the start, null before 2 fixes. */
  closureDistanceMeters: number | null;
  /** Client-estimated enclosed area. Only meaningful once a loop is plausible. */
  estimatedAreaSquareMeters: number;
  /** Distinct cells the route has crossed so far (client estimate). */
  cellsCrossed: number;
  /** Client-estimated capturable cell count. */
  estimatedCells: number;
  /** Tolerance the backend uses for closure — kept in sync via config. */
  closureToleranceMeters: number;
  /** Distance at which the UI starts nudging toward the start point. */
  nearClosureMeters: number;
  /** Client-side route distance so far. */
  distanceMeters: number;
  /** Minimum distance the backend requires. */
  minDistanceMeters: number;
}

export interface CapturePreview {
  stage: CaptureStage;
  /** One-line status. */
  headline: string;
  /** Supporting detail, or null. */
  detail: string | null;
  /**
   * True only when the server has confirmed. Every other stage must render as
   * provisional — this is the flag the UI keys "confirmed" styling off.
   */
  confirmed: boolean;
  /** True when an area estimate is geometrically meaningful enough to show. */
  showAreaEstimate: boolean;
}

/**
 * A closed loop needs three distinct corners before an enclosed area means
 * anything. Below this the "area" is GPS noise, so it isn't shown at all.
 */
const MIN_MEANINGFUL_AREA_M2 = 500;

/** Live, on-device preview during a run. Never claims anything. */
export function buildLivePreview(input: CapturePreviewInput): CapturePreview {
  const {
    closureDistanceMeters,
    estimatedAreaSquareMeters,
    estimatedCells,
    closureToleranceMeters,
    nearClosureMeters,
    distanceMeters,
    minDistanceMeters,
  } = input;

  const showAreaEstimate = estimatedAreaSquareMeters >= MIN_MEANINGFUL_AREA_M2;

  if (closureDistanceMeters === null) {
    return {
      stage: "open",
      headline: "Start moving to draw your route.",
      detail: null,
      confirmed: false,
      showAreaEstimate: false,
    };
  }

  const closed = closureDistanceMeters <= closureToleranceMeters;
  const farEnough = distanceMeters >= minDistanceMeters;

  if (closed && farEnough) {
    return {
      stage: "closedLocally",
      headline: "Loop detected.",
      detail:
        estimatedCells > 0
          ? `Capture estimate: ${estimatedCells} zone${estimatedCells === 1 ? "" : "s"}. Finish to have it verified.`
          : "Finish to have it verified.",
      confirmed: false,
      showAreaEstimate,
    };
  }

  if (closed && !farEnough) {
    const remaining = Math.max(0, Math.round(minDistanceMeters - distanceMeters));
    return {
      stage: "nearClosure",
      headline: "Loop closed, but the route is still short.",
      detail: `About ${remaining} m more to reach the minimum.`,
      confirmed: false,
      showAreaEstimate,
    };
  }

  if (closureDistanceMeters <= nearClosureMeters) {
    return {
      stage: "nearClosure",
      headline: `Loop almost closed — ${Math.round(closureDistanceMeters)} m remaining.`,
      detail: "Head back toward your starting point.",
      confirmed: false,
      showAreaEstimate,
    };
  }

  return {
    stage: "open",
    headline: "Return near your starting point to close the loop.",
    detail: `${Math.round(closureDistanceMeters)} m from where you started.`,
    confirmed: false,
    showAreaEstimate,
  };
}

/** The server's answer for a submitted route. */
export interface CaptureResult {
  routeStatus: string;
  captureEligible: boolean;
  capturedCells: string[];
  reinforcedCells: string[];
  attackedCells: string[];
  rejectedCells: string[];
  rejectionReasons: string[];
  /** Null while the worker has not finished. */
  processedAt: string | null;
}

/**
 * The post-run preview. `null` result means "submitted, not answered yet" — the
 * verifying state, never a silent success.
 */
export function buildResultPreview(result: CaptureResult | null): CapturePreview {
  if (!result || result.processedAt === null) {
    return {
      stage: "submitted",
      headline: "Verifying route and territory…",
      detail: "Your run is being checked on the server. This usually takes a moment.",
      confirmed: false,
      showAreaEstimate: false,
    };
  }

  if (result.captureEligible && result.capturedCells.length > 0) {
    const count = result.capturedCells.length;
    const extras: string[] = [];
    if (result.reinforcedCells.length > 0) {
      extras.push(`${result.reinforcedCells.length} reinforced`);
    }
    if (result.attackedCells.length > 0) {
      extras.push(`${result.attackedCells.length} attacked`);
    }
    return {
      stage: "confirmed",
      headline: `Territory captured — ${count} zone${count === 1 ? "" : "s"}.`,
      detail: extras.length > 0 ? extras.join(" · ") : null,
      confirmed: true,
      showAreaEstimate: false,
    };
  }

  // Eligible but nothing new taken: the run still defended or attacked ground,
  // which is a real outcome and should read as one.
  if (result.captureEligible) {
    const reinforced = result.reinforcedCells.length;
    const attacked = result.attackedCells.length;
    if (reinforced > 0 || attacked > 0) {
      return {
        stage: "confirmed",
        headline: "Territory held.",
        detail: [
          reinforced > 0 ? `${reinforced} reinforced` : null,
          attacked > 0 ? `${attacked} attacked` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        confirmed: true,
        showAreaEstimate: false,
      };
    }
  }

  return {
    stage: "rejected",
    headline: "Capture not awarded.",
    detail: describeRejections(result.rejectionReasons)[0] ?? null,
    confirmed: false,
    showAreaEstimate: false,
  };
}

/** Format an area for display: m² below a hectare, then km². */
export function formatArea(squareMeters: number): string {
  if (squareMeters >= 1_000_000) return `${(squareMeters / 1_000_000).toFixed(2)} km²`;
  if (squareMeters >= 10_000) return `${(squareMeters / 10_000).toFixed(1)} ha`;
  return `${Math.round(squareMeters)} m²`;
}
