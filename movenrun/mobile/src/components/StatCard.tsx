import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "@/theme";
import type { IoniconName } from "@/types";

interface StatCardProps {
  icon: IoniconName;
  value: string | number;
  label: string;
  tint?: string;
}

export function StatCard({ icon, value, label, tint = colors.primary }: StatCardProps) {
  return (
    <View style={styles.card}>
      <Ionicons name={icon} size={22} color={tint} />
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  value: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
  },
  label: {
    color: colors.textDim,
    fontSize: 12,
  },
});
