/**
 * The one foreground fix an area map is allowed to hold.
 *
 * ## Why this exists at all
 *
 * Home and Territory show the player's area. That needs a position, and a
 * position obtained here must not be able to leak into the movement game: it is
 * browsing, not evidence. So it is never persisted, never watched, never
 * submitted, and never distance. It is one fix, held in memory, erased the
 * moment the screen loses focus, the app leaves the foreground, or the privacy
 * generation turns over.
 *
 * ## Why it now acquires without being asked
 *
 * It used to acquire only on an explicit `Locate me` tap. On a device that had
 * already granted foreground permission that meant opening Home and being shown
 * a world-scale basemap centred on nothing, every single visit, with the app
 * fully able to answer the question and simply not asking. `Locate me` remains
 * — as a recentre and a recovery — but it is no longer the only way to see your
 * own area.
 *
 * The line this keeps is about *prompting*, not about locating. The automatic
 * path reads the permission it already has ({@link Location.getForegroundPermissionsAsync},
 * which does not prompt) and stops silently when it does not have it. Only the
 * explicit tap requests permission, so an ungranted device is never nagged by a
 * screen it merely opened.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import * as Location from "expo-location";
import type { TrackPoint } from "@/lib/geo";
import { mapAreaTimings } from "@/lib/mapAreaTimings";
import { captureVerificationScope, isVerificationScopeCurrent, onVerificationPrivacyReset } from "@/services/verificationPrivacy";

/**
 * How old a cached OS fix may be and still be worth showing while a current one
 * is acquired.
 *
 * The point of the seed is to replace an arbitrary continent with the player's
 * own neighbourhood in the time it takes the map to draw, not to present stale
 * geography as current. Two minutes is short enough that the seed and the fix
 * that replaces it are the same area on any plausible walk.
 */
export const SEED_MAX_AGE_MS = 120_000;

/** How long one acquisition attempt may run before the UI is released. */
export const AREA_FIX_TIMEOUT_MS = 20_000;

/** A native fix, validated. Null when it is not honest geography. */
function validate(fix: Location.LocationObject | null): TrackPoint | null {
  if (!fix) return null;
  const { latitude, longitude, accuracy } = fix.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180 ||
      !Number.isFinite(fix.timestamp) || fix.timestamp <= 0 ||
      (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0))) return null;
  return { latitude, longitude, timestamp: fix.timestamp, accuracy: accuracy ?? null };
}

/** One explicitly requested foreground map fix. Never workout evidence or storage. */
export function useMapArea() {
  const [point, setPoint] = useState<TrackPoint | null>(null);
  const [status, setStatus] = useState("Find your area");
  const [busy, setBusy] = useState(false);
  const [viewportGeneration, setViewportGeneration] = useState(0);
  const generation = useRef(0);
  const inFlight = useRef(false);
  /* What is on the map right now, readable from inside an async attempt. The
     state value itself is captured stale by the closure that needs it. */
  const shown = useRef<TrackPoint | null>(null);
  const show = useCallback((next: TrackPoint | null) => {
    shown.current = next;
    setPoint(next);
  }, []);
  const clear = useCallback(() => {
    generation.current++;
    setViewportGeneration(generation.current);
    inFlight.current = false;
    show(null);
    setBusy(false);
    setStatus("Find your area");
  }, [show]);
  useEffect(() => {
    const offPrivacy = onVerificationPrivacyReset(clear);
    return () => { generation.current++; offPrivacy(); };
  }, [clear]);

  /**
   * Acquire one fix.
   *
   * `prompt` is the whole difference between the button and the automatic
   * path: with it, permission is *requested*; without it, permission is only
   * *read*, and a screen that lacks it does nothing rather than asking again.
   */
  const acquire = useCallback(async ({ prompt }: { prompt: boolean }) => {
    if (inFlight.current || AppState.currentState !== "active") return;
    inFlight.current = true;
    const request = ++generation.current;
    const scope = captureVerificationScope(null);
    const current = () => request === generation.current && isVerificationScopeCurrent(scope) && AppState.currentState === "active";
    mapAreaTimings.begin(prompt);
    setBusy(true);
    setStatus("Locating your area…");
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          const permission = prompt
            ? await Location.requestForegroundPermissionsAsync()
            : await Location.getForegroundPermissionsAsync();
          if (!current()) return;
          mapAreaTimings.permission(permission.status === "granted");
          if (permission.status !== "granted") {
            // Silent on the automatic path: a screen the player merely opened
            // does not get to explain a permission they were never asked for.
            if (prompt) setStatus("Location permission needed");
            else setStatus("Find your area");
            return;
          }
          /* A cached fix first, so an already-permitted screen shows the
             player's own area immediately instead of a world view held for the
             length of a cold GPS acquisition. It is replaced, not kept, by the
             current fix below. */
          const seed = validate(await Location.getLastKnownPositionAsync({ maxAge: SEED_MAX_AGE_MS }).catch(() => null));
          if (!current()) return;
          if (seed) { mapAreaTimings.seed(); show(seed); setStatus("Your area"); }
          mapAreaTimings.requested();
          const fix = validate(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
          if (!current()) return;
          mapAreaTimings.fix(fix !== null);
          if (fix === null) throw new Error("unavailable");
          show(fix);
          setStatus("Your area");
        })(),
        new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(() => reject(new Error("Map acquisition timed out")), AREA_FIX_TIMEOUT_MS);
        }),
      ]);
    } catch {
      /* A seed already on screen is the player's real area and survives a
         failed refresh — replacing it with an error would take away correct
         geography in order to report that better geography did not arrive. */
      if (current()) {
        mapAreaTimings.failed();
        setStatus(shown.current === null ? "Area unavailable · try again" : "Your area");
      }
    }
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
  }, [show]);

  const locate = useCallback(() => acquire({ prompt: true }), [acquire]);

  /**
   * Entering the screen acquires; leaving it erases.
   *
   * Both halves matter. Without the first, an already-permitted player is shown
   * a map of nowhere until they find the button. Without the second, a position
   * outlives the screen that was allowed to have it.
   */
  useFocusEffect(useCallback(() => {
    void acquire({ prompt: false });
    return () => clear();
  }, [acquire, clear]));

  /* Foregrounding is a fresh visit: the point was erased on the way out, and a
     player who has walked while the app was away is somewhere else now. */
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => {
      if (state !== "active") clear();
      else void acquire({ prompt: false });
    });
    return () => subscription.remove();
  }, [acquire, clear]);

  return { point, status, busy, locate, viewportGeneration };
}
