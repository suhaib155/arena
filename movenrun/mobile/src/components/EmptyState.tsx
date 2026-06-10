import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, shadows, spacing, type } from "@/theme";
import type { IoniconName } from "@/types";
import { Button } from "./Button";

interface EmptyStateProps {
  icon: IoniconName;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** Friendly placeholder used wherever a list/section has no data yet. */
export function EmptyState({ icon, title, message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconCircle}>
        <Ionicons name={icon} size={28} color={colors.primary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {actionLabel && onAction ? (
        <Button label={actionLabel} variant="secondary" onPress={onAction} style={styles.action} />
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
    ...shadows.card,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryDim,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  title: { ...type.heading },
  message: {
    ...type.body,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  action: { marginTop: spacing.md },
});
