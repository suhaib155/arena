/**
 * MovenRunMap — the real MapLibre basemap with territory + live-route overlays.
 *
 * ## Expo Go
 * `@maplibre/maplibre-react-native` is a **native module**. It is not part of the
 * Expo Go runtime, and importing it there throws at module-evaluation time
 * (`MLRNModule.ts` does `Object.create(NativeModules.MLRNModule)`). This
 * component therefore resolves the module lazily inside a `try/catch` and
 * renders `MapUnavailable` instead of crashing the app. A **native development
 * build** (`eas build --profile development`) is required to see a real map —
 * see `movenrun/docs/REAL_MAP_TERRITORY_SETUP.md`.
 *
 * ## Rendering model (see PHASE 17 — performance)
 * Territories are drawn as **one** `ShapeSource` feeding a native `FillLayer` +
 * `LineLayer`, styled entirely by MapLibre `match` expressions over each
 * feature's `relationship` property. One React component per cell is never
 * mounted, so a viewport with a thousand cells still renders in two layers.
 *
 * ## Authority
 * This component only *renders* what it is given. It never decides ownership —
 * relationship/state always arrives from the backend.
 */
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { Feature, FeatureCollection, LineString, Position } from "geojson";
import type * as MapLibreTypes from "@maplibre/maplibre-react-native";
import { colors, palette, radius, spacing, type } from "@/theme";
import { MAP_DEFAULTS, MAP_RENDER_DEFAULTS, resolveMapConfig } from "@/config/map";
import {
  territoryFillColorExpression,
  territoryFillOpacityExpression,
  territoryOutlineColorExpression,
  territoryOutlineWidthExpression,
} from "@/lib/territory/territoryStyle";

type MapLibreModule = typeof MapLibreTypes;

/** Resolved once per JS runtime. `null` = native module unavailable. */
let mapLibreModule: MapLibreModule | null | undefined;

/**
 * Lazily resolve the native MapLibre module. Exported so screens can decide
 * whether to offer a "real map" entry point at all.
 */
export function loadMapLibre(): MapLibreModule | null {
  if (mapLibreModule !== undefined) return mapLibreModule;
  try {
    // Not a static import: in Expo Go this throws, and a static import would
    // take the whole bundle down before any error boundary could run.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const resolved = require("@maplibre/maplibre-react-native") as Partial<MapLibreModule>;
    // Guard against a module that loaded but registered nothing (a native build
    // where autolinking didn't run): the declared types say `MapView` is always
    // present, so the check has to go through the partial view above.
    mapLibreModule = resolved.MapView ? (resolved as MapLibreModule) : null;
  } catch {
    mapLibreModule = null;
  }
  return mapLibreModule;
}

export function isRealMapAvailable(): boolean {
  return loadMapLibre() !== null;
}

/** Map viewport in the same west/south/east/north shape the territory API takes. */
export interface MapViewport {
  west: number;
  south: number;
  east: number;
  north: number;
  zoom: number;
}

export interface MovenRunMapRef {
  /** Recentre on a coordinate (`[longitude, latitude]`). */
  recenter: (coordinate: Position) => void;
}

export interface MovenRunMapProps {
  /** Territory polygons, already carrying a `relationship` property per feature. */
  territories?: FeatureCollection | null;
  /** The live/finished route as a LineString feature. */
  route?: Feature<LineString> | null;
  /** Keep the camera locked to the runner. */
  followUser?: boolean;
  /** Show the blue user-location puck. */
  showUserLocation?: boolean;
  /** Initial camera centre, `[longitude, latitude]`. */
  initialCenter?: Position;
  initialZoom?: number;
  /** Fired (already debounced by MapLibre) when the visible region settles. */
  onViewportChange?: (viewport: MapViewport) => void;
  /**
   * Fired when the *user* moves the map — pan, pinch or rotate — as opposed to
   * a programmatic camera move (D4). The live map uses this to drop follow
   * mode: a camera that fights the user's pan is worse than one that never
   * follows at all.
   */
  onUserGesture?: () => void;
  /** Fired with the tapped territory's `cellId`, or null when the tap missed. */
  onSelectTerritory?: (cellId: string | null) => void;
  /** Currently selected cell — drawn with a heavier outline. */
  selectedCellId?: string | null;
  /** Shown as a non-blocking overlay while territory data is in flight. */
  loading?: boolean;
  /** Rendered as a dismissable banner over the map. */
  errorMessage?: string | null;
  style?: object;
  /** Test seam: inject a stub module instead of the native one. */
  moduleOverride?: MapLibreModule | null;
}

