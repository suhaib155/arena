import { useEffect, useRef } from "react";
import { Animated, Easing, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { GameBadge } from "@/components/GameBadge";
import { CountUpText } from "@/components/CountUpText";
import { RoutePath } from "@/components/RoutePath";
import { ShareCard } from "@/components/ShareCard";
import { Hexagon } from "@/components/Hexagon";
import { avatar, colors, glow, iconTile, ink, palette, radius, shadows, softTint, spacing, type } from "@/theme";
import { resolveQuestResult } from "@/lib/questResult";
import { formatDuration } from "@/lib/geo";
import { questService } from "@/services/questService";
import { useGameStore, useIsCompletedToday } from "@/store/useGameStore";
import { getLevelInfo } from "@/lib/leveling";
import { lockedMovePreview } from "@/lib/lockedMove";
import { useReducedMotion } from "@/hooks/useReducedMotion";

export default function ResultScreen() {
  const router = useRouter();
  const { id, attemptId } = useLocalSearchParams<{ id: string; attemptId: string }>();
  const quest = questService.getQuestById(id ?? "");
  const attempt = useGameStore((s) => s.questAttempt);
  const hydrated = useGameStore((s) => s._hydrated);
  // Results only present a persisted settlement; opening a route cannot award XP.
  const outcome = attempt && attempt.id === attemptId && attempt.questId === quest?.id ? attempt.outcome : null;
  const pop = useRef(new Animated.Value(0)).current;
  const reducedMotion = useReducedMotion();
  const attemptSettled = attempt === null || attempt.status === "completed" || attempt.status === "abandoned";
  const alreadyAwardedToday = useIsCompletedToday(quest?.id ?? "");

  /**
   * How the result reads. Presentation only — `completionSatisfied` arrives
   * already settled from the store and no reward rule is re-decided here.
   */
  const view = resolveQuestResult({
    questTitle: quest?.title ?? null,
    completionSatisfied: outcome?.completionSatisfied ?? false,
    xpGained: outcome?.xpGained ?? 0,
    activeMs: attempt && attempt.questId === quest?.id ? attempt.activeMs : 0,
    requiredMs: (quest?.durationSeconds ?? 0) * 1000,
    alreadyAwardedToday,
    attemptSettled,
  });

  useEffect(() => {
    if (!outcome?.completionSatisfied) return;
    if (reducedMotion) { pop.setValue(1); return; }
    Animated.timing(pop, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.back(1.6)),
      useNativeDriver: true,
    }).start();
  }, [outcome, pop, reducedMotion]);

  if (!hydrated) {
    return (
      <Screen>
        <View style={styles.center} />
      </Screen>
    );
  }

  if (!quest || !outcome?.completionSatisfied) {
    /**
     * The unfinished result.
     *
     * Same blocks as the completed one below — crest, title, quest name,
     * reason, XP, progress, actions — sized to their content instead of
     * floating in a centred void. The crest is muted and there is no badge and
     * no pop: a quest that was not completed is not celebrated, and dressing it
     * up as a near-miss would be the screen flattering the player about a rule
     * it just enforced.
     */
    const held = formatDuration(view.progress * (quest?.durationSeconds ?? 0) * 1000);
    const target = formatDuration((quest?.durationSeconds ?? 0) * 1000);
    return (
      <Screen>
        {/* Scrollable content, pinned actions.
            The card is content-sized and its text does not shrink, so at the
            largest supported font on a 320x640 screen a two-line quest title
            plus reason plus progress plus the XP row can exceed the viewport.
            As a plain flex column that clipped, with no way to reach what was
            cut off. The actions stay outside the scroller so they are never the
            thing that scrolls away. */}
        <ScrollView
          style={styles.compactScroll}
          contentContainerStyle={styles.compact}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.resultCard}>
            <View style={styles.crestRow}>
              <GameBadge icon={view.icon as never} tone="neutral" size={56} />
              <View style={styles.crestText}>
                <Text style={styles.resultTitle}>{view.title}</Text>
                {quest ? <Text style={styles.questName} numberOfLines={2}>{quest.title}</Text> : null}
              </View>
            </View>

            <Text style={styles.reason}>{view.reason}</Text>

            {quest && quest.durationSeconds > 0 ? (
              <View style={styles.progressBlock}>
                <RoutePath progress={view.progress} />
                <Text style={styles.progressLabel}>{held} of {target} held</Text>
              </View>
            ) : null}

            <View style={styles.xpRow}>
              <Text style={styles.xpLabel}>XP earned</Text>
              <Text style={styles.xpZero}>{view.xpLabel}</Text>
            </View>
          </View>

        </ScrollView>

        <View style={styles.compactActions}>
          <Button label="Back to Today" icon="home" onPress={() => router.replace("/(tabs)")} />
          {view.retry && quest ? (
            <Button
              label="Try again"
              icon="refresh"
              variant="secondary"
              onPress={() => router.replace({ pathname: "/quest/[id]", params: { id: quest.id } })}
            />
          ) : null}
        </View>
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
          <GameBadge icon="checkmark" tone="green" size={84} />
        </Animated.View>

        <Text style={styles.title}>{view.title}</Text>
        <Text style={styles.questName}>{quest.title}</Text>

        {/* Earned quest progression */}
        <View style={styles.rewardCard}>
          <View style={styles.rewardRow}>
            <View style={[styles.rewardIcon, { backgroundColor: softTint(palette.moveGold) }]}>
              <Ionicons name="flash" size={18} color={palette.moveGold} />
            </View>
            <Text style={styles.rewardLabel}>XP earned</Text>
            <CountUpText
              value={outcome.xpGained}
              prefix="+"
              style={[styles.rewardValue, { color: ink.gold }]}
            />
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
        <Button label="Done" icon="home" onPress={() => router.replace("/(tabs)")} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1 },
  /* Content-sized, top-aligned, with the actions pinned to the bottom. The old
     failure branch was `flex: 1` + `justifyContent: "center"`, which is what
     produced a short paragraph adrift in the middle of an empty page. */
  compactScroll: { flex: 1 },
  /* `flexGrow` so a short result still sits where it did, `gap` unchanged. */
  compact: { flexGrow: 1, paddingTop: spacing.xl, gap: spacing.lg },
  resultCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.lg,
    ...shadows.card,
  },
  crestRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  /* The crest, muted. Same tile geometry as the completed badge's family, and
     deliberately not its Pulse Green: the shape says "this is the result", the
     colour says "and it is not a win". */
  crestMuted: { ...iconTile(52), backgroundColor: colors.surfaceAlt },
  crestText: { flex: 1, gap: 2 },
  resultTitle: { ...type.display, fontSize: 22, lineHeight: 27 },
  reason: { ...type.body, fontSize: 14, lineHeight: 20, color: colors.textDim },
  progressBlock: { gap: spacing.xs },
  progressLabel: { ...type.mono, fontSize: 12, color: colors.textFaint },
  xpRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: colors.surfaceAlt,
    paddingTop: spacing.md,
  },
  xpLabel: { ...type.heading, fontSize: 14.5 },
  /* Stated, not hidden. A zero the player cannot find reads as a screen that is
     still loading the number. */
  xpZero: { ...type.title, fontSize: 20, color: colors.textDim },
  /* Outside the scroller now, so `marginTop: auto` is no longer what holds it
     down — it is simply the last child of the screen. */
  compactActions: { paddingTop: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  content: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.lg },
  badge: { ...avatar(92), backgroundColor: colors.surfaceAlt, marginBottom: spacing.sm },
  title: { ...type.display, fontSize: 28, lineHeight: 36, textAlign: "center" },
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
  rewardIcon: { ...iconTile(38) },
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
    backgroundColor: softTint(palette.pulseGreen),
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  levelUpText: { color: ink.green, fontSize: 14, fontWeight: "700" },
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
