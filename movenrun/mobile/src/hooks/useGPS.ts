import { useState, useEffect, useCallback } from "react";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { GPSPoint } from "@movenrun/shared";
import { CurrentPosition, useStore } from "../store/index.js";

const BACKGROUND_TASK = "movenrun-gps-task";
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

export interface SubmitResult {
  oracleSig: string;
  hexActivity: Record<string, number>;
  moveEarned: bigint;
}

// Must be defined at module top-level — runs in background JS context
TaskManager.defineTask(
  BACKGROUND_TASK,
  ({ data, error }: TaskManager.TaskManagerTaskBody) => {
    if (error) {
      console.error("[BG GPS]", error);
      return;
    }
    const locations = (
      (data as Record<string, unknown>)?.locations ?? []
    ) as Location.LocationObject[];

    const store = useStore.getState();
    for (const loc of locations) {
      const point: GPSPoint = {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        accuracy: loc.coords.accuracy ?? 0,
        altitude: loc.coords.altitude ?? undefined,
        timestamp: loc.timestamp,
      };
      store.addGPSPoint(point);

      const pos: CurrentPosition = {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        accuracy: loc.coords.accuracy ?? 0,
        speed: loc.coords.speed ?? 0,
        timestamp: loc.timestamp,
      };
      store.setCurrentPosition(pos);
    }
  },
);

async function pollJobStatus(jobId: string): Promise<SubmitResult> {
  const MAX_ATTEMPTS = 30;
  const POLL_MS = 2_000;

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await new Promise<void>((r) => setTimeout(r, POLL_MS));

    const res = await fetch(`${API_BASE}/gps/status/${jobId}`);
    if (!res.ok) continue;

    const data = (await res.json()) as {
      status: string;
      oracleSig?: string;
      hexActivity?: Record<string, number>;
      moveEarned?: string;
      reason?: string;
    };

    if (data.status === "COMPLETE") {
      return {
        oracleSig: data.oracleSig ?? "",
        hexActivity: data.hexActivity ?? {},
        moveEarned: BigInt(data.moveEarned ?? "0"),
      };
    }
    if (data.status === "REJECTED") {
      throw new Error(`Route rejected: ${data.reason ?? "unknown"}`);
    }
  }
  throw new Error("Route processing timed out");
}

export function useGPS() {
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isTracking = useStore((s) => s.isTracking);
  const currentPosition = useStore((s) => s.currentPosition);
  const routePoints = useStore((s) => s.currentPoints);
  const distanceThisSession = useStore((s) => s.currentDistanceMeters);
  const startRun = useStore((s) => s.startRun);
  const stopRun = useStore((s) => s.stopRun);
  const walletAddress = useStore((s) => s.walletAddress);

  useEffect(() => {
    void (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setError("Location permission denied");
        return;
      }
      const { status: bgStatus } =
        await Location.requestBackgroundPermissionsAsync();
      setPermissionGranted(bgStatus === "granted");
    })();
  }, []);

  const startTracking = useCallback(async () => {
    if (!permissionGranted) {
      setError("Background location permission required");
      return;
    }
    setError(null);
    startRun();
    await Location.startLocationUpdatesAsync(BACKGROUND_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      distanceInterval: 5,
      timeInterval: 5_000,
      foregroundService: {
        notificationTitle: "MovenRun tracking your route",
        notificationBody: "Earning $MOVE as you move",
      },
    });
  }, [permissionGranted, startRun]);

  const stopTracking = useCallback(async (): Promise<SubmitResult | null> => {
    // Snapshot points before stopping (store resets on stopRun)
    const points = useStore.getState().currentPoints;
    stopRun();

    const isRegistered =
      await Location.hasStartedLocationUpdatesAsync(BACKGROUND_TASK);
    if (isRegistered) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_TASK);
    }

    if (points.length < 2 || !walletAddress) return null;

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/gps/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress,
          points,
          startTime: points[0].timestamp,
          endTime: points[points.length - 1].timestamp,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { jobId } = (await res.json()) as { jobId: string };
      return await pollJobStatus(jobId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Submission failed");
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }, [walletAddress, stopRun]);

  return {
    isTracking,
    permissionGranted,
    error,
    isSubmitting,
    currentPosition,
    routePoints,
    distanceThisSession,
    startTracking,
    stopTracking,
    // Legacy aliases for existing components
    start: startTracking,
    stop: stopTracking,
    currentPoints: routePoints,
  };
}
