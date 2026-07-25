/**
 * expo-location adapter for the map's recentre control (D4).
 *
 * Thin by design: it supplies the four platform calls and the accuracy mode,
 * and delegates every decision to `@/lib/territory/deviceLocation`, which is
 * platform-free and unit-tested offline. See that module for the ordering
 * rules, the failure taxonomy and the privacy posture.
 */
import * as Location from "expo-location";
import {
  requestDeviceLocation,
  LOCATION_TIMEOUT_MS,
  type LocationBackend,
} from "@/lib/territory/deviceLocation";
import type { LocationOutcome } from "@/lib/territory/mapFollow";

export { LOCATION_TIMEOUT_MS };
export type { LocationBackend };

const expoBackend: LocationBackend = {
  hasServicesEnabledAsync: () => Location.hasServicesEnabledAsync(),
  getForegroundPermissionsAsync: () => Location.getForegroundPermissionsAsync(),
  requestForegroundPermissionsAsync: () => Location.requestForegroundPermissionsAsync(),
  getCurrentPositionAsync: () =>
    Location.getCurrentPositionAsync({
      // Balanced, not BestForNavigation: this is a camera move, not a recorded
      // run, and the highest-accuracy mode costs battery and seconds for
      // precision the map does not need.
      accuracy: Location.Accuracy.Balanced,
    }),
};

/** Ask the device where it is, for the map camera and nothing else. */
export function getCurrentLocation(
  backend: LocationBackend = expoBackend,
  timeoutMs = LOCATION_TIMEOUT_MS,
): Promise<LocationOutcome> {
  return requestDeviceLocation(backend, timeoutMs);
}
