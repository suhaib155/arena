import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, shadows, spacing, type } from "@/theme";
import type { IoniconName } from "@/types";
import { ScalePress } from "./ScalePress";

interface NavRowProps {
  icon: IoniconName;
  title: string;
  subtitle?: string;
  /** Optional trailing count/badge text (e.g. "2/5"). */
  trailing?: string;
  onPress: () => void;
  /** Accent for the leading icon tile. Defaults to Base Blue. */
  tint?: string;
}

/**
 * The canonical tappable list row — leading icon tile, title, one-line
 * subtitle, trailing chevron. Consolidates the many bespoke "chip rows" the
 * screens used to hand-roll, so Home's "Up Next" and similar link lists share
 * one rhythm, one touch target, and one accessible label.
 */
export function NavRow({ icon, title, subtitle, trailing, onPress, tint = colors.primary }: NavRowProps) {
  return (
    <ScalePress
      to={0.98}
      onPress={onPress}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
    >
      <View style={[styles.iconTile, { backgroundColor: `${tint}14` }]}>
        <Ionicons name={icon} size={18} color={tint} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {trailing ? <Text style={styles.trailing}>{trailing}</Text> : null}
        </View>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
    </ScalePress>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    minHeight: 60,
    ...shadows.card,
  },
  iconTile: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1, gap: 2 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  title: { ...type.heading, fontSize: 14.5, flexShrink: 1 },
  trailing: { ...type.mono, fontSize: 12, color: colors.textDim },
  subtitle: { ...type.caption, fontSize: 11.5, color: colors.textFaint },
});
