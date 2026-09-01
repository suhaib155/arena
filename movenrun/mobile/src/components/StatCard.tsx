import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, iconTile, radius, shadows, softTint, spacing, type } from "@/theme";
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
      <View style={[styles.iconTile, { backgroundColor: softTint(tint) }]}>
        <Ionicons name={icon} size={18} color={tint} />
      </View>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
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
    ...shadows.card,
  },
  iconTile: { ...iconTile(34), marginBottom: 2 },
  value: {
    ...type.title,
    fontSize: 24,
  },
  label: { ...type.caption },
});
