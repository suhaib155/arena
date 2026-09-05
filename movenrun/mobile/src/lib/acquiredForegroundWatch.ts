import { createGpsAcquisition, ON_FOOT_POLICY } from "@movenrun/shared/measurement";
import { distanceDiagnostics } from "./distanceDiagnostics";
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
}
interface WatchRun {
  phase: "acquiring" | "switching" | "active" | "stopped";
  sub: { remove(): void } | null;
  timer: ReturnType<typeof setTimeout> | null;
  reject: (error: TrackerStartError) => void;
}

/** Native watch lifetime, including late subscription resolution after cancellation. */
export class AcquiredForegroundWatch {
  private run: WatchRun | null = null;
  constructor(private readonly deps: ForegroundWatchDeps) {}

  start(onPoint: (point: TrackPoint) => void,
    onError?: (error: TrackerStartError) => void): Promise<void> {
    this.stop();
    const acquisition = createGpsAcquisition();
    return new Promise<void>((resolve, reject) => {
      const run: WatchRun = { phase: "acquiring", sub: null, timer: null, reject };
      this.run = run;
      const fail = (error: TrackerStartError) => {
        if (run.phase === "stopped") return;
        const wasActive = run.phase === "active";
        run.phase = "stopped";
        if (run.timer) clearTimeout(run.timer);
        run.sub?.remove(); run.sub = null;
        if (wasActive) onError?.(error); else reject(error);
      };
      const nativeError = () => fail(new TrackerStartError("tracker_error"));
      run.timer = setTimeout(() => fail(new TrackerStartError("acquisition_timeout")),
        ON_FOOT_POLICY.acquisitionTimeoutMs);
      const acquired = () => {
        if (run.phase !== "acquiring") return;
        run.phase = "switching";
        run.sub?.remove(); run.sub = null;
        this.deps.watch(false, (point) => {
          if (run.phase === "active") onPoint(point);
        }, nativeError).then((sub) => {
          if (run.phase !== "switching") { sub.remove(); return; }
          run.sub = sub; run.phase = "active";
          if (run.timer) clearTimeout(run.timer);
          resolve();
        }).catch(nativeError);
      };
      this.deps.watch(true, (point) => {
        if (run.phase !== "acquiring") return;
        distanceDiagnostics.record(point, { accepted: false, reason: "acquiring", segmentMeters: 0 }, 0, 0);
        if (acquisition.push(point, (this.deps.now ?? Date.now)())) acquired();
      }, nativeError).then((sub) => {
        if (run.phase !== "acquiring") sub.remove(); else run.sub = sub;
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
    if (pending) run.reject(new TrackerStartError("cancelled"));
    this.run = null;
  }
}
