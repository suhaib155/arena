/**
 * The app's map. Every screen that shows geography goes through this.
 *
 * It owns four things no screen should own for itself: whether a real basemap
 * is available at all, which provider draws it, what the camera is allowed to
 * do, and what is said when there is no map. Screens supply a route, some
 * cells, and a size.
 *
 * ## Honest failure
 *
 * If this build has no Google Maps key, the map does not render and a panel
 * says so — see `lib/mapAvailability.ts` for why a missing key is otherwise
 * invisible. There is no drawn stand-in. The app used to have one and it was
 * fine as an illustration; as a *fallback* it would put painted roads under a
 * real route and invite every viewer to read them as the streets the player
 * walked.
 *
 * ## Where the player is, and where the player went
 *
 * These are two inputs, not one. `currentLocation` is where the player is
 * standing; `points` is the route that has been recorded as evidence. The
 * marker, the follow camera and the waiting overlay all read the first; the
 * polyline and the start marker read the second.
 *
 * Deriving position from the head of the route — which this map used to do —
 * looks equivalent and is not, because the two genuinely disagree. A player
 * standing still has a position and no new evidence: the session watch wakes
 * on displacement, so the route stops growing while they wait at a crossing or
 * finish acquiring a signal. On a physical build that produced a map at world
 * scale, with no marker and a `Waiting for your first location fix…` overlay,
 * for a player the app could already locate to within a few metres.
 *
 * The separation runs the other way too: a display fix may never become
 * geometry. Nothing this map is handed as `currentLocation` is measured,
 * sealed, submitted or turned into ground.
 *
 * ## What is not drawn
 *
 * - `showsUserLocation` is off: the OS dot is a second, disagreeing opinion
 *   about where the player is. See `CurrentLocationMarker`.
 * - `toolbarEnabled` is off: Google's Navigate / Open-in-Maps buttons appear on
 *   marker press and hand the player to another app mid-session.
 * - No traffic layer, no buildings layer, no points of interest we did not put
 *   there. The map shows ground, the route and the grid.
 */
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef } from "react";
import { Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";

import { colors, radius, spacing, type } from "@/theme";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import {
  mapAvailability,
  mapUnavailableMessage,
  type MapConfigSlice,
  type MapPlatform,
} from "@/lib/mapAvailability";
import { regionForPoints, routeHead, routeStart, toLatLng, type LatLng } from "@/lib/mapGeometry";
import { cellCoordinates } from "@/lib/mapCells";
import type { TrackPoint } from "@/lib/geo";
import type { PauseSource } from "@movenrun/shared/sealing";
import { FloatingMapControl } from "@/components/FloatingMapControl";

import { MapView, PROVIDER_DEFAULT, PROVIDER_GOOGLE } from "./provider";
import { H3Overlay, type OverlayCell } from "./H3Overlay";
import { RoutePolyline } from "./RoutePolyline";
import { CurrentLocationMarker } from "./CurrentLocationMarker";
import { StartMarker } from "./StartMarker";
import { useMapCamera } from "./useMapCamera";

/** What a screen can ask the map to do imperatively. */
export interface MovenMapHandle {
  /** Frame the whole recorded route. */
  fitRoute(): void;
  /** Follow the player again. */
  recenter(): void;
  /**
   * Capture the map as an image file, for the share card.
   *
   * Resolves to a local file URI, or null when there is no map to capture. It
   * never resolves to a placeholder image: a share card with no map shows no
   * map.
   */
  capture(): Promise<string | null>;
}

interface MovenMapProps {
  /**
   * The recorded route. Break-aware — see `RoutePolyline`.
   *
   * Optional: a map can show ground without a walk on it. The Territory screen
   * passes cells and no points.
   */
  points?: readonly TrackPoint[];
  /**
   * Where the player is now, independent of the route.
   *
   * Drives the marker, the follow camera and whether the waiting overlay is
   * shown. Null means the map genuinely does not know — it is never filled in
   * with a last-known fix, a route head or a default coordinate. When it is
   * null the map falls back to the head of `points`, which is the honest answer
   * for a *finished* route being reviewed, and no answer at all for an empty
   * one.
   */
  currentLocation?: TrackPoint | null;
  /** Session pauses, so the drawn line breaks where the measured route does. */
  pauses?: PauseSource;
  /** H3 context. Memoise in the caller. */
  cells?: readonly OverlayCell[];
  /** Make the cells tappable. Omit for a purely contextual grid. */
  onPressCell?: (cell: OverlayCell) => void;
  /**
   * A session is being recorded: show the live head marker and follow it.
   * Off for a finished route, which is framed once and left alone.
   */
  live?: boolean;
  showStartMarker?: boolean;
  /** Capture is paused. Only affects how the head marker reads. */
  paused?: boolean;
  /** Allow panning and zooming, and show the camera controls. */
  interactive?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Describes the map to a screen reader. */
  accessibilityLabel?: string;
}

function currentPlatform(): MapPlatform {
  if (Platform.OS === "android") return "android";
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "web") return "web";
  return "unknown";
}

