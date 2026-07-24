import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, hairline, radius, shadows, spacing, tints, type, type TintName } from "@/theme";
import { alpha } from "@/lib/gradient";
import type { IoniconName } from "@/types";

interface StatCardProps {
  icon: IoniconName;
  value: string | number;
  label: string;
  /** Icon/value accent. Ignored when `tone` is set (the tint supplies its own). */
  tint?: string;
  /**
   * Soft tinted surface. A row of stat cards should vary its tones — identical
   * white cards read as a template rather than a designed set.
   */
  tone?: TintName;
}

/**
 * A single at-a-glance metric. Either a white card with a tinted icon badge, or
 * — with `tone` — a softly washed surface whose colour carries the meaning.
 */
export function StatCard({ icon, value, label, tint = colors.primary, tone }: StatCardProps) {
  const t = tone ? tints[tone] : null;
  const accent = t ? t.ink : tint;
  return (
    <View
      style={[
        styles.card,
        t ? { backgroundColor: t.bg, borderColor: t.edge } : null,
      ]}
    >
      <View
        style={[
          styles.iconTile,
          {
            backgroundColor: t ? alpha(t.ink, 0.1) : alpha(tint, 0.12),
            borderColor: alpha(accent, 0.22),
          },
        ]}
      >
        <Ionicons name={icon} size={18} color={accent} />
      </View>
      <Text style={[styles.value, t ? { color: t.ink } : null]}>{value}</Text>
      {/* Full-strength ink, de-emphasised by weight rather than opacity: a
          faded label would drop under 4.5:1 on the warmer tints. */}
      <Text style={[styles.label, t ? styles.labelTinted : null, t ? { color: t.ink } : null]} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.xs,
    ...hairline,
    ...shadows.card,
  },
  iconTile: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  value: {
    ...type.title,
    fontSize: 26,
    letterSpacing: -0.9,
    fontVariant: ["tabular-nums"],
  },
  label: { ...type.caption },
  labelTinted: { fontWeight: "600" },
});
