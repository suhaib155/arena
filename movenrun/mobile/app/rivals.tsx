import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { ScalePress } from "@/components/ScalePress";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import {
  buildRivalGhosts,
  GHOST_PRESSURE_LABEL,
  GHOST_STATUS_LABEL,
  type GhostAction,
  type RivalGhost,
} from "@/lib/rivalGhosts";
import type { IoniconName } from "@/types";
import { tapFeedback } from "@/lib/haptics";

/**
 * Rival Ghosts — local, read-only fictional pressure around the user's
 * territory. No real users, accounts, PvP, backend, network, chain, wallet,
 * map SDK, or raw GPS; ghosts are derived deterministically from safe zone ids
 * and zone health. Read-only; gates nothing.
 */
export default function RivalGhostsScreen() {
  const router = useRouter();
  const zones = useGameStore((s) => s.zones);
  const now = Date.now();
  const overview = useMemo(() => buildRivalGhosts(zones, now), [zones, now]);

  const go = (ghost: RivalGhost) => {
    tapFeedback();
    const action: GhostAction = ghost.action;
    if (action === "zone" && ghost.zoneId) {
      router.push({ pathname: "/zone/[id]", params: { id: ghost.zoneId } });
    } else if (action === "district") {
      router.push("/city-districts");
    } else if (action === "move") {
      router.push("/move");
    } else {
      router.push("/territory/map");
    }
  };

  const calm = !overview.hasPressure;

  return (
    <Screen>
      <View style={styles.headerRow}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Rival Ghosts</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <FadeSlideIn>
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>Rival Ghosts</Text>
            <Text style={styles.heroTitle}>Fictional pressure around your local territory.</Text>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: `${palette.baseBlue}14` }]}>
                <Ionicons name="eye-outline" size={13} color={palette.baseBlue} />
                <Text style={[styles.badgeText, { color: palette.baseBlue }]}>Local preview</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: `${palette.deedViolet}14` }]}>
                <Ionicons name="color-wand-outline" size={13} color={palette.deedViolet} />
                <Text style={[styles.badgeText, { color: palette.deedViolet }]}>Fictional rivals</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: colors.surfaceAlt }]}>
                <Ionicons name="person-remove-outline" size={13} color={colors.textDim} />
                <Text style={[styles.badgeText, { color: colors.textDim }]}>No real users</Text>
              </View>
            </View>
          </View>
        </FadeSlideIn>

        {/* Pressure summary */}
        <FadeSlideIn delay={STAGGER_MS}>
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Stat value={overview.active} label="rivals" />
              <View style={styles.sumDivider} />
              <Stat
                value={overview.highPressure}
                label="high pressure"
                tint={overview.highPressure > 0 ? "#C2492E" : undefined}
              />
              <View style={styles.sumDivider} />
              <Stat value={overview.blocked} label="held off" tint="#0A8F60" />
            </View>
            <Text style={styles.summaryNext}>
              {overview.topResponse
                ? `Next · ${overview.topResponse.recommendation}`
                : "No rival pressure right now."}
            </Text>
          </View>
        </FadeSlideIn>

        {overview.ghosts.length === 0 ? (
          <FadeSlideIn delay={STAGGER_MS * 2}>
            <View style={styles.calmCard}>
              <Ionicons name="shield-checkmark-outline" size={28} color={palette.pulseGreen} />
              <Text style={styles.calmText}>No rival pressure right now.</Text>
              <Button
                label="View Territory Map"
                variant="secondary"
                onPress={() => {
                  tapFeedback();
                  router.push("/territory/map");
                }}
                style={styles.calmBtn}
              />
            </View>
          </FadeSlideIn>
        ) : (
          <>
            {calm ? (
              <FadeSlideIn delay={STAGGER_MS * 2}>
                <View style={styles.calmBanner}>
                  <Ionicons name="shield-checkmark" size={16} color={palette.pulseGreen} />
                  <Text style={styles.calmBannerText}>
                    No active rival pressure — these rivals are held off.
                  </Text>
                </View>
              </FadeSlideIn>
            ) : null}
            <View style={styles.list}>
              {overview.ghosts.map((g, i) => (
                <FadeSlideIn key={g.id} delay={STAGGER_MS * (2 + Math.min(i, 6))}>
                  <GhostRow ghost={g} onPress={() => go(g)} />
                </FadeSlideIn>
              ))}
            </View>
          </>
        )}

        <Text style={styles.footerNote}>
          Rival ghosts are fictional local previews. They are not real users,
          rewards, or on-chain activity.
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

function GhostRow({ ghost, onPress }: { ghost: RivalGhost; onPress: () => void }) {
  const where = ghost.districtName ?? ghost.zoneName ?? "your territory";
  return (
    <View style={styles.ghost}>
      <View style={[styles.ghostAvatar, { backgroundColor: `${ghost.accent}1A` }]}>
        <Ionicons name={ghost.icon as IoniconName} size={20} color={ghost.accent} />
      </View>
      <View style={styles.ghostBody}>
        <View style={styles.ghostTitleRow}>
          <Text style={styles.ghostName} numberOfLines={1}>{ghost.name}</Text>
          <View style={[styles.statusChip, { backgroundColor: `${ghost.accent}1A` }]}>
            <Text style={[styles.statusText, { color: ghost.accent }]}>
              {GHOST_STATUS_LABEL[ghost.status]}
            </Text>
          </View>
        </View>
        <Text style={styles.ghostMeta}>
          {GHOST_PRESSURE_LABEL[ghost.pressure]} pressure · {where}
        </Text>
        <Text style={styles.ghostRec}>{ghost.recommendation}</Text>
        <Pressable hitSlop={8} onPress={onPress} style={styles.ctaBtn}>
          <Text style={[styles.ctaText, { color: ghost.accent }]}>{ghost.ctaLabel}</Text>
          <Ionicons name="chevron-forward" size={13} color={ghost.accent} />
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
  statLabel: { ...type.caption, fontSize: 11, textAlign: "center" },
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
  calmText: { ...type.heading, fontSize: 16, textAlign: "center" },
  calmBtn: { alignSelf: "stretch" },
  calmBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: `${palette.pulseGreen}12`,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  calmBannerText: { flex: 1, ...type.caption, fontSize: 12.5, color: "#0A8F60", fontWeight: "600" },

  list: { gap: spacing.sm },
  ghost: {
    flexDirection: "row",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  ghostAvatar: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  ghostBody: { flex: 1, gap: 3 },
  ghostTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  ghostName: { ...type.heading, fontSize: 14.5, flex: 1 },
  statusChip: { borderRadius: radius.pill, paddingVertical: 2, paddingHorizontal: spacing.sm },
  statusText: { fontSize: 10, fontWeight: "800" },
  ghostMeta: { ...type.mono, fontSize: 10.5, color: colors.textFaint },
  ghostRec: { ...type.caption, fontSize: 12, lineHeight: 16, color: colors.textDim },
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
