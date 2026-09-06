import { useEffect, useMemo, useRef } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { MovenMap, type MovenMapHandle } from "./map/MovenMap";
import { Button } from "./Button";
import { useMapArea } from "@/hooks/useMapArea";
import { areaCells, currentCellKey, type OverlayCell } from "@/lib/mapCells";
import { colors, spacing, type } from "@/theme";

const EMPTY_CELLS: readonly OverlayCell[] = [];

/**
 * The map on Home and Territory: the player's own area, the grid over it, and
 * whatever ground they have recorded.
 *
 * The position goes in as `currentLocation` and never as a one-point route.
 * Passing it as `points` made the player's position and the app's route
 * evidence the same value, so a browsing fix on Home was indistinguishable — to
 * the map — from the first fix of a walk, and the map's own marker, camera and
 * waiting overlay all hung off an array that on this screen never holds a
 * route.
 */
export function AreaMap({ cells = EMPTY_CELLS, onPressCell, style }: {
  cells?: readonly OverlayCell[];
  onPressCell?: (cell: OverlayCell) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const area = useMapArea();
  const map = useRef<MovenMapHandle>(null);
  // Each new point recenters, whether it came from entering the screen or from
  // an explicit Locate me. Ordinary renders and user pans never do.
  useEffect(() => { if (area.point) map.current?.recenter(); }, [area.point]);
  /* Keyed on the cell rather than the fix: while the player stays inside one
     cell the grid is identical, so a refreshed fix rebuilds no polygons. */
  const cellKey = currentCellKey(area.point);
  const overlay = useMemo(
    () => areaCells(cells, area.point),
    [cells, cellKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return <View style={[styles.root, style]}>
    <MovenMap key={area.viewportGeneration} ref={map} currentLocation={area.point} cells={overlay} onPressCell={onPressCell} live={!!area.point} showStartMarker={false} style={styles.map} accessibilityLabel="Map of your area and preview zones" />
    <View style={styles.controls}>
      <Text style={styles.status} accessibilityLiveRegion="polite">{area.status}</Text>
      <Button label="Locate me" icon="locate-outline" variant="ghost" loading={area.busy} onPress={() => void area.locate()} accessibilityHint="Uses one foreground location fix to center this map. Does not start a workout." />
    </View>
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: spacing.xs },
  map: { flex: 1, minHeight: 250 },
  controls: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" },
  status: { ...type.caption, color: colors.textDim, flexShrink: 1 },
});