const EMPTY_COLLECTION: FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * Convert MapLibre's `visibleBounds` ([northEast, southWest]) into the
 * west/south/east/north shape the territory API expects. Exported for tests —
 * getting this mapping wrong silently queries the wrong half of the world.
 */
export function boundsToViewport(
  visibleBounds: [Position, Position],
  zoom: number,
): MapViewport {
  const [northEast, southWest] = visibleBounds;
  // MapLibre positions are GeoJSON order: [longitude, latitude].
  const [east, north] = northEast;
  const [west, south] = southWest;
  return { west, south, east, north, zoom };
}

export const MovenRunMap = forwardRef<MovenRunMapRef, MovenRunMapProps>(function MovenRunMap(
  {
    territories,
    route,
    followUser = false,
    showUserLocation = true,
    initialCenter,
    initialZoom = MAP_DEFAULTS.zoom,
    onViewportChange,
    onUserGesture,
    onSelectTerritory,
    selectedCellId = null,
    loading = false,
    errorMessage = null,
    style,
    moduleOverride,
  },
  ref,
) {
  const MapLibre = moduleOverride !== undefined ? moduleOverride : loadMapLibre();
  const cameraRef = useRef<MapLibreTypes.CameraRef | null>(null);
  const [styleLoaded, setStyleLoaded] = useState(false);
  const [styleFailed, setStyleFailed] = useState(false);
  const config = useMemo(() => resolveMapConfig(), []);

  useImperativeHandle(
    ref,
    () => ({
      recenter: (coordinate: Position) => {
        cameraRef.current?.setCamera({
          centerCoordinate: coordinate,
          zoomLevel: MAP_DEFAULTS.followZoom,
          animationDuration: MAP_DEFAULTS.animationDurationMs,
        });
      },
    }),
    [],
  );

  const handleRegionDidChange = useCallback(
    (feature: { properties: MapLibreTypes.RegionPayload }) => {
      if (!onViewportChange) return;
      const payload = feature?.properties;
      if (!payload?.visibleBounds) return;
      onViewportChange(
        boundsToViewport(
          payload.visibleBounds as [Position, Position],
          payload.zoomLevel,
        ),
      );
    },
    [onViewportChange],
  );

  /**
   * `isUserInteraction` is what separates a pan from the camera move we just
   * asked for ourselves (D4). Without that check, calling `recenter` would
   * immediately report a "gesture" and cancel its own follow.
   */
  const handleRegionWillChange = useCallback(
    (feature: { properties: MapLibreTypes.RegionPayload }) => {
      if (feature?.properties?.isUserInteraction) onUserGesture?.();
    },
    [onUserGesture],
  );

  const handleTerritoryPress = useCallback(
    (event: MapLibreTypes.OnPressEvent) => {
      if (!onSelectTerritory) return;
      const cellId = event?.features?.[0]?.properties?.cellId;
      onSelectTerritory(typeof cellId === "string" ? cellId : null);
    },
    [onSelectTerritory],
  );

  const handleMapPress = useCallback(() => {
    onSelectTerritory?.(null);
  }, [onSelectTerritory]);

  if (!MapLibre) {
    return <MapUnavailable style={style} />;
  }

  const {
    MapView,
    Camera,
    UserLocation,
    ShapeSource,
    FillLayer,
    LineLayer,
    UserTrackingMode,
  } = MapLibre;

  return (
    <View style={[styles.container, style]}>
      <MapView
        style={StyleSheet.absoluteFill}
        mapStyle={config.styleUrl}
        // Deliberately sparse chrome: attribution stays (licence requirement),
        // logo/compass/pitch/rotation go — the map is a game board, not an atlas.
        attributionEnabled
        logoEnabled={false}
        compassEnabled={false}
        pitchEnabled={false}
        rotateEnabled={false}
        regionDidChangeDebounceTime={250}
        onRegionWillChange={handleRegionWillChange}
        onRegionDidChange={handleRegionDidChange}
        onDidFinishLoadingStyle={() => setStyleLoaded(true)}
        onDidFailLoadingMap={() => setStyleFailed(true)}
        onPress={handleMapPress}
      >
        <Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: initialCenter ?? [...MAP_DEFAULTS.fallbackCenter],
            zoomLevel: initialZoom,
            pitch: MAP_DEFAULTS.pitch,
          }}
          minZoomLevel={MAP_DEFAULTS.minZoom}
          maxZoomLevel={MAP_DEFAULTS.maxZoom}
          followUserLocation={followUser}
          followUserMode={UserTrackingMode.Follow}
          followZoomLevel={MAP_DEFAULTS.followZoom}
        />

        {showUserLocation ? <UserLocation visible animated /> : null}

        {/* Territory: one source, two native layers. Order matters — fills
            first so route + outlines draw above them. */}
        <ShapeSource
          id="movenrun-territories"
          shape={territories ?? EMPTY_COLLECTION}
          onPress={handleTerritoryPress}
        >
          <FillLayer
            id="movenrun-territory-fill"
            style={{
              fillColor: territoryFillColorExpression() as never,
              fillOpacity: territoryFillOpacityExpression() as never,
            }}
          />
          <LineLayer
            id="movenrun-territory-outline"
            style={{
              lineColor: territoryOutlineColorExpression() as never,
              lineWidth: selectedCellId
                ? ([
                    "case",
                    ["==", ["get", "cellId"], selectedCellId],
                    MAP_RENDER_DEFAULTS.selectedOutlineWidth,
                    territoryOutlineWidthExpression(),
                  ] as never)
                : (territoryOutlineWidthExpression() as never),
              lineJoin: "round",
              lineCap: "round",
            }}
          />
        </ShapeSource>

        {/* Route: a pale wide underlay keeps the line legible over any basemap,
            then the MovenRun mint line on top. */}
        {route ? (
          <ShapeSource id="movenrun-route" shape={route} lineMetrics>
            <LineLayer
              id="movenrun-route-underlay"
              style={{
                lineColor: "#FFFFFF",
                lineOpacity: 0.9,
                lineWidth: MAP_RENDER_DEFAULTS.routeUnderlayWidth,
                lineJoin: "round",
                lineCap: "round",
              }}
            />
            <LineLayer
              id="movenrun-route-line"
              style={{
                lineColor: palette.pulseGreen,
                lineWidth: MAP_RENDER_DEFAULTS.routeLineWidth,
                lineJoin: "round",
                lineCap: "round",
              }}
            />
          </ShapeSource>
        ) : null}
      </MapView>

      {/* Loading never blocks the map: already-rendered territory stays visible. */}
      {!styleLoaded && !styleFailed ? (
        <View style={styles.blockingOverlay} accessibilityLabel="Loading map">
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.overlayText}>Loading map…</Text>
        </View>
      ) : null}

      {loading && styleLoaded ? (
        <View style={styles.loadingPill} accessibilityLabel="Loading territory">
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.loadingPillText}>Updating territory…</Text>
        </View>
      ) : null}

      {styleFailed ? (
        <View style={styles.errorBanner} accessibilityLabel="Map failed to load">
          <Text style={styles.errorTitle}>Map couldn't load</Text>
          <Text style={styles.errorBody}>
            {config.usingDevelopmentFallback
              ? "No map style URL is configured, so the development placeholder style was used. Set EXPO_PUBLIC_MAP_STYLE_URL to a real provider."
              : "The configured map style couldn't be reached. Check your connection and the style URL."}
          </Text>
        </View>
      ) : null}

      {errorMessage ? (
        <View style={styles.errorBanner} accessibilityLabel={errorMessage}>
          <Text style={styles.errorBody}>{errorMessage}</Text>
        </View>
      ) : null}
    </View>
  );
});

