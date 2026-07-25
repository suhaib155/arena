import { StyleSheet, Text, View, type TextStyle } from "react-native";
import { colors, type } from "@/theme";

interface MetricValueProps {
  /** The figure itself, e.g. "450" or "7". */
  value: string | number;
  /** Small trailing unit set tight against the value, e.g. "kcal", "m", "%". */
  unit?: string;
  /** A second value/unit pair, for compound readouts like 7h 30m. */
  value2?: string | number;
  unit2?: string;
  size?: number;
  color?: string;
  style?: TextStyle;
}

/**
 * A figure with its unit set small and tight against it — `450kcal`, `7h30m`,
 * `82,641steps`.
 *
 * Pairing a large figure with a diminutive unit is what lets a metric stay
 * scannable without the unit shouting; writing "450 kcal" at one size makes the
 * unit compete with the number. Tabular figures stop the value jittering as it
 * counts, and the whole thing is announced as one label so a screen reader says
 * "450 kcal", not "450" then "kcal".
 */
export function MetricValue({
  value,
  unit,
  value2,
  unit2,
  size = 30,
  color = colors.text,
  style,
}: MetricValueProps) {
  const unitSize = Math.max(10, Math.round(size * 0.42));
  const label = [value, unit, value2, unit2].filter((p) => p != null && p !== "").join(" ");
  return (
    <View style={styles.row} accessibilityLabel={label}>
      <Text
        style={[styles.value, { fontSize: size, lineHeight: size * 1.06, color }, style]}
        numberOfLines={1}
      >
        {value}
      </Text>
      {unit ? <Text style={[styles.unit, { fontSize: unitSize, color }]}>{unit}</Text> : null}
      {value2 != null ? (
        <Text
          style={[styles.value, styles.value2, { fontSize: size, lineHeight: size * 1.06, color }]}
          numberOfLines={1}
        >
          {value2}
        </Text>
      ) : null}
      {unit2 ? <Text style={[styles.unit, { fontSize: unitSize, color }]}>{unit2}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "baseline" },
  value: {
    ...type.display,
    fontWeight: "800",
    letterSpacing: -1,
    fontVariant: ["tabular-nums"],
  },
  value2: { marginLeft: 4 },
  unit: {
    fontWeight: "700",
    letterSpacing: -0.2,
    /* Sits tight against the figure — the pairing is the point. */
    marginLeft: 1,
  },
});
