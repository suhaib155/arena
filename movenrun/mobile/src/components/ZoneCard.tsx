import { StyleSheet, Text, View } from "react-native";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import type { Zone, ZoneState } from "@/types";
import { HEALTH_LABEL, zoneStatus, type ZoneHealth } from "@/lib/territory";
import { Hexagon } from "./Hexagon";
import { ScalePress } from "./ScalePress";

/** Solid pastel fills per state (pre-blended for the 3-rect hexagon). */
const STATE_FILL: Record<ZoneState, string> = {
  unclaimed: "#E8EDF0",
  yours: "#C9EEDE",
  contested: "#FFDCD2",
  dormant: "#E9ECEF",
  deedPreview: "#E1DAFF",
};
const STATE_CORE: Record<ZoneState, string> = {
  unclaimed: palette.dustGray,
  yours: palette.pulseGreen,
  contested: palette.heatCoral,
  dormant: palette.silverTrail,
  deedPreview: palette.deedViolet,
};

/** Health → visual mapping (derived defend status, not the stored state). */
const HEALTH_VISUAL: Record<ZoneHealth, { fill: string; core: string; text: string }> = {
  yours: { fill: "#C9EEDE", core: palette.pulseGreen, text: "#0A8F60" },
  atRisk: { fill: "#FFE6DE", core: palette.heatCoral, text: "#C2492E" },
  contestedPreview: { fill: "#FFDCD2", core: palette.heatCoral, text: "#C2492E" },
  dormant: { fill: "#E9ECEF", core: palette.silverTrail, text: colors.textDim },
};

export function zoneStateCore(state: ZoneState): string {
  return STATE_CORE[state];
}
export function zoneStateFill(state: ZoneState): string {
  return STATE_FILL[state];
}
export function healthVisual(health: ZoneHealth) {
  return HEALTH_VISUAL[health];
}

interface ZoneCardProps {
  zone: Zone;
  onPress?: () => void;
}

/** Glass card for a captured zone: hex emblem, derived health badge, and the
 *  decayed control/defense meters from the local defend simulation. */
export function ZoneCard({ zone, onPress }: ZoneCardProps) {
  const status = zoneStatus(zone);
  const visual = HEALTH_VISUAL[status.health];
  return (
    <ScalePress onPress={onPress} to={0.98} style={styles.card}>
      <View style={styles.emblem}>
        <Hexagon size={40} color={visual.fill} coreColor={visual.core} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.name} numberOfLines={1}>{zone.name}</Text>
          <View style={[styles.stateChip, { backgroundColor: `${visual.core}1A` }]}>
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
