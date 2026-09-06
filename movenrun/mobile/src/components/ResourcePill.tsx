import { StyleSheet, Text, View } from "react-native";
import { Hexagon } from "./Hexagon";
import { colors, ink, palette, radius, softTint, spacing, type } from "@/theme";

export type ResourceTone = "gold" | "violet" | "green" | "blue";

interface ResourcePillProps {
  /** The number, already formatted ("128", "1,260"). Never a raw float. */
  value: string;
  /** The unit, in caps: "MOVE", "XP". Two to four characters. */
  unit: string;
  tone: ResourceTone;
  /**
   * A short qualifier rendered *inside* the pill, e.g. "preview".
   *
   * Not decorative. Locked MOVE has no ledger — it is derived from XP for
   * display (see lib/lockedMove.ts) — and a gold pill reading "128 MOVE" beside
   * a real XP total is precisely how a preview gets mistaken for a balance. A
   * qualifier that lives in the pill travels with it to every screen; a
   * footnote at the bottom of one screen does not.
   */
  note?: string;
  /**
   * Overrides the spoken text. Default reads "<value> <unit>" — pass the whole
   * truth where the visible pill is a shorthand.
   */
  accessibilityLabel?: string;
}

/**
 * A resource readout: hex glyph, number, unit.
 *
 * The resource header is the single largest gamification idea in the design
 * guide, and it works because the two currencies are told apart *before* they
 * are read — one gold hexagon, one violet, in the same place on every screen.
 * Colour alone would not do it, so the unit is always written out and the tone
 * only reinforces it.
 *
 * Deliberately not pressable. A pill is a readout; making one tappable on some
 * screens and not others is how a status display turns into an inconsistent
 * navigation control. Where a resource needs an explanation, the screen puts a
 * row under it.
 */
export function ResourcePill({ value, unit, tone, note, accessibilityLabel }: ResourcePillProps) {
  const paint = TONE[tone];
  return (
    <View
      style={[styles.pill, { backgroundColor: softTint(paint.core) }]}
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? `${value} ${unit}`}
    >
      <Hexagon size={14} color={paint.core} />
      <Text style={[styles.value, { color: paint.ink }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={[styles.unit, { color: paint.ink }]} numberOfLines={1}>
        {unit}
      </Text>
      {note ? (
        <Text style={styles.note} numberOfLines={1}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

/* Core paints the hexagon, ink writes the number — the same split the rest of
   the app uses. A brand hue is not legible as text on a chip of itself. */
const TONE: Record<ResourceTone, { core: string; ink: string }> = {
  gold: { core: palette.moveGold, ink: ink.gold },
  violet: { core: palette.deedViolet, ink: ink.violet },
  green: { core: palette.pulseGreen, ink: ink.green },
  blue: { core: palette.baseBlue, ink: ink.blue },
};

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    borderRadius: radius.pill,
    paddingVertical: 5,
    paddingHorizontal: spacing.md,
    /* Shrinkable, so two pills and a name share a header row at large text
       instead of pushing the bell off the screen. */
    flexShrink: 1,
    minWidth: 0,
  },
  value: {
    ...type.heading,
    fontSize: 14,
    fontVariant: ["tabular-nums"],
    flexShrink: 1,
  },
  unit: { ...type.kicker, fontSize: 10, letterSpacing: 0.6 },
  note: { ...type.kicker, fontSize: 8.5, letterSpacing: 0.4, color: colors.textDim },
});
