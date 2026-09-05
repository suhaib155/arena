/**
 * Display point buffering and tracking-gap accounting.
 *
 * Two problems live here, both from the live session screen.
 *
 * ## 1. The route buffer was quadratic
 *
 * Every accepted fix did `points = [...points, p]`. Copying the whole array per
 * point is O(n) each time and O(n²) across a session — an hour's walk is a few
 * thousand fixes, so the copy alone runs into millions of element writes, and
 * each new array reference re-rendered the screen and re-projected every point.
 *
 * `pushPoint` mutates in place (O(1) amortised) and decimates when full, so
 * memory is bounded no matter how long the session runs. Decimation keeps every
 * other point, which halves resolution uniformly rather than dropping the start
 * of the route. This is only a drawing approximation: sealing, measurement,
 * submission and summary consume the separate bounded canonical evidence store.
 *
 * ## 2. A tracking gap is not the same as standing still
 *
 * Tracking is foreground-only. If the user switches apps mid-run, the watch
 * stops, distance stops growing, and nothing in the app knows: the summary
 * reports a short distance and a slow pace as though that were the truth, and
 * route trust still says "Clean route".
 *
 * The tempting fix — infer a gap from a long gap between point timestamps — is
 * wrong, because standing at a traffic light produces exactly the same silence
 * (that is the whole point of `distanceInterval`). So gaps are **recorded from
 * app lifecycle transitions**, which are authoritative: we know when we stopped
 * receiving fixes because we know when we were backgrounded.
 */
import type { TrackPoint } from "./geo";

/** Display-only budget. This buffer must never be used as canonical evidence. */
export const MAX_STORED_POINTS = 2048;

/** Redraw the on-screen route every N accepted points rather than every point.
 *  The canvas draws at most ~110 dots, so finer updates are invisible. */
export const PREVIEW_STRIDE = 4;

/**
 * Append a fix in place. Returns the buffer for convenience — it is the *same*
 * array, deliberately: callers must not rely on a new reference for rendering.
 */
export function pushPoint(
  buffer: TrackPoint[],
  point: TrackPoint,
  cap: number = MAX_STORED_POINTS,
): TrackPoint[] {
  buffer.push(point);
  if (buffer.length > cap) decimate(buffer);
  return buffer;
}

/** Halve resolution in place, keeping the first and last fix. */
function decimate(buffer: TrackPoint[]): void {
  const last = buffer[buffer.length - 1]!;
  let write = 0;
  for (let read = 0; read < buffer.length; read += 2) buffer[write++] = buffer[read]!;
  buffer.length = write;
  // Always keep the newest fix so the route head stays where the user is.
  if (buffer[buffer.length - 1] !== last) buffer.push(last);
}

/** Whether this accepted-point count should refresh the drawn route. */
export function shouldRefreshPreview(
  acceptedCount: number,
  stride: number = PREVIEW_STRIDE,
): boolean {
  return acceptedCount <= 2 || acceptedCount % stride === 0;
}

/* ── tracking gaps ─────────────────────────────────────────────────────── */

/** A span during which the app was not receiving fixes. */
export interface TrackingGap {
  startedAt: number;
  endedAt: number;
}

/**
 * Backgrounding shorter than this is ignored — pulling down the notification
 * shade or glancing at a message briefly deactivates the app without losing
 * meaningful distance, and flagging it would cry wolf on every session.
 */
export const MIN_GAP_MS = 8_000;

/** Record a completed background span, if it was long enough to matter. */
export function recordGap(
  gaps: TrackingGap[],
  startedAt: number,
  endedAt: number,
  minMs: number = MIN_GAP_MS,
): TrackingGap[] {
  if (endedAt - startedAt >= minMs) gaps.push({ startedAt, endedAt });
  return gaps;
}

export interface GapSummary {
  count: number;
  totalMs: number;
  /** Share of the session spent untracked, 0..1. */
  share: number;
  /** Enough missing time that the distance should not be presented as complete. */
  significant: boolean;
}

/** Untracked time is significant past either of these — a long single gap, or
 *  a meaningful share of the whole session. */
export const SIGNIFICANT_GAP_MS = 60_000;
export const SIGNIFICANT_GAP_SHARE = 0.1;

export function summarizeGaps(
  gaps: readonly TrackingGap[],
  sessionDurationMs: number,
): GapSummary {
  const totalMs = gaps.reduce((sum, g) => sum + Math.max(0, g.endedAt - g.startedAt), 0);
  const share = sessionDurationMs > 0 ? Math.min(1, totalMs / sessionDurationMs) : 0;
  return {
    count: gaps.length,
    totalMs,
    share,
    significant:
      gaps.length > 0 && (totalMs >= SIGNIFICANT_GAP_MS || share >= SIGNIFICANT_GAP_SHARE),
  };
}

/** One honest sentence for the summary screen, or null when tracking was clean. */
export function gapNotice(summary: GapSummary): string | null {
  if (summary.count === 0) return null;
  const minutes = Math.max(1, Math.round(summary.totalMs / 60_000));
  const spans = summary.count === 1 ? "once" : `${summary.count} times`;
  return `Location tracking was interrupted ${spans} — about ${minutes} min of this route wasn't recorded.`;
}
