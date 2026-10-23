/**
 * Estimated versus verified movement XP — the status model (MR-C item 4).
 *
 * Pure: no React, no store, no network, no storage.
 *
 * ## The rule
 *
 * Pressing Save records the session and banks its XP *as an estimate*: the
 * phone's own measurement, shown at once, and reversible. Only an
 * authoritative server decision turns it into *verified* XP, and that happens
 * exactly once per session:
 *
 * - `verified`: verified XP is the smaller of the estimate and the XP the
 *   server's own distance and duration earn. Anything the phone estimated
 *   above that is taken back, so a provisional reading can never bank more
 *   than the server accepted.
 * - `rejected`: the whole estimate is taken back; the session stays saved
 *   (history, streak and the workout itself are not erased).
 * - no answer (offline, timeout, server error, signed out): the estimate
 *   stands, labelled as pending or local, and a later retry settles it.
 *
 * Settling is keyed by the session's stable `clientSessionId`, and a settled
 * entry never settles again, so a retried or duplicated response cannot
 * reverse twice or verify twice. The estimate itself is recorded once per
 * session for the same reason.
 *
 * ## What is not decided here
 *
 * The four player-facing labels are proposals in
 * `docs/movement/MR-C_CLOCK_DRIFT_AND_XP_STATUS.md`; the mobile UI is frozen,
 * so nothing renders them yet. A pending answer whose cause is permanent
 * (`invalid_request`, `not_found`) is still `pending_verification` rather than
 * `not_eligible`: the server never gave a verdict, and only a verdict reverses.
 */
import type { VerificationState } from "./movementVerification";
import type { VerifiedMovementRecord } from "./verifiedMovement";

export type MovementXpStatus =
  /** Saved on this phone; no verification was attempted (signed out, no client). */
  | "saved_locally"
  /** Sent, or queued for retry, with no verdict yet. Estimated XP stands. */
  | "pending_verification"
  /** The server verified it; verified XP is banked. */
  | "verified"
  /** The server declined it; the estimate was taken back. */
  | "not_eligible";

export interface MovementXpEntry {
  clientSessionId: string;
  /** Banked locally at Save. */
  estimatedXp: number;
  /** Whether Save handed the session to verification. */
  submitted: boolean;
  /** Null until the server decides; then the terminal outcome. */
  settled: "verified" | "not_eligible" | null;
  /** Banked on a verified verdict; null otherwise. */
  verifiedXp: number | null;
  /** Estimate taken back on settlement (0 until settled). */
  reversedXp: number;
  savedAt: string;
}

/** Newest first, bounded. An entry evicted before its verdict simply keeps its estimate. */
export const MAX_MOVEMENT_XP_ENTRIES = 50;

/** XP the server's own measurement earns, never more than the estimate. */
export function verifiedXpFor(
  estimatedXp: number,
  record: VerifiedMovementRecord,
  xpFor: (distanceM: number, durationMs: number) => number,
): number {
  if (record.status !== "verified") return 0;
  if (record.verifiedDistanceMeters === null || record.verifiedDurationSeconds === null) return 0;
  return Math.max(0, Math.min(estimatedXp, xpFor(record.verifiedDistanceMeters, record.verifiedDurationSeconds * 1000)));
}

/** Record the estimate banked at Save. A second call for the same session changes nothing. */
export function recordEstimate(
  ledger: readonly MovementXpEntry[],
  entry: { clientSessionId: string; estimatedXp: number; submitted: boolean; savedAt: string },
): MovementXpEntry[] {
  if (ledger.some((e) => e.clientSessionId === entry.clientSessionId)) return ledger.slice();
  const fresh: MovementXpEntry = {
    clientSessionId: entry.clientSessionId,
    estimatedXp: Math.max(0, Math.round(entry.estimatedXp)),
    submitted: entry.submitted,
    settled: null,
    verifiedXp: null,
    reversedXp: 0,
    savedAt: entry.savedAt,
  };
  return [fresh, ...ledger].slice(0, MAX_MOVEMENT_XP_ENTRIES);
}

export interface Settlement {
  ledger: MovementXpEntry[];
  /** Add to the total XP: zero or negative (an estimate taken back). */
  totalXpDelta: number;
  /** Add to verified XP: zero or positive. */
  verifiedXpDelta: number;
}

/** Apply a server verdict to its session's entry, at most once. */
export function settle(
  ledger: readonly MovementXpEntry[],
  record: VerifiedMovementRecord,
  xpFor: (distanceM: number, durationMs: number) => number,
): Settlement {
  const index = ledger.findIndex((e) => e.clientSessionId === record.clientSessionId);
  const entry = index < 0 ? null : ledger[index]!;
  if (!entry || entry.settled !== null) return { ledger: ledger.slice(), totalXpDelta: 0, verifiedXpDelta: 0 };
  const verified = verifiedXpFor(entry.estimatedXp, record, xpFor);
  const reversed = entry.estimatedXp - verified;
  const next: MovementXpEntry = {
    ...entry,
    settled: record.status === "verified" ? "verified" : "not_eligible",
    verifiedXp: record.status === "verified" ? verified : null,
    reversedXp: reversed,
  };
  const copy = ledger.slice();
  copy[index] = next;
  return { ledger: copy, totalXpDelta: -reversed, verifiedXpDelta: verified };
}

/**
 * The status a session's XP is in. `live` is the in-memory verification state
 * of the session on screen, when there is one, so a verdict that has arrived
 * but not yet been recorded still reads correctly.
 */
export function movementXpStatus(entry: MovementXpEntry, live?: VerificationState | null): MovementXpStatus {
  if (entry.settled === "verified") return "verified";
  if (entry.settled === "not_eligible") return "not_eligible";
  if (live?.kind === "verified") return "verified";
  if (live?.kind === "rejected") return "not_eligible";
  if (entry.submitted || live?.kind === "submitting" || live?.kind === "pending") return "pending_verification";
  return "saved_locally";
}
