import { useEffect, useMemo, useRef } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { MovenMap, type MovenMapHandle } from "./map/MovenMap";
import { Button } from "./Button";
import { useMapArea } from "@/hooks/useMapArea";
import { contextCells, type OverlayCell } from "@/lib/mapCells";
import { colors, spacing, type } from "@/theme";

const EMPTY_CELLS: readonly OverlayCell[] = [];
export function AreaMap({ cells = EMPTY_CELLS, onPressCell, style }: {
  cells?: readonly OverlayCell[];
  onPressCell?: (cell: OverlayCell) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const area = useMapArea();
  const map = useRef<MovenMapHandle>(null);
  // Each new point comes only from an explicit Locate me request. Ordinary
  // renders and user pans never recenter this map.
  useEffect(() => { if (area.point) map.current?.recenter(); }, [area.point]);
  const points = useMemo(() => area.point ? [area.point] : [], [area.point]);
  const overlay = useMemo(() => cells.length ? cells : contextCells(area.point), [cells, area.point]);
  return <View style={[styles.root, style]}>
    <MovenMap key={area.viewportGeneration} ref={map} points={points} cells={overlay} onPressCell={onPressCell} live={!!area.point} showStartMarker={false} style={styles.map} accessibilityLabel="Map of your area and preview zones" />
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
