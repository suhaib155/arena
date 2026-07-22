import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import type { IoniconName } from "@/types";

export type ReadinessTone = "neutral" | "ok" | "ready" | "warning" | "danger";

interface ReadinessChipProps {
  icon: IoniconName;
  label: string;
  tone?: ReadinessTone;
  /** Optional: render as a full-width row rather than an inline pill. */
  block?: boolean;
}

const TONE: Record<ReadinessTone, string> = {
  neutral: palette.silverTrail,
  ok: palette.pulseGreen,
  ready: palette.pulseGreen,
  warning: palette.moveGold,
  danger: palette.heatCoral,
};

/**
 * Compact status chip for GPS / permission / signal readiness. The label text
 * always states the status, so the state is never conveyed by colour alone; the
 * dot + icon pair the tone with shape. Reused by Start Move and Active Move.
 */
export function ReadinessChip({ icon, label, tone = "neutral", block = false }: ReadinessChipProps) {
  const c = TONE[tone];
  return (
    <View
      style={[styles.chip, block && styles.block]}
      accessibilityRole="text"
      accessibilityLabel={`Status: ${label}`}
    >
      <View style={[styles.dot, { backgroundColor: c }]} />
      <Ionicons name={icon} size={14} color={c} />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    ...shadows.card,
  },
  block: { alignSelf: "stretch" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { ...type.caption, fontSize: 12, fontWeight: "700", color: colors.text },
});
