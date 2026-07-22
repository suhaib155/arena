import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import type { IoniconName } from "@/types";

export type ResultTone = "primary" | "green" | "warning" | "neutral" | "danger";

interface ResultCalloutProps {
  icon: IoniconName;
  kicker: string;
  headline: string;
  detail: string;
  tone?: ResultTone;
}

const TONE: Record<ResultTone, string> = {
  primary: palette.baseBlue,
  green: palette.pulseGreen,
  warning: palette.moveGold,
  neutral: palette.silverTrail,
  danger: palette.heatCoral,
};

/**
 * A single result-state callout for the completion screen (confirmed / saved /
 * too-short / demo…). One accent, one clear message — the honest status of the
 * session, stated in words so it never depends on colour or animation.
 */
export function ResultCallout({ icon, kicker, headline, detail, tone = "primary" }: ResultCalloutProps) {
  const accent = TONE[tone];
  return (
    <View
      style={[styles.card, { borderColor: `${accent}33` }]}
      accessibilityRole="summary"
      accessibilityLabel={`${kicker}. ${headline}. ${detail}`}
    >
      <View style={styles.head}>
        <View style={[styles.iconTile, { backgroundColor: `${accent}16` }]}>
          <Ionicons name={icon} size={20} color={accent} />
        </View>
        <View style={styles.headText}>
          <Text style={[styles.kicker, { color: accent }]}>{kicker}</Text>
          <Text style={styles.headline}>{headline}</Text>
        </View>
      </View>
      <Text style={styles.detail}>{detail}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  iconTile: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  headText: { flex: 1, gap: 2 },
  kicker: { ...type.kicker, fontSize: 10.5 },
  headline: { ...type.heading, fontSize: 16.5 },
  detail: { ...type.caption, fontSize: 12.5, lineHeight: 17, color: colors.textDim },
});
