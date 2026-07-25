import { StyleSheet, Text, View } from "react-native";
import { colors, gradients, palette, radius, shadows, spacing, type } from "@/theme";
import { alpha } from "@/lib/gradient";
import { Gradient } from "./Gradient";

interface ProgressHeroProps {
  /** Dominant value, e.g. "2". */
  value: string | number;
  /** Trailing part of the fraction, e.g. "/ 17". Optional. */
  outOf?: string;
  /** Short label under the value, e.g. "objectives complete". */
  label: string;
  /** 0..100. */
  percent: number;
  /** Editorial one-liner under the bar. */
  statement: string;
  /** Bar/accent colour. Defaults to Base Blue; pass Pulse Green at 100%. */
  accent?: string;
}

/**
 * Dominant progress statement: one large real value + a compact bar + a concise
 * statement. The single hero of a progression screen — replaces a wall of equal
 * cards with one clear answer to "how far am I?".
 *
 * Rendered on a deep ink surface so the headline metric anchors the screen
 * instead of floating in a sea of white cards. Progress is still conveyed by
 * the value and percent text, never by colour alone.
 */
export function ProgressHero({
  value,
  outOf,
  label,
  percent,
  statement,
  accent = palette.baseBlue,
}: ProgressHeroProps) {
  const pct = Math.max(0, Math.min(100, percent));
  return (
    <View
      style={styles.card}
      accessibilityRole="summary"
      accessibilityLabel={`${value}${outOf ? ` ${outOf}` : ""} ${label}, ${pct}%. ${statement}`}
    >
      <Gradient colors={gradients.ink} radius={radius.xl} />
      {/* A faint wash of the accent keeps each screen's hero on-topic. It is
          clipped by the same rounded mask as the gradient beneath it. */}
      <View style={styles.washMask}>
        <View style={[styles.wash, { backgroundColor: alpha(accent, 0.16) }]} />
      </View>

      <View style={styles.topRow}>
        <View style={styles.valueWrap}>
          <Text style={styles.value}>{value}</Text>
          {outOf ? <Text style={styles.outOf}> {outOf}</Text> : null}
        </View>
        <View style={[styles.pctChip, { backgroundColor: alpha(accent, 0.26) }]}>
          <Text style={styles.pctText}>{pct}%</Text>
        </View>
      </View>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]}>
          <Gradient colors={[accent, palette.voltMint]} direction="horizontal" steps={8} />
        </View>
      </View>
      <Text style={styles.statement}>{statement}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.ink,
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.sm,
    ...shadows.hero,
  },
  /** Rounded mask so the glaze cannot spill past the card's corners. */
  washMask: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.xl,
    overflow: "hidden",
  },
  /** Accent glaze over the ink gradient, anchored to the top-right. */
  wash: {
    position: "absolute",
    top: -120,
    right: -80,
    width: 260,
    height: 260,
    borderRadius: 130,
  },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  valueWrap: { flexDirection: "row", alignItems: "baseline" },
  value: {
    ...type.display,
    fontSize: 46,
    letterSpacing: -1.6,
    color: colors.onInk,
    fontVariant: ["tabular-nums"],
  },
  outOf: { ...type.title, fontSize: 20, color: colors.onInkDim },
  pctChip: { borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: spacing.md },
  pctText: { ...type.heading, fontSize: 15, color: colors.onInk, fontVariant: ["tabular-nums"] },
  label: { ...type.caption, fontSize: 13, color: colors.onInkDim },
  track: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: "#FFFFFF1F",
    overflow: "hidden",
    marginTop: spacing.xs,
  },
  fill: { height: 10, borderRadius: radius.pill, overflow: "hidden" },
  statement: { ...type.caption, fontSize: 12.5, color: colors.onInkDim },
});
