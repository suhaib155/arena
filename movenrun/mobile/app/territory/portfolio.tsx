/**
 * Territory Portfolio — everything you currently hold, and how safe it is.
 *
 * Reads the local zone store (which is what the shell already persists) rather
 * than adding a second source of truth. When the backend portfolio endpoint is
 * wired to a signed-in wallet, this screen swaps its data source and keeps its
 * shape — the presentation logic in `@/lib/territory` is already server-shaped.
 */
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { SectionHeader } from "@/components/SectionHeader";
import { StatCard } from "@/components/StatCard";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { HEALTH_LABEL } from "@/lib/territory";
import { buildTerritoryOverview } from "@/lib/territoryMap";
import { healthVisual } from "@/components/ZoneCard";
import { tapFeedback } from "@/lib/haptics";

export default function TerritoryPortfolioScreen() {
  const router = useRouter();
  const zones = useGameStore((s) => s.zones);
  const hydrated = useGameStore((s) => s._hydrated);
  const now = Date.now();
  const overview = useMemo(() => buildTerritoryOverview(zones, now), [zones, now]);

  const atRisk = overview.atRisk + overview.contestedPreview + overview.dormant;

  return (
    <Screen edgeTop>
      <View style={styles.headerRow}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Portfolio</Text>
        <View style={styles.backBtn} />
      </View>

      {!hydrated ? null : overview.total === 0 ? (
        <EmptyState
          icon="map-outline"
          title="No territory yet"
          message="Close a loop on a run to capture your first zone. Everything you hold will be listed here."
          actionLabel="Start Territory Run"
          onAction={() => {
            tapFeedback();
            router.push("/move");
          }}
        />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <View style={styles.statRow}>
            <StatCard icon="map" value={overview.total} label="zones held" />
            <StatCard
              icon="shield-checkmark"
              value={overview.healthy}
              label="healthy"
              tint={palette.pulseGreen}
            />
            <StatCard
              icon="alert-circle"
              value={atRisk}
              label="need defence"
              tint={palette.heatCoral}
            />
          </View>

          <View style={styles.scoreCard}>
            <Text style={styles.scoreLabel}>Territory score</Text>
            <Text style={styles.scoreValue}>{overview.territoryScore}</Text>
            <Text style={styles.scoreHint}>
              Control and defence across everything you hold. Server-confirmed
              ownership arrives with each verified run.
            </Text>
          </View>

          <SectionHeader title="Your zones" trailing={`${overview.total}`} />
          {overview.cells.map((cell) => {
            const visual = healthVisual(cell.status.health);
            return (
              <Pressable
                key={cell.zone.id}
                style={styles.zoneRow}
                onPress={() => {
                  tapFeedback();
                  router.push({ pathname: "/zone/[id]", params: { id: cell.zone.id } });
                }}
                accessibilityRole="button"
                accessibilityLabel={`${cell.zone.name}, ${HEALTH_LABEL[cell.status.health]}`}
              >
                <View style={[styles.zoneSwatch, { backgroundColor: visual.fill }]} />
                <View style={styles.zoneBody}>
                  <Text style={styles.zoneName} numberOfLines={1}>
                    {cell.zone.name}
                  </Text>
                  <Text style={styles.zoneMeta}>
                    {HEALTH_LABEL[cell.status.health]} · control {cell.status.control} · defence{" "}
                    {cell.status.defense}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
              </Pressable>
            );
          })}

          <Button
            label="Defence queue"
            icon="shield-half-outline"
            variant="secondary"
            onPress={() => {
              tapFeedback();
              router.push("/territory/defence");
            }}
            style={styles.footerButton}
          />
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
  statRow: { flexDirection: "row", gap: spacing.sm },

  scoreCard: {
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...shadows.card,
  },
  scoreLabel: { ...type.kicker, fontSize: 10 },
  scoreValue: { ...type.display, fontSize: 34, fontVariant: ["tabular-nums"] },
  scoreHint: { ...type.caption, fontSize: 11.5, lineHeight: 16, color: colors.textFaint },

  zoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  zoneSwatch: { width: 30, height: 30, borderRadius: radius.sm },
  zoneBody: { flex: 1, gap: 1 },
  zoneName: { ...type.heading, fontSize: 14.5 },
  zoneMeta: { ...type.caption, fontSize: 11.5 },

  footerButton: { marginTop: spacing.sm },
});
