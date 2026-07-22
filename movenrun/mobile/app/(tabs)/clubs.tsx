import { useEffect, useMemo, useRef } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { Hexagon } from "@/components/Hexagon";
import { ScalePress } from "@/components/ScalePress";
import { RankRow } from "@/components/RankRow";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { CLUBS, getClubById } from "@/data/clubs";
import { zoneStatus } from "@/lib/territory";
import {
  rankClubs,
  seasonResetLabel,
  sessionsThisWeek,
  type RankedClub,
} from "@/lib/clubs";
import { selectClubMission, buildClubHeroView } from "@/lib/clubsView";
import type { Club } from "@/types";
import { successFeedback, tapFeedback } from "@/lib/haptics";

/** Pre-blended pastel fill for a club color over the mist panel. */
function pastelFor(color: string): string {
  const map: Record<string, string> = {
    [palette.baseBlue]: "#D4E2FE",
    [palette.heatCoral]: "#FFDCD2",
    [palette.moveGold]: "#FBEACB",
    [palette.deedViolet]: "#E1DAFF",
    [palette.pulseGreen]: "#C9EEDE",
  };
  return map[color] ?? "#E8EDF0";
}

/**
 * Clubs — Free Map Beta. The local social/competitive layer: a featured club
 * hero, one current mission, and a compact leaderboard where your real local
 * stats power your club. No backend, sync, messaging, or club economy — all
 * data is a local preview and labelled as such. Ranking logic is unchanged.
 */
export default function ClubsScreen() {
  const selectedClubId = useGameStore((s) => s.selectedClubId);
  const selected = getClubById(selectedClubId);

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.greeting}>City War Preview</Text>
          <Text style={styles.title}>{selected ? "Your club this week" : "Find your club"}</Text>
        </View>
        {selected ? <ClubHome club={selected} /> : <ChooseClub />}
        <Text style={styles.footerNote}>Local preview · online clubs and city wars arrive later.</Text>
      </ScrollView>
    </Screen>
  );
}

/* ───────────────────────── no-club discovery ───────────────────────── */

function ChooseClub() {
  const selectClub = useGameStore((s) => s.selectClub);
  return (
    <View style={styles.chooseWrap}>
      <View style={styles.valueCard}>
        <Text style={styles.valueTitle}>Represent a club as you move</Text>
        <Text style={styles.valueText}>
          Your captured zones, defends, and sessions power your club's weekly
          score on this device. It's a local preview — online city wars arrive
          later.
        </Text>
      </View>
      <Text style={styles.sectionLabel}>Available clubs</Text>
      {CLUBS.map((club, i) => (
        <FadeSlideIn key={club.id} delay={STAGGER_MS * i}>
          <ScalePress
            to={0.98}
            style={styles.clubOption}
            onPress={() => {
              tapFeedback();
              selectClub(club.id);
              successFeedback();
            }}
            accessibilityRole="button"
            accessibilityLabel={`Join ${club.name}. ${club.memberCount} movers`}
          >
            <Hexagon size={40} color={pastelFor(club.color)} coreColor={club.color} />
            <View style={styles.clubOptionBody}>
              <Text style={styles.clubOptionName}>{club.name}</Text>
              <Text style={styles.clubOptionMotto} numberOfLines={1}>
                “{club.motto}”
              </Text>
            </View>
            <View style={styles.joinChip}>
              <Text style={styles.joinChipText}>Join</Text>
            </View>
          </ScalePress>
        </FadeSlideIn>
      ))}
    </View>
  );
}

/* ───────────────────────── selected-club home ──────────────────────── */

