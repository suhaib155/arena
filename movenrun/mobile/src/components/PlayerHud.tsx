import type { ReactNode } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { GameBadge } from "./GameBadge";
import { XPBar } from "./XPBar";
import { getLevelInfo } from "@/lib/leveling";
import { colors, ink, spacing, type } from "@/theme";

export function PlayerHud({ totalXp, name = "Mover", streak, trailing, compact = false }: {
  totalXp: number; name?: string; streak?: number; trailing?: ReactNode; compact?: boolean;
}) {
  const level = getLevelInfo(totalXp);
  const { fontScale } = useWindowDimensions();
  return <View style={styles.root}>
    <View style={styles.row}>
      <GameBadge icon="navigate" size={compact ? 36 : 44} tone="blue" />
      <View style={[styles.identity, { minWidth: Math.min(200, 100 * Math.max(1, fontScale)) }]}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.level}>LEVEL {level.level}{streak !== undefined ? ` · ${streak} DAY STREAK` : ""}</Text>
      </View>
      <Text style={styles.xp}>{totalXp.toLocaleString()} XP</Text>
      {trailing}
    </View>
    {!compact ? <View style={styles.progress}>
      <XPBar progress={level.progress} />
      <Text style={styles.next}>{level.xpForLevel - level.xpIntoLevel} XP to level {level.level + 1}</Text>
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: spacing.sm }, row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  identity: { flex: 1, minWidth: 100, gap: 2 }, name: { ...type.heading },
  level: { ...type.kicker, fontSize: 10, color: colors.textDim, letterSpacing: .7 },
  xp: { ...type.heading, fontSize: 14, color: ink.violet }, progress: { gap: spacing.xs },
  next: { ...type.caption, fontSize: 10, textAlign: "right", color: colors.textDim },
});
