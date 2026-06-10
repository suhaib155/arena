import { StyleSheet, Text, View } from "react-native";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { Hexagon } from "./Hexagon";

/**
 * Non-functional territory teaser: a light map-like panel with a mock hex
 * cluster showing the three zone states the real map will have. Pure visual —
 * no GPS, no data. Fills are pre-blended pastels over the Mist panel so the
 * hexagon rectangles compose into clean solids.
 */
const FILLS = {
  owned: "#C9EEDE", // Pulse Green pastel
  contested: "#FFDCD2", // Heat Coral pastel
  deed: "#E1DAFF", // Deed Violet pastel
  unclaimed: "#E8EDF0", // Dust pastel
} as const;

const HEX = 44;

interface ZoneHexProps {
  fill: string;
  core?: string;
  /** Cluster offsets, in hex units. */
  dx: number;
  dy: number;
}

function ZoneHex({ fill, core, dx, dy }: ZoneHexProps) {
  return (
    <View
      style={{
        position: "absolute",
        left: "50%",
        top: "50%",
        marginLeft: dx * (HEX + 3) - HEX / 2,
        marginTop: dy * (HEX * 0.92) - (HEX * 1.1547) / 2,
      }}
    >
      <Hexagon size={HEX} color={fill} coreColor={core} />
    </View>
  );
}

export function TerritoryPreview() {
  return (
    <View style={styles.card}>
      <View style={styles.map}>
        {/* faint “roads” */}
        <View style={[styles.road, { top: "30%" }]} />
        <View style={[styles.road, { top: "68%" }]} />
        <View style={[styles.roadV, { left: "24%" }]} />
        <View style={[styles.roadV, { left: "72%" }]} />

        {/* mock hex cluster: owned / contested / future deed */}
        <ZoneHex fill={FILLS.unclaimed} dx={-1} dy={-0.5} />
        <ZoneHex fill={FILLS.unclaimed} dx={1} dy={0.5} />
        <ZoneHex fill={FILLS.unclaimed} dx={-1} dy={0.5} />
        <ZoneHex fill={FILLS.owned} core={palette.pulseGreen} dx={0} dy={0} />
        <ZoneHex fill={FILLS.contested} core={palette.heatCoral} dx={1} dy={-0.5} />
        <ZoneHex fill={FILLS.deed} core={palette.deedViolet} dx={0} dy={1} />

        <View style={styles.comingChip}>
          <Text style={styles.comingText}>Territory map coming next</Text>
        </View>
      </View>

      <View style={styles.legend}>
        <Legend color={palette.pulseGreen} label="Owned" />
        <Legend color={palette.heatCoral} label="Contested" />
        <Legend color={palette.deedViolet} label="Deed zone" />
      </View>
      <Text style={styles.loop}>Move → Capture → Defend → Own</Text>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.md,
    ...shadows.card,
  },
  map: {
    height: 190,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
  },
  road: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#E2E8EC",
  },
  roadV: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 5,
    borderRadius: 3,
    backgroundColor: "#E6EBEF",
  },
  comingChip: {
    position: "absolute",
    bottom: spacing.md,
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    ...shadows.card,
  },
  comingText: { ...type.caption, color: colors.text, fontWeight: "700" },
  legend: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.lg,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendLabel: { ...type.caption, fontWeight: "600" },
  loop: { ...type.mono, textAlign: "center", color: colors.textFaint, fontSize: 12 },
});
