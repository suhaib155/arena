import { useState, useEffect, useCallback, useRef } from "react";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { useStore } from "../store/index.js";

const BACKGROUND_TASK = "movenrun-gps-task";

// Register the background task (must be top-level)
TaskManager.defineTask(BACKGROUND_TASK, ({ data, error }: any) => {
  if (error) { console.error("[BG GPS]", error); return; }
  const locations: Location.LocationObject[] = data?.locations ?? [];
  for (const loc of locations) {
    useStore.getState().addGPSPoint({
      lat: loc.coords.latitude,
      lng: loc.coords.longitude,
      accuracy: loc.coords.accuracy ?? 0,
      altitude: loc.coords.altitude ?? undefined,
      timestamp: loc.timestamp,
    });
  }
});

export function useGPS() {
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isTracking = useStore((s) => s.isTracking);
  const startTracking = useStore((s) => s.startTracking);
  const stopTracking = useStore((s) => s.stopTracking);
  const currentPoints = useStore((s) => s.currentPoints);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") { setError("Location permission denied"); return; }
      const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
      setPermissionGranted(bgStatus === "granted");
    })();
  }, []);

  const start = useCallback(async () => {
    if (!permissionGranted) { setError("Need background location permission"); return; }
    startTracking();
    await Location.startLocationUpdatesAsync(BACKGROUND_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      distanceInterval: 5, // meters
      timeInterval: 5_000,
      foregroundService: {
        notificationTitle: "MovenRun is tracking your route",
        notificationBody: "Earning $MOVE as you move",
      },
    });
  }, [permissionGranted, startTracking]);

  const stop = useCallback(async () => {
    stopTracking();
    const isRegistered = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_TASK);
    if (isRegistered) await Location.stopLocationUpdatesAsync(BACKGROUND_TASK);
  }, [stopTracking]);

  return { isTracking, permissionGranted, error, start, stop, currentPoints };
}
