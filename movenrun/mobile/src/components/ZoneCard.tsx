import { StyleSheet, Text, View } from "react-native";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import type { Zone, ZoneState } from "@/types";
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
const STATE_TEXT: Record<ZoneState, string> = {
  unclaimed: colors.textDim,
  yours: "#0A8F60",
  contested: "#C2492E",
  dormant: colors.textDim,
  deedPreview: palette.deedViolet,
};
const STATE_LABEL: Record<ZoneState, string> = {
  unclaimed: "Unclaimed",
  yours: "Yours",
  contested: "Contested",
  dormant: "Dormant",
  deedPreview: "Deed preview",
};

export function zoneStateCore(state: ZoneState): string {
  return STATE_CORE[state];
}
export function zoneStateFill(state: ZoneState): string {
  return STATE_FILL[state];
}

interface ZoneCardProps {
  zone: Zone;
  onPress?: () => void;
}

/** Glass card for a captured zone: hex emblem, name, state, control meter. */
export function ZoneCard({ zone, onPress }: ZoneCardProps) {
  return (
    <ScalePress onPress={onPress} to={0.98} style={styles.card}>
      <View style={styles.emblem}>
        <Hexagon size={40} color={STATE_FILL[zone.state]} coreColor={STATE_CORE[zone.state]} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.name} numberOfLines={1}>{zone.name}</Text>
          <View style={[styles.stateChip, { backgroundColor: `${STATE_CORE[zone.state]}1A` }]}>
            <Text style={[styles.stateText, { color: STATE_TEXT[zone.state] }]}>
              {STATE_LABEL[zone.state]}
            </Text>
          </View>
        </View>
        <Text style={styles.kind}>Common Zone · {zone.id}</Text>
        <View style={styles.meterTrack}>
          <View style={[styles.meterFill, { width: `${zone.controlPercent}%` }]} />
        </View>
        <Text style={styles.meterLabel}>Control {zone.controlPercent}%</Text>
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
  meterFill: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: palette.voltMint,
  },
  meterLabel: { ...type.caption, fontSize: 11, color: colors.textFaint },
});
