/**
 * One-shot device-location request — the decision logic, platform-free (D4).
 *
 * The expo-location adapter lives in `@/services/location/currentLocation`;
 * everything that can be got *wrong* lives here, so it is verifiable under
 * `node --test` without a device, a permission dialog or a native module.
 *
 * ## Deliberately not the run service
 * `activeRunService` owns a *run*: a continuous, persisted, uploaded recording
 * that also needs background permission. The map's recentre control needs one
 * fix, now, to move a camera. Reusing the run service would mean starting a
 * recording to answer "where am I" — wrong, and a privacy problem.
 *
 * ## Privacy
 * The fix is returned to the caller and nothing else: never stored, never
 * logged, never uploaded. The map camera is its only consumer, and the backend
 * has no endpoint that takes it.
 *
 * ## Every failure has a name
 * Permission refused, location services off and "no fix" need three different
 * things from the user, so this returns a discriminated outcome rather than
 * throwing or returning null. Collapsing them into "something went wrong" is
 * what makes a location button feel broken.
 */
import type { LocationOutcome } from "./mapFollow";

/** Give up rather than leave the control spinning indefinitely. */
export const LOCATION_TIMEOUT_MS = 10_000;

/** The platform capabilities this needs, narrowed to four calls. */
export interface LocationBackend {
  /** Whether the device's location radio is on at all. */
  hasServicesEnabledAsync(): Promise<boolean>;
  /** The current foreground permission, without prompting. */
  getForegroundPermissionsAsync(): Promise<{ status: string; canAskAgain?: boolean }>;
  /** Prompt for foreground permission. */
  requestForegroundPermissionsAsync(): Promise<{ status: string }>;
  /** One position fix. The adapter chooses the accuracy mode. */
  getCurrentPositionAsync(): Promise<{ coords: { longitude: number; latitude: number } }>;
}

/** Resolve after `ms`, so a hung fix cannot hang the UI. */
function timeout(ms: number): Promise<LocationOutcome> {
  return new Promise((resolve) =>
    setTimeout(() => resolve({ kind: "unavailable", reason: "timeout" }), ms),
  );
}

/**
 * Ask the device where it is.
 *
 * Order matters: services first (a permission prompt is pointless with the
 * radio off), then permission, then the fix.
 */
export async function requestDeviceLocation(
  backend: LocationBackend,
  timeoutMs = LOCATION_TIMEOUT_MS,
): Promise<LocationOutcome> {
  return Promise.race([locate(backend), timeout(timeoutMs)]);
}

async function locate(backend: LocationBackend): Promise<LocationOutcome> {
  let servicesEnabled: boolean;
  try {
    servicesEnabled = await backend.hasServicesEnabledAsync();
  } catch {
    // Cannot tell — try anyway rather than blaming the user's settings for
    // something we did not actually observe.
    servicesEnabled = true;
  }
  if (!servicesEnabled) return { kind: "servicesDisabled" };

  let status: string;
  try {
    const current = await backend.getForegroundPermissionsAsync();
    status = current.status;
    if (status !== "granted") {
      // Only prompt when it has not already been settled: re-requesting a
      // permanently denied permission does nothing on iOS and re-nags on
      // Android.
      if (status === "denied" && current.canAskAgain === false) return { kind: "denied" };
      status = (await backend.requestForegroundPermissionsAsync()).status;
    }
  } catch {
    return { kind: "denied" };
  }
  if (status !== "granted") return { kind: "denied" };

  try {
    const position = await backend.getCurrentPositionAsync();
    const { longitude, latitude } = position.coords;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      // A NaN fix would put the camera at null island and look like a bug in
      // the map rather than in the sensor.
      return { kind: "unavailable", reason: "invalidFix" };
    }
    return { kind: "fix", coordinate: [longitude, latitude] };
  } catch (error) {
    return { kind: "unavailable", reason: error instanceof Error ? error.message : "unknown" };
  }
}
