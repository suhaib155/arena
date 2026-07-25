import { useMemo } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { gradientStops } from "@/lib/gradient";

interface GradientProps {
  /** `[from, to]` colour pair — pass a token from `gradients` in the theme. */
  colors: readonly [string, string];
  /** Band direction. Vertical reads as light falling from above. */
  direction?: "vertical" | "horizontal";
  /** Band count. More is smoother; 14 is indistinguishable from a real ramp. */
  steps?: number;
  /** Absolutely fill the parent (the usual case for a card/button backdrop). */
  fill?: boolean;
  /**
   * Corner radius clipped by the gradient itself. Prefer this over putting
   * `overflow: "hidden"` on the parent, which can suppress the Android
   * elevation shadow of the very surface the gradient is filling.
   */
  radius?: number;
  style?: ViewStyle;
}

/**
 * A linear gradient built from stacked solid bands — no native dependency.
 *
 * React Native ships no gradient primitive, and adding a gradient package for
 * presentation alone is not worth a native dependency, so the ramp is composed
 * from `steps` flex-sized Views. Purely decorative: it is never a touch target
 * and is hidden from screen readers, so the labelled content above it stays the
 * only thing announced.
 */
export function Gradient({
  colors,
  direction = "vertical",
  steps = 14,
  fill = true,
  radius,
  style,
}: GradientProps) {
  const stops = useMemo(() => gradientStops(colors[0], colors[1], steps), [colors, steps]);
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        fill ? StyleSheet.absoluteFillObject : null,
        { flexDirection: direction === "vertical" ? "column" : "row" },
        radius != null ? { borderRadius: radius, overflow: "hidden" } : null,
        style,
      ]}
    >
      {/* Static, never-reordered decorative bands: index is the stable key, and
          adjacent stops can round to the same hex so colour is not unique. */}
      {stops.map((c, i) => (
        <View key={i} style={[styles.band, { backgroundColor: c }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  /* Each band takes an equal share of the axis; -0.5 margin hides the hairline
     seams that appear between sibling views on fractional pixel densities. */
  band: { flex: 1, marginVertical: -0.5, marginHorizontal: -0.5 },
});
