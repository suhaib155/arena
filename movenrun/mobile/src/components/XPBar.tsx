import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "@/theme";

interface XPBarProps {
  progress: number; // 0..1
  label?: string;
}

export function XPBar({ progress, label }: XPBarProps) {
  const pct = Math.max(0, Math.min(1, progress));
  return (
    <View style={styles.wrap}>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct * 100}%` }]} />
      </View>
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  track: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  label: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: "600",
  },
});
