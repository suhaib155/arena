import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { getLocalDateKey } from "@/lib/date";
import {
  buildTerritoryAlerts,
  type AlertAction,
  type AlertSeverity,
  type TerritoryAlert,
} from "@/lib/territoryAlerts";
import type { IoniconName } from "@/types";
import { tapFeedback } from "@/lib/haptics";

const SEVERITY: Record<AlertSeverity, { label: string; core: string; text: string; soft: string }> = {
  urgent: { label: "Urgent", core: palette.heatCoral, text: "#C2492E", soft: `${palette.heatCoral}1A` },
  caution: { label: "Caution", core: palette.moveGold, text: "#B07908", soft: `${palette.moveGold}1F` },
  info: { label: "Info", core: palette.baseBlue, text: palette.baseBlue, soft: `${palette.baseBlue}14` },
  success: { label: "Healthy", core: palette.pulseGreen, text: "#0A8F60", soft: `${palette.pulseGreen}1A` },
};

const CATEGORY_ICON: Record<TerritoryAlert["category"], IoniconName> = {
  defend: "navigate-outline",
  fortify: "shield-outline",
  dormant: "moon-outline",
  healthy: "checkmark-circle-outline",
  progress: "trail-sign-outline",
};

/**
 * Territory Alerts — local, in-app reminders derived from zone state. No push
 * notifications, permissions, background tasks, backend, chain, or GPS. Alerts
 * are suggestions and gate nothing.
 */
