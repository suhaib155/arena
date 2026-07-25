/**
 * Territory Map — the real MapLibre basemap with live territory.
 *
 * The existing `/territory/map` board stays as-is: it is an on-device summary
 * of your own zones and works everywhere, including Expo Go. This screen is the
 * real-world map, which needs a native development build and a configured tile
 * provider. Both entry points are offered rather than one replacing the other.
 *
 * All the interesting logic lives in `@/lib/territory/*` (debounce, staleness,
 * caching, reconciliation) and is unit-tested offline; this file is the shell.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { FloatingMapControl } from "@/components/FloatingMapControl";
import { MapLegend, type LegendItem } from "@/components/MapLegend";
import {
  isRealMapAvailable,
  MapUnavailable,
  MovenRunMap,
  type MapViewport,
  type MovenRunMapRef,
} from "@/components/map/MovenRunMap";
import { colors, radius, shadows, spacing, type } from "@/theme";
import { resolveMapConfig } from "@/config/map";
import {
  TERRITORY_LEGEND_ORDER,
  TERRITORY_STYLES,
} from "@/lib/territory/territoryStyle";
import {
  applyError,
  applyResponse,
  beginLoading,
  cellsToFeatureCollection,
  INITIAL_VIEW_STATE,
  RequestSequence,
  shouldRefetch,
  ViewportCache,
  VIEWPORT_RULES,
  type TerritoryViewState,
  type Viewport,
} from "@/lib/territory/viewport";
import { fetchTerritoryMap, TerritoryApiError } from "@/services/territoryApi";
import { tapFeedback } from "@/lib/haptics";

const LEGEND: LegendItem[] = TERRITORY_LEGEND_ORDER.map((relationship) => ({
  label: TERRITORY_STYLES[relationship].label,
  color: TERRITORY_STYLES[relationship].fill,
}));

export default function TerritoryLiveMapScreen() {
  const router = useRouter();
  const mapRef = useRef<MovenRunMapRef | null>(null);
  const cache = useRef(new ViewportCache()).current;
  const sequence = useRef(new RequestSequence()).current;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFetchedRef = useRef<Viewport | null>(null);

  const [state, setState] = useState<TerritoryViewState>(INITIAL_VIEW_STATE);
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const [showLegend, setShowLegend] = useState(true);

  const config = useMemo(() => resolveMapConfig(), []);
  const mapAvailable = useMemo(() => isRealMapAvailable(), []);

  const load = useCallback(
    async (viewport: Viewport) => {
      const cached = cache.get(viewport);
      if (cached) {
        setState((current) => applyResponse(current, cached));
        return;
      }

      const token = sequence.begin();
      setState(beginLoading);
      try {
        const result = await fetchTerritoryMap(viewport);
        // A response for a viewport the user has already panned away from is
        // discarded rather than overwriting the current one.
        if (!sequence.isCurrent(token)) return;
        cache.set(viewport, result.cells);
        setState((current) => applyResponse(current, result.cells));
      } catch (error) {
        if (!sequence.isCurrent(token)) return;
        const message =
          error instanceof TerritoryApiError
            ? error.message
            : "Couldn't load territory right now.";
        // Previously loaded territory stays on screen.
        setState((current) => applyError(current, message));
      }
    },
    [cache, sequence],
  );

  const onViewportChange = useCallback(
    (next: MapViewport) => {
      if (!shouldRefetch(lastFetchedRef.current, next)) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        lastFetchedRef.current = next;
        void load(next);
      }, VIEWPORT_RULES.debounceMs);
    },
    [load],
  );

  // Invalidate anything in flight when the screen goes away, so a late response
  // can't call setState on an unmounted screen.
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      sequence.cancelAll();
    },
    [sequence],
  );

  const territories = useMemo(() => cellsToFeatureCollection(state.cells), [state.cells]);
  const selected = state.cells.find((cell) => cell.cellId === selectedCellId) ?? null;

  if (!mapAvailable) {
    return (
      <Screen edgeTop>
        <Header onBack={() => router.back()} />
        <MapUnavailable style={styles.unavailable} />
        <View style={styles.footer}>
          <Button
            label="Open the local territory board"
            icon="grid-outline"
            variant="secondary"
            onPress={() => {
              tapFeedback();
              router.replace("/territory/map");
            }}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edgeTop>
      <Header onBack={() => router.back()} count={state.cells.length} />

      <View style={styles.mapWrap}>
        <MovenRunMap
          ref={mapRef}
          territories={territories}
          followUser={false}
          showUserLocation
          onViewportChange={onViewportChange}
          onSelectTerritory={setSelectedCellId}
          selectedCellId={selectedCellId}
          loading={state.loading}
          errorMessage={state.error}
          style={styles.map}
        />

        <View style={styles.floatingControls}>
          <FloatingMapControl
            icon="information-circle-outline"
            accessibilityLabel={showLegend ? "Hide legend" : "Show legend"}
            active={showLegend}
            onPress={() => {
              tapFeedback();
              setShowLegend((value) => !value);
            }}
          />
          <FloatingMapControl
            icon="locate-outline"
            accessibilityLabel="Recentre on my location"
            onPress={() => {
              tapFeedback();
              const centre = lastFetchedRef.current;
              if (!centre) return;
              mapRef.current?.recenter([
                (centre.west + centre.east) / 2,
                (centre.south + centre.north) / 2,
              ]);
            }}
          />
        </View>

        {showLegend && !selected ? (
          <View style={styles.legendWrap} pointerEvents="box-none">
            <MapLegend items={LEGEND} />
          </View>
        ) : null}

        {config.usingDevelopmentFallback ? (
          <View style={styles.devBanner}>
            <Ionicons name="construct-outline" size={13} color={colors.textDim} />
            <Text style={styles.devBannerText}>
              Development map style — set EXPO_PUBLIC_MAP_STYLE_URL for real streets.
            </Text>
          </View>
        ) : null}

        {state.empty && !state.loading && state.cells.length === 0 ? (
          <View style={styles.emptyBanner}>
            <Text style={styles.emptyTitle}>No territory here yet</Text>
            <Text style={styles.emptyText}>
              Nobody has captured anything in this area. Close a loop to be first.
            </Text>
          </View>
        ) : null}
      </View>

      {selected ? (
        <View style={styles.selectedPanel}>
          <View style={styles.selectedHead}>
            <View
              style={[
                styles.selectedSwatch,
                { backgroundColor: TERRITORY_STYLES[selected.relationship].fill },
              ]}
            />
            <View style={styles.selectedBody}>
              <Text style={styles.selectedLabel}>
                {TERRITORY_STYLES[selected.relationship].label} · {selected.state}
              </Text>
              <Text style={styles.selectedMeta}>
                Control {selected.controlScore} · Defence {selected.defenceScore}
              </Text>
            </View>
            <Pressable
              hitSlop={12}
              onPress={() => {
                tapFeedback();
                setSelectedCellId(null);
              }}
              accessibilityRole="button"
              accessibilityLabel="Clear selection"
            >
              <Ionicons name="close" size={20} color={colors.textDim} />
            </Pressable>
          </View>
          <Button
            label="Zone details"
            icon="information-circle-outline"
            variant="secondary"
            onPress={() => {
              tapFeedback();
              router.push({
                pathname: "/territory/[cellId]",
                params: { cellId: selected.cellId },
              });
            }}
          />
        </View>
      ) : (
        <View style={styles.footer}>
          <Button
            label="Start Territory Run"
            icon="walk"
            onPress={() => {
              tapFeedback();
              router.push("/move");
            }}
          />
        </View>
      )}
    </Screen>
  );
}

function Header({ onBack, count }: { onBack: () => void; count?: number }) {
  return (
    <View style={styles.headerRow}>
      <Pressable hitSlop={12} onPress={onBack} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={22} color={colors.text} />
      </Pressable>
      <Text style={styles.headerTitle}>Territory Map</Text>
      {count !== undefined ? (
        <View style={styles.headerStat}>
          <Text style={styles.headerStatValue}>{count}</Text>
          <Text style={styles.headerStatLabel}>zones</Text>
        </View>
      ) : (
        <View style={styles.backBtn} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...type.heading, fontSize: 17 },
  headerStat: { alignItems: "center", minWidth: 40 },
  headerStatValue: { ...type.heading, fontSize: 16, fontVariant: ["tabular-nums"] },
  headerStatLabel: { ...type.caption, fontSize: 9.5, textTransform: "uppercase", letterSpacing: 0.5 },

  mapWrap: { flex: 1, borderRadius: radius.lg, overflow: "hidden" },
  map: { flex: 1 },
  unavailable: { flex: 1, marginVertical: spacing.md },

  floatingControls: { position: "absolute", top: spacing.md, right: spacing.md, gap: spacing.sm },
  legendWrap: { position: "absolute", left: 0, right: 0, bottom: spacing.md, alignItems: "center" },

  devBanner: {
    position: "absolute",
    top: spacing.md,
    left: spacing.md,
    right: 60,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
  },
  devBannerText: { flex: 1, ...type.caption, fontSize: 10.5 },

  emptyBanner: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    top: "40%",
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  emptyTitle: { ...type.heading, fontSize: 15 },
  emptyText: { ...type.caption, fontSize: 12.5, lineHeight: 17 },

  selectedPanel: {
    marginTop: spacing.md,
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  selectedHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  selectedSwatch: { width: 26, height: 26, borderRadius: radius.sm },
  selectedBody: { flex: 1, gap: 2 },
  selectedLabel: { ...type.heading, fontSize: 14.5, textTransform: "capitalize" },
  selectedMeta: { ...type.caption, fontSize: 12 },

  footer: { paddingVertical: spacing.md },
});
