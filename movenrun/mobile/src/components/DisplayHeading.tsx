import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, type } from "@/theme";
export function DisplayHeading({ eyebrow, title, detail, trailing }: { eyebrow?: string; title: string; detail?: string; trailing?: ReactNode }) {
  return <View style={styles.row}><View style={styles.words}>
    {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
    <Text accessibilityRole="header" style={styles.title}>{title}</Text>
    {detail ? <Text style={styles.detail}>{detail}</Text> : null}
  </View>{trailing}</View>;
}
const styles = StyleSheet.create({ row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm }, words: { flex: 1, minWidth: 170, gap: spacing.xs }, eyebrow: { ...type.kicker, fontSize: 10, color: colors.primary }, title: { ...type.display, fontSize: 26, lineHeight: 33, includeFontPadding: true }, detail: { ...type.body, color: colors.textDim } });
