import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import * as Location from "expo-location";
import type { TrackPoint } from "@/lib/geo";
import { captureVerificationScope, isVerificationScopeCurrent, onVerificationPrivacyReset } from "@/services/verificationPrivacy";

/** One explicitly requested foreground map fix. Never workout evidence or storage. */
export function useMapArea() {
  const [point, setPoint] = useState<TrackPoint | null>(null);
  const [status, setStatus] = useState("Find your area");
  const [busy, setBusy] = useState(false);
  const [viewportGeneration, setViewportGeneration] = useState(0);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const clear = useCallback(() => {
    generation.current++;
    setViewportGeneration(generation.current);
    inFlight.current = false;
    setPoint(null);
    setBusy(false);
    setStatus("Find your area");
  }, []);
  useFocusEffect(useCallback(() => () => clear(), [clear]));
  useEffect(() => {
    const offPrivacy = onVerificationPrivacyReset(clear);
    const appState = AppState.addEventListener("change", state => { if (state !== "active") clear(); });
    return () => { generation.current++; offPrivacy(); appState.remove(); };
  }, [clear]);
  const locate = useCallback(async () => {
    if (inFlight.current || AppState.currentState !== "active") return;
    inFlight.current = true;
    const request = ++generation.current;
    const scope = captureVerificationScope(null);
    const current = () => request === generation.current && isVerificationScopeCurrent(scope) && AppState.currentState === "active";
    setBusy(true);
    setStatus("Locating your area…");
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          const permission = await Location.requestForegroundPermissionsAsync();
          if (!current()) return;
          if (permission.status !== "granted") { setStatus("Location permission needed"); return; }
          const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          if (!current()) return;
          const { latitude, longitude, accuracy } = fix.coords;
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 ||
              !Number.isFinite(fix.timestamp) || fix.timestamp <= 0 || (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0))) throw new Error("unavailable");
          setPoint({ latitude, longitude, timestamp: fix.timestamp, accuracy: accuracy ?? null });
          setStatus("Your area");
        })(),
        new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(() => reject(new Error("Map acquisition timed out")), 20000);
        }),
      ]);
    } catch { if (current()) setStatus("Area unavailable · try again"); }
    finally {
      if (deadline !== undefined) clearTimeout(deadline);
      // Native one-fix promises cannot be canceled. Invalidate their late result,
      // including after timeout, without allowing it to overwrite a new request.
      if (request === generation.current) {
        generation.current++;
        inFlight.current = false;
        setBusy(false);
      }
    }
  }, []);
  return { point, status, busy, locate, viewportGeneration };
}
