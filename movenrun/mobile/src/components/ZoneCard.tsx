import { StyleSheet, Text, View } from "react-native";
import { colors, ink, palette, radius, shadows, softTint, spacing, tints, tones, type } from "@/theme";
import type { ToneName } from "@/theme";
import type { Zone, ZoneState } from "@/types";
import { HEALTH_LABEL, zoneStatus, type ZoneHealth } from "@/lib/territory";
import { Hexagon } from "./Hexagon";
import { ScalePress } from "./ScalePress";

/** Solid pastel fills per state (pre-blended for the 3-rect hexagon). */
const STATE_FILL: Record<ZoneState, string> = {
  unclaimed: tints.neutral,
  yours: tints.green,
  contested: tints.coral,
  dormant: tints.neutral,
  deedPreview: tints.violet,
};
const STATE_CORE: Record<ZoneState, string> = {
  unclaimed: palette.dustGray,
  yours: palette.pulseGreen,
  contested: palette.heatCoral,
  dormant: palette.silverTrail,
  deedPreview: palette.deedViolet,
};

/**
 * Health → visual mapping (derived defend status, not the stored state).
 *
 * The three paints come from the shared tone table, so "at risk" is the same
 * coral here as on the alerts screen. Only `atRisk`'s fill is overridden: it
 * and `contestedPreview` share a tone but must stay visually distinguishable
 * in a list, so the weaker of the two coral fills is used for the weaker
 * state. That override is the exception, and it is written down.
 */
const HEALTH_TONE: Record<ZoneHealth, { tone: ToneName; fill?: string }> = {
  yours: { tone: "positive" },
  atRisk: { tone: "urgent", fill: tints.coralSoft },
  contestedPreview: { tone: "urgent" },
  dormant: { tone: "neutral" },
};

function healthPaint(health: ZoneHealth): { fill: string; core: string; text: string } {
  const { tone, fill } = HEALTH_TONE[health];
  const t = tones[tone];
  return { fill: fill ?? t.tint, core: t.core, text: t.ink };
}

export function zoneStateCore(state: ZoneState): string {
  return STATE_CORE[state];
}
export function zoneStateFill(state: ZoneState): string {
  return STATE_FILL[state];
}
export function healthVisual(health: ZoneHealth) {
  return healthPaint(health);
}

interface ZoneCardProps {
  zone: Zone;
  onPress?: () => void;
}

/** Glass card for a captured zone: hex emblem, derived health badge, and the
 *  decayed control/defense meters from the local defend simulation. */
export function ZoneCard({ zone, onPress }: ZoneCardProps) {
  const status = zoneStatus(zone);
  const visual = healthPaint(status.health);
  return (
    <ScalePress onPress={onPress} to={0.98} style={styles.card}>
      <View style={styles.emblem}>
        <Hexagon size={40} color={visual.fill} coreColor={visual.core} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.name} numberOfLines={1}>{zone.name}</Text>
          <View style={[styles.stateChip, { backgroundColor: softTint(visual.core) }]}>
            <Text style={[styles.stateText, { color: visual.text }]}>
              {HEALTH_LABEL[status.health]}
            </Text>
          </View>
        </View>
        <Text style={styles.kind}>Common Zone · {zone.id}</Text>
        <View style={styles.meterTrack}>
          <View
            style={[
              styles.meterFill,
              {
                width: `${status.defense}%`,
                backgroundColor: status.health === "yours" ? palette.pulseGreen : palette.heatCoral,
              },
            ]}
          />
        </View>
        <Text style={styles.meterLabel}>
          Defense {status.defense}% · Control {status.control}%
        </Text>
      </View>
    </ScalePress>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  emblem: { width: 44, alignItems: "center" },
  body: { flex: 1, gap: 4 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { ...type.heading, fontSize: 15.5, flex: 1 },
  stateChip: {
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
  },
  stateText: { fontSize: 11, fontWeight: "700" },
  kind: { ...type.mono, fontSize: 11, color: colors.textFaint },
  meterTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
    marginTop: 2,
  },
  meterFill: { height: "100%", borderRadius: radius.pill },
  meterLabel: { ...type.caption, fontSize: 11, color: colors.textFaint },
});
