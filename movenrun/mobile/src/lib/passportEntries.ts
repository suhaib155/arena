/**
 * Passport route stamps — pure, platform-free, testable.
 *
 * Maps the already-persisted route-review summaries (`RouteTrustRecord`, which
 * are scalar-only — no coordinates, no path, no location) into compact,
 * privacy-safe "stamps" for the Route Passport. It exposes ONLY safe scalar
 * fields (date, activity, distance/duration, trust label, territory result) and
 * never any raw coordinate, route array, or hidden anti-cheat detail. Missing
 * optional metadata degrades to null so the row can omit it.
 */
import type { RouteTrustRecord } from "@/lib/routeTrust";
import { recapFormat } from "@/lib/weeklyRecap";

export interface PassportStamp {
  id: string;
  /** Human date, e.g. "Jun 18". */
  dateLabel: string;
  /** Activity type — the app records one movement type; kept honest. */
  activity: string;
  /** Distance label, or null when unavailable. */
  distanceLabel: string | null;
  /** Duration label, or null when unavailable. */
  durationLabel: string | null;
  /** Route trust label (local preview). */
  trustLabel: string;
  /** Territory result, or null when the route captured/defended nothing. */
  territoryLabel: string | null;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function dateLabelOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function territoryLabelOf(r: RouteTrustRecord): string | null {
  if (r.routeOutcome === "captured") return "Captured a zone";
  if (r.routeOutcome === "defended") {
    return r.defendedCount > 0
      ? `Defended ${r.defendedCount} zone${r.defendedCount === 1 ? "" : "s"}`
      : "Defended territory";
  }
  return null;
}

/**
 * Build up to `max` recent passport stamps (history is newest-first). Only safe
 * scalar fields are emitted.
 */
export function buildPassportStamps(
  history: readonly RouteTrustRecord[],
  max = 6,
): PassportStamp[] {
  return history.slice(0, max).map((r) => ({
    id: r.id,
    dateLabel: dateLabelOf(r.createdAt),
    activity: "Movement route",
    distanceLabel: r.distanceMeters > 0 ? recapFormat.fmtKm(r.distanceMeters) : null,
    durationLabel: r.durationSeconds > 0 ? recapFormat.fmtDuration(r.durationSeconds) : null,
    trustLabel: r.trustLabel,
    territoryLabel: territoryLabelOf(r),
  }));
}