function ClubHome({ club }: { club: Club }) {
  const router = useRouter();
  const selectClub = useGameStore((s) => s.selectClub);
  const zones = useGameStore((s) => s.zones);
  const timesDefended = useGameStore((s) => s.timesDefended);
  const totalXp = useGameStore((s) => s.totalXp);
  const streak = useGameStore((s) => s.streak);
  const history = useGameStore((s) => s.history);

  const ranked = useMemo(
    () =>
      rankClubs(CLUBS, club.id, {
        zonesOwned: zones.length,
        timesDefended,
        totalXp,
        streak,
        sessionsThisWeek: sessionsThisWeek(history),
      }),
    [club.id, zones.length, timesDefended, totalXp, streak, history],
  );
  const mine = ranked.find((r) => r.isUserClub) ?? null;
  const weekSessions = sessionsThisWeek(history);
  const atRiskZones = zones.filter((z) => zoneStatus(z).health !== "yours").length;
  const heroView = buildClubHeroView(mine);
  const mission = selectClubMission({
    hasClub: true,
    userContribution: mine?.userContribution ?? 0,
    rank: mine?.rank ?? null,
    zonesOwned: zones.length,
    atRiskZones,
  });

  const runMission = () => {
    tapFeedback();
    if (mission.action === "map") router.push("/territory/map");
    else router.push("/move");
  };

  return (
    <View style={styles.homeWrap}>
      {/* Featured club hero */}
      <FadeSlideIn>
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={styles.warChip}>
              <View style={styles.warDot} />
              <Text style={styles.warChipText}>Season preview</Text>
            </View>
            <Text style={styles.warCountdown}>{seasonResetLabel()}</Text>
          </View>

          <CityWarMap ranked={ranked} />

          <View style={styles.heroIdentity}>
            <Hexagon size={44} color="#C9EEDE" coreColor={palette.pulseGreen} />
            <View style={styles.heroIdentityBody}>
              <View style={styles.heroNameRow}>
                <Text style={styles.heroName}>{club.name}</Text>
                <View style={styles.youChip}>
                  <Text style={styles.youChipText}>Your club</Text>
                </View>
              </View>
              <Text style={styles.heroMotto} numberOfLines={1}>
                “{club.motto}”
              </Text>
            </View>
            <Pressable
              hitSlop={10}
              onPress={() => {
                tapFeedback();
                selectClub("");
              }}
              accessibilityRole="button"
              accessibilityLabel="Switch club"
            >
              <Text style={styles.switchLink}>Switch</Text>
            </Pressable>
          </View>

          <View style={styles.heroStats}>
            <HeroStat label="Rank" value={heroView.rankLabel} tint={heroView.rankAvailable ? palette.baseBlue : colors.textFaint} />
            <View style={styles.heroStatDivider} />
            <HeroStat label="Your contribution" value={heroView.contributionLabel} tint={heroView.hasContribution ? "#0A8F60" : colors.textFaint} wide />
          </View>
          <Text style={styles.heroSummary}>
            {zones.length} zone{zones.length === 1 ? "" : "s"} · defended ×{timesDefended} ·{" "}
            {weekSessions} session{weekSessions === 1 ? "" : "s"} this week
          </Text>
        </View>
      </FadeSlideIn>

      {/* One current mission */}
      <FadeSlideIn delay={STAGGER_MS}>
        <View style={styles.missionCard}>
          <View style={styles.missionIcon}>
            <Ionicons name="flag-outline" size={20} color={palette.baseBlue} />
          </View>
          <View style={styles.missionBody}>
            <Text style={styles.missionKicker}>Club mission</Text>
            <Text style={styles.missionTitle}>{mission.title}</Text>
            <Text style={styles.missionDetail}>{mission.detail}</Text>
          </View>
        </View>
      </FadeSlideIn>
      <FadeSlideIn delay={STAGGER_MS}>
        <Button label={mission.ctaLabel} icon="play" onPress={runMission} />
      </FadeSlideIn>

      {/* Club Territory command layer (compact) */}
      <FadeSlideIn delay={STAGGER_MS * 2}>
        <ScalePress
          to={0.98}
          style={styles.territoryCta}
          onPress={() => {
            tapFeedback();
            router.push("/club-territory");
          }}
          accessibilityRole="button"
          accessibilityLabel="Club Territory. Your local club command layer, preview"
        >
          <View style={styles.territoryCtaIcon}>
            <Ionicons name="map-outline" size={18} color={colors.primary} />
          </View>
          <View style={styles.territoryCtaBody}>
            <Text style={styles.territoryCtaName}>Club Territory</Text>
            <Text style={styles.territoryCtaNote}>Your local club command layer · preview</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
        </ScalePress>
      </FadeSlideIn>

      {/* Compact leaderboard */}
      <FadeSlideIn delay={STAGGER_MS * 3}>
        <Text style={styles.sectionTitle}>City leaderboard</Text>
      </FadeSlideIn>
      <View style={styles.board}>
        {ranked.map((entry, i) => (
          <FadeSlideIn key={entry.club.id} delay={STAGGER_MS * (3 + Math.min(i, 4))}>
            <RankRow
              rank={entry.rank}
              name={entry.club.name}
              meta={`${entry.club.zonesOwned} zones · ${entry.club.zonesDefended} defended · ${entry.club.weeklyDistanceKm} km/wk${entry.isUserClub && entry.userContribution > 0 ? ` · +${entry.userContribution} you` : ""}`}
              score={entry.score.toLocaleString()}
              trend={entry.trend}
              accent={entry.isUserClub ? palette.pulseGreen : entry.club.color}
              pastel={pastelFor(entry.isUserClub ? palette.pulseGreen : entry.club.color)}
              isMine={entry.isUserClub}
            />
          </FadeSlideIn>
        ))}
      </View>
    </View>
  );
}

