import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { RouteCanvas } from "@/components/RouteCanvas";
import { CountUpText } from "@/components/CountUpText";
import { Hexagon } from "@/components/Hexagon";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { formatDuration, formatPace } from "@/lib/geo";
import {
  clearLastSession,
  getLastSession,
  isSaveable,
  sessionXp,
} from "@/services/moveSession";
import { useGameStore, useIsCompletedToday } from "@/store/useGameStore";
import { lockedMovePreview } from "@/lib/lockedMove";
import type { Quest } from "@/types";
import { successFeedback, tapFeedback } from "@/lib/haptics";

/**
 * One synthetic quest id per local day gates session XP through the store's
 * existing once-per-day award logic — saving repeatedly can't farm XP.
 */
const SESSION_QUEST_ID = "move-session";

export default function MoveSummaryScreen() {
  const router = useRouter();
  const session = useMemo(() => getLastSession(), []);
  const completeQuest = useGameStore((s) => s.completeQuest);
  const totalXp = useGameStore((s) => s.totalXp);
  const alreadySavedToday = useIsCompletedToday(SESSION_QUEST_ID);
  const [saved, setSaved] = useState(false);

  if (!session) {
    return (
      <Screen>
        <View style={styles.missingWrap}>
          <Text style={styles.missingText}>No session to show.</Text>
          <Button label="Back to Today" variant="secondary" onPress={() => router.dismissAll()} />
        </View>
      </Screen>
    );
  }

  const km = session.distanceM / 1000;
  const xp = sessionXp(session.distanceM, session.durationMs);
  const lockedMoveDelta = lockedMovePreview(totalXp + xp) - lockedMovePreview(totalXp);
  const pace = formatPace(session.distanceM, session.durationMs);
  const saveable = session.mode === "gps" && isSaveable(session.distanceM, session.durationMs);

  const save = () => {
    tapFeedback();
    /* Synthetic "quest" routes the award through the existing store: same
       XP-once-per-day gate, same history, no new earning logic. */
    const sessionQuest: Quest = {
      id: SESSION_QUEST_ID,
      title: "Movement Session",
      summary: "GPS movement session",
      description: "A real-world movement session tracked with foreground GPS.",
      category: "Cardio",
      difficulty: "Medium",
      durationSeconds: Math.round(session.durationMs / 1000),
      xpReward: xp,
      icon: "navigate",
      instructions: [],
    };
    completeQuest(sessionQuest);
    successFeedback();
    setSaved(true);
  };

  const done = () => {
    clearLastSession();
    router.dismissAll();
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.kicker}>
          {session.mode === "demo" ? "Demo session" : "Session complete"}
        </Text>
        <Text style={styles.title}>Every move{"\n"}leaves a mark.</Text>
      </View>

      <FadeSlideIn>
        <RouteCanvas points={session.points} height={210} />
      </FadeSlideIn>

      <FadeSlideIn delay={STAGGER_MS}>
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <CountUpText value={km} decimals={2} style={styles.statValue} />
            <Text style={styles.statLabel}>km</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statValue}>{formatDuration(session.durationMs)}</Text>
            <Text style={styles.statLabel}>time</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statValue}>{pace ?? "—"}</Text>
            <Text style={styles.statLabel}>pace /km</Text>
          </View>
        </View>
      </FadeSlideIn>

      <FadeSlideIn delay={STAGGER_MS * 2}>
        <View style={styles.rewardCard}>
          <View style={styles.rewardRow}>
            <View style={[styles.rewardIcon, { backgroundColor: `${palette.moveGold}1F` }]}>
              <Ionicons name="flash" size={18} color={palette.moveGold} />
            </View>
            <Text style={styles.rewardLabel}>XP</Text>
            <CountUpText value={xp} prefix="+" style={[styles.rewardValue, { color: "#B07908" }]} />
          </View>
          <View style={styles.rewardDivider} />
          <View style={styles.rewardRow}>
            <View style={[styles.rewardIcon, { backgroundColor: `${palette.deedViolet}14` }]}>
              <Hexagon size={15} color={palette.deedViolet} />
            </View>
            <View style={styles.rewardLabelWrap}>
              <Text style={styles.rewardLabelPlain}>Locked MOVE</Text>
              <Text style={styles.rewardSub}>preview · in-app progress, not a payout</Text>
            </View>
            <Text style={[styles.rewardValue, { color: palette.deedViolet }]}>
              +{lockedMoveDelta}
            </Text>
          </View>
        </View>
      </FadeSlideIn>

      {session.mode === "demo" ? (
        <Text style={styles.note}>
          Demo route — not real GPS, so this session isn't saved as progress.
        </Text>
      ) : alreadySavedToday && !saved ? (
        <Text style={styles.note}>
          You already saved a session today — extra sessions don't earn more XP.
        </Text>
      ) : !saveable && !saved ? (
        <Text style={styles.note}>
          Too short to save — move at least 200 m or 5 minutes next time.
        </Text>
      ) : saved ? (
        <View style={styles.savedRow}>
          <Ionicons name="checkmark-circle" size={16} color={palette.pulseGreen} />
          <Text style={styles.savedText}>Session saved — streak safe.</Text>
        </View>
      ) : null}

      <View style={styles.footer}>
        {saveable && !saved && !alreadySavedToday ? (
          <Button label="Save session" icon="bookmark" onPress={save} />
        ) : null}
        <Button
          label="Back to Today"
          icon="home"
          variant={saveable && !saved && !alreadySavedToday ? "secondary" : "primary"}
          onPress={done}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: spacing.lg, paddingBottom: spacing.lg, gap: spacing.xs },
  kicker: { ...type.kicker, color: colors.primary },
  title: { ...type.display, fontSize: 28 },
  statsRow: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    marginTop: spacing.md,
    ...shadows.card,
  },
  stat: { flex: 1, alignItems: "center", gap: 2 },
  statValue: { ...type.title, fontSize: 22, fontVariant: ["tabular-nums"] },
  statLabel: { ...type.caption, fontSize: 11 },
  statDivider: { width: 1, backgroundColor: colors.surfaceAlt },
  rewardCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
    marginTop: spacing.md,
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
  rewardLabel: { ...type.heading, fontSize: 15, flex: 1 },
  rewardLabelWrap: { flex: 1, gap: 1 },
  rewardLabelPlain: { ...type.heading, fontSize: 15 },
  rewardSub: { ...type.caption, fontSize: 11, color: colors.textFaint },
  rewardValue: { fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  rewardDivider: { height: 1, backgroundColor: colors.surfaceAlt },
  note: {
    ...type.caption,
    fontSize: 12.5,
    color: colors.textFaint,
    textAlign: "center",
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  savedRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: spacing.lg,
  },
  savedText: { ...type.caption, fontSize: 13, color: colors.text, fontWeight: "600" },
  footer: { marginTop: "auto", paddingVertical: spacing.md, gap: spacing.sm },
  missingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg },
  missingText: { ...type.body },
});
