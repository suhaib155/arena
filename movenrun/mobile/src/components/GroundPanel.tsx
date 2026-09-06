import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ground, groundInk, iconTile, onGround, radius, softTint, spacing, type } from "@/theme";
import type { IoniconName } from "@/types";

export type GroundTone = "info" | "positive" | "caution" | "urgent" | "deed" | "neutral";

interface GroundPanelProps {
  icon: IoniconName;
  /** Small caps role line: "LOOP STATUS", "RESULT". */
  kicker: string;
  /** The statement. One line where possible. */
  title: string;
  /** One supporting sentence. */
  detail?: string;
  tone?: GroundTone;
  /** A chip, a metric, a control — rendered at the right of the head row. */
  trailing?: ReactNode;
  /** Announce changes to this panel. Live sessions set this; static ones don't. */
  live?: boolean;
}

/**
 * A statement on the dark ground.
 *
 * The sibling of {@link MissionCard}: same surface, no primary action. It is
 * for the one thing a screen most needs the player to understand — the route's
 * sealing state during a session, the verdict on a summary — and it earns the
 * dark ground for the same reason the mission card does. On a screen that is
 * otherwise a map and a stack of white cards, exactly one dark object is
 * unambiguous; two would be a pattern and none would be a paragraph.
 *
 * State is carried by the kicker and the title, never by the ground colour: the
 * panel is the same near-black in every tone, and only the glyph and the kicker
 * take the accent. That is deliberate — a status band that turns red is a
 * warning, and most of the states this shows (an open route, a local-only save)
 * are ordinary, not problems.
 */
export function GroundPanel({
  icon,
  kicker,
  title,
  detail,
  tone = "info",
  trailing,
  live = false,
}: GroundPanelProps) {
  const accent = ACCENT[tone];
  return (
    <View
      style={styles.panel}
      accessibilityLiveRegion={live ? "polite" : "none"}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={detail ? `${kicker}. ${title}. ${detail}` : `${kicker}. ${title}`}
    >
      <View style={styles.head}>
        <View style={[styles.glyph, { backgroundColor: softTint(accent) }]}>
          <Ionicons name={icon} size={17} color={accent} />
        </View>
        <View style={styles.headText}>
          <Text style={[styles.kicker, { color: accent }]} numberOfLines={1}>
            {kicker}
          </Text>
          <Text style={styles.title}>{title}</Text>
        </View>
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </View>
  );
}

const ACCENT: Record<GroundTone, string> = {
  info: groundInk.blue,
  positive: groundInk.green,
  caution: groundInk.gold,
  urgent: groundInk.coral,
  deed: groundInk.violet,
  neutral: groundInk.neutral,
};

const styles = StyleSheet.create({
  panel: {
    backgroundColor: ground.base,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  glyph: { ...iconTile(34) },
  headText: { flex: 1, gap: 1, minWidth: 0 },
  kicker: { ...type.kicker, fontSize: 9.5 },
  title: { ...type.heading, fontSize: 15.5, color: onGround.text },
  trailing: { flexShrink: 0 },
  detail: { ...type.caption, fontSize: 12.5, lineHeight: 18, color: onGround.dim },
});
