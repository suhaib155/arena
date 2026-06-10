import { StyleSheet, Text, View } from "react-native";
import { colors, glow, palette, radius, type } from "@/theme";

interface RoutePathProps {
  /** 0..1 progress along the route. */
  progress: number;
  label?: string;
}

/**
 * XP progress styled as a glowing route: a dashed trail, a Pulse Green fill,
 * and a runner dot at the head — the same motif as the website's journey line.
 */
export function RoutePath({ progress, label }: RoutePathProps) {
  const pct = Math.max(0, Math.min(1, progress));
  return (
    <View style={styles.wrap}>
      <View style={styles.track}>
        <View style={styles.dashes}>
          {Array.from({ length: 14 }).map((_, i) => (
            <View key={i} style={styles.dash} />
          ))}
        </View>
        <View style={[styles.fill, { width: `${pct * 100}%` }]} />
        <View style={[styles.runner, { left: `${pct * 100}%` }]}>
          <View style={styles.runnerCore} />
        </View>
      </View>
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  track: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    justifyContent: "center",
  },
  dashes: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
  },
  dash: {
    width: 6,
    height: 2,
    borderRadius: 1,
    backgroundColor: palette.dustGray,
  },
  fill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: radius.pill,
    backgroundColor: palette.pulseGreen,
  },
  runner: {
    position: "absolute",
    top: -3,
    marginLeft: -8,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: palette.pulseGreen,
    borderWidth: 3,
    borderColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...glow(palette.pulseGreen),
  },
  runnerCore: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surface,
  },
  label: { ...type.caption, fontWeight: "600" },
});
