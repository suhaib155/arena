import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, type } from "@/theme";
import { useResponsive } from "@/hooks/useResponsive";

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
  const r = useResponsive();
  /* The hero numeral is the tallest element on the tracking screen, so it is
     sized from the viewport — a fixed size overflows short phones. */
  const heroSize = hero ? { fontSize: r.fs(68, 40), lineHeight: r.fs(72, 44) } : null;
  return (
    <View style={hero ? styles.heroWrap : styles.tile} accessibilityLabel={`${label}: ${value}`}>
      <Text
        style={[
          hero ? styles.heroValue : styles.tileValue,
          heroSize,
          tint ? { color: tint } : null,
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit={hero}
        minimumFontScale={0.6}
      >
        {value}
      </Text>
      <Text style={hero ? styles.heroLabel : styles.tileLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  heroWrap: { alignItems: "center", gap: spacing.xs },
  heroValue: {
    ...type.display,
    fontSize: 68,
    lineHeight: 72,
    letterSpacing: -3,
    fontVariant: ["tabular-nums"],
  },
  heroLabel: { ...type.kicker, color: colors.textFaint },
  tile: { flex: 1, alignItems: "center", gap: 2, paddingVertical: spacing.xs },
  tileValue: {
    ...type.title,
    fontSize: 24,
    letterSpacing: -0.8,
    fontVariant: ["tabular-nums"],
  },
  tileLabel: { ...type.caption, fontSize: 11 },
});