export default function TerritoryAlertsScreen() {
  const router = useRouter();
  const zones = useGameStore((s) => s.zones);
  const streak = useGameStore((s) => s.streak);
  const lastActiveDay = useGameStore((s) => s.lastActiveDay);

  const summary = useMemo(
    () =>
      buildTerritoryAlerts({
        zones,
        streak,
        hasRecentActivity: lastActiveDay === getLocalDateKey(),
      }),
    [zones, streak, lastActiveDay],
  );

  const go = (alert: TerritoryAlert) => {
    tapFeedback();
    const action: AlertAction = alert.action;
    if (action === "zone" && alert.zoneId) {
      router.push({ pathname: "/zone/[id]", params: { id: alert.zoneId } });
    } else if (action === "map") {
      router.push("/territory/map");
    } else if (action === "move") {
      router.push("/move");
    } else {
      router.dismissAll();
    }
  };

  const calm = summary.urgent === 0 && summary.caution === 0;

  return (
    <Screen>
      <View style={styles.headerRow}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Alerts</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <FadeSlideIn>
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>Territory Alerts</Text>
            <Text style={styles.heroTitle}>Local reminders for what needs attention next.</Text>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: `${palette.baseBlue}14` }]}>
                <Ionicons name="phone-portrait-outline" size={13} color={palette.baseBlue} />
                <Text style={[styles.badgeText, { color: palette.baseBlue }]}>In-app only</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: colors.surfaceAlt }]}>
                <Ionicons name="eye-outline" size={13} color={colors.textDim} />
                <Text style={[styles.badgeText, { color: colors.textDim }]}>Local preview</Text>
              </View>
            </View>
          </View>
        </FadeSlideIn>

        {/* Summary */}
        <FadeSlideIn delay={STAGGER_MS}>
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Stat value={summary.urgent} label="urgent" tint={summary.urgent > 0 ? "#C2492E" : undefined} />
              <View style={styles.sumDivider} />
              <Stat value={summary.caution} label="caution" tint={summary.caution > 0 ? "#B07908" : undefined} />
              <View style={styles.sumDivider} />
              <Stat value={summary.positive} label="healthy" tint="#0A8F60" />
            </View>
            {summary.topAction ? (
              <Text style={styles.summaryNext}>Next · {summary.topAction.title}</Text>
            ) : null}
          </View>
        </FadeSlideIn>

        {/* Alert list / calm state */}
        {calm && summary.alerts.every((a) => a.severity === "success") ? (
          <FadeSlideIn delay={STAGGER_MS * 2}>
            <View style={styles.calmCard}>
              <Ionicons name="leaf-outline" size={28} color={palette.pulseGreen} />
              <Text style={styles.calmText}>Your territory is calm.</Text>
              <Pressable
                style={styles.calmBtn}
                onPress={() => {
                  tapFeedback();
                  router.push("/territory/map");
                }}
              >
                <Text style={styles.calmBtnText}>View Territory Map</Text>
              </Pressable>
            </View>
          </FadeSlideIn>
        ) : (
          <View style={styles.list}>
            {summary.alerts.map((a, i) => (
              <FadeSlideIn key={a.id} delay={STAGGER_MS * (2 + Math.min(i, 6))}>
                <AlertRow alert={a} onPress={() => go(a)} />
              </FadeSlideIn>
            ))}
          </View>
        )}

        <Text style={styles.footerNote}>
          Alerts are local suggestions. They do not affect rewards, ownership, or
          on-chain status.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function Stat({ value, label, tint }: { value: number; label: string; tint?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, tint ? { color: tint } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function AlertRow({ alert, onPress }: { alert: TerritoryAlert; onPress: () => void }) {
  const sev = SEVERITY[alert.severity];
  return (
    <View style={styles.alert}>
      <View style={[styles.alertIcon, { backgroundColor: sev.soft }]}>
        <Ionicons name={CATEGORY_ICON[alert.category]} size={18} color={sev.core} />
      </View>
      <View style={styles.alertBody}>
        <View style={styles.alertTitleRow}>
          <Text style={styles.alertTitle} numberOfLines={1}>{alert.title}</Text>
          <View style={[styles.sevChip, { backgroundColor: sev.soft }]}>
            <Text style={[styles.sevText, { color: sev.text }]}>{sev.label}</Text>
          </View>
        </View>
        <Text style={styles.alertDesc}>{alert.description}</Text>
        <Pressable hitSlop={8} onPress={onPress} style={styles.ctaBtn}>
          <Text style={[styles.ctaText, { color: sev.text }]}>{alert.ctaLabel}</Text>
          <Ionicons name="chevron-forward" size={13} color={sev.text} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  backBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...type.heading, fontSize: 16 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 48, gap: spacing.lg },

  hero: { gap: spacing.sm, paddingTop: spacing.sm },
  heroKicker: { ...type.kicker, color: colors.primary },
  heroTitle: { ...type.display, fontSize: 23, lineHeight: 29 },
  badgeRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", marginTop: spacing.xs },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
  },
  badgeText: { fontSize: 12, fontWeight: "700" },

  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  summaryRow: { flexDirection: "row", alignItems: "center" },
  stat: { flex: 1, alignItems: "center", gap: 2 },
  statValue: { ...type.title, fontSize: 22, fontVariant: ["tabular-nums"] },
  statLabel: { ...type.caption, fontSize: 11 },
  sumDivider: { width: 1, alignSelf: "stretch", marginVertical: 6, backgroundColor: colors.surfaceAlt },
  summaryNext: { ...type.caption, fontSize: 12.5, color: colors.textDim, textAlign: "center" },

  calmCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.md,
    ...shadows.card,
  },
  calmText: { ...type.heading, fontSize: 16 },
  calmBtn: {
    backgroundColor: colors.primaryDim,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  calmBtnText: { ...type.caption, fontSize: 13, fontWeight: "800", color: colors.primary },

  list: { gap: spacing.sm },
  alert: {
    flexDirection: "row",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  alertIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  alertBody: { flex: 1, gap: 4 },
  alertTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  alertTitle: { ...type.heading, fontSize: 14.5, flex: 1 },
  sevChip: { borderRadius: radius.pill, paddingVertical: 2, paddingHorizontal: spacing.sm },
  sevText: { fontSize: 10, fontWeight: "800" },
  alertDesc: { ...type.caption, fontSize: 12, lineHeight: 16, color: colors.textDim },
  ctaBtn: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  ctaText: { ...type.caption, fontSize: 12.5, fontWeight: "700" },

  footerNote: {
    ...type.mono,
    fontSize: 11,
    color: colors.textFaint,
    textAlign: "center",
    paddingTop: spacing.xs,
  },
});
