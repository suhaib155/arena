import { StyleSheet, Text, View } from "react-native";
import { radius, spacing } from "@/theme";

interface BadgeProps {
  label: string;
  color: string;
}

/** Soft tinted pill used for category and difficulty tags — no hard borders. */
export function Badge({ label, color }: BadgeProps) {
  return (
    <View style={[styles.badge, { backgroundColor: `${color}1C` }]}>
      <Text style={[styles.text, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingVertical: 5,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    alignSelf: "flex-start",
  },
  text: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
});
