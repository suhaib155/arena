import { createGpsAcquisition, inspectFix, ON_FOOT_POLICY } from "@movenrun/shared/measurement";
import { acquisitionFixState, type GpsAcquisitionState } from "./gpsAcquisitionState";
import type { TrackPoint } from "./geo";

export type TrackerStartErrorCode = "permission_denied" | "services_off" |
  "acquisition_timeout" | "tracker_error" | "cancelled";
export class TrackerStartError extends Error {
  constructor(readonly code: TrackerStartErrorCode) {
    super(code); this.name = "TrackerStartError";
  }
  get settingsRelevant(): boolean {
    return this.code === "permission_denied" || this.code === "services_off";
  }
}
export interface ForegroundWatchDeps {
  watch(acquiring: boolean, onPoint: (point: TrackPoint) => void,
    onError: () => void): Promise<{ remove(): void }>;
  now?: () => number;
  acquisitionSample?: (point: TrackPoint) => void;
}
interface WatchRun {
  phase: "acquiring" | "switching" | "active" | "stopped";
  sub: { remove(): void } | null;
  acquisitionSub: { remove(): void } | null;
  timer: ReturnType<typeof setTimeout> | null;
  reject: (error: TrackerStartError) => void;
}

/**
 * Native watch lifetime, including late subscription resolution after
 * cancellation.
 *
 * ## Two channels, and why they are not one
 *
 * This class emits points on two channels that must never be merged.
 *
 * - **Evidence** (`onPoint`). Points that may become route geometry, measured
 *   distance, a sealed loop, XP and territory. Warm-up fixes are kept out of
 *   it on purpose: a session's route begins when the session does.
 * - **Display** (`onDisplayFix`). Points that may only be *looked at* — the
 *   marker, the camera, the H3 cell the player is standing in, and the
 *   readiness the chip is allowed to claim. Nothing on this channel is
 *   submitted, measured or banked.
 *
 * The display channel exists because the two questions have different answers
 * during acquisition and while standing still. The session watch wakes on
 * displacement, so a stationary player produces no evidence at all — correctly,
 * they have not moved — and the map was left with nothing to draw even though
 * the app knew where they were to within a few metres. Answering "where am I"
 * from the evidence channel made a map that could only show a player who was
 * already walking.
 */
export class AcquiredForegroundWatch {
  private run: WatchRun | null = null;
  constructor(private readonly deps: ForegroundWatchDeps) {}

  /**
   * Begin a foreground watch.
   *
   * `onPoint` is the *evidence* channel: a point delivered there may become
   * route geometry, distance, a seal and eventually territory. `onDisplayFix`
   * is the *display* channel and may never do any of those things — see the
   * class doc.
   */
  start(onPoint: (point: TrackPoint) => void,
    onError?: (error: TrackerStartError) => void,
    onState?: (state: GpsAcquisitionState) => void,
    onDisplayFix?: (point: TrackPoint) => void): Promise<void> {
    this.stop();
    const acquisition = createGpsAcquisition();
    return new Promise<void>((resolve, reject) => {
      const run: WatchRun = { phase: "acquiring", sub: null, acquisitionSub: null, timer: null, reject };
      onState?.("locating");
      this.run = run;
      const fail = (error: TrackerStartError) => {
        if (run.phase === "stopped") return;
        const wasActive = run.phase === "active";
        run.phase = "stopped";
        if (run.timer) clearTimeout(run.timer);
        run.sub?.remove(); run.sub = null;
        run.acquisitionSub?.remove(); run.acquisitionSub = null;
        if (wasActive) onError?.(error); else reject(error);
      };
      const nativeError = () => fail(new TrackerStartError("tracker_error"));
      /* A fix good enough to put a marker on. Deliberately a weaker bar than
         the acquisition policy: the policy decides when a *session* may start,
         and this decides only whether a coordinate is honest enough to centre
         a map on. `inspectFix` against no predecessor rejects impossible
         coordinates, unusable accuracy and stale or future timestamps, which
         is exactly the set that must never reach a map. */
      const display = (point: TrackPoint, now: number) => {
        if (inspectFix(null, point, now).accepted) onDisplayFix?.(point);
      };
      run.timer = setTimeout(() => fail(new TrackerStartError("acquisition_timeout")),
        ON_FOOT_POLICY.acquisitionTimeoutMs);
      const acquired = (point: TrackPoint, now: number) => {
        if (run.phase !== "acquiring") return;
        /* The fix that satisfied the policy is the one the player is standing
           on, and until this line it was consumed by the policy and dropped.
           A stationary player then produced no further points at all — the
           session watch below only wakes on displacement — so the map kept a
           world-scale view and an empty waiting overlay while the header said
           the session was ready. It goes to the display channel, and only the
           display channel: it is not evidence and does not become route,
           distance, a seal or ground. */
        display(point, now);
        // The already-running foreground watch remains live while the lower
        // power watch attaches. Readiness must not wait for a second native
        // registration after the unchanged acquisition policy is satisfied.
        run.phase = "active";
        if (run.timer) clearTimeout(run.timer);
        onState?.("ready");
        resolve();
        this.deps.watch(false, (point) => {
          if (run.phase === "active") onPoint(point);
        }, nativeError).then((sub) => {
          if (run.phase !== "active") { sub.remove(); return; }
          run.sub = sub;
          run.acquisitionSub?.remove(); run.acquisitionSub = null;
        }).catch(nativeError);
      };
      this.deps.watch(true, (point) => {
        if (run.phase === "active" && !run.sub) { onPoint(point); return; }
        if (run.phase !== "acquiring") return;
        this.deps.acquisitionSample?.(point);
        const now = (this.deps.now ?? Date.now)();
        onState?.(acquisitionFixState(point, now));
        /* Every drawable warm-up fix centres the map, not only the qualifying
           one. Waiting for the policy would leave the player looking at an
           arbitrary continent for the whole acquisition window while the app
           already knew, to within a few metres, where they were. */
        if (acquisition.push(point, now)) acquired(point, now);
        else display(point, now);
      }, nativeError).then((sub) => {
        if (run.phase === "stopped" || run.sub) sub.remove(); else run.acquisitionSub = sub;
      }).catch(nativeError);
    });
  }

  stop(): void {
    const run = this.run;
    if (!run) return;
    const pending = run.phase === "acquiring" || run.phase === "switching";
    run.phase = "stopped";
    if (run.timer) clearTimeout(run.timer);
    run.sub?.remove(); run.sub = null;
    run.acquisitionSub?.remove(); run.acquisitionSub = null;
    if (pending) run.reject(new TrackerStartError("cancelled"));
    this.run = null;
  }
}
