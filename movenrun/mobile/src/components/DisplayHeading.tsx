import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, type } from "@/theme";

interface DisplayHeadingProps {
  /** Small caps line above the headline: "MOVENRUN", "TERRITORY". */
  kicker: string;
  /** The headline. One sentence, ending in a full stop: "Make your next move." */
  title: string;
  /** An optional supporting line under it. One line, never two sentences. */
  subtitle?: string;
  /**
   * The loop, set as a vertical rail on the right: `["MOVE","CAPTURE",…]`.
   *
   * Four words at most. This is the app's core loop as a piece of typography —
   * the thing the game *is*, present on the screen without a card, a tooltip or
   * a tutorial. It is decorative in the strict sense (it states nothing the
   * screen does not otherwise say), so it is hidden from assistive technology
   * rather than read out as four unexplained nouns.
   */
  rail?: readonly string[];
}

/**
 * The screen's editorial headline.
 *
 * Home opened on "Good morning" at 28pt, which is a greeting, not a game. The
 * design guide opens on a *statement* — "Make your next move.", "Your city.
 * Your ground." — and the difference is not the font size: a headline gives the
 * screen a point of view, so the mission card underneath reads as the answer to
 * something rather than as the first item in a list.
 *
 * The rail on the right is the second half of that idea. Set small, wide-tracked
 * and faint, it fills the space a headline leaves beside it and states the loop
 * — MOVE · CAPTURE · DEFEND · OWN — without spending a card on it.
 */
export function DisplayHeading({ kicker, title, subtitle, rail }: DisplayHeadingProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.text}>
          <Text style={styles.kicker}>{kicker}</Text>
          <Text style={styles.title}>{title}</Text>
        </View>
        {rail && rail.length > 0 ? (
          <View
            style={styles.rail}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {rail.map((word) => (
              <Text key={word} style={styles.railWord} numberOfLines={1}>
                {word}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  text: { flex: 1, gap: 4 },
  kicker: { ...type.kicker, color: colors.primary },
  title: { ...type.hero },
  subtitle: { ...type.body, fontSize: 14.5, lineHeight: 20 },
  /* A fixed-width rail rather than a flexed one: the headline owns the leftover
     space, and the rail must not steal a word's worth of it on a narrow screen.
     `flexShrink: 0` keeps it whole; the words are short enough to fit 84pt. */
  rail: {
    width: 84,
    flexShrink: 0,
    alignItems: "flex-start",
    gap: 1,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
    paddingLeft: spacing.md,
    paddingTop: 3,
  },
  railWord: {
    ...type.kicker,
    fontSize: 8.5,
    letterSpacing: 1.1,
    color: colors.textFaint,
  },
});
