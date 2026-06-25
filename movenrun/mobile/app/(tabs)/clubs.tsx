import { useEffect, useMemo, useRef } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Hexagon } from "@/components/Hexagon";
import { ScalePress } from "@/components/ScalePress";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { CLUBS, getClubById } from "@/data/clubs";
import {
  rankClubs,
  seasonResetLabel,
  sessionsThisWeek,
  type RankedClub,
} from "@/lib/clubs";
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
 * Clubs — Free Map Beta. A local-only competition preview: pick a club, see a
 * city-war mock and a leaderboard where your real local stats power your
 * club's score. No backend, no sync, no club economy.
 */
export default function ClubsScreen() {
  const selectedClubId = useGameStore((s) => s.selectedClubId);
  const selected = getClubById(selectedClubId);

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.greeting}>City War Preview</Text>
          <Text style={styles.title}>
            {selected ? "Your club this week" : "Choose your club"}
          </Text>
        </View>
        {selected ? <ClubHome club={selected} /> : <ChooseClub />}
        <Text style={styles.footerNote}>
          Local preview · online clubs and city wars arrive later.
        </Text>
      </ScrollView>
    </Screen>
  );
}

/* ───────────────────────── choose-club state ───────────────────────── */

function ChooseClub() {
  const selectClub = useGameStore((s) => s.selectClub);
  return (
    <View style={styles.chooseWrap}>
      <Text style={styles.chooseLede}>
        Clubs are a local preview for now — your movement strengthens your club
        on this device. Online city wars arrive later.
      </Text>
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
          >
            <Hexagon size={40} color={pastelFor(club.color)} coreColor={club.color} />
            <View style={styles.clubOptionBody}>
              <Text style={styles.clubOptionName}>{club.name}</Text>
              <Text style={styles.clubOptionMotto}>“{club.motto}”</Text>
            </View>
            <View style={styles.clubOptionMeta}>
              <Text style={styles.clubOptionMembers}>{club.memberCount}</Text>
              <Text style={styles.clubOptionMembersLabel}>movers</Text>
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
  const mine = ranked.find((r) => r.isUserClub);
  const weekSessions = sessionsThisWeek(history);

  return (
    <View style={styles.homeWrap}>
      {/* City War hero */}
      <FadeSlideIn>
        <View style={styles.warHero}>
          <View style={styles.warHeroTop}>
            <View style={styles.warChip}>
              <View style={styles.warDot} />
              <Text style={styles.warChipText}>Season preview</Text>
            </View>
            <Text style={styles.warCountdown}>{seasonResetLabel()}</Text>
          </View>
          <CityWarMap ranked={ranked} />
          <Text style={styles.warLede}>Your movement strengthens your club.</Text>
        </View>
      </FadeSlideIn>

      {/* Your club card */}
      <FadeSlideIn delay={STAGGER_MS}>
        <View style={styles.myClub}>
          <Hexagon size={44} color="#C9EEDE" coreColor={palette.pulseGreen} />
          <View style={styles.myClubBody}>
            <View style={styles.myClubTitleRow}>
              <Text style={styles.myClubName}>{club.name}</Text>
              <View style={styles.youChip}>
                <Text style={styles.youChipText}>Your club</Text>
              </View>
            </View>
            <Text style={styles.myClubMotto}>“{club.motto}”</Text>
            <Text style={styles.myClubStats}>
              Rank #{mine?.rank ?? "—"} · your contribution +{mine?.userContribution ?? 0}
            </Text>
            <Text style={styles.myClubSub}>
              {zones.length} zone{zones.length === 1 ? "" : "s"} · defended ×
              {timesDefended} · {weekSessions} session{weekSessions === 1 ? "" : "s"} this week
            </Text>
          </View>
          <Pressable
            hitSlop={10}
            onPress={() => {
              tapFeedback();
              selectClub("");
            }}
          >
            <Text style={styles.switchLink}>Switch</Text>
          </Pressable>
        </View>
      </FadeSlideIn>

      {/* Club Territory dashboard — local command layer */}
      <FadeSlideIn delay={STAGGER_MS * 2}>
        <ScalePress
          to={0.98}
          style={styles.territoryCta}
          onPress={() => {
            tapFeedback();
            router.push("/club-territory");
          }}
        >
          <View style={styles.territoryCtaIcon}>
            <Ionicons name="map-outline" size={18} color={palette.deedViolet} />
          </View>
          <View style={styles.territoryCtaBody}>
            <Text style={styles.territoryCtaName}>Club Territory</Text>
            <Text style={styles.territoryCtaNote}>Your local club command layer · preview</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
        </ScalePress>
      </FadeSlideIn>

      {/* Leaderboard */}
      <FadeSlideIn delay={STAGGER_MS * 3}>
        <Text style={styles.sectionTitle}>City leaderboard</Text>
      </FadeSlideIn>
      <View style={styles.board}>
        {ranked.map((entry, i) => (
          <FadeSlideIn key={entry.club.id} delay={STAGGER_MS * (3 + i)}>
            <LeaderboardRow entry={entry} />
          </FadeSlideIn>
        ))}
      </View>
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

  /* Split the hex cluster by score share, deterministic order. */
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
    /* deterministic interleave so colors mix like a real map */
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
                    opacity: pulse.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.85, 1],
                    }),
                    transform: [
                      {
                        scale: pulse.interpolate({
                          inputRange: [0, 1],
                          outputRange: [1, 1.06],
                        }),
                      },
                    ],
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