function HeroStat({ label, value, tint, wide }: { label: string; value: string; tint: string; wide?: boolean }) {
  return (
    <View style={[styles.heroStat, wide ? styles.heroStatWide : null]} accessibilityLabel={`${label}: ${value}`}>
      <Text style={[styles.heroStatValue, { color: tint }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.heroStatLabel}>{label}</Text>
    </View>
  );
}

/* ───────────────────────── city war map ────────────────────────────── */

const WAR_CELLS = 18;

function CityWarMap({ ranked }: { ranked: RankedClub[] }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const cells = useMemo(() => {
    const total = ranked.reduce((sum, r) => sum + r.score, 0) || 1;
    const out: { color: string; core: string; isUser: boolean }[] = [];
    for (const entry of ranked) {
      const n = Math.max(1, Math.round((entry.score / total) * WAR_CELLS));
      const color = entry.isUserClub ? palette.pulseGreen : entry.club.color;
      for (let i = 0; i < n && out.length < WAR_CELLS; i++) {
        out.push({ color: pastelFor(color), core: color, isUser: entry.isUserClub });
      }
    }
    while (out.length < WAR_CELLS) {
      out.push({ color: "#E8EDF0", core: palette.dustGray, isUser: false });
    }
    return out
      .map((c, i) => ({ c, k: (i * 7) % WAR_CELLS }))
      .sort((a, b) => a.k - b.k)
      .map((e) => e.c);
  }, [ranked]);

  return (
    <View style={styles.warMap}>
      <View style={[styles.warRoad, { top: "34%" }]} />
      <View style={[styles.warRoad, { top: "70%" }]} />
      <View style={[styles.warRoadV, { left: "28%" }]} />
      <View style={[styles.warRoadV, { left: "68%" }]} />
      <View style={styles.warHexGrid}>
        {cells.map((cell, i) => (
          <Animated.View
            key={i}
            style={
              cell.isUser
                ? {
                    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }),
                    transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) }],
                  }
                : undefined
            }
          >
            <Hexagon size={30} color={cell.color} coreColor={cell.core} />
          </Animated.View>
        ))}
      </View>
      <View style={styles.warLegend}>
        {ranked.map((entry) => (
          <View key={entry.club.id} style={styles.legendItem}>
            <View
              style={[
                styles.legendDot,
                { backgroundColor: entry.isUserClub ? palette.pulseGreen : entry.club.color },
              ]}
            />
            <Text style={styles.legendText}>{entry.club.shortName}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.sm, paddingBottom: 120, gap: spacing.lg },
  header: { paddingTop: spacing.md, gap: 2 },
  greeting: { ...type.kicker, color: colors.primary },
  title: { ...type.display, fontSize: 26 },
  footerNote: {
    ...type.mono,
    fontSize: 11,
    color: colors.textFaint,
    textAlign: "center",
    paddingVertical: spacing.md,
  },

  /* choose */
  chooseWrap: { gap: spacing.md },
  valueCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.xs,
    ...shadows.card,
  },
  valueTitle: { ...type.heading, fontSize: 16.5 },
  valueText: { ...type.body, fontSize: 13.5, lineHeight: 19 },
  sectionLabel: { ...type.kicker, color: colors.textFaint },
  clubOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  clubOptionBody: { flex: 1, gap: 2 },
  clubOptionName: { ...type.heading, fontSize: 16 },
  clubOptionMotto: { ...type.caption, fontSize: 12.5, fontStyle: "italic" },
  joinChip: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 7,
    paddingHorizontal: spacing.lg,
  },
  joinChipText: { fontSize: 13, fontWeight: "800", color: colors.surface },

  /* home */
  homeWrap: { gap: spacing.lg },
  hero: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.md,
    ...shadows.float,
  },
  heroTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.xs,
  },
  warChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: `${palette.baseBlue}12`,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
  },
  warDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: palette.baseBlue },
  warChipText: { fontSize: 11.5, fontWeight: "700", color: palette.baseBlue },
  warCountdown: { ...type.mono, fontSize: 12, color: colors.textDim },

  heroIdentity: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.xs },
  heroIdentityBody: { flex: 1, gap: 2 },
  heroNameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  heroName: { ...type.heading, fontSize: 17 },
  heroMotto: { ...type.caption, fontSize: 12, fontStyle: "italic" },
  switchLink: { ...type.caption, fontSize: 12.5, fontWeight: "700", color: colors.primary },
  youChip: {
    backgroundColor: `${palette.pulseGreen}1A`,
    borderRadius: radius.pill,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
  },
  youChipText: { fontSize: 10.5, fontWeight: "800", color: "#0A8F60" },

  heroStats: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
  },
  heroStat: { flex: 1, alignItems: "center", gap: 2 },
  heroStatWide: { flex: 1.6 },
  heroStatValue: { ...type.title, fontSize: 18, fontVariant: ["tabular-nums"] },
  heroStatLabel: { ...type.caption, fontSize: 10.5, textAlign: "center" },
  heroStatDivider: { width: 1, alignSelf: "stretch", marginVertical: 6, backgroundColor: colors.border },
  heroSummary: { ...type.mono, fontSize: 11, color: colors.textFaint, textAlign: "center" },

  missionCard: {
    flexDirection: "row",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: `${palette.baseBlue}22`,
    padding: spacing.lg,
    ...shadows.card,
  },
  missionIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: `${palette.baseBlue}16`,
    alignItems: "center",
    justifyContent: "center",
  },
  missionBody: { flex: 1, gap: 3 },
  missionKicker: { ...type.kicker, fontSize: 10.5, color: palette.baseBlue },
  missionTitle: { ...type.heading, fontSize: 16 },
  missionDetail: { ...type.caption, fontSize: 12.5, lineHeight: 17, color: colors.textDim },

  territoryCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  territoryCtaIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.primaryDim,
    alignItems: "center",
    justifyContent: "center",
  },
  territoryCtaBody: { flex: 1, gap: 1 },
  territoryCtaName: { ...type.heading, fontSize: 14.5 },
  territoryCtaNote: { ...type.caption, fontSize: 11.5, color: colors.textFaint },

  sectionTitle: { ...type.heading, fontSize: 18 },
  board: { gap: spacing.sm },

  /* city war map */
  warMap: {
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  warRoad: { position: "absolute", left: 0, right: 0, height: 5, borderRadius: 3, backgroundColor: "#E2E8EC" },
  warRoadV: { position: "absolute", top: 0, bottom: 0, width: 5, borderRadius: 3, backgroundColor: "#E6EBEF" },
  warHexGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: spacing.lg,
  },
  warLegend: { flexDirection: "row", justifyContent: "center", gap: spacing.lg, flexWrap: "wrap" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { ...type.caption, fontSize: 11, fontWeight: "700" },
});
