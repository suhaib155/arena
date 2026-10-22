/**
 * The phone's capture path, driven by a synthetic scenario.
 *
 * Every decision here is made by the real app modules: the shared measurement
 * policy (`inspectFix`, `createGpsAcquisition`), the capture lifecycle machine
 * (`mobile/src/lib/sessionLifecycle.ts`), the canonical evidence/seal preview
 * (`mobile/src/lib/sealPreview.ts`), the gap ledger (`trackPoints.ts`) and the
 * summary predicates (`moveSession.ts`, `routeMapState.ts`,
 * `movementVerification.ts`).
 *
 * What is REPLICATED rather than executed, because it lives inside React
 * components and cannot run on plain Node:
 *  - the fix callback in `mobile/app/move/session.tsx` (the `tracker.start`
 *    onPoint handler: non-increasing/before-start guard, `inspectFix(prev, p,
 *    now)`, continuity break after background/resume/tracker error, pushing
 *    into the seal preview);
 *  - the AppState listener and `finish()` in the same file;
 *  - the watch cadence of `AcquiredForegroundWatch` (4 s interval, 5 m distance
 *    filter once acquired, 30 s acquisition timeout), modelled from
 *    `trackingConfig.ts` because the native watch is the OS's, not ours;
 *  - the Save decision in `mobile/app/move/summary.tsx` (`saveable`,
 *    `movedOverGround`, `completeQuest` only when moved over ground).
 *
 * If one of those component bodies changes, this file must be re-read against
 * it. `tests/pipelineDrift.test.ts` pins the source lines it mirrors.
 */
import { createGpsAcquisition, inspectFix, ON_FOOT_POLICY, type FixRejection } from "@movenrun/shared/measurement";
import { haversineMeters } from "@movenrun/shared/geo";
import type { SessionMetadata } from "@movenrun/shared/session";
import type { EvidenceStatus } from "@movenrun/shared/evidence";
import {
  finish as finishLifecycle,
  idleLifecycle,
  pause as pauseLifecycle,
  requestStart,
  resume as resumeLifecycle,
  sessionMetadata,
  trackerStarted,
  activeMsSoFar,
  type SessionLifecycle,
} from "../../../mobile/src/lib/sessionLifecycle";
import { createSealPreview, sealFinishedRoute, type SealPreviewTracker } from "../../../mobile/src/lib/sealPreview";
import { recordGap, summarizeGaps, gapNotice, type TrackingGap } from "../../../mobile/src/lib/trackPoints";
import type { TrackPoint } from "../../../mobile/src/lib/geo";
import { SESSION_WATCH } from "../../../mobile/src/lib/trackingConfig";
import { degradesSignal } from "../../../mobile/src/lib/mapPresence";
import { hasDrawableRoute } from "../../../mobile/src/lib/routeMapState";
import { isVerifiable, toSubmission } from "../../../mobile/src/lib/movementVerification";
import { isSaveable, sessionXp } from "../../../mobile/src/services/moveSession";
import type { Scenario, SensorSample } from "./scenario";
import { sample } from "./scenario";

export type StartOutcome = "started" | "permission_denied" | "services_off" | "acquisition_timeout" | "approximate_only";

export interface ClientResult {
  start: StartOutcome;
  /** Seconds from scenario start to acquisition (session start). */
  acquiredAtSecond: number | null;
  fixesDelivered: number;
  accepted: number;
  rejected: Partial<Record<FixRejection | "non_increasing_time_guard" | "dropped_not_active", number>>;
  /** Times the in-session signal chip would have flipped to degraded. */
  degradedSignals: number;
  /** Seconds where fixes were being rejected and the chip still said usable. */
  silentRejectSeconds: number;
  distanceM: number;
  durationMs: number;
  gaps: TrackingGap[];
  gapNotice: string | null;
  evidenceStatus: EvidenceStatus | null;
  points: TrackPoint[];
  metadata: SessionMetadata | null;
  sealed: boolean | null;
  /** The process was killed before Finish: nothing survives. */
  lostToProcessKill: boolean;
  /** Summary-screen decisions. */
  saveable: boolean;
  movedOverGround: boolean;
  /** XP shown on the summary reward line (sessionXp). */
  xpShown: number;
  /** XP banked if the player presses Save (completeQuest runs only when moved). */
  xpBankedOnSave: number;
  willSubmit: boolean;
  submission: ReturnType<typeof toSubmission> | null;
  /** Wall-clock (system) finish time used for the session, for the server's `now`. */
  finishedAtSystem: number | null;
  /** Scenario seconds the session finished at, and paused between (truth bookkeeping only). */
  finishedAtSecond: number | null;
  pausedSeconds: [number, number][];
}

