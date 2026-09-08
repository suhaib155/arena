import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Hexagon } from "./Hexagon";
import { colors, ink, tints } from "@/theme";
import type { IoniconName } from "@/types";

export type GameTone = "blue" | "green" | "gold" | "violet" | "neutral";
export const gamePaint = {
  blue: { ink: ink.blue, fill: tints.blue },
  green: { ink: ink.green, fill: tints.green },
  gold: { ink: ink.gold, fill: tints.gold },
  violet: { ink: ink.violet, fill: tints.violet },
  neutral: { ink: ink.neutral, fill: tints.neutral },
};

/** An identity emblem, never a map or an assertion of an earned achievement. */
export const GameBadge = memo(function GameBadge({ icon, tone = "blue", size = 48, label, locked = false }: {
  icon: IoniconName; tone?: GameTone; size?: number; label?: string; locked?: boolean;
}) {
  const paint = gamePaint[locked ? "neutral" : tone];
  return <View style={[styles.frame, { width: size, height: size * 1.16 }]} accessible={!!label} accessibilityLabel={label} importantForAccessibility={label ? "yes" : "no-hide-descendants"}>
    <Hexagon size={size} color={paint.ink} />
    <View style={styles.center}><Hexagon size={size - 4} color={paint.fill} /></View>
    <View style={styles.center}><Ionicons name={locked ? "lock-closed-outline" : icon} size={size * .45} color={paint.ink} /></View>
  </View>;
});
const styles = StyleSheet.create({ frame: { alignItems: "center", justifyContent: "center" }, center: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" } });
