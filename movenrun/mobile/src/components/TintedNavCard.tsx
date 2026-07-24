import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { alpha } from "@/lib/gradient";
import { radius, spacing, tints, type, type TintName } from "@/theme";
import { ScalePress } from "./ScalePress";

interface TintedNavCardProps {
  /** Tiny uppercase micro-label, e.g. "SEASON". */
  kicker: string;
  /** The headline — this is what the row is really about. */
  title: string;
  /** One short supporting line. */
  detail?: string;
  /** Trailing figure, e.g. "12%" or "2/17". */
  value?: string;
  /** 0..1 — draws a slim progress bar in the tint's ink. */
  progress?: number;
  tone: TintName;
  onPress: () => void;
}

/**
 * A tappable tinted card for a list of destinations.
 *
 * Deliberately icon-free: a coloured icon tile on every row is what makes a
 * list read as a template. Here the tint carries the identity, the kicker
 * carries the category, and the title gets the weight — so a stack of these
 * reads as a designed set rather than a settings menu.
 */
export function TintedNavCard({
  kicker,
  title,
  detail,
  value,
  progress,
  tone,
  onPress,
}: TintedNavCardProps) {
  const t = tints[tone];
  const pct = progress == null ? null : Math.max(0, Math.min(1, progress));
  return (
    <ScalePress
      to={0.985}
      onPress={onPress}
      style={[styles.card, { backgroundColor: t.bg, borderColor: t.edge }]}
      accessibilityRole="button"
      accessibilityLabel={[kicker, title, detail, value].filter(Boolean).join(". ")}
    >
      <View style={styles.head}>
        <Text style={[styles.kicker, { color: alpha(t.ink, 0.75) }]} numberOfLines={1}>
          {kicker}
        </Text>
        <View style={styles.trailing}>
          {value ? <Text style={[styles.value, { color: t.ink }]}>{value}</Text> : null}
          <Ionicons name="chevron-forward" size={15} color={alpha(t.ink, 0.5)} />
        </View>
      </View>

      <Text style={[styles.title, { color: t.ink }]} numberOfLines={2}>
        {title}
      </Text>

      {pct != null ? (
        <View style={[styles.track, { backgroundColor: alpha(t.ink, 0.14) }]}>
          <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: t.ink }]} />
        </View>
      ) : null}

      {detail ? (
        <Text style={[styles.detail, { color: alpha(t.ink, 0.8) }]} numberOfLines={1}>
          {detail}
        </Text>
      ) : null}
    </ScalePress>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.sm,
    minHeight: 88,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  kicker: { ...type.kicker, fontSize: 10 },
  trailing: { flexDirection: "row", alignItems: "center", gap: 5 },
  value: { fontSize: 14, fontWeight: "800", fontVariant: ["tabular-nums"], letterSpacing: -0.3 },
  title: { ...type.title, fontSize: 19, letterSpacing: -0.6 },
  track: { height: 6, borderRadius: radius.pill, overflow: "hidden" },
  fill: { height: 6, borderRadius: radius.pill },
  detail: { fontSize: 12.5, fontWeight: "600" },
});