/**
 * Shown when the native MapLibre module isn't present — the Expo Go case, and
 * any build where the config plugin hasn't run. Honest about *why*, and never
 * pretends a map is there.
 */
export function MapUnavailable({ style }: { style?: object }) {
  return (
    <View style={[styles.container, styles.unavailable, style]}>
      <Text style={styles.unavailableTitle}>Real map needs a native build</Text>
      <Text style={styles.unavailableBody}>
        The MapLibre basemap is a native module, so it can't run in Expo Go. Run a
        development build (eas build --profile development) to see live territory
        on a real street map.
      </Text>
      <Text style={styles.unavailableHint}>
        Everything else — route recording, capture rules, territory data — works
        without it.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: "hidden",
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceAlt,
  },
  blockingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
  },
  overlayText: { ...type.caption, fontSize: 12.5 },
  loadingPill: {
    position: "absolute",
    top: spacing.md,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
  },
  loadingPillText: { ...type.caption, fontSize: 11.5, fontWeight: "600" },
  errorBanner: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorTitle: { ...type.heading, fontSize: 14 },
  errorBody: { ...type.caption, fontSize: 12, lineHeight: 16 },
  unavailable: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.xl,
  },
  unavailableTitle: { ...type.heading, fontSize: 15, textAlign: "center" },
  unavailableBody: {
    ...type.caption,
    fontSize: 12.5,
    lineHeight: 17,
    textAlign: "center",
  },
  unavailableHint: {
    ...type.caption,
    fontSize: 11.5,
    color: colors.textFaint,
    textAlign: "center",
  },
});
