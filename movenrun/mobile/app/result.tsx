import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Share, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { CountUpText } from "@/components/CountUpText";
import { RoutePath } from "@/components/RoutePath";
import { ShareCard } from "@/components/ShareCard";
import { Hexagon } from "@/components/Hexagon";
import { colors, glow, palette, radius, shadows, spacing, type } from "@/theme";
import { questService } from "@/services/questService";
import { useGameStore, type CompletionOutcome } from "@/store/useGameStore";
import { getLevelInfo } from "@/lib/leveling";
import { lockedMovePreview } from "@/lib/lockedMove";
import { successFeedback } from "@/lib/haptics";

export default function ResultScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const quest = questService.getQuestById(id ?? "");
  const completeQuest = useGameStore((s) => s.completeQuest);

  const [outcome, setOutcome] = useState<CompletionOutcome | null>(null);
  // Award XP exactly once, even if the component re-renders.
  const awardedRef = useRef(false);
  const pop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (awardedRef.current || !quest) return;
    awardedRef.current = true;
    setOutcome(completeQuest(quest));
    successFeedback();
    Animated.timing(pop, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.back(1.6)),
      useNativeDriver: true,
    }).start();
  }, [quest, completeQuest, pop]);

  if (!quest || !outcome) {
    return (
      <Screen>
        <View style={styles.center} />
      </Screen>
    );
  }

  const level = getLevelInfo(outcome.totalXpAfter);
  // Display preview only: in-app progress, not a payout (see lib/lockedMove).
  const lockedMoveGained =
    lockedMovePreview(outcome.totalXpAfter) - lockedMovePreview(outcome.totalXpBefore);

  const onShare = async () => {
    try {
      await Share.share({
        message:
          `I just completed "${quest.title}" on MovenRun and earned +${outcome.xpGained} XP! ` +
          `Level ${level.level} • ${outcome.streak}-day streak 🔥`,
      });
    } catch {
      // User dismissed the share sheet or sharing is unavailable — ignore.
    }
  };

  return (
    <Screen edgeTop>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        style={{ opacity: pop }}
      >
        <Animated.View style={[styles.badge, { transform: [{ scale: pop }] }]}>
          <Ionicons name="checkmark" size={44} color={colors.surface} />
        </Animated.View>

        <Text style={styles.title}>Quest complete!</Text>
        <Text style={styles.questName}>{quest.title}</Text>

        {/* Reward card: XP + Locked MOVE preview */}
        <View style={styles.rewardCard}>
          <View style={styles.rewardRow}>
            <View style={[styles.rewardIcon, { backgroundColor: `${palette.moveGold}1F` }]}>
              <Ionicons name="flash" size={18} color={palette.moveGold} />
            </View>
            <Text style={styles.rewardLabel}>XP earned</Text>
            <CountUpText
              value={outcome.xpGained}
              prefix="+"
              style={[styles.rewardValue, { color: "#B07908" }]}
            />
          </View>
          <View style={styles.rewardDivider} />
          <View style={styles.rewardRow}>
            <View style={[styles.rewardIcon, { backgroundColor: `${palette.deedViolet}14` }]}>
              <Hexagon size={15} color={palette.deedViolet} />
            </View>
            <View style={styles.rewardLabelWrap}>
              <Text style={styles.rewardLabelPlain}>Locked MOVE</Text>
              <Text style={styles.rewardSub}>preview · in-app progress</Text>
            </View>
            <Text style={[styles.rewardValue, { color: palette.deedViolet }]}>
              +{lockedMoveGained}
            </Text>
          </View>
        </View>

        {outcome.leveledUp ? (
          <View style={styles.levelUp}>
            <Ionicons name="arrow-up-circle" size={18} color={palette.pulseGreen} />
            <Text style={styles.levelUpText}>
              Level up! You reached level {outcome.levelAfter}
            </Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <View style={styles.levelRow}>
            <Text style={styles.levelLabel}>Level {level.level}</Text>
            <Text style={styles.levelXp}>
              {level.xpIntoLevel} / {level.xpForLevel} XP
            </Text>
          </View>
          <RoutePath progress={level.progress} />
        </View>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Ionicons name="flame" size={20} color={palette.heatCoral} />
            <Text style={styles.statValue}>{outcome.streak}</Text>
            <Text style={styles.statLabel}>
              day streak{outcome.streakIncreased ? " 🔥" : ""}
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.stat}>
            <Ionicons name="trophy" size={20} color={palette.moveGold} />
            <Text style={styles.statValue}>{outcome.totalXpAfter}</Text>
            <Text style={styles.statLabel}>total XP</Text>
          </View>
        </View>

        {outcome.alreadyAwarded ? (
          <Text style={styles.note}>
            You already completed this quest today — no extra XP. Come back tomorrow!
          </Text>
        ) : !outcome.streakIncreased ? (
          <Text style={styles.note}>
            You already moved today — streak stays the same. Keep it up tomorrow!
          </Text>
        ) : null}

        <Text style={styles.shareHint}>Share your win</Text>
        <ShareCard
          questTitle={quest.title}
          xpGained={outcome.xpGained}
          level={level.level}
          streak={outcome.streak}
        />
      </Animated.ScrollView>

      <View style={styles.footer}>
        <Button label="Share" icon="share-social-outline" variant="secondary" onPress={onShare} />
        <Button label="Done" icon="home" onPress={() => router.dismissAll()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1 },
  content: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.lg },
  badge: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: palette.pulseGreen,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
    ...glow(palette.pulseGreen),
  },
  title: { ...type.display, fontSize: 28 },
  questName: { ...type.body, fontSize: 16 },
  rewardCard: {
    alignSelf: "stretch",
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
    marginTop: spacing.sm,
    ...shadows.float,
  },
  rewardRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  rewardIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  rewardLabelWrap: { flex: 1, gap: 1 },
  rewardLabel: { ...type.heading, fontSize: 15, flex: 1 },
  rewardLabelPlain: { ...type.heading, fontSize: 15 },
  rewardSub: { ...type.caption, fontSize: 11, color: colors.textFaint },
  rewardValue: { fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  rewardDivider: { height: 1, backgroundColor: colors.surfaceAlt },
  levelUp: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: `${palette.pulseGreen}14`,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  levelUpText: { color: "#0A8F60", fontSize: 14, fontWeight: "700" },
  card: {
    alignSelf: "stretch",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    marginTop: spacing.sm,
    ...shadows.card,
  },
  levelRow: { flexDirection: "row", justifyContent: "space-between" },
  levelLabel: { ...type.heading, fontSize: 16 },
  levelXp: { ...type.mono, fontSize: 12.5 },
  statsRow: {
    alignSelf: "stretch",
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  stat: { flex: 1, alignItems: "center", gap: spacing.xs },
  statValue: { ...type.title, fontSize: 22 },
  statLabel: { ...type.caption, fontSize: 12 },
  divider: { width: 1, backgroundColor: colors.surfaceAlt },
  note: {
    ...type.caption,
    fontSize: 13,
    color: colors.textFaint,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
  },
  shareHint: {
    ...type.kicker,
    alignSelf: "flex-start",
    marginTop: spacing.sm,
  },
  footer: { paddingVertical: spacing.md, gap: spacing.sm },
});
