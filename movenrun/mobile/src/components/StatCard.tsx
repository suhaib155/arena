import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, hairline, radius, shadows, spacing, type } from "@/theme";
import { alpha } from "@/lib/gradient";
import type { IoniconName } from "@/types";

interface StatCardProps {
  icon: IoniconName;
  value: string | number;
  label: string;
  tint?: string;
}

/**
 * A single at-a-glance metric. The tinted icon badge carries a matching ring so
 * it reads as a deliberate object rather than a flat pastel square.
 */
export function StatCard({ icon, value, label, tint = colors.primary }: StatCardProps) {
  return (
    <View style={styles.card}>
      <View
        style={[
          styles.iconTile,
          { backgroundColor: alpha(tint, 0.12), borderColor: alpha(tint, 0.22) },
        ]}
      >
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
});
