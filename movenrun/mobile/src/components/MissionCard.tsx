import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { HexField } from "./HexField";
import { ScalePress } from "./ScalePress";
import { colors, ground, groundInk, iconTile, onGround, radius, shadows, softTint, spacing, type } from "@/theme";
import type { IoniconName } from "@/types";

export type MissionTone = "primary" | "danger" | "gold" | "green";

interface MissionCardProps {
  /** "DAILY MISSION", "NEXT UP", "ALL CLEAR". Two words at most. */
  kicker: string;
  /** Imperative and specific: "Seal the riverside loop". */
  title: string;
  /** One supporting line. Never a second sentence. */
  detail: string;
  /** Button text. Lives on the task, so it cannot drift from the title. */
  ctaLabel: string;
  ctaIcon: IoniconName;
  onPress: () => void;
  /** The mission's own glyph, drawn in the crest. */
  icon: IoniconName;
  tone?: MissionTone;
  /** XP the mission awards, or 0 when it is not XP-bearing. */
  reward?: number;
  /** "2 of 5 done" — the board's own wording, never recomputed here. */
  progressLabel?: string;
  /** 0..1. Drawn as a thin rule under the CTA. */
  progress?: number;
}

/**
 * The spotlight mission — one per screen, and the only place a screen renders a
 * primary action.
 *
 * ## Why it is dark
 *
 * The old hero was a white card among white cards, distinguished only by being
 * slightly rounder and slightly more shadowed. That is a hierarchy you have to
 * *look for*, and the one thing a fitness app cannot afford is a home screen
 * where the user has to choose before they can move. Dropping the mission onto
 * the ground inverts the page: it is the only dark object on a light screen, so
 * it is found before it is read, and the CTA inside it is unmissable.
 *
 * It is also the app's one moment of game texture. Everything else stays calm
 * and legible in daylight; this is where the territory identity lives.
 *
 * ## What it does not do
 *
 * It never invents a mission. `kicker`, `title`, `detail`, `ctaLabel`, `reward`
 * and `progressLabel` all come from the caller's task model
 * (`lib/tasks.ts`) — this component decides nothing about what the player
 * should do, which is the property that keeps the board testable.
 */
export function MissionCard({
  kicker,
  title,
  detail,
  ctaLabel,
  ctaIcon,
  onPress,
  icon,
  tone = "primary",
  reward = 0,
  progressLabel,
  progress,
}: MissionCardProps) {
  const accent = ACCENT[tone];
  const pct = progress == null ? null : Math.max(0, Math.min(1, progress));

  return (
    <View style={styles.card}>
      <HexField />

      <View style={styles.body}>
        <View style={styles.head}>
          <View style={[styles.crest, { backgroundColor: softTint(accent) }]}>
            <Ionicons name={icon} size={20} color={accent} />
          </View>
          <View style={styles.headText}>
            <Text style={[styles.kicker, { color: accent }]} numberOfLines={1}>
              {kicker}
            </Text>
            {progressLabel ? (
              <Text style={styles.progressLabel} numberOfLines={1}>
                {progressLabel}
              </Text>
            ) : null}
          </View>
        </View>

        <Text style={styles.title}>{title}</Text>
        <Text style={styles.detail}>{detail}</Text>

        {reward > 0 ? (
          <View style={styles.rewardChip}>
            <Ionicons name="sparkles" size={13} color={groundInk.violet} />
            <Text style={styles.rewardText}>Reward · +{reward} XP</Text>
          </View>
        ) : null}

        {pct != null ? (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: accent }]} />
          </View>
        ) : null}

        <ScalePress
          to={0.97}
          onPress={onPress}
          style={styles.cta}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
          accessibilityHint={`${kicker}: ${title}`}
        >
          <Ionicons name={ctaIcon} size={19} color={colors.surface} />
          <Text style={styles.ctaLabel} numberOfLines={1}>
            {ctaLabel}
          </Text>
        </ScalePress>
      </View>
    </View>
  );
}

/* On the dark ground the readable variants of the brand hues are the
   `groundInk` ramp, not `palette` — see lib/tone.ts. Blue and violet are the
   two that genuinely fail there; green, gold and coral are their own cores. */
const ACCENT: Record<MissionTone, string> = {
  primary: groundInk.blue,
  danger: groundInk.coral,
  gold: groundInk.gold,
  green: groundInk.green,
};

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    overflow: "hidden",
    backgroundColor: ground.base,
    ...shadows.float,
  },
  body: { padding: spacing.xl, gap: spacing.md },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  crest: { ...iconTile(42) },
  headText: { flex: 1, gap: 2 },
  kicker: { ...type.kicker, fontSize: 10.5 },
  progressLabel: { ...type.caption, fontSize: 12, color: onGround.dim },
  title: { ...type.display, fontSize: 27, lineHeight: 32, color: onGround.text },
  detail: { ...type.body, fontSize: 14.5, lineHeight: 20, color: onGround.dim },
  rewardChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    borderRadius: radius.pill,
    backgroundColor: ground.raised,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
  },
  rewardText: { ...type.heading, fontSize: 13, color: groundInk.violet },
  track: {
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: ground.raised,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: radius.pill },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    minHeight: 54,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xs,
  },
  ctaLabel: { ...type.heading, fontSize: 16.5, color: colors.surface, flexShrink: 1 },
});
