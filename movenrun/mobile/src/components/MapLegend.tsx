import { StyleSheet, Text, View } from "react-native";
import { colors, radius, shadows, spacing, type } from "@/theme";

export interface LegendItem {
  label: string;
  color: string;
}

interface MapLegendProps {
  items: LegendItem[];
}

/**
 * Compact, sunlit-glass legend for the territory board. Each entry pairs a
 * colour swatch with a text label, so zone state is always readable without
 * relying on colour perception.
 */
export function MapLegend({ items }: MapLegendProps) {
  return (
    <View style={styles.legend}>
      {items.map((it) => (
        <View key={it.label} style={styles.item}>
          <View style={[styles.dot, { backgroundColor: it.color }]} />
          <Text style={styles.label}>{it.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    ...shadows.card,
  },
  item: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  label: { ...type.caption, fontSize: 11, color: colors.textDim },
});
