import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { Hexagon } from "@/components/Hexagon";
import { zoneStateCore, zoneStateFill } from "@/components/ZoneCard";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { getLastSession } from "@/services/moveSession";
import { ZONE_STATE_LABEL } from "@/lib/zones";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " · " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Local zone detail — Free Map Beta. No defend action, no deeds, no chain. */
export default function ZoneDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const zone = useGameStore((s) => s.zones.find((z) => z.id === id));
  const hasSession = getLastSession() !== null;

  if (!zone) {
    return (
      <Screen>
        <View style={styles.missing}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.textFaint} />
          <Text style={styles.missingText}>That zone isn&apos;t in your portfolio.</Text>
          <Button label="Back" variant="secondary" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </Pressable>
          <Text style={styles.topTitle}>Zone</Text>
          <View style={{ width: 26 }} />
        </View>

        <View style={styles.hero}>
          <Hexagon
            size={88}
            color={zoneStateFill(zone.state)}
            coreColor={zoneStateCore(zone.state)}
          />
          <Text style={styles.name}>{zone.name}</Text>
          <View style={styles.chipsRow}>
            <View style={[styles.chip, { backgroundColor: `${zoneStateCore(zone.state)}1A` }]}>
              <Text style={[styles.chipText, { color: "#0A8F60" }]}>
                {ZONE_STATE_LABEL[zone.state]}
              </Text>
            </View>
            <View style={[styles.chip, { backgroundColor: colors.surfaceAlt }]}>
              <Text style={[styles.chipText, { color: colors.textDim }]}>Common Zone</Text>
            </View>
          </View>
          <Text style={styles.zoneId}>{zone.id}</Text>
        </View>

        <View style={styles.meterCard}>
          <View style={styles.meterRow}>
            <Text style={styles.meterTitle}>Control</Text>
            <Text style={styles.meterValue}>{zone.controlPercent}%</Text>
          </View>
          <View style={styles.meterTrack}>
            <View
              style={[styles.meterFill, { width: `${zone.controlPercent}%`, backgroundColor: palette.voltMint }]}
            />
          </View>

          <View style={[styles.meterRow, { marginTop: spacing.md }]}>
            <View style={styles.meterTitleRow}>
              <Text style={styles.meterTitle}>Defense</Text>
              <Ionicons name="lock-closed" size={12} color={colors.textFaint} />
            </View>
            <Text style={[styles.meterValue, { color: colors.textFaint }]}>
              {zone.defensePercent}%
            </Text>
          </View>
          <View style={styles.meterTrack}>
            <View
              style={[styles.meterFill, { width: `${Math.max(zone.defensePercent, 2)}%`, backgroundColor: palette.silverTrail }]}
            />
          </View>
          <Text style={styles.meterNote}>Defense unlocks with the Defend loop — arriving next.</Text>
        </View>

        <Text style={styles.sectionTitle}>Recent activity</Text>
        <View style={styles.activity}>
          <View style={styles.activityRow}>
            <View style={[styles.activityIcon, { backgroundColor: `${palette.pulseGreen}1A` }]}>
              <Ionicons name="flag" size={14} color={palette.pulseGreen} />
            </View>
            <Text style={styles.activityText}>Zone captured</Text>
            <Text style={styles.activityWhen}>{formatWhen(zone.capturedAt)}</Text>
          </View>
          <View style={styles.activityRow}>
            <View style={[styles.activityIcon, { backgroundColor: `${palette.baseBlue}14` }]}>
              <Ionicons name="navigate" size={14} color={palette.baseBlue} />
            </View>
            <Text style={styles.activityText}>Route touched this zone</Text>
            <Text style={styles.activityWhen}>{formatWhen(zone.lastTouchedAt)}</Text>
          </View>
        </View>

        <Text style={styles.betaNote}>Local territory preview · on-device simulation</Text>
      </ScrollView>

      <View style={styles.footer}>
        {hasSession ? (
          <Button
            label="View route summary"
            icon="analytics-outline"
            variant="secondary"
            onPress={() => router.push("/move/summary")}
          />
        ) : null}
        <Button label="Defend soon" icon="shield-outline" variant="secondary" disabled onPress={() => {}} />
        <Button label="Back to Today" icon="home" onPress={() => router.dismissAll()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.lg, gap: spacing.lg },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.md,
  },
  topTitle: { ...type.heading, fontSize: 16 },
  hero: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md },
  name: { ...type.display, fontSize: 26, marginTop: spacing.xs },
  chipsRow: { flexDirection: "row", gap: spacing.sm },
  chip: {
    paddingVertical: 5,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
  chipText: { fontSize: 12, fontWeight: "700" },
  zoneId: { ...type.mono, fontSize: 11.5, color: colors.textFaint },
  meterCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
  meterRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  meterTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  meterTitle: { ...type.heading, fontSize: 14.5 },
  meterValue: { ...type.mono, fontSize: 13, fontWeight: "700", color: colors.text },
  meterTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
  },
  meterFill: { height: "100%", borderRadius: radius.pill },
  meterNote: { ...type.caption, fontSize: 11.5, color: colors.textFaint },
  sectionTitle: { ...type.heading, fontSize: 17 },
  activity: { gap: spacing.sm },
  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  activityIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  activityText: { ...type.caption, fontSize: 13.5, color: colors.text, fontWeight: "600", flex: 1 },
  activityWhen: { ...type.mono, fontSize: 11, color: colors.textFaint },
  betaNote: { ...type.mono, fontSize: 11, color: colors.textFaint, textAlign: "center" },
  footer: { paddingVertical: spacing.md, gap: spacing.sm },
  missing: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg },
  missingText: { ...type.body },
});
