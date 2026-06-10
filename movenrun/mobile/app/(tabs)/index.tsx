import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { QuestCard } from "@/components/QuestCard";
import { SectionHeader } from "@/components/SectionHeader";
import { RoutePath } from "@/components/RoutePath";
import { TerritoryPreview } from "@/components/TerritoryPreview";
import { ZoneCard } from "@/components/ZoneCard";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { Button } from "@/components/Button";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { useSessionStart } from "@/hooks/useSessionStart";
import { getLevelInfo } from "@/lib/leveling";
import { lockedMovePreview } from "@/lib/lockedMove";
import { getLocalDateKey } from "@/lib/date";
import { tapFeedback } from "@/lib/haptics";

function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function TodayScreen() {
  const router = useRouter();
  const {
    dailyQuest,
    recommendedQuests,
    completedTodayIds,
    dailyCompletedToday,
  } = useSessionStart();

  const totalXp = useGameStore((s) => s.totalXp);
  const streak = useGameStore((s) => s.streak);
  const history = useGameStore((s) => s.history);
  const zones = useGameStore((s) => s.zones);
  const latestZone = zones[0] ?? null;
  const level = getLevelInfo(totalXp);

  // Presentation-only derivations — no store/data changes.
  const todayKey = getLocalDateKey();
  const xpToday = history
    .filter((rec) => getLocalDateKey(new Date(rec.completedAt)) === todayKey)
    .reduce((sum, rec) => sum + rec.xp, 0);
  const lockedMove = lockedMovePreview(totalXp);

  const openQuest = (id: string) => {
    tapFeedback();
    router.push({ pathname: "/quest/[id]", params: { id } });
  };

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.greeting}>{greeting()}</Text>
            <Text style={styles.brand}>
              {dailyCompletedToday ? "You've moved today" : "Ready to move?"}
            </Text>
          </View>
          <View style={styles.streakChip}>
            <Ionicons name="flame" size={15} color={palette.moveGold} />
            <Text style={styles.streakNum}>{streak}</Text>
            <Text style={styles.streakLabel}>day streak</Text>
          </View>
        </View>

        {/* Hero: territory warmup + Start Move */}
        <FadeSlideIn>
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>Free map beta · Warmup</Text>
            <View style={styles.heroLevelRow}>
              <Text style={styles.heroLevel}>Level {level.level}</Text>
              <Text style={styles.heroXp}>
                {level.xpIntoLevel} / {level.xpForLevel} XP
              </Text>
            </View>
            <RoutePath progress={level.progress} />
            <Button
              label="Start Move"
              icon="play"
              onPress={() => {
                tapFeedback();
                router.push("/move");
              }}
              style={styles.heroCta}
            />
            <Text style={styles.heroNote}>
              Foreground GPS session — your route, distance, and pace, all
              on-device. Territory capture comes next.
            </Text>
          </View>
        </FadeSlideIn>

        {/* Today chips: XP / streak-safe / Locked MOVE preview */}
        <FadeSlideIn delay={STAGGER_MS}>
          <View style={styles.chipsRow}>
            <View style={styles.chip}>
              <Text style={[styles.chipValue, { color: "#B07908" }]}>+{xpToday}</Text>
              <Text style={styles.chipLabel}>XP today</Text>
            </View>
            <View style={styles.chip}>
              <Text style={[styles.chipValue, { color: palette.heatCoral }]}>{streak}</Text>
              <Text style={styles.chipLabel}>streak</Text>
            </View>
            <View style={styles.chip}>
              <Text style={[styles.chipValue, { color: palette.deedViolet }]}>{lockedMove}</Text>
              <Text style={styles.chipLabel}>Locked MOVE · preview</Text>
            </View>
          </View>
        </FadeSlideIn>

        {dailyCompletedToday ? (
          <View style={styles.doneBanner}>
            <Ionicons name="checkmark-circle" size={18} color={palette.pulseGreen} />
            <Text style={styles.doneText}>
              Daily quest done — streak safe. Try a bonus quest below for more XP.
            </Text>
          </View>
        ) : null}

        {/* Territory portfolio — captured common zones (local simulation) */}
        <FadeSlideIn delay={STAGGER_MS * 2}>
          <SectionHeader
            title="Your territory"
            trailing={zones.length > 0 ? `${zones.length} zone${zones.length === 1 ? "" : "s"}` : "soon"}
          />
          <View style={styles.sectionGap} />
          {latestZone ? (
            <View style={styles.territoryWrap}>
              <ZoneCard
                zone={latestZone}
                onPress={() => {
                  tapFeedback();
                  router.push({ pathname: "/zone/[id]", params: { id: latestZone.id } });
                }}
              />
              <View style={styles.defendTeaser}>
                <Ionicons name="shield-outline" size={14} color={colors.textFaint} />
                <Text style={styles.defendTeaserText}>
                  Defend arrives next — keep your zones warm.
                </Text>
              </View>
            </View>
          ) : (
            <TerritoryPreview />
          )}
        </FadeSlideIn>

        <FadeSlideIn delay={STAGGER_MS * 3}>
          <SectionHeader title="Today's Quest" />
          <View style={styles.sectionGap} />
          <QuestCard
            quest={dailyQuest}
            featured
            completed={dailyCompletedToday}
            onPress={() => openQuest(dailyQuest.id)}
          />
        </FadeSlideIn>

        <SectionHeader title="Warmup quests" trailing={`${recommendedQuests.length}`} />
        <View style={styles.list}>
          {recommendedQuests.map((q, i) => (
            <FadeSlideIn key={q.id} delay={STAGGER_MS * (4 + i)}>
              <QuestCard
                quest={q}
                completed={completedTodayIds.includes(q.id)}
                onPress={() => openQuest(q.id)}
              />
            </FadeSlideIn>
          ))}
        </View>

        <Text style={styles.footerLoop}>Move → Capture → Defend → Own</Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Extra bottom padding clears the floating tab bar.
  content: { paddingTop: spacing.sm, paddingBottom: 110, gap: spacing.lg },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  headerText: { flex: 1 },
  greeting: { ...type.caption, fontSize: 14 },
  brand: { ...type.display, fontSize: 26 },
  streakChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    ...shadows.card,
  },
  streakNum: { ...type.heading, fontSize: 16 },
  streakLabel: { ...type.caption, fontSize: 11 },
  hero: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.md,
    ...shadows.float,
  },
  heroKicker: { ...type.kicker, color: colors.primary },
  heroLevelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  heroLevel: { ...type.title, fontSize: 20 },
  heroXp: { ...type.mono, fontSize: 12.5 },
  heroCta: { marginTop: spacing.xs },
  heroNote: { ...type.caption, fontSize: 12, textAlign: "center", color: colors.textFaint },
  chipsRow: { flexDirection: "row", gap: spacing.md },
  chip: {
    flex: 1,
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    gap: 2,
    ...shadows.card,
  },
  chipValue: { fontSize: 20, fontWeight: "800", letterSpacing: -0.4 },
  chipLabel: { ...type.caption, fontSize: 10.5, textAlign: "center" },
  doneBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: `${palette.pulseGreen}14`,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  doneText: { flex: 1, ...type.caption, fontSize: 13, lineHeight: 18, color: colors.text },
  sectionGap: { height: spacing.md },
  territoryWrap: { gap: spacing.sm },
  defendTeaser: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: spacing.xs,
  },
  defendTeaserText: { ...type.caption, fontSize: 12, color: colors.textFaint },
  list: { gap: spacing.md },
  footerLoop: {
    ...type.mono,
    fontSize: 12,
    color: colors.textFaint,
    textAlign: "center",
    paddingVertical: spacing.md,
  },
});
