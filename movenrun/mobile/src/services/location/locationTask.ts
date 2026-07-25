/**
 * The background location TaskManager task.
 *
 * ## Why this file exists separately
 * `TaskManager.defineTask` **must** run at module scope, not inside a React
 * component or effect. When the OS relaunches the app to deliver a background
 * location batch, it starts a fresh JS runtime and immediately looks for the
 * task by name — if the definition lives inside a component that hasn't
 * mounted yet, the delivery is dropped and the run loses those samples.
 *
 * `app/_layout.tsx` imports this module for that side effect only.
 *
 * ## Privacy
 * Nothing here logs a coordinate. Even at debug level, a precise location in a
 * log is a location leak (crash reporters and device logs both persist), so
 * only counts and error messages are ever printed — see PHASE 18.
 */
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import type { RouteSample } from "@/lib/geo/routeSample";

export const LOCATION_TASK_NAME = "movenrun-territory-run-location";

/** Receives batches delivered while the app is backgrounded. */
type BackgroundBatchHandler = (samples: RouteSample[]) => void;

/**
 * Set by `activeRunService` while a run is live. Kept in module scope so a
 * background relaunch can reattach to it.
 */
let backgroundHandler: BackgroundBatchHandler | null = null;

export function setBackgroundBatchHandler(handler: BackgroundBatchHandler | null): void {
  backgroundHandler = handler;
}

/**
 * Convert one Expo `LocationObject` into a MovenRun `RouteSample`.
 *
 * Every optional field is normalised to `null` rather than `undefined` so the
 * shape serialises identically through AsyncStorage and the upload payload.
 * `mocked` comes from Android's `isMocked` where the platform reports it; iOS
 * does not, so it stays null there (never inferred).
 */
export function toRouteSample(location: Location.LocationObject): RouteSample {
  const coords = location.coords;
  const mocked = (location as { mocked?: boolean }).mocked;
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    timestamp: location.timestamp,
    accuracy: coords.accuracy ?? null,
    altitude: coords.altitude ?? null,
    altitudeAccuracy: coords.altitudeAccuracy ?? null,
    speed: coords.speed ?? null,
    heading: coords.heading ?? null,
    mocked: typeof mocked === "boolean" ? mocked : null,
  };
}

interface LocationTaskData {
  locations?: Location.LocationObject[];
}

/**
 * The task body, exported so it can be exercised offline without the native
 * TaskManager. Returns the number of samples handed to the active handler.
 */
export function handleLocationTaskPayload(
  payload: { data?: unknown; error?: { message?: string } | null },
  handler: BackgroundBatchHandler | null = backgroundHandler,
): number {
  if (payload.error) {
    // Message only — an error object from the location stack can carry the
    // last known coordinate in some platform versions.
    console.warn(`[MovenRun location] background task error: ${payload.error.message ?? "unknown"}`);
    return 0;
  }
  const locations = (payload.data as LocationTaskData | undefined)?.locations;
  if (!Array.isArray(locations) || locations.length === 0) return 0;
  if (!handler) {
    // No run is active in this runtime (e.g. a stale delivery after finish).
    return 0;
  }
  handler(locations.map(toRouteSample));
  return locations.length;
}

// Defined at module scope — see the header comment. Guarded so a hot reload or
// a duplicate import can't register the task twice.
if (!TaskManager.isTaskDefined(LOCATION_TASK_NAME)) {
  TaskManager.defineTask(LOCATION_TASK_NAME, (body) => {
    handleLocationTaskPayload(body as { data?: unknown; error?: { message?: string } | null });
  });
}

/** Location options used while a territory run is active. */
export const RUN_LOCATION_OPTIONS: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.BestForNavigation,
  // A fix every ~5 m or ~2 s, whichever comes first. Dense enough that a loop
  // closes cleanly and traversed cells aren't skipped; sparse enough not to
  // drain the battery over an hour.
  distanceInterval: 5,
  timeInterval: 2000,
  // iOS: tells CoreLocation this is a workout, which keeps updates flowing with
  // the screen locked and stops the "significant location change" downgrade.
  activityType: Location.ActivityType.Fitness,
  pausesUpdatesAutomatically: false,
  showsBackgroundLocationIndicator: true,
  // Android: a visible, honest foreground-service notification is required for
  // background location and is the right thing to show regardless.
  foregroundService: {
    notificationTitle: "MovenRun is recording your run",
    notificationBody: "Your route is being tracked so you can capture territory.",
    notificationColor: "#18C987",
  },
};