/**
 * The Expo config as this module needs to read it.
 *
 * Expo exposes the non-secret availability flag while stripping the native
 * key. Narrowing here — once, in one place — keeps
 * `mapAvailability` free of Expo's types and testable on plain Node.
 */
function mapConfigSlice(): MapConfigSlice | null {
  const config = Constants.expoConfig as MapConfigSlice | null | undefined;
  return config ?? null;
}

function MovenMapView(
  {
    points = [],
    currentLocation = null,
    pauses = [],
    cells = [],
    onPressCell,
    live = false,
    showStartMarker = true,
    paused = false,
    interactive = true,
    style,
    accessibilityLabel = "Map of your route",
  }: MovenMapProps,
  ref: React.Ref<MovenMapHandle>,
) {
  const reducedMotion = useReducedMotion();
  const mapRef = useRef<MapView | null>(null);
  const mapLoaded = useRef(false);

  const availability = useMemo(
    () => mapAvailability(currentPlatform(), mapConfigSlice()),
    [],
  );

  /* Where the player is. The current location when there is one, otherwise the
     last recorded fix — which is what "here" means for a route being reviewed
     after the fact, and null for a route that does not exist yet. */
  const head = useMemo(() => {
    const point = currentLocation ?? routeHead(points);
    return point === null ? null : toLatLng(point);
  }, [currentLocation, points]);
  /* Where the route began. Route evidence only: a display fix is not a start
     line, so a map that has a position but no recorded route shows no start
     marker. */
  const start = useMemo(() => {
    const point = routeStart(points);
    return point === null ? null : toLatLng(point);
  }, [points]);

  /* A finished route is framed once and then left where the player puts it, so
     it starts free. A live session follows until the player says otherwise. */
  const camera = useMapCamera({
    head: live ? head : null,
    reducedMotion,
    initialMode: live ? "following" : "free",
    followEnabled: live,
  });

  /**
   * The viewport the map opens on.
   *
   * Captured once, on the first render, because that is the only render at
   * which the native view reads it — `initialRegion` is by contract the
   * *initial* region, and recomputing it later would be a value nothing
   * consumes. Every subsequent framing is a camera command instead.
   *
   * Null when the route has no points yet: there is no honest place to point a
   * camera at a route that does not exist, so the map opens wide and the
   * follow camera arrives with the first accepted fix.
   */
  const initialRegionRef = useRef<ReturnType<typeof regionForPoints> | undefined>(undefined);
  if (initialRegionRef.current === undefined) {
    /* A route frames the camera when there is one. When there is not — the
       Territory map, which shows ground rather than a walk — the cells do.
       Both empty means no viewport, and the map opens wide rather than
       pointing somewhere the player has never been. */
    const framing =
      points.length > 0
        ? points.map(toLatLng)
        : currentLocation !== null
          ? [toLatLng(currentLocation)]
          : cellCoordinates(cells);
    initialRegionRef.current = regionForPoints(framing);
  }

  const routeCoordinates = useMemo(() => points.map(toLatLng), [points]);
  /* What "fit" means depends on what the map is showing: the route where there
     is one, otherwise the ground. */
  const fitTarget = useMemo(
    () => (points.length > 0 ? routeCoordinates : cellCoordinates(cells)),
    [points.length, routeCoordinates, cells],
  );

  /* Stable, so React does not detach and re-attach the camera on every render.
     An inline arrow here would hand the camera a null target and then a fresh
     one each time the screen re-rendered, clearing the memo that stops the
     follow camera animating for sub-metre changes. */
  const attachMap = useCallback(
    (instance: MapView | null) => {
      mapRef.current = instance;
      if (instance === null) mapLoaded.current = false;
      camera.attach(instance);
    },
    [camera.attach],
  );

  useImperativeHandle(
    ref,
    () => ({
      fitRoute: () => camera.fitRoute(fitTarget),
      recenter: () => camera.recenter(),
      capture: async () => {
        const map = mapRef.current;
        if (map === null || availability.status !== "ready" || !mapLoaded.current) return null;
        try {
          return await map.takeSnapshot({ format: "png", result: "file" });
        } catch {
          /* A failed capture is a missing image, never a fabricated one. The
             caller shows the card without a map rather than with a stand-in. */
          return null;
        }
      },
    }),
    [camera, fitTarget, availability.status],
  );

  const unavailable = mapUnavailableMessage(availability);
  if (unavailable !== null) {
    return (
      <View style={[styles.container, styles.unavailable, style]} accessibilityRole="alert">
        <Ionicons name="map-outline" size={26} color={colors.textFaint} />
        <Text style={styles.unavailableText}>{unavailable}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, style]}>
      <MapView
        ref={attachMap}
        onMapReady={camera.onReady}
        onMapLoaded={() => { mapLoaded.current = true; }}
        style={StyleSheet.absoluteFill}
        /* Google on Android is the only provider with a key configured; iOS
           uses Apple Maps, which needs none. */
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
        initialRegion={initialRegionRef.current ?? undefined}
        onPanDrag={interactive ? camera.onUserPan : undefined}
        scrollEnabled={interactive}
        zoomEnabled={interactive}
        rotateEnabled={false}
        pitchEnabled={false}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        showsTraffic={false}
        showsBuildings={false}
        showsIndoors={false}
        toolbarEnabled={false}
        accessibilityLabel={accessibilityLabel}
      >
        <H3Overlay cells={cells} onPressCell={onPressCell} />
        <RoutePolyline points={points} pauses={pauses} />
        {showStartMarker && start !== null ? <StartMarker coordinate={start} /> : null}
        {live && head !== null ? (
          <CurrentLocationMarker coordinate={head} paused={paused} />
        ) : null}
      </MapView>

      {/* Depends on the position, not on the route. Keyed to `points` it said
          "waiting for your first location fix" to a player whose position was
          already on screen, simply because they had not moved far enough to
          record one. */}
      {live && head === null ? (
        <View style={styles.waiting} pointerEvents="none" accessibilityLiveRegion="polite">
          <Text style={styles.waitingText}>Waiting for your first location fix…</Text>
        </View>
      ) : null}

      {interactive ? (
        <View style={styles.controls}>
          {/* Only offered once it would do something: while the camera is
              already following, a recentre control is a button that does
              nothing, and a control that does nothing teaches the player to
              stop trusting the controls. */}
          {live && camera.mode === "free" ? (
            <FloatingMapControl
              icon="navigate"
              accessibilityLabel="Follow my position"
              onPress={camera.recenter}
            />
          ) : null}
          {fitTarget.length > 1 ? (
            <FloatingMapControl
              icon="scan-outline"
              accessibilityLabel={
                points.length > 1 ? "Fit the whole route on screen" : "Fit all your ground on screen"
              }
              onPress={() => camera.fitRoute(fitTarget)}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export const MovenMap = forwardRef<MovenMapHandle, MovenMapProps>(MovenMapView);

export type { OverlayCell, LatLng };

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.surfaceAlt,
  },
  unavailable: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.lg,
  },
  unavailableText: { ...type.caption, textAlign: "center" },
  waiting: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  waitingText: { ...type.caption, textAlign: "center" },
  controls: {
    position: "absolute",
    right: spacing.md,
    bottom: spacing.md,
    gap: spacing.sm,
  },
});
