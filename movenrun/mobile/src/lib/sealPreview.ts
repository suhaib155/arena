/**
 * The live sealing preview — what the player can see while they are moving.
 *
 * This is **guidance, not authority.** It exists so the mechanic is
 * understandable in the moment: you can see that your trail is still open, that
 * a loop just closed, that you are back near where you started. The server
 * recomputes all of it from verified evidence afterwards, and that recomputation
 * is the answer that counts.
 *
 * ## Why it can still be trusted to be consistent
 *
 * There is no second algorithm here. Every geometric decision comes from
 * `@movenrun/shared/sealing`, the same module the backend runs, fed the same
 * pauses from the same session provenance. What differs is the *evidence*, and
 * only the evidence: the phone feeds fixes its own tracker accepted, and the
 * server feeds the fixes it verified. Given identical points the two agree
 * exactly, and a test asserts it rather than assuming it.
 *
 * That difference is why the preview is never presented as final. A route the
 * tracker liked can still be refused by the server, and a loop the player
 * watched close can turn out not to have been submitted at all.
 *
 * ## What it deliberately does not do
 *
 * It does not capture, own, defend or claim anything, and it never says
 * "captured", "owned", "solid" or "shade" — none of those mechanics exists. It
 * does not hurry the player: there is no countdown, no warning, no red state and
 * no penalty language, because an unsealed route is an ordinary route and
 * nobody should be moving unsafely to close one.
 */
import { haversineMeters } from "@movenrun/shared/geo";
import {
  createSealScanner,
  evaluateSealing,
  sealingRulesFor,
  type SealScanner,
  type SealingRules,
} from "@movenrun/shared/sealing";
import type { PauseInterval, SessionMetadata } from "@movenrun/shared/session";

import type { TrackPoint } from "./geo";

/** What the player is told about their trail right now. */
export interface SealPreview {
  /** Loops closed so far in this session. */
  sealedLoops: number;
  /** Whether finishing here would close the route by coming home. */
  nearStart: boolean;
}

export const EMPTY_PREVIEW: SealPreview = { sealedLoops: 0, nearStart: false };

export interface SealPreviewTracker {
  /**
   * Extend the previewed route by one accepted fix.
   *
   * Returns true exactly on the fix that closed a loop, so the caller can mark
   * the moment once. It never returns true twice for the same closure.
   */
  push(point: TrackPoint): boolean;
  readonly preview: SealPreview;
}

/**
 * Start previewing a session, or return null if this build cannot.
 *
 * Null for an unknown rules version, which is the same fail-closed answer the
 * server gives: a session captured under rules this build does not have is not
 * one it should be drawing conclusions about, even soft ones.
 */
export function createSealPreview(
  rulesVersion: number,
  pauses: readonly PauseInterval[] = [],
): SealPreviewTracker | null {
  const rules = sealingRulesFor(rulesVersion);
  if (rules === null) return null;
  return tracker(rules, pauses);
}

function tracker(rules: SealingRules, pauses: readonly PauseInterval[]): SealPreviewTracker {
  const scanner: SealScanner = createSealScanner(rules, pauses);
  let first: TrackPoint | null = null;
  let sealedLoops = 0;
  let nearStart = false;
  /* The player has to leave the radius before returning to it means anything.
     Without this, every session would open by telling the player they were
     already home — true, useless, and the opposite of glanceable. */
  let hasLeft = false;

  return {
    push(point: TrackPoint): boolean {
      const closed = scanner.push(point).length > 0;
      if (closed) sealedLoops = scanner.events.length;
      if (first === null) {
        first = point;
        return closed;
      }
      const distance = haversineMeters(first, point);
      if (distance > rules.returnRadiusMeters) hasLeft = true;
      nearStart = hasLeft && distance <= rules.returnRadiusMeters;
      return closed;
    },
    get preview(): SealPreview {
      return { sealedLoops, nearStart };
    },
  };
}

/* ── words ────────────────────────────────────────────────────────────────── */

/**
 * One short line, readable at a glance in daylight while moving.
 *
 * Every string here describes the *route*. None of them claims territory,
 * reward or ownership, and none of them is a warning: "Open route" is a
 * statement of fact about a trail that is still in play, not a problem to fix.
 */
export function sealPreviewLabel(preview: SealPreview): string {
  const loops = preview.sealedLoops;
  if (loops === 0) return preview.nearStart ? "Finish here to seal" : "Open route";
  const sealed = loops === 1 ? "1 loop sealed" : `${loops} loops sealed`;
  return preview.nearStart ? `${sealed} · finish here to seal` : sealed;
}

/**
 * What a screen reader should say, or null when there is nothing new to say.
 *
 * Announced on the transitions that mean something — a loop closing, and coming
 * back into range of the start — and silent on every fix in between. A live
 * region that spoke on every GPS update would make the screen unusable.
 */
export function sealPreviewAnnouncement(
  previous: SealPreview,
  next: SealPreview,
): string | null {
  if (next.sealedLoops > previous.sealedLoops) {
    return next.sealedLoops === 1 ? "Loop sealed" : `${next.sealedLoops} loops sealed`;
  }
  if (next.nearStart && !previous.nearStart) return "Back near your start";
  return null;
}

/* ── the finished route ───────────────────────────────────────────────────── */

/**
 * What the summary screen says about a route that has ended.
 *
 * Deliberately three booleans and a count rather than the engine's full
 * evaluation: the summary has no use for route slices, and a screen that held
 * them would be one more place a closure's location could end up.
 */
export interface FinishedSeal {
  sealed: boolean;
  /** Loops closed mid-session by cutting the trail. */
  loops: number;
  /** Whether the route also closed by finishing near its own start. */
  cameHome: boolean;
}

export const UNSEALED: FinishedSeal = { sealed: false, loops: 0, cameHome: false };

/**
 * Evaluate a finished route once, locally.
 *
 * Null when the session carries no provenance, or a rules version this build
 * cannot interpret — the same fail-closed answer the server gives, and for the
 * same reason. Null is not "did not seal": callers that gate on sealing must
 * treat it as *unknown* and do nothing, never as permission.
 *
 * Held ground is not evaluated here at all. The app's zone list is local
 * preview state that no server has agreed to, and feeding it in would turn a
 * guess into the thing that decides whether a route sealed.
 */
export function sealFinishedRoute(finished: {
  points: readonly TrackPoint[];
  session?: SessionMetadata;
}): FinishedSeal | null {
  if (!finished.session) return null;
  const evaluation = evaluateSealing({
    session: finished.session,
    points: finished.points,
    heldCells: null,
  });
  if (evaluation.status !== "evaluated") return null;
  return {
    sealed: evaluation.events.length > 0,
    loops: evaluation.events.filter((e) => e.method === "self_cross").length,
    cameHome: evaluation.methods.includes("return_to_start"),
  };
}

/**
 * One neutral sentence for the summary.
 *
 * An unsealed route gets a plain statement of fact, never a failure: the
 * session is valid, the movement counted, and the route simply stayed open.
 * There is no red state and no "you missed it" here by design.
 */
export function finishedSealLabel(seal: FinishedSeal | null): string {
  if (seal === null) return "Route not evaluated";
  if (!seal.sealed) return "Open route — this one stayed open";
  const parts: string[] = [];
  if (seal.loops === 1) parts.push("1 loop sealed");
  else if (seal.loops > 1) parts.push(`${seal.loops} loops sealed`);
  if (seal.cameHome) parts.push("finished near your start");
  return parts.join(" · ");
}
