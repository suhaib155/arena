import type { ReactNode } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { GameBadge, type GameTone } from "./GameBadge";
import { colors, palette, radius, spacing, type } from "@/theme";
import type { IoniconName } from "@/types";

export function GroundPanel({ kicker, title, detail, icon, tone = "blue", children, trailing, compact = false }: {
  kicker?: string; title: string; detail?: string; icon?: IoniconName; tone?: GameTone;
  children?: ReactNode; trailing?: ReactNode; compact?: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  return <View style={[styles.root, compact && styles.compact]}>
    <View style={styles.row}>
      {icon ? <GameBadge icon={icon} tone={tone} size={compact ? 32 : 42} /> : null}
      <View style={[styles.words, { minWidth: Math.min(240, 130 * Math.max(1, fontScale)) }]}>
        {kicker ? <Text style={styles.kicker}>{kicker}</Text> : null}
        <Text style={[styles.title, compact && styles.smallTitle]}>{title}</Text>
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
    {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    {children}
  </View>;
}
const styles = StyleSheet.create({
  root: { backgroundColor: palette.deepInk, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  compact: { padding: spacing.md, gap: spacing.sm }, row: { flexDirection: "row", alignItems: "center", gap: spacing.md, flexWrap: "wrap" },
  words: { flex: 1, minWidth: 130, gap: spacing.xs }, kicker: { ...type.kicker, fontSize: 10, color: palette.voltMint },
  title: { ...type.title, color: colors.surface }, smallTitle: { fontSize: 16, lineHeight: 22 },
  detail: { ...type.body, fontSize: 13, lineHeight: 19, color: palette.dustGray }, trailing: { flexShrink: 1 },
});
