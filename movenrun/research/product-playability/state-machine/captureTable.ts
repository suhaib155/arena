/**
 * The capture lifecycle as a table: every state against every event.
 *
 * Source of truth is `mobile/src/lib/sessionLifecycle.ts`; this table is what
 * the documentation shows, and `tests/stateMachine.test.ts` proves the two
 * agree row by row.
 */
import {
  finish, idleLifecycle, pause, requestStart, trackerStarted, type CaptureState, type SessionLifecycle, type TransitionOutcome,
} from "../../../mobile/src/lib/sessionLifecycle";

export type CaptureEvent = "requestStart" | "trackerStarted" | "trackerFailed" | "pause" | "resume" | "finish";

export interface CaptureRow { from: CaptureState; event: CaptureEvent; outcome: TransitionOutcome; to: CaptureState; note: string }

export const CAPTURE_TABLE: readonly CaptureRow[] = [
  { from: "idle", event: "requestStart", outcome: "ok", to: "starting", note: "Start pressed; nothing stamped yet" },
  { from: "idle", event: "trackerStarted", outcome: "invalid", to: "idle", note: "a late native start with no request is refused" },
  { from: "idle", event: "trackerFailed", outcome: "invalid", to: "idle", note: "" },
  { from: "idle", event: "pause", outcome: "invalid", to: "idle", note: "" },
  { from: "idle", event: "resume", outcome: "invalid", to: "idle", note: "" },
  { from: "idle", event: "finish", outcome: "invalid", to: "idle", note: "no session, so no evidence" },
  { from: "starting", event: "requestStart", outcome: "ignored", to: "starting", note: "double tap on Start" },
  { from: "starting", event: "trackerStarted", outcome: "ok", to: "active", note: "id, mode, rules version and start time stamped together" },
  { from: "starting", event: "trackerFailed", outcome: "ok", to: "idle", note: "permission, services or acquisition timeout; nothing burned" },
  { from: "starting", event: "pause", outcome: "invalid", to: "starting", note: "" },
  { from: "starting", event: "resume", outcome: "invalid", to: "starting", note: "" },
  { from: "starting", event: "finish", outcome: "invalid", to: "starting", note: "the screen's quit path discards instead" },
  { from: "active", event: "requestStart", outcome: "ignored", to: "active", note: "" },
  { from: "active", event: "trackerStarted", outcome: "invalid", to: "active", note: "a second native start cannot re-stamp" },
  { from: "active", event: "trackerFailed", outcome: "invalid", to: "active", note: "mid-session errors become gaps, not a reset" },
  { from: "active", event: "pause", outcome: "ok", to: "paused", note: "" },
  { from: "active", event: "resume", outcome: "ignored", to: "active", note: "" },
  { from: "active", event: "finish", outcome: "ok", to: "finished", note: "" },
  { from: "paused", event: "requestStart", outcome: "ignored", to: "paused", note: "" },
  { from: "paused", event: "trackerStarted", outcome: "invalid", to: "paused", note: "" },
  { from: "paused", event: "trackerFailed", outcome: "invalid", to: "paused", note: "" },
  { from: "paused", event: "pause", outcome: "ignored", to: "paused", note: "no second open pause" },
  { from: "paused", event: "resume", outcome: "ok", to: "active", note: "next accepted fix starts a new stretch (no bridge)" },
  { from: "paused", event: "finish", outcome: "ok", to: "finished", note: "the open pause closes at finish" },
  { from: "finished", event: "requestStart", outcome: "ignored", to: "finished", note: "" },
  { from: "finished", event: "trackerStarted", outcome: "invalid", to: "finished", note: "" },
  { from: "finished", event: "trackerFailed", outcome: "invalid", to: "finished", note: "" },
  { from: "finished", event: "pause", outcome: "invalid", to: "finished", note: "" },
  { from: "finished", event: "resume", outcome: "invalid", to: "finished", note: "" },
  { from: "finished", event: "finish", outcome: "ignored", to: "finished", note: "double Finish is one session" },
];

/** A lifecycle in the given state, built through the real machine. */
export function reach(state: CaptureState): SessionLifecycle {
  const idle = idleLifecycle();
  if (state === "idle") return idle;
  const starting = requestStart(idle).lifecycle;
  if (state === "starting") return starting;
  const active = trackerStarted(starting, { clientSessionId: "synthetic-0001", at: 1_000 }).lifecycle;
  if (state === "active") return active;
  if (state === "paused") return pause(active, 1_500).lifecycle;
  return finish(active, 1_800).lifecycle;
}
