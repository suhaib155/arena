import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { gamePaint, type GameTone } from "./GameBadge";
import { colors, spacing, type } from "@/theme";

export function MeterRow({ items }: { items: readonly { label: string; value: string | number; tone?: GameTone }[] }) {
  const { fontScale } = useWindowDimensions();
  return <View style={styles.row}>{items.map(item => <View key={item.label} style={[styles.item, { minWidth: 140 * Math.max(1, fontScale), maxWidth: "100%" }]} accessible accessibilityLabel={`${item.value} ${item.label}`}>
    <Text style={[styles.value, { color: gamePaint[item.tone ?? "neutral"].ink }]}>{item.value}</Text>
    <Text style={styles.label}>{item.label}</Text>
  </View>)}</View>;
}
const styles = StyleSheet.create({ row: { flexDirection: "row", flexWrap: "wrap", paddingVertical: spacing.sm, gap: spacing.md }, item: { flex: 1, minWidth: 76, gap: spacing.xs }, value: { ...type.title, fontSize: 23, lineHeight: 30, includeFontPadding: true, fontVariant: ["tabular-nums"] }, label: { ...type.caption, fontSize: 11, color: colors.textDim } });
