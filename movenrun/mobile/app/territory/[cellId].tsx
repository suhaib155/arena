/**
 * Territory Details — one cell's state, owner, scores, neighbours and history.
 *
 * Everything shown here comes from the public territory API: cell state,
 * truncated owner references, scores and coarse timestamps. No route path, no
 * coordinates, no full wallet address — see the backend's `views.ts`, which is
 * where that boundary is enforced and tested.
 */
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { SectionHeader } from "@/components/SectionHeader";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { TERRITORY_STYLES, toRelationship } from "@/lib/territory/territoryStyle";
import {
  fetchTerritoryDetail,
  TerritoryApiError,
  type TerritoryDetail,
} from "@/services/territoryApi";
import { tapFeedback } from "@/lib/haptics";

/** Coarse "when" copy. Deliberately day-level — timing precision is a privacy
 *  leak in a game where cells map to real streets. */
function relativeDay(iso: string | null, now: number): string {
  if (!iso) return "—";
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return `${Math.floor(days / 30)} months ago`;
}

const EVENT_LABEL: Record<string, string> = {
  captured: "Captured",
  reinforced: "Reinforced",
  attacked: "Attacked",
  contested: "Contested",
  transferred: "Changed hands",
  expired: "Expired",
  released: "Released",
  restricted: "Restricted",
};

export default function TerritoryDetailScreen() {
  const router = useRouter();
  const { cellId } = useLocalSearchParams<{ cellId?: string }>();
  const [detail, setDetail] = useState<TerritoryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const now = Date.now();

  const load = useCallback(async () => {
    if (!cellId) {
      setError("No zone selected.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setDetail(await fetchTerritoryDetail(cellId));
    } catch (err) {
      setError(
        err instanceof TerritoryApiError ? err.message : "Couldn't load this zone right now.",
      );
    } finally {
      setLoading(false);
    }
  }, [cellId]);

  useEffect(() => {
    void load();
  }, [load]);

  const relationship = toRelationship(detail?.relationship);
  const style = TERRITORY_STYLES[relationship];

  return (
    <Screen edgeTop>
      <View style={styles.headerRow}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Zone</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.centreText}>Loading zone…</Text>
        </View>
      ) : error ? (
        <View style={styles.centre}>
          <Ionicons name="cloud-offline-outline" size={28} color={colors.textFaint} />
          <Text style={styles.centreText}>{error}</Text>
          <Button label="Try again" variant="secondary" onPress={() => void load()} />
        </View>
      ) : detail ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <View style={styles.stateCard}>
            <View style={[styles.stateSwatch, { backgroundColor: style.fill, borderColor: style.outline }]} />
            <View style={styles.stateBody}>
              <Text style={styles.stateLabel}>{style.label}</Text>
              <Text style={styles.stateMeta}>
                {detail.state}
                {detail.classification !== "playable" ? ` · ${detail.classification}` : ""}
              </Text>
            </View>
          </View>

          <View style={styles.metersCard}>
            <Meter label="Control" value={detail.controlScore} color={palette.baseBlue} />
            <Meter label="Defence" value={detail.defenceScore} color={palette.pulseGreen} />
          </View>

          <View style={styles.rowsCard}>
            <Row label="Owner" value={detail.owner?.displayAddress ?? "Unclaimed"} />
            <Row label="Captured" value={relativeDay(detail.capturedAt, now)} />
            <Row label="Last defended" value={relativeDay(detail.lastDefendedAt, now)} />
            <Row
              label="Neighbours"
              value={`${detail.neighbours.filter((n) => n.state !== "neutral").length} of ${detail.neighbours.length} claimed`}
            />
          </View>

          <SectionHeader title="What this zone needs" />
          <View style={styles.rowsCard}>
            {detail.captureRequirements.map((requirement) => (
              <View key={requirement} style={styles.requirementRow}>
                <Ionicons name="ellipse" size={6} color={colors.textFaint} />
                <Text style={styles.requirementText}>{requirement}</Text>
              </View>
            ))}
          </View>

          <SectionHeader title="Recent activity" />
          <View style={styles.rowsCard}>
            {detail.recentEvents.length === 0 ? (
              <Text style={styles.emptyText}>Nothing has happened here yet.</Text>
            ) : (
              detail.recentEvents.map((event, index) => (
                <View key={`${event.at}-${index}`} style={styles.eventRow}>
                  <Text style={styles.eventLabel}>
                    {EVENT_LABEL[event.eventType] ?? event.eventType}
                  </Text>
                  <Text style={styles.eventMeta}>
                    {event.actor ?? "—"} · {relativeDay(event.at, now)}
                  </Text>
                </View>
              ))
            )}
          </View>

          <View style={styles.actions}>
            {detail.actions.canCapture ? (
              <Button
                label="Run to capture"
                icon="flag"
                onPress={() => {
                  tapFeedback();
                  router.push("/move");
                }}
              />
            ) : null}
            {detail.actions.canReinforce ? (
              <Button
                label="Run to reinforce"
                icon="shield-checkmark"
                onPress={() => {
                  tapFeedback();
                  router.push("/move");
                }}
              />
            ) : null}
            {detail.actions.canAttack ? (
              <Button
                label="Run to attack"
                icon="flash"
                variant="secondary"
                onPress={() => {
                  tapFeedback();
                  router.push("/move");
                }}
              />
            ) : null}
            {!detail.actions.canCapture &&
            !detail.actions.canReinforce &&
            !detail.actions.canAttack ? (
              <Text style={styles.emptyText}>
                This ground can't be claimed — it's protected or off-limits.
              </Text>
            ) : null}
          </View>
        </ScrollView>
      ) : null}
    </Screen>
  );
}

function Meter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.meter}>
      <View style={styles.meterHead}>
        <Text style={styles.meterLabel}>{label}</Text>
        <Text style={styles.meterValue}>{value}</Text>
      </View>
      <View style={styles.meterTrack}>
        <View
          style={[styles.meterFill, { width: `${Math.min(100, value)}%`, backgroundColor: color }]}
        />
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
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

  centre: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  centreText: { ...type.caption, fontSize: 13, textAlign: "center" },

  scroll: { paddingBottom: spacing.xl, gap: spacing.md },

  stateCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  stateSwatch: { width: 38, height: 38, borderRadius: radius.sm, borderWidth: 2 },
  stateBody: { flex: 1, gap: 2 },
  stateLabel: { ...type.heading, fontSize: 16 },
  stateMeta: { ...type.caption, fontSize: 12, textTransform: "capitalize" },

  metersCard: {
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  meter: { gap: 6 },
  meterHead: { flexDirection: "row", justifyContent: "space-between" },
  meterLabel: { ...type.caption, fontSize: 12, fontWeight: "600" },
  meterValue: { ...type.mono, fontSize: 12.5, color: colors.text },
  meterTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
  },
  meterFill: { height: "100%", borderRadius: radius.pill },

  rowsCard: {
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  row: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  rowLabel: { ...type.caption, fontSize: 12.5 },
  rowValue: { ...type.caption, fontSize: 12.5, fontWeight: "700", color: colors.text, flexShrink: 1 },

  requirementRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  requirementText: { flex: 1, ...type.caption, fontSize: 12.5, lineHeight: 17 },

  eventRow: { gap: 1 },
  eventLabel: { ...type.caption, fontSize: 13, fontWeight: "700", color: colors.text },
  eventMeta: { ...type.caption, fontSize: 11.5, color: colors.textFaint },

  emptyText: { ...type.caption, fontSize: 12.5, color: colors.textFaint },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
});
