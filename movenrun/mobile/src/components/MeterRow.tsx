import { Fragment } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, iconTile, radius, softTint, spacing, type } from "@/theme";
import type { IoniconName } from "@/types";

export interface Meter {
  icon: IoniconName;
  /** The number, already formatted. Tabular, so the row doesn't twitch. */
  value: string;
  /** Two or three words at most — it sits under a large number. */
  label: string;
  /** Brand hue for the glyph and the meter. Never used for the value text. */
  tint: string;
  /**
   * 0..1 progress, drawn as a bar under the number, or `undefined` for a bare
   * count.
   *
   * A count and a proportion are different facts and the row shows both: "6
   * zones held" is finished information, "3 of 4 active days" is not, and
   * drawing an empty bar under the count would invent a target the game does
   * not set.
   */
  progress?: number;
  /**
   * Draw `progress` as discrete pips instead of a bar, with this many steps.
   *
   * For a small whole-number goal — four active days, three sessions — pips are
   * countable at a glance and a bar is not. Above about six they stop being
   * countable and become a worse bar, so the caller chooses.
   */
  steps?: number;
}

interface MeterRowProps {
  /** Exactly three. Two looks unbalanced full-width; four stops being scannable. */
  meters: [Meter, Meter, Meter];
}

/**
 * Three meters in a row — the game's vital signs.
 *
 * This replaces `StatTrio`, which was three bare numbers split by hairlines. It
 * was a good component and it kept the right proportions — oversized value,
 * tiny label, equal columns — but it could only state a *count*. The territory
 * loop is mostly about proportions: how many of your zones are healthy, how far
 * through the badge set you are, how much of the board is done. A number with
 * no scale beside it cannot say "nearly there", which is the thing that
 * actually gets someone out of the door.
 *
 * So the rhythm is inherited and two things are added: a glyph that identifies
 * the meter without reading it, and an optional bar or pips. A meter that is
 * genuinely just a total simply omits `progress` and renders as `StatTrio`
 * always did.
 *
 * Progress is never conveyed by colour alone: every meter states its value in
 * text, and the bar repeats what the number already said.
 */
export function MeterRow({ meters }: MeterRowProps) {
  return (
    <View style={styles.row}>
      {meters.map((meter, i) => (
        <Fragment key={meter.label}>
          {i > 0 ? <View style={styles.divider} /> : null}
          <MeterCell meter={meter} />
        </Fragment>
      ))}
    </View>
  );
}

function MeterCell({ meter }: { meter: Meter }) {
  const pct = meter.progress == null ? null : Math.max(0, Math.min(1, meter.progress));
  const steps = meter.steps;
  return (
    <View
      style={styles.cell}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${meter.value} ${meter.label}`}
    >
      <View style={styles.head}>
        <View style={[styles.glyph, { backgroundColor: softTint(meter.tint) }]}>
          <Ionicons name={meter.icon} size={15} color={meter.tint} />
        </View>
        <Text style={styles.value} numberOfLines={1}>
          {meter.value}
        </Text>
      </View>
      <Text style={styles.label} numberOfLines={1}>
        {meter.label}
      </Text>

      {pct == null ? null : steps ? (
        <View style={styles.pips}>
          {Array.from({ length: steps }, (_, i) => (
            <View
              key={i}
              style={[
                styles.pip,
                /* Ceil, not round: a player one step into a four-step goal must
                   see one pip lit, and `round` would leave it dark until 12.5%. */
                i < Math.ceil(pct * steps) ? { backgroundColor: meter.tint } : styles.pipEmpty,
              ]}
            />
          ))}
        </View>
      ) : (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: meter.tint }]} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  cell: { flex: 1, gap: 4, minWidth: 0 },
  head: { flexDirection: "row", alignItems: "center", gap: 6 },
  glyph: { ...iconTile(26) },
  value: {
    ...type.display,
    fontSize: 21,
    lineHeight: 25,
    fontVariant: ["tabular-nums"],
    flexShrink: 1,
  },
  label: { ...type.caption, fontSize: 11, color: colors.textDim },
  track: {
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
    marginTop: 2,
  },
  fill: { height: "100%", borderRadius: radius.pill },
  pips: { flexDirection: "row", gap: 4, marginTop: 4 },
  pip: { flex: 1, height: 5, borderRadius: radius.pill },
  pipEmpty: { backgroundColor: colors.surfaceAlt },
  divider: { width: StyleSheet.hairlineWidth, alignSelf: "stretch", backgroundColor: colors.border },
});
