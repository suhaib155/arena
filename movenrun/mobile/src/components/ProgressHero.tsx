import { StyleSheet, Text, View } from "react-native";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";

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
 * statement. The single hero of Objectives (and reusable for other progression
 * surfaces) — replaces a wall of equal cards with one clear answer to "how far
 * am I?". Progress is conveyed by the value/percent text, not colour alone.
 */
export function ProgressHero({ value, outOf, label, percent, statement, accent = palette.baseBlue }: ProgressHeroProps) {
  const pct = Math.max(0, Math.min(100, percent));
  return (
    <View
      style={styles.card}
      accessibilityRole="summary"
      accessibilityLabel={`${value}${outOf ? ` ${outOf}` : ""} ${label}, ${pct}%. ${statement}`}
    >
      <View style={styles.topRow}>
        <View style={styles.valueWrap}>
          <Text style={styles.value}>{value}</Text>
          {outOf ? <Text style={styles.outOf}> {outOf}</Text> : null}
        </View>
        <View style={[styles.pctChip, { backgroundColor: `${accent}1A` }]}>
          <Text style={[styles.pctText, { color: accent }]}>{pct}%</Text>
        </View>
      </View>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%`, backgroundColor: accent }]} />
      </View>
      <Text style={styles.statement}>{statement}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  valueWrap: { flexDirection: "row", alignItems: "baseline" },
  value: { ...type.display, fontSize: 40, letterSpacing: -1, fontVariant: ["tabular-nums"] },
  outOf: { ...type.title, fontSize: 20, color: colors.textFaint },
  pctChip: { borderRadius: radius.pill, paddingVertical: 5, paddingHorizontal: spacing.md },
  pctText: { ...type.heading, fontSize: 15, fontVariant: ["tabular-nums"] },
  label: { ...type.caption, fontSize: 12.5, color: colors.textDim },
  track: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
    marginTop: spacing.xs,
  },
  fill: { height: 8, borderRadius: radius.pill },
  statement: { ...type.caption, fontSize: 12.5, color: colors.textDim },
});
