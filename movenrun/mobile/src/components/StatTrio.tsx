import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, type } from "@/theme";

export interface StatTrioItem {
  value: string | number;
  /** Two or three words at most — it sits under a large number. */
  label: string;
  tint?: string;
}

interface StatTrioProps {
  items: [StatTrioItem, StatTrioItem, StatTrioItem];
}

/**
 * Three numbers, split by hairlines — the stat strip every serious fitness app
 * converges on (Strava's activity footer, Apple's Activity summary, Whoop's
 * daily band).
 *
 * The reason it works is worth stating, because it's easy to "improve" away:
 * the numbers are oversized and the labels are tiny, so the row is legible at a
 * glance and at arm's length, mid-movement. Equal-width columns mean the eye
 * never has to re-find them between screens. Tabular figures stop the layout
 * twitching as values tick.
 *
 * Exactly three. Two looks unbalanced against a full-width card and four stops
 * being scannable — the number is the pattern.
 */
export function StatTrio({ items }: StatTrioProps) {
  return (
    <View style={styles.row}>
      {items.map((item, i) => (
        <View key={item.label} style={styles.cell}>
          {i > 0 ? <View style={styles.divider} /> : null}
          <Text style={[styles.value, item.tint ? { color: item.tint } : null]} numberOfLines={1}>
            {item.value}
          </Text>
          <Text style={styles.label} numberOfLines={1}>
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "stretch" },
  cell: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2 },
  divider: {
    position: "absolute",
    left: 0,
    top: spacing.xs,
    bottom: spacing.xs,
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  value: {
    ...type.display,
    fontSize: 26,
    lineHeight: 31,
    color: colors.text,
    fontVariant: ["tabular-nums"],
  },
  label: { ...type.kicker, fontSize: 9.5, letterSpacing: 0.8, textAlign: "center" },
});
