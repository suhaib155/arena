import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, glow, hairline, palette, radius, shadows, spacing, type } from "@/theme";
import { alpha } from "@/lib/gradient";
import type { IoniconName } from "@/types";
import { Button } from "./Button";

interface EmptyStateProps {
  icon: IoniconName;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

/**
 * Placeholder used wherever a list/section has no data yet. An empty screen is
 * a first impression, so the icon sits in a haloed medallion and the action —
 * when there is one — is the full primary treatment rather than a muted
 * secondary, making the next step unmistakable.
 */
export function EmptyState({ icon, title, message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.halo}>
        <View style={styles.iconCircle}>
          <Ionicons name={icon} size={28} color={colors.primary} />
        </View>
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
    ...hairline,
    ...shadows.card,
  },
  /** Soft outer ring so the icon reads as a focal medallion. */
  halo: {
    width: 84,
    height: 84,
    borderRadius: radius.pill,
    backgroundColor: alpha(palette.baseBlue, 0.06),
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryDim,
    alignItems: "center",
    justifyContent: "center",
    ...glow(palette.baseBlue),
    shadowOpacity: 0.18,
  },
  title: { ...type.heading, fontSize: 18 },
  message: {
    ...type.body,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  action: { marginTop: spacing.md, alignSelf: "stretch" },
});
