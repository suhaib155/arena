/**
 * Server-verified movement — the reconciliation layer.
 *
 * Turns a settled {@link VerificationState} into a record the app can keep, and
 * defines how a server measurement relates to the device's own. Pure: no React,
 * no store, no network, no storage.
 *
 * ## The boundary this module exists to hold
 *
 * The backend owns route validity, distance, duration and traversed hexes. It
 * does NOT own captured territory, zone control, defence, ownership, deeds,
 * PvP, XP or Locked MOVE — none of those exist server-side at all
 * (`hex_activities` / `zones` are written by no code path). So:
 *
 *   verified traversal is evidence of where verified movement occurred.
 *   it is not territory ownership.
 *
 * Nothing here converts a hex into a zone, a capture, a defence, a deed or a
 * reward, and `structuralGuards` in the tests enforce that this module's source
 * never reaches for the APIs that could.
 */
import type { VerificationState } from "./movementVerification";

/* ── the persisted record ─────────────────────────────────────────────────── */

/**
 * What the server said about one session, in the form the app keeps.
 *
 * ### Why there are no hex ids here
 *
 * H3 cells at the resolution the backend uses are roughly half a square
 * kilometre. A list of them IS location history — coarse, but a trail. The
 * app's existing movement history is explicit that it "deliberately holds no
 * coordinates, polyline, path, or place names: nothing here can reconstruct
 * where the user went" (`RouteTrustRecord`), and persisting traversed cells
 * beside it would quietly break that promise.
 *
 * Nothing in the app needs them persistently: the count is enough to say "this
 * verified session passed through N areas", the ids remain available in the
 * live {@link VerificationState} for the session the user is looking at, and a
 * future territory feature would receive authoritative state from the server
 * rather than replaying a local cache. So the count is kept and the trail is
 * not — the smaller and more honest of the two options.
 */
export interface VerifiedMovementRecord {
  /** The session this belongs to. The only key; see `mergeVerification`. */
  clientSessionId: string;
  /** Terminal outcomes only — the endpoint has no pending status. */
  status: "verified" | "rejected";
  /** Server-measured. Null when the session was rejected before measurement. */
  verifiedDistanceMeters: number | null;
  verifiedDurationSeconds: number | null;
  /** How many H3 cells the verified route passed through. NOT zones owned. */
  traversedHexCount: number;
  /** Server-reported reasons; empty unless rejected. */
  rejectionReasons: string[];
  /** When this client settled the record (ISO). */
  recordedAt: string;
}

/**
 * Build a record from a settled state, or `null` when nothing is settled.
 *
 * `local`, `submitting` and `pending` deliberately produce nothing: they are
 * client states meaning "no server answer", and persisting them would create a
 * row that looks like a verdict. Pending retry state is a separate concern with
 * its own account-scoping and retention questions.
 */
export function toVerifiedRecord(
  clientSessionId: string,
  state: VerificationState,
  now: () => string = () => new Date().toISOString(),
): VerifiedMovementRecord | null {
  if (state.kind === "verified") {
    return {
      clientSessionId,
      status: "verified",
      verifiedDistanceMeters: state.distanceMeters,
      verifiedDurationSeconds: state.durationSeconds,
      // The COUNT, not the trail — see the interface comment above.
      traversedHexCount: state.traversedHexIds.length,
      rejectionReasons: [],
      recordedAt: now(),
    };
  }
  if (state.kind === "rejected") {
    return {
      clientSessionId,
      status: "rejected",
      verifiedDistanceMeters: null,
      verifiedDurationSeconds: null,
      traversedHexCount: 0,
      rejectionReasons: state.reasons,
      recordedAt: now(),
    };
  }
  return null;
}

/**
 * Merge an incoming record into what is already held for that session.
 *
 * Terminal-first, because the backend's outcomes are terminal: a session that
 * has been verified or rejected has a final answer, and
 * `POST /movement/verify` returns that same answer to every later request for
 * the same (user, sessionId). So the first settled record wins and a duplicate
 * idempotent response converges on it rather than rewriting it.
 *
 * That is what makes `verified → pending` and `verified → local` unreachable
 * here: those states never become records at all, and a second settled record
 * cannot displace the first. No revision or versioning semantics are invented,
 * because the server offers none.
 */
export function mergeVerification(
  existing: VerifiedMovementRecord | null,
  incoming: VerifiedMovementRecord,
): VerifiedMovementRecord {
  return existing ?? incoming;
}

/** Find the record for a session. Keyed only by id, so one session's verdict
 *  can never be read as another's. */
export function findVerification(
  records: readonly VerifiedMovementRecord[],
  clientSessionId: string,
): VerifiedMovementRecord | null {
  return records.find((r) => r.clientSessionId === clientSessionId) ?? null;
}

/* ── local vs server measurement ──────────────────────────────────────────── */

/** Which number a surface is showing, and on whose authority. */
export type MeasurementSource = "local" | "server";

export interface PresentedMeasurement {
  distanceMeters: number;
  durationSeconds: number;
  source: MeasurementSource;
  /** True only when the server measured it. Never true for a local reading. */
  serverVerified: boolean;
}

/**
 * Decide which measurement a surface should present.
 *
 * The device's reading is never destroyed or overwritten — it is what the user
 * watched accumulate, and it stays the record of what the device observed. The
 * server's number is an independent measurement of the same route, and the two
 * legitimately differ (different filtering, different smoothing).
 *
 * Precedence: the local observation until the server has verified the session,
 * the server's measurement afterwards, and `source` always says which is on
 * screen so a surface can label it rather than imply the two are the same fact.
 * A rejected session keeps the local reading — the server declining to verify
 * a route is not a claim that the device measured it wrongly.
 */
export function presentMeasurement(
  local: { distanceMeters: number; durationSeconds: number },
  record: VerifiedMovementRecord | null,
): PresentedMeasurement {
  if (
    record?.status === "verified" &&
    record.verifiedDistanceMeters !== null &&
    record.verifiedDurationSeconds !== null
  ) {
    return {
      distanceMeters: record.verifiedDistanceMeters,
      durationSeconds: record.verifiedDurationSeconds,
      source: "server",
      serverVerified: true,
    };
  }
  return { ...local, source: "local", serverVerified: false };
}

/* ── labelling ────────────────────────────────────────────────────────────── */

/**
 * Neutral, factual wording for a verification state.
 *
 * Every string here describes the *verification*, never territory or reward.
 * "Captured", "owned", "earned", "approved" and anything on-chain are absent by
 * construction — none of those facts is established by this endpoint, and a
 * test asserts the vocabulary stays clean.
 */
export function verificationLabel(state: VerificationState): string {
  switch (state.kind) {
    case "local":
      return "Not submitted";
    case "submitting":
      return "Verifying movement";
    case "verified":
      return "Verified movement";
    case "rejected":
      return "Needs review";
    case "pending":
      return "Verification pending";
  }
}
