import { StyleSheet, View } from "react-native";
import { Hexagon } from "./Hexagon";
import { palette, spacing, tints } from "@/theme";

/**
 * A small abstract mark for a session with no route to show.
 *
 * Deliberately **not** a map. A share card or a summary panel with an empty
 * space in it looks unfinished, and the obvious fix — draw a little map, or a
 * little route — is the one thing that must not happen: a drawn line in the
 * slot where a real route goes reads as the route, and this component exists
 * precisely for the sessions that have none.
 *
 * So it is a hex and three ascending steps: the game's own shape, and a
 * progression that is legible as an emblem and illegible as geography. There
 * are no streets, no polyline, no coordinates and nothing that scales.
 */
export function RouteMotif({ size = 44 }: { size?: number }) {
  return (
    <View style={styles.root} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Hexagon size={size} color={tints.neutral} />
      <View style={styles.steps}>
        {[0.4, 0.7, 1].map((step) => (
          <View key={step} style={[styles.step, { height: 6 + step * 10, opacity: 0.35 + step * 0.4 }]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  steps: { flexDirection: "row", alignItems: "flex-end", gap: 4, paddingBottom: 4 },
  step: { width: 5, borderRadius: 3, backgroundColor: palette.silverTrail },
});
