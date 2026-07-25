/**
 * Territory Defence — what to run next, ordered by how close it is to falling.
 *
 * The whole point of this screen is prioritisation: a list of everything you
 * own is the Portfolio, but a runner with 20 minutes wants to know which single
 * zone to go and stand in. Ordering is by the existing risk model in
 * `@/lib/territory`, so it matches what every other surface already says.
 */
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { byRisk, HEALTH_LABEL, zoneStatus } from "@/lib/territory";
import { healthVisual } from "@/components/ZoneCard";
import { tapFeedback } from "@/lib/haptics";

export default function TerritoryDefenceScreen() {
  const router = useRouter();
  const zones = useGameStore((s) => s.zones);
  const hydrated = useGameStore((s) => s._hydrated);
  const now = Date.now();

  const queue = useMemo(() => {
    return zones
      .map((zone) => ({ zone, status: zoneStatus(zone, now) }))
      .filter((entry) => entry.status.health !== "yours")
      .sort((a, b) => byRisk(a.zone, b.zone, now));
  }, [zones, now]);

  const priority = queue[0] ?? null;

  return (
    <Screen edgeTop>
      <View style={styles.headerRow}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Defence</Text>
        <View style={styles.backBtn} />
      </View>

      {!hydrated ? null : zones.length === 0 ? (
        <EmptyState
          icon="shield-outline"
          title="Nothing to defend yet"
          message="Capture your first zone and it will appear here when it needs attention."
          actionLabel="Start Territory Run"
          onAction={() => {
            tapFeedback();
            router.push("/move");
          }}
        />
      ) : queue.length === 0 ? (
        <EmptyState
          icon="checkmark-circle-outline"
          title="Everything is holding"
          message="No zone needs defending right now. Running through the ones you own keeps it that way."
          actionLabel="Start Territory Run"
          onAction={() => {
            tapFeedback();
            router.push("/move");
          }}
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {priority ? (
            <View style={styles.priorityCard}>
              <Text style={styles.priorityKicker}>Defend next</Text>
              <Text style={styles.priorityName} numberOfLines={1}>
                {priority.zone.name}
              </Text>
              <Text style={styles.priorityMeta}>
                {HEALTH_LABEL[priority.status.health]} · {priority.status.risk}% risk · defence{" "}
                {priority.status.defense}
              </Text>
              <Text style={styles.priorityHint}>
                Running through a zone you own reinforces it more than enclosing it
                from outside. Ownership is confirmed by the server after the run.
              </Text>
              <Button
                label="Start Territory Run"
                icon="walk"
                onPress={() => {
                  tapFeedback();
                  router.push("/move");
                }}
              />
            </View>
          ) : null}

          <Text style={styles.listHeading}>
            {queue.length} zone{queue.length === 1 ? "" : "s"} need attention
          </Text>

          {queue.map(({ zone, status }) => {
            const visual = healthVisual(status.health);
            return (
              <Pressable
                key={zone.id}
                style={styles.row}
                onPress={() => {
                  tapFeedback();
                  router.push({ pathname: "/zone/[id]", params: { id: zone.id } });
                }}
                accessibilityRole="button"
                accessibilityLabel={`${zone.name}, ${HEALTH_LABEL[status.health]}, ${status.risk}% risk`}
              >
                <View style={[styles.rowSwatch, { backgroundColor: visual.fill }]} />
                <View style={styles.rowBody}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {zone.name}
                  </Text>
                  <Text style={styles.rowMeta}>
                    {HEALTH_LABEL[status.health]} · defence {status.defense}
                  </Text>
                </View>
                <View style={styles.riskWrap}>
                  <Text style={[styles.riskValue, { color: visual.core }]}>{status.risk}%</Text>
                  <Text style={styles.riskLabel}>risk</Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...type.heading, fontSize: 17 },

  scroll: { paddingBottom: spacing.xl, gap: spacing.md },

  priorityCard: {
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...shadows.float,
  },
  priorityKicker: { ...type.kicker, color: palette.heatCoral, fontSize: 10 },
  priorityName: { ...type.title, fontSize: 20 },
  priorityMeta: { ...type.caption, fontSize: 12.5 },
  priorityHint: { ...type.caption, fontSize: 11.5, lineHeight: 16, color: colors.textFaint },

  listHeading: { ...type.kicker, fontSize: 10 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  rowSwatch: { width: 30, height: 30, borderRadius: radius.sm },
  rowBody: { flex: 1, gap: 1 },
  rowName: { ...type.heading, fontSize: 14.5 },
  rowMeta: { ...type.caption, fontSize: 11.5 },
  riskWrap: { alignItems: "flex-end" },
  riskValue: { ...type.heading, fontSize: 15, fontVariant: ["tabular-nums"] },
  riskLabel: { ...type.caption, fontSize: 10, color: colors.textFaint },
});