/* ───────────────────────── leaderboard row ─────────────────────────── */

function LeaderboardRow({ entry }: { entry: RankedClub }) {
  const { club, rank, score, trend, isUserClub, userContribution } = entry;
  const accent = isUserClub ? palette.pulseGreen : club.color;
  return (
    <View style={[styles.row, isUserClub ? styles.rowMine : null]}>
      <Text style={[styles.rank, rank === 1 ? styles.rankGold : null]}>{rank}</Text>
      <Hexagon size={30} color={pastelFor(accent)} coreColor={accent} />
      <View style={styles.rowBody}>
        <View style={styles.rowTitleRow}>
          <Text style={styles.rowName} numberOfLines={1}>{club.name}</Text>
          {isUserClub ? (
            <View style={styles.youChip}>
              <Text style={styles.youChipText}>You</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.rowMeta}>
          {club.zonesOwned} zones · {club.zonesDefended} defended · {club.weeklyDistanceKm} km/wk
          {isUserClub && userContribution > 0 ? ` · +${userContribution} you` : ""}
        </Text>
      </View>
      <View style={styles.rowScoreWrap}>
        <Text style={styles.rowScore}>{score.toLocaleString()}</Text>
        <View style={styles.trendRow}>
          <Ionicons
            name={trend === "up" ? "chevron-up" : trend === "down" ? "chevron-down" : "remove"}
            size={11}
            color={trend === "up" ? "#0A8F60" : trend === "down" ? "#C2492E" : colors.textFaint}
          />
          <Text
            style={[
              styles.trendText,
              { color: trend === "up" ? "#0A8F60" : trend === "down" ? "#C2492E" : colors.textFaint },
            ]}
          >
            {trend === "up" ? "rising" : trend === "down" ? "slipping" : "steady"}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.sm, paddingBottom: 110, gap: spacing.lg },
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
    backgroundColor: `${palette.deedViolet}14`,
    alignItems: "center",
    justifyContent: "center",
  },
  territoryCtaBody: { flex: 1, gap: 1 },
  territoryCtaName: { ...type.heading, fontSize: 14.5 },
  territoryCtaNote: { ...type.caption, fontSize: 11.5, color: colors.textFaint },
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
  chooseLede: { ...type.body, fontSize: 14 },
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
  clubOptionMeta: { alignItems: "center" },
  clubOptionMembers: { ...type.title, fontSize: 18 },
  clubOptionMembersLabel: { ...type.caption, fontSize: 10.5 },

  /* home */
  homeWrap: { gap: spacing.lg },
  warHero: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.md,
    ...shadows.float,
  },
  warHeroTop: {
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
    backgroundColor: `${palette.deedViolet}12`,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
  },
  warDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: palette.deedViolet },
  warChipText: { fontSize: 11.5, fontWeight: "700", color: palette.deedViolet },
  warCountdown: { ...type.mono, fontSize: 12, color: colors.textDim },
  warLede: {
    ...type.caption,
    fontSize: 13,
    color: colors.text,
    fontWeight: "600",
    textAlign: "center",
    paddingBottom: spacing.xs,
  },
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
  warLegend: { flexDirection: "row", justifyContent: "center", gap: spacing.lg },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { ...type.caption, fontSize: 11, fontWeight: "700" },

  myClub: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  myClubBody: { flex: 1, gap: 2 },
  myClubTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  myClubName: { ...type.heading, fontSize: 16 },
  myClubMotto: { ...type.caption, fontSize: 12, fontStyle: "italic" },
  myClubStats: { ...type.caption, fontSize: 12.5, color: "#0A8F60", fontWeight: "700" },
  myClubSub: { ...type.mono, fontSize: 11, color: colors.textFaint },
  youChip: {
    backgroundColor: `${palette.pulseGreen}1A`,
    borderRadius: radius.pill,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
  },
  youChipText: { fontSize: 10.5, fontWeight: "800", color: "#0A8F60" },
  switchLink: { ...type.caption, fontSize: 12.5, fontWeight: "700", color: colors.primary },

  sectionTitle: { ...type.heading, fontSize: 18 },
  board: { gap: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  rowMine: {
    backgroundColor: "#F2FBF7",
    shadowColor: palette.pulseGreen,
    shadowOpacity: 0.22,
  },
  rank: { ...type.title, fontSize: 18, width: 22, textAlign: "center", color: colors.textDim },
  rankGold: { color: "#B07908" },
  rowBody: { flex: 1, gap: 2 },
  rowTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowName: { ...type.heading, fontSize: 14.5 },
  rowMeta: { ...type.mono, fontSize: 10.5, color: colors.textFaint },
  rowScoreWrap: { alignItems: "flex-end", gap: 1 },
  rowScore: { ...type.title, fontSize: 17 },
  trendRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  trendText: { fontSize: 10.5, fontWeight: "700" },
});
