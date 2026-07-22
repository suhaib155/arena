import { useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { StatCard } from "@/components/StatCard";
import { SectionHeader } from "@/components/SectionHeader";
import { NavRow } from "@/components/NavRow";
import { StatusPill } from "@/components/StatusPill";
import { EmptyState } from "@/components/EmptyState";
import { RoutePath } from "@/components/RoutePath";
import { Hexagon } from "@/components/Hexagon";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { Button } from "@/components/Button";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { useAuthStore } from "@/store/useAuthStore";
import { getLevelInfo } from "@/lib/leveling";
import { lockedMovePreview } from "@/lib/lockedMove";
import { zoneStatus } from "@/lib/territory";
import { getClubById, CLUBS } from "@/data/clubs";
import { rankClubs, sessionsThisWeek } from "@/lib/clubs";
import { computePassport } from "@/lib/routePassport";
import { createTapGuard } from "@/lib/openingAnimation";
import { buildCollections } from "@/lib/zoneCollections";
import { buildWeeklyRecap } from "@/lib/weeklyRecap";
import { buildSeasonObjectives } from "@/lib/seasonObjectives";
import { buildCityDistricts } from "@/lib/cityDistricts";
import { buildProfileIdentity } from "@/lib/profileView";
import type { IoniconName } from "@/types";
import { tapFeedback } from "@/lib/haptics";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ProfileScreen() {
  const router = useRouter();
  // Rapid taps on "Replay opening intro" must push exactly one OpeningScreen.
  const replayGuard = useRef(createTapGuard(1200)).current;

  const totalXp = useGameStore((s) => s.totalXp);
  const streak = useGameStore((s) => s.streak);
  const questsCompleted = useGameStore((s) => s.questsCompleted);
  const history = useGameStore((s) => s.history);
  const zones = useGameStore((s) => s.zones);
  const timesDefended = useGameStore((s) => s.timesDefended);
  const selectedClubId = useGameStore((s) => s.selectedClubId);
  const selectedClub = getClubById(selectedClubId);
  const routeTrustHistory = useGameStore((s) => s.routeTrustHistory);
  const viewedRoutePassport = useGameStore((s) => s.viewedRoutePassport);
  const viewedRouteProof = useGameStore((s) => s.viewedRouteProof);
  const reset = useGameStore((s) => s.reset);

  // Identity state (server-derived, non-secret). Never rendered as ids/addresses.
  const authStatus = useAuthStore((s) => s.status);
  const authUser = useAuthStore((s) => s.user);
  const wallets = useAuthStore((s) => s.wallets);
  const identity = buildProfileIdentity({
    authStatus,
    hasUser: authUser != null,
    walletCount: wallets.length,
    hasEmbeddedWallet: wallets.some((w) => w.isEmbedded),
  });

  const statuses = zones.map((z) => ({ zone: z, status: zoneStatus(z) }));
  const atRiskCount = statuses.filter((e) => e.status.health !== "yours").length;
  const collections = buildCollections({
    savedRoutes: routeTrustHistory.length,
    cleanRoutes: routeTrustHistory.filter((r) => r.riskFlags.length === 0).length,
    hasStrongTrust: routeTrustHistory.some((r) => r.trustLabel === "Strong"),
    zonesCaptured: zones.length,
    atRiskOrWorse: atRiskCount,
    timesDefended,
    fortifyCount: zones.reduce((s, z) => s + (z.fortifyCount ?? 0), 0),
    hasClub: selectedClubId != null,
    viewedPassport: viewedRoutePassport,
    viewedProof: viewedRouteProof,
  });
  const recap = buildWeeklyRecap({
    history,
    routeTrustHistory,
    zones,
    streak,
    clubName: selectedClub?.name ?? null,
  });
  const seasonObjectives = buildSeasonObjectives({
    routesThisWeek: recap.routes,
    savedRoutes: routeTrustHistory.length,
    hasStrongTrust: routeTrustHistory.some((r) => r.trustLabel === "Strong"),
    zonesOwned: zones.length,
    atRiskOrWorse: atRiskCount,
    timesDefended,
    fortifyCount: zones.reduce((s, z) => s + (z.fortifyCount ?? 0), 0),
    hasClub: selectedClubId != null,
    streak,
    viewedPassport: viewedRoutePassport,
    viewedProof: viewedRouteProof,
    weeklyActive: recap.hasActivity,
    collectionsUnlocked: collections.unlocked,
  });
  const city = buildCityDistricts(zones);
  const passport = computePassport(routeTrustHistory, { zonesOwned: zones.length, timesDefended });
  const level = getLevelInfo(totalXp);
  const lockedMove = lockedMovePreview(totalXp);
  const myRanked = selectedClub
    ? rankClubs(CLUBS, selectedClub.id, {
        zonesOwned: zones.length,
        timesDefended,
        totalXp,
        streak,
        sessionsThisWeek: sessionsThisWeek(history),
      }).find((r) => r.isUserClub) ?? null
    : null;

  const go = (path: Href) => {
    tapFeedback();
    router.navigate(path);
  };
  const onReset = () => {
    tapFeedback();
    reset();
  };

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Identity header */}
        <FadeSlideIn>
          <View style={styles.hero}>
            <View style={styles.avatarRing}>
              <View style={styles.avatar}>
                <Ionicons name="person" size={30} color={colors.primary} />
              </View>
            </View>
            <Text style={styles.name}>Mover</Text>
            <Text style={styles.subtitle}>
              Level {level.level} · {totalXp.toLocaleString()} XP total
            </Text>
            <View style={styles.pillRow}>
              <StatusPill
                icon={identity.signedIn ? "person-circle-outline" : "phone-portrait-outline"}
                label={identity.statusLabel}
                tone={identity.signedIn ? "primary" : "neutral"}
              />
              <StatusPill
                icon={identity.walletAvailable ? "wallet-outline" : "wallet-outline"}
                label={identity.walletLabel}
                tone={identity.walletAvailable ? "success" : "neutral"}
              />
            </View>
            <View style={styles.heroBar}>
              <RoutePath
                progress={level.progress}
                label={`${level.xpForLevel - level.xpIntoLevel} XP to level ${level.level + 1}`}
              />
            </View>
          </View>
        </FadeSlideIn>

        {/* Concise real stats */}
        <FadeSlideIn delay={STAGGER_MS}>
          <View style={styles.statsRow}>
            <StatCard icon="flame" value={streak} label="Day streak" tint={palette.heatCoral} />
            <StatCard icon="trophy" value={level.level} label="Level" tint={colors.primary} />
            <StatCard icon="checkmark-done" value={questsCompleted} label="Completed" tint={palette.pulseGreen} />
          </View>
        </FadeSlideIn>

        {/* Locked MOVE — in-app progress only */}
        <FadeSlideIn delay={STAGGER_MS * 2}>
          <View style={styles.moveCard}>
            <View style={styles.moveIcon}>
              <Hexagon size={20} color={palette.moveGold} />
            </View>
            <View style={styles.moveText}>
              <Text style={styles.moveValue}>{lockedMove.toLocaleString()} Locked MOVE</Text>
              <Text style={styles.moveNote}>
                Preview · in-app progress, not a payout. Unlocks with the territory beta.
              </Text>
            </View>
          </View>
        </FadeSlideIn>

        {/* Current club */}
        <FadeSlideIn delay={STAGGER_MS * 2}>
          <NavRow
            icon={selectedClub ? "people" : "people-outline"}
            tint={selectedClub ? palette.pulseGreen : colors.primary}
            title={selectedClub ? selectedClub.name : "Choose your club"}
            subtitle={
              selectedClub
                ? `City rank #${myRanked?.rank ?? "—"} · contribution +${myRanked?.userContribution ?? 0}`
                : "Local preview · represent a club as you move"
            }
            onPress={() => go("/clubs")}
          />
        </FadeSlideIn>

        {/* Progress */}
        <NavGroup title="Progress">
          <NavRow
            icon="ribbon-outline"
            title="Season Objectives"
            subtitle={`${seasonObjectives.completed}/${seasonObjectives.total} complete · local preview`}
            trailing={`${seasonObjectives.progressPct}%`}
            onPress={() => go("/season-objectives")}
          />
          <NavRow
            icon="bar-chart-outline"
            title="Weekly Recap"
            subtitle={recap.hasActivity ? `${recap.weekLabel} · ${recap.momentumLabel}` : "Move to fill it in · local preview"}
            onPress={() => go("/weekly-recap")}
          />
          <NavRow
            icon="medal-outline"
            title="Collections"
            subtitle={`${collections.unlocked}/${collections.total} local badges · preview only`}
            onPress={() => go("/collections")}
          />
          <NavRow
            icon="trending-up-outline"
            title="District Mastery"
            subtitle="Long-term local progress · no ownership"
            onPress={() => go("/district-mastery")}
          />
        </NavGroup>

        {/* Signal & routes */}
        <NavGroup title="Signal & routes">
          <NavRow
            icon="shield-half-outline"
            title="Route Signal Passport"
            subtitle={
              passport.reviewedRouteCount > 0
                ? `${passport.readinessLabel} · ${passport.reviewedRouteCount} route${passport.reviewedRouteCount === 1 ? "" : "s"}`
                : "Local readiness preview · no raw GPS"
            }
            onPress={() => go("/route/passport")}
          />
          <NavRow
            icon="list-outline"
            title="Route Review History"
            subtitle={
              routeTrustHistory.length > 0
                ? `${routeTrustHistory.length} route${routeTrustHistory.length === 1 ? "" : "s"} · summaries only`
                : "No saved routes yet · review only, no raw GPS"
            }
            onPress={() => go("/route/review-history")}
          />
        </NavGroup>

        {/* Territory & clubs */}
        <NavGroup title="Territory & clubs">
          <NavRow
            icon="map-outline"
            title="Territory Map"
            subtitle={`${zones.length} zone${zones.length === 1 ? "" : "s"} · local board · no raw GPS`}
            onPress={() => go("/territory/map")}
          />
          <NavRow
            icon="business-outline"
            title="City Districts"
            subtitle={
              city.hasZones
                ? `${city.controlledDistricts}/${city.activeDistricts} controlled · local preview`
                : "Local city preview · capture zones to reveal"
            }
            onPress={() => go("/city-districts")}
          />
          <NavRow
            icon="flag-outline"
            title="Club Territory"
            subtitle="Local club command layer · preview"
            onPress={() => go("/club-territory")}
          />
          <NavRow
            icon="rocket-outline"
            title="Crew Missions"
            subtitle="Local weekly crew goals · preview"
            onPress={() => go("/crew-missions")}
          />
        </NavGroup>

        {/* Account & network */}
        <NavGroup title="Account & network">
          <NavRow
            icon="wallet-outline"
            title="Account & Wallet"
            subtitle={identity.signedIn ? `Signed in · ${identity.walletLabel}` : "Local profile · sign in and wallets"}
            onPress={() => go("/account")}
          />
          <NavRow
            icon="cube-outline"
            title="Base Sepolia Status"
            subtitle="Contracts deployed · read-only preview · no wallet needed"
            onPress={() => go("/network/status")}
          />
        </NavGroup>

        {/* Beta & Preview — fictional/technical previews live here */}
        <NavGroup title="Beta & Preview">
          <NavRow icon="shapes-outline" tint={palette.deedViolet} title="Deed Preview Showroom" subtitle="Educational preview · no wallet · no minting" onPress={() => go("/deed-showroom")} />
          <NavRow icon="flag-outline" tint={palette.deedViolet} title="City War Board" subtitle="Fictional season battle · no real users" onPress={() => go("/city-war")} />
          <NavRow icon="color-wand-outline" tint={palette.deedViolet} title="Rival Ghosts" subtitle="Fictional local pressure · no real users" onPress={() => go("/rivals")} />
          <NavRow icon="storefront-outline" tint={palette.deedViolet} title="Sponsor Zones" subtitle="Fictional future activations · no ads" onPress={() => go("/sponsor-zones")} />
          <NavRow icon="sparkles-outline" tint={palette.deedViolet} title="Event Zones" subtitle="Fictional future city activity · no live events" onPress={() => go("/event-zones")} />
        </NavGroup>

        {/* Recent activity */}
        <SectionHeader title="Recent activity" trailing={history.length ? `${history.length}` : undefined} />
        {history.length === 0 ? (
          <EmptyState
            icon="walk-outline"
            title="No moves yet"
            message="Complete your first quest to earn XP and start a daily streak."
            actionLabel="Browse quests"
            onAction={() => router.navigate("/")}
          />
        ) : (
          <View style={styles.list}>
            {history.slice(0, 8).map((rec, i) => (
              <View key={`${rec.questId}-${i}`} style={styles.row}>
                <View style={styles.rowIcon}>
                  <Ionicons name="checkmark" size={15} color={palette.pulseGreen} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{rec.questTitle}</Text>
                  <Text style={styles.rowTime}>{timeAgo(rec.completedAt)}</Text>
                </View>
                <Text style={styles.rowXp}>+{rec.xp} XP</Text>
              </View>
            ))}
          </View>
        )}

        {/* Account & security + support */}
        <Button
          label={identity.primaryActionLabel}
          icon="wallet-outline"
          variant="secondary"
          onPress={() => go("/account")}
        />

        <Pressable
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Replay opening intro"
          onPress={() => {
            if (!replayGuard.tryAcquire()) return;
            tapFeedback();
            router.push("/opening");
          }}
          style={styles.replayLink}
        >
          <Text style={styles.replayText}>Replay opening intro</Text>
        </Pressable>

        {history.length > 0 ? (
          <Button label="Reset progress" variant="ghost" icon="refresh-outline" onPress={onReset} style={styles.resetBtn} />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function NavGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <SectionHeader title={title} />
      <View style={styles.groupList}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Extra bottom padding clears the floating tab bar.
  content: { paddingTop: spacing.lg, paddingBottom: 120, gap: spacing.lg },
  hero: {
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    ...shadows.float,
  },
  avatarRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 3,
    borderColor: palette.baseBlue,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primaryDim,
    alignItems: "center",
    justifyContent: "center",
  },
  name: { ...type.title, fontSize: 24 },
  subtitle: { ...type.caption, fontSize: 14 },
  pillRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", justifyContent: "center", marginTop: spacing.xs },
  heroBar: { alignSelf: "stretch", marginTop: spacing.md },
  statsRow: { flexDirection: "row", gap: spacing.md },
  moveCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  moveIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: `${palette.moveGold}1A`,
    alignItems: "center",
    justifyContent: "center",
  },
  moveText: { flex: 1, gap: 2 },
  moveValue: { ...type.heading, fontSize: 16 },
  moveNote: { ...type.caption, fontSize: 12, lineHeight: 16 },
  group: { gap: spacing.sm },
  groupList: { gap: spacing.sm },
  list: { gap: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  rowIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: `${palette.pulseGreen}1A`,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1 },
  rowTitle: { ...type.heading, fontSize: 14.5 },
  rowTime: { ...type.caption, fontSize: 12, color: colors.textFaint },
  rowXp: { ...type.mono, fontSize: 13, color: "#B07908", fontWeight: "700" },
  resetBtn: { marginTop: spacing.xs, alignSelf: "center" },
  replayLink: { marginTop: spacing.lg, alignSelf: "center", paddingVertical: spacing.xs },
  replayText: { ...type.caption, fontSize: 12.5, fontWeight: "700", color: colors.primary },
});
