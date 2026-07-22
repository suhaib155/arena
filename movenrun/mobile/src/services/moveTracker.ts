/**
 * Foreground-only movement trackers for the Move session screen.
 *
 * - `GpsTracker` wraps expo-location `watchPositionAsync` (foreground watch —
 *   no background tracking, no task manager). Points stay on-device.
 * - `DemoTracker` synthesizes a plausible walking loop for development, web
 *   testing, and the permission-denied fallback. It is always labeled as demo
 *   in the UI and demo sessions are never saved as progress.
 */
import * as Location from "expo-location";
import type { TrackPoint } from "@/lib/geo";

export type TrackerMode = "gps" | "demo";

export interface MoveTracker {
  readonly mode: TrackerMode;
  start(onPoint: (p: TrackPoint) => void): Promise<void>;
  stop(): void;
}

/** Ask for foreground permission. Returns true when granted. */
export async function requestForegroundPermission(): Promise<boolean> {
  try {
    const res = await Location.requestForegroundPermissionsAsync();
    return res.status === "granted";
  } catch {
    return false;
  }
}

export async function hasForegroundPermission(): Promise<boolean> {
  try {
    const res = await Location.getForegroundPermissionsAsync();
    return res.status === "granted";
  } catch {
    return false;
  }
}

/** Coarse foreground-permission status for the readiness screen. Read-only —
 *  does not request permission or change tracking behaviour. */
export type ForegroundPermission = "granted" | "denied" | "undetermined";

export async function getForegroundPermissionStatus(): Promise<ForegroundPermission> {
  try {
    const res = await Location.getForegroundPermissionsAsync();
    if (res.status === "granted") return "granted";
    if (res.status === "denied") return "denied";
    return "undetermined";
  } catch {
    return "undetermined";
  }
}

/** Whether device location services (the radio) are enabled. Unknown/errored
 *  is treated as enabled so we never raise a false "unavailable" alarm. */
export async function hasLocationServices(): Promise<boolean> {
  try {
    return await Location.hasServicesEnabledAsync();
  } catch {
    return true;
  }
}

export class GpsTracker implements MoveTracker {
  readonly mode = "gps" as const;
  private sub: Location.LocationSubscription | null = null;

  async start(onPoint: (p: TrackPoint) => void): Promise<void> {
    this.sub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 2000,
        distanceInterval: 3,
      },
      (loc) => {
        onPoint({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          timestamp: loc.timestamp ?? Date.now(),
          accuracy: loc.coords.accuracy ?? null,
        });
      },
    );
  }

  stop(): void {
    this.sub?.remove();
    this.sub = null;
  }
}

/**
 * Emits a point every second along a rounded city-block loop at a brisk-walk
 * pace (~1.9 m/s) with light jitter. Anchored to a fixed park so the route
 * preview looks like a real run.
 */
export class DemoTracker implements MoveTracker {
  readonly mode = "demo" as const;
  private timer: ReturnType<typeof setInterval> | null = null;
  private t = 0;

  async start(onPoint: (p: TrackPoint) => void): Promise<void> {
    const lat0 = 40.7812;
    const lon0 = -73.9665;
    const mPerDegLat = 111_320;
    const mPerDegLon = mPerDegLat * Math.cos((lat0 * Math.PI) / 180);
    this.timer = setInterval(() => {
      this.t += 1;
      /* rounded-rectangle loop, ~600 m around, plus gentle wobble */
      const u = (this.t * 1.9) / 600; // loops per tick distance
      const a = u * 2 * Math.PI;
      const xm = 120 * Math.cos(a) + 18 * Math.cos(a * 3);
      const ym = 75 * Math.sin(a) + 12 * Math.sin(a * 2);
      const jx = (Math.random() - 0.5) * 1.6;
      const jy = (Math.random() - 0.5) * 1.6;
      onPoint({
        latitude: lat0 + (ym + jy) / mPerDegLat,
        longitude: lon0 + (xm + jx) / mPerDegLon,
        timestamp: Date.now(),
        accuracy: 8,
      });
    }, 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export function createTracker(mode: TrackerMode): MoveTracker {
  return mode === "demo" ? new DemoTracker() : new GpsTracker();
}
