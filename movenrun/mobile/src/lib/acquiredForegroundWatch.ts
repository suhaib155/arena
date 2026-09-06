import { createGpsAcquisition, ON_FOOT_POLICY } from "@movenrun/shared/measurement";
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

/** Native watch lifetime, including late subscription resolution after cancellation. */
export class AcquiredForegroundWatch {
  private run: WatchRun | null = null;
  constructor(private readonly deps: ForegroundWatchDeps) {}

  start(onPoint: (point: TrackPoint) => void,
    onError?: (error: TrackerStartError) => void,
    onState?: (state: GpsAcquisitionState) => void): Promise<void> {
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
      run.timer = setTimeout(() => fail(new TrackerStartError("acquisition_timeout")),
        ON_FOOT_POLICY.acquisitionTimeoutMs);
      const acquired = () => {
        if (run.phase !== "acquiring") return;
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
        if (acquisition.push(point, now)) acquired();
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
