import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import type { IoniconName } from "@/types";
import type { HomeMission, MissionTone } from "@/lib/homeMission";
import { Button } from "./Button";
import { ScalePress } from "./ScalePress";

interface MissionCardProps {
  mission: HomeMission;
  /** Whether to render the mission's own CTA button. When false the whole card
   *  is tappable instead — used so a movement mission never duplicates the
   *  hero's Start/Resume Move button. */
  showButton: boolean;
  onPress: () => void;
}

const TONE: Record<MissionTone, string> = {
  primary: palette.baseBlue,
  danger: palette.heatCoral,
  gold: palette.moveGold,
  green: palette.pulseGreen,
};

/**
 * The single prioritized "what to do next" surface on Home. One mission, one
 * accent, one obvious action — the antidote to a wall of equally-weighted
 * cards. Colour is semantic (see {@link HomeMission}'s tone), never decorative.
 */
export function MissionCard({ mission, showButton, onPress }: MissionCardProps) {
  const accent = TONE[mission.tone];

  const body = (
    <View style={[styles.card, { borderColor: `${accent}33` }]}>
      <View style={styles.head}>
        <View style={[styles.iconTile, { backgroundColor: `${accent}16` }]}>
          <Ionicons name={mission.icon as IoniconName} size={20} color={accent} />
        </View>
        <View style={styles.headText}>
          <Text style={[styles.kicker, { color: accent }]}>{mission.kicker}</Text>
          <Text style={styles.title} numberOfLines={2}>
            {mission.title}
          </Text>
        </View>
        {!showButton ? (
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        ) : null}
      </View>
      <Text style={styles.subtitle}>{mission.subtitle}</Text>
      {showButton ? (
        <Button
          label={mission.ctaLabel}
          variant="secondary"
          onPress={onPress}
          style={styles.cta}
        />
      ) : null}
    </View>
  );

  // With no button, the whole card is the tap target (and carries the
  // accessible label); otherwise the Button owns the action.
  if (showButton) return body;
  return (
    <ScalePress
      to={0.98}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${mission.kicker}. ${mission.title}. ${mission.subtitle}`}
    >
      {body}
    </ScalePress>
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
  title: { ...type.heading, fontSize: 16.5 },
  subtitle: { ...type.caption, fontSize: 12.5, lineHeight: 17, color: colors.textDim },
  cta: { marginTop: spacing.xs },
});