/** Native watch cadence: OS delivers at most every `timeInterval`, and while not
 *  acquiring only after `distanceInterval` metres of reported displacement. */
function deliverable(samples: SensorSample[]): { s: SensorSample; acquiring: boolean }[] {
  return samples.map((s) => ({ s, acquiring: false }));
}

/**
 * Candidate changes, OFF by default. With no options the pipeline is today's
 * code. Each option is a PROPOSED fix measured on the corpus; none is applied
 * to the app.
 */
export interface CandidateOptions {
  /** P2: after a speed rejection, the next accepted fix starts a new stretch instead of bridging from the old anchor. */
  breakAfterSpeedReject?: boolean;
  /** P3: Save/XP duration from fix timestamps (GNSS) rather than the phone's wall clock. */
  durationFromEvidence?: boolean;
  /** P4: a future-dated fix (phone clock behind GNSS) degrades the signal chip like a stale fix. */
  futureFixDegrades?: boolean;
  /** P5: reject a fix that keeps a 60 s window of accepted fixes wandering without getting anywhere. */
  driftGuard?: boolean;
}

export const DRIFT_WINDOW_MS = 60_000;
export const DRIFT_MIN_PATH_M = 40;
export const DRIFT_MIN_NET_RATIO = 0.25;

export function runClient(scenario: Scenario, options: CandidateOptions = {}): ClientResult {
  const samples = sample(scenario);
  const latency = scenario.latencyMs ?? 300;
  const result: ClientResult = {
    start: "started", acquiredAtSecond: null, fixesDelivered: 0, accepted: 0, rejected: {},
    degradedSignals: 0, silentRejectSeconds: 0, distanceM: 0, durationMs: 0, gaps: [], gapNotice: null,
    evidenceStatus: null, points: [], metadata: null, sealed: null, lostToProcessKill: false,
    saveable: false, movedOverGround: false, xpShown: 0, xpBankedOnSave: 0, willSubmit: false,
    submission: null, finishedAtSystem: null, finishedAtSecond: null, pausedSeconds: [],
  };
  const bump = (reason: keyof ClientResult["rejected"]) => {
    result.rejected[reason] = (result.rejected[reason] ?? 0) + 1;
  };

  /* Start: moveTracker.GpsTracker.start checks services then permission. */
  if (scenario.servicesOff) { result.start = "services_off"; return result; }
  if (scenario.permission === "denied") { result.start = "permission_denied"; return result; }

  let lifecycle: SessionLifecycle = requestStart(idleLifecycle()).lifecycle;
  const acquisition = createGpsAcquisition();
  let acquiring = true;
  let acquisitionStartSystem = samples[0]!.systemTime;
  let lastDeliveredAt = -Infinity;
  let lastDeliveredPos: { latitude: number; longitude: number } | null = null;

  let preview: SealPreviewTracker | null = null;
  let lastFixTimestamp = 0;
  let continuityBroken = false;
  let backgroundedAt: number | null = null;
  let trackerGapAt: number | null = null;
  let signalUsable = true;
  let lastRejectWasSpeed = false;
  const gaps: TrackingGap[] = [];
  const events = [...scenario.events].sort((a, b) => a.at - b.at);

  for (const s of samples) {
    const now = s.systemTime + latency;
    /* user / OS events at this second, before the fix for the same second */
    for (const e of events.filter((ev) => ev.at === s.second)) {
      if (e.type === "processKill") { result.lostToProcessKill = true; return result; }
      if (lifecycle.state !== "active" && lifecycle.state !== "paused") {
        if (e.type === "finish" && lifecycle.state === "starting") return result; // quit before start
        continue;
      }
      if (e.type === "pause") {
        const next = pauseLifecycle(lifecycle, now);
        if (next.outcome === "ok") result.pausedSeconds.push([s.second, Infinity]);
        lifecycle = next.lifecycle;
      }
      if (e.type === "resume") {
        const next = resumeLifecycle(lifecycle, now);
        if (next.outcome === "ok") { continuityBroken = true; result.pausedSeconds[result.pausedSeconds.length - 1]![1] = s.second; }
        lifecycle = next.lifecycle;
      }
      if (e.type === "background" && backgroundedAt === null) { backgroundedAt = now; continuityBroken = true; }
      if (e.type === "foreground" && backgroundedAt !== null) { recordGap(gaps, backgroundedAt, now); backgroundedAt = null; }
      if (e.type === "trackerError") { continuityBroken = true; trackerGapAt ??= now; signalUsable = false; result.degradedSignals += 1; }
      if (e.type === "finish") {
        const next = finishLifecycle(lifecycle, now);
        if (next.outcome !== "ok") continue;
        lifecycle = next.lifecycle;
        if (backgroundedAt !== null) { recordGap(gaps, backgroundedAt, now); backgroundedAt = null; }
        if (trackerGapAt !== null) { recordGap(gaps, trackerGapAt, now); trackerGapAt = null; }
        result.finishedAtSystem = now;
        result.finishedAtSecond = s.second;
      }
    }
    if (lifecycle.state === "finished") break;

    const fix = s.reported;
    if (!fix) continue;
    /* OS cadence */
    if ((s.gnssTime - lastDeliveredAt) < SESSION_WATCH.timeInterval) continue;
    if (!acquiring && lastDeliveredPos && haversineMeters(lastDeliveredPos, fix) < SESSION_WATCH.distanceInterval) continue;
    if (backgroundedAt !== null) continue; // foreground-only: no callbacks while backgrounded
    lastDeliveredAt = s.gnssTime;
    lastDeliveredPos = fix;

    if (acquiring) {
      if (now - acquisitionStartSystem > ON_FOOT_POLICY.acquisitionTimeoutMs) { result.start = "acquisition_timeout"; return result; }
      if (scenario.permission === "approximate") continue; // approximate fixes never satisfy 20 m
      if (acquisition.push(fix, now)) {
        acquiring = false;
        lifecycle = trackerStarted(lifecycle, { clientSessionId: `synthetic-${scenario.seed}`, at: now }).lifecycle;
        const live = lifecycle;
        preview = createSealPreview(live.rulesVersion ?? -1, () => lifecycle.pauses);
        result.acquiredAtSecond = s.second;
      }
      continue;
    }
    result.fixesDelivered += 1;
    if (lifecycle.state !== "active") { bump("dropped_not_active"); continue; }

    const prev = continuityBroken ? null : result.points[result.points.length - 1] ?? null;
    const guard = fix.timestamp <= lastFixTimestamp || fix.timestamp < (lifecycle.startedAt ?? now);
    const decision = guard
      ? { accepted: false, reason: "non_increasing_time" as FixRejection, segmentMeters: 0 }
      : inspectFix(options.breakAfterSpeedReject && lastRejectWasSpeed ? null : prev, fix, now);
    if (decision.accepted && options.driftGuard && prev) {
      const window = result.points.filter((p) => fix.timestamp - p.timestamp <= DRIFT_WINDOW_MS && !p.breakBefore);
      if (window.length >= 3) {
        const path = [...window, fix].reduce((sum, p, i, all) => i === 0 ? 0 : sum + haversineMeters(all[i - 1]!, p), 0);
        const net = haversineMeters(window[0]!, fix);
        if (path >= DRIFT_MIN_PATH_M && net < DRIFT_MIN_NET_RATIO * path) {
          decision.accepted = false;
          (decision as { reason: string | null }).reason = "within_uncertainty";
        }
      }
    }
    if (Number.isFinite(fix.timestamp) && fix.timestamp <= now) lastFixTimestamp = Math.max(lastFixTimestamp, fix.timestamp);
    if (!decision.accepted && decision.reason === "implausible_speed") lastRejectWasSpeed = true;
    if (!decision.accepted) {
      bump(guard ? "non_increasing_time_guard" : decision.reason!);
      if (degradesSignal(decision.reason) || (options.futureFixDegrades && decision.reason === "future_fix")) {
        if (signalUsable) result.degradedSignals += 1;
        signalUsable = false;
      } else if (decision.reason !== "within_uncertainty" && signalUsable) {
        result.silentRejectSeconds += SESSION_WATCH.timeInterval / 1000;
      }
      continue;
    }
    signalUsable = !(fix.accuracy != null && fix.accuracy > 25);
    if (trackerGapAt !== null) { recordGap(gaps, trackerGapAt, now); trackerGapAt = null; }
    let point: TrackPoint = { ...fix };
    if (options.breakAfterSpeedReject && lastRejectWasSpeed && prev) continuityBroken = true;
    lastRejectWasSpeed = false;
    if (continuityBroken) { point = { ...point, breakBefore: true }; continuityBroken = false; }
    result.points.push(point);
    result.accepted += 1;
    preview?.push(point);
  }

  if (lifecycle.state === "starting") { result.start = "acquisition_timeout"; return result; }
  if (lifecycle.state !== "finished") {
    // Scenario ended without a Finish: treat as the player pressing Finish at the end.
    const end = samples[samples.length - 1]!.systemTime + latency;
    lifecycle = finishLifecycle(lifecycle, end).lifecycle;
    result.finishedAtSystem = end;
    result.finishedAtSecond = samples[samples.length - 1]!.second;
  }

  const metadata = sessionMetadata(lifecycle);
  const points = preview?.snapshot() ?? [];
  result.metadata = metadata;
  result.points = points;
  result.evidenceStatus = preview?.evidenceStatus ?? "capacity_limited";
  result.distanceM = preview?.distanceMeters ?? 0;
  result.durationMs = activeMsSoFar(lifecycle, lifecycle.finishedAt ?? 0);
  if (options.durationFromEvidence) {
    let observed = 0;
    for (let i = 1; i < points.length; i++) if (!points[i]!.breakBefore) observed += points[i]!.timestamp - points[i - 1]!.timestamp;
    result.durationMs = Math.min(result.durationMs, observed);
  }
  result.gaps = gaps;
  result.gapNotice = gapNotice(summarizeGaps(gaps, result.durationMs));
  const seal = sealFinishedRoute({ points, session: metadata ?? undefined, evidenceStatus: result.evidenceStatus });
  result.sealed = seal ? seal.sealed : null;

  /* summary.tsx Save semantics */
  result.saveable = isSaveable(result.distanceM, result.durationMs);
  result.movedOverGround = hasDrawableRoute(points, metadata?.pauses ?? []);
  result.xpShown = sessionXp(result.distanceM, result.durationMs);
  result.xpBankedOnSave = result.saveable && result.movedOverGround ? result.xpShown : 0;
  result.willSubmit = isVerifiable({ mode: "gps", finished: true, saveable: result.saveable, points });
  result.submission = result.willSubmit && metadata
    ? toSubmission({ points, durationMs: result.durationMs, finishedAt: metadata.finishedAt, session: metadata })
    : null;
  void deliverable;
  return result;
}

/** Ground-truth distance actually walked ON FOOT while the session was capturing
 *  and not paused, counted in scenario seconds so a wrong phone clock cannot
 *  distort the reference. */
export function truthDistance(scenario: Scenario, client: ClientResult): number {
  if (client.acquiredAtSecond === null || client.finishedAtSecond === null) return 0;
  const samples = sample(scenario);
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!, b = samples[i]!;
    if (b.second <= client.acquiredAtSecond || b.second > client.finishedAtSecond) continue;
    if (client.pausedSeconds.some(([from, to]) => b.second > from && b.second <= to)) continue;
    if (!b.truthOnFoot) continue;
    total += Math.hypot(b.truth.x - a.truth.x, b.truth.y - a.truth.y);
  }
  return total;
}
