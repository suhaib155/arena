import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { Button } from "./Button";
import { ScalePress } from "./ScalePress";

export interface ZoneSheetMeter {
  label: string;
  /** 0..100 */
  value: number;
  color: string;
}

export interface ZoneSheetRow {
  label: string;
  value: string;
}

interface ZoneSheetProps {
  zoneName: string;
  /** Ownership / health, e.g. "At Risk", "Yours". Always shown as text. */
  statusLabel: string;
  statusColor: string;
  /** Concise recent-activity line (collapsed). */
  activity: string;
  /** The single contextual action shown collapsed and expanded. */
  actionLabel: string;
  onAction: () => void;
  /** Collapsed ⇄ expanded. */
  expanded: boolean;
  onToggle: () => void;
  onClose: () => void;
  /** Meters shown expanded (control / defence / …). */
  meters?: ZoneSheetMeter[];
  /** Extra key/value rows shown expanded. */
  rows?: ZoneSheetRow[];
}

/**
 * Territory zone bottom sheet with a collapsed and an expanded state. Collapsed
 * shows only the essentials (name, ownership status as text + colour, one
 * activity line, one action); expanded reveals the existing detail (meters,
 * rows) without repeating the collapsed line verbatim. The grabber toggles the
 * two states and is labelled for assistive tech.
 */
export function ZoneSheet({
  zoneName,
  statusLabel,
  statusColor,
  activity,
  actionLabel,
  onAction,
  expanded,
  onToggle,
  onClose,
  meters = [],
  rows = [],
}: ZoneSheetProps) {
  return (
    <View style={styles.sheet} accessibilityViewIsModal={false}>
      <ScalePress
        to={0.99}
        onPress={onToggle}
        style={styles.grabberHit}
        accessibilityRole="button"
        accessibilityLabel={expanded ? "Collapse zone details" : "Expand zone details"}
      >
        <View style={styles.grabber} />
      </ScalePress>

      <View style={styles.headRow}>
        <View style={styles.headText}>
          <Text style={styles.name} numberOfLines={1}>
            {zoneName}
          </Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.status, { color: statusColor }]}>{statusLabel}</Text>
          </View>
        </View>
        <ScalePress
          to={0.85}
          onPress={onClose}
          style={styles.closeBtn}
          accessibilityRole="button"
          accessibilityLabel="Close zone details"
        >
          <Ionicons name="close" size={18} color={colors.textDim} />
        </ScalePress>
      </View>

      {!expanded ? (
        <Text style={styles.activity} numberOfLines={1}>
          {activity}
        </Text>
      ) : (
        <View style={styles.expanded}>
          {meters.map((m) => (
            <View key={m.label} style={styles.meter}>
              <View style={styles.meterHead}>
                <Text style={styles.meterLabel}>{m.label}</Text>
                <Text style={styles.meterValue}>{Math.round(m.value)}%</Text>
              </View>
              <View style={styles.meterTrack}>
                <View
                  style={[styles.meterFill, { width: `${Math.max(0, Math.min(100, m.value))}%`, backgroundColor: m.color }]}
                />
              </View>
            </View>
          ))}
          {rows.map((r) => (
            <View key={r.label} style={styles.detailRow}>
              <Text style={styles.detailLabel}>{r.label}</Text>
              <Text style={styles.detailValue}>{r.value}</Text>
            </View>
          ))}
        </View>
      )}

      <Button label={actionLabel} onPress={onAction} style={styles.action} />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.md,
    ...shadows.float,
  },
  grabberHit: { alignItems: "center", paddingVertical: spacing.xs },
  grabber: { width: 40, height: 5, borderRadius: 3, backgroundColor: palette.dustGray },
  headRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  headText: { flex: 1, gap: 3 },
  name: { ...type.heading, fontSize: 17 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  status: { ...type.caption, fontSize: 12.5, fontWeight: "700" },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  activity: { ...type.caption, fontSize: 12.5, color: colors.textDim },
  expanded: { gap: spacing.md },
  meter: { gap: 5 },
  meterHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  meterLabel: { ...type.caption, fontSize: 12, color: colors.textDim },
  meterValue: { ...type.mono, fontSize: 12, color: colors.text },
  meterTrack: { height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
  meterFill: { height: 8, borderRadius: radius.pill },
  detailRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  detailLabel: { ...type.caption, fontSize: 12.5, color: colors.textDim },
  detailValue: { ...type.caption, fontSize: 12.5, fontWeight: "600", color: colors.text },
  action: { marginTop: spacing.xs },
});
