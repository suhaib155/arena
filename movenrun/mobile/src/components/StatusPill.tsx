import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, palette, radius, spacing, type } from "@/theme";
import type { IoniconName } from "@/types";

export type StatusTone = "primary" | "success" | "neutral" | "warning";

interface StatusPillProps {
  icon: IoniconName;
  label: string;
  tone?: StatusTone;
}

const TONE: Record<StatusTone, string> = {
  primary: palette.baseBlue,
  success: palette.pulseGreen,
  neutral: palette.silverTrail,
  warning: palette.moveGold,
};

/**
 * A small labelled status pill (identity, wallet, local-preview). The label
 * text always states the status and the icon reinforces it, so status is never
 * conveyed by colour alone. Reads clearly to a screen reader.
 */
export function StatusPill({ icon, label, tone = "neutral" }: StatusPillProps) {
  const c = TONE[tone];
  return (
    <View style={[styles.pill, { backgroundColor: `${c}16` }]} accessibilityRole="text" accessibilityLabel={label}>
      <Ionicons name={icon} size={13} color={c} />
      <Text style={[styles.label, { color: c }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    paddingVertical: 5,
    paddingHorizontal: spacing.md,
  },
  label: { fontSize: 12, fontWeight: "700" },
});
