import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, type } from "@/theme";

interface MovementMetricProps {
  value: string;
  label: string;
  /** "hero" for the single dominant metric; "tile" for the supporting row. */
  size?: "hero" | "tile";
  tint?: string;
}

/**
 * A single movement metric (value + label). One dominant `hero` metric plus a
 * row of `tile` metrics gives the Active Move and summary screens clear
 * hierarchy instead of a grid of equal numbers. Tabular figures keep the value
 * from jittering as it counts.
 */
export function MovementMetric({ value, label, size = "tile", tint }: MovementMetricProps) {
  const hero = size === "hero";
  return (
    <View style={hero ? styles.heroWrap : styles.tile} accessibilityLabel={`${label}: ${value}`}>
      <Text style={[hero ? styles.heroValue : styles.tileValue, tint ? { color: tint } : null]}>
        {value}
      </Text>
      <Text style={hero ? styles.heroLabel : styles.tileLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  heroWrap: { alignItems: "center", gap: 2 },
  heroValue: {
    ...type.display,
    fontSize: 52,
    letterSpacing: -1.5,
    fontVariant: ["tabular-nums"],
  },
  heroLabel: { ...type.kicker, color: colors.textDim },
  tile: { flex: 1, alignItems: "center", gap: 2, paddingVertical: spacing.xs },
  tileValue: {
    ...type.title,
    fontSize: 22,
    fontVariant: ["tabular-nums"],
  },
  tileLabel: { ...type.caption, fontSize: 11 },
});
