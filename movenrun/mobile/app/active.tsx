import { useCallback, useEffect, useRef } from "react";
import { Alert, AppState, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Button } from "@/components/Button";
import { GameBadge } from "@/components/GameBadge";
import { avatar, categoryColor, colors, radius, shadows, spacing, type } from "@/theme";
import { questService } from "@/services/questService";
import { successFeedback, tapFeedback } from "@/lib/haptics";
import { useGameStore } from "@/store/useGameStore";

function mmss(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function ActiveQuestScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const quest = questService.getQuestById(id ?? "");
  const duration = quest?.durationSeconds ?? 0;

  const hydrated = useGameStore((s) => s._hydrated);
  const storedAttempt = useGameStore((s) => s.questAttempt);
  const attempt = storedAttempt?.questId === quest?.id ? storedAttempt : null;
  const remaining = Math.max(0, Math.ceil(duration - (attempt?.activeMs ?? 0) / 1000));
  const paused = attempt?.status === "paused";
  const lastTickRef = useRef<number | null>(null);
  // Guard so the tick and the "Finish" button can't both navigate.
  const finishedRef = useRef(false);

  const flushElapsed = useCallback(() => {
    const current = useGameStore.getState().questAttempt;
    const now = performance.now();
    if (lastTickRef.current !== null && current && current.questId === quest?.id && current.status === "active") {
      useGameStore.getState().advanceQuest(current.id, now - lastTickRef.current);
    }
    lastTickRef.current = now;
  }, [quest?.id]);

  const finish = useCallback(() => {
    const current = useGameStore.getState().questAttempt;
    if (finishedRef.current || !quest || !current || current.questId !== quest.id) return;
    finishedRef.current = true;
    flushElapsed();
    const outcome = useGameStore.getState().finishQuest(current.id);
    if (outcome?.completionSatisfied && !outcome.alreadyAwarded) successFeedback();
    router.replace({ pathname: "/result", params: { id: quest.id, attemptId: current.id } });
  }, [quest, router, flushElapsed]);

  useEffect(() => {
    if (hydrated && quest) useGameStore.getState().startQuest(quest.id);
  }, [hydrated, quest?.id]);

  useEffect(() => {
    if (!attempt || attempt.status !== "active" || finishedRef.current) return;
    if (AppState.currentState !== "active") {
      useGameStore.getState().pauseQuest(attempt.id);
      return;
    }
    lastTickRef.current = performance.now();
    const interval = setInterval(() => {
      flushElapsed();
      if ((useGameStore.getState().questAttempt?.activeMs ?? 0) >= duration * 1000) finish();
    }, 1000);
    return () => {
      clearInterval(interval);
      lastTickRef.current = null;
    };
  }, [attempt?.id, attempt?.status, duration, finish, flushElapsed]);

  useEffect(() => {
    const pause = () => {
      flushElapsed();
      const current = useGameStore.getState().questAttempt;
      if (current && current.questId === quest?.id) useGameStore.getState().pauseQuest(current.id);
      lastTickRef.current = null;
    };
    const listener = AppState.addEventListener("change", (state) => { if (state !== "active") pause(); });
    return () => { listener.remove(); pause(); };
  }, [quest?.id, flushElapsed]);

  const quit = useCallback(() => {
    Alert.alert("Quit quest?", "You won't earn XP if you leave now.", [
      { text: "Keep going", style: "cancel" },
      {
        text: "Quit",
        style: "destructive",
        onPress: () => {
          finishedRef.current = true;
          flushElapsed();
          const current = useGameStore.getState().questAttempt;
          if (current && current.questId === quest?.id) useGameStore.getState().finishQuest(current.id);
          router.back();
        },
      },
    ]);
  }, [router, quest?.id, flushElapsed]);

  if (!quest) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.missing}>Quest not found.</Text>
          <Button label="Go back" variant="secondary" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  const tint = categoryColor[quest.category] ?? colors.primary;
  const progress = duration > 0 ? 1 - remaining / duration : 0;

  return (
    <Screen>
      <ScreenHeader
        title={quest.title}
        action="dismiss"
        onAction={quit}
        actionLabel="End this quest"
      />

      <View style={styles.center}>
        <View style={[styles.ring, { borderColor: tint }]}>
          <Text maxFontSizeMultiplier={1.6} style={styles.timer}>{mmss(remaining)}</Text>
          <View style={styles.questState}>
            <GameBadge icon={paused ? "pause" : "flash-outline"} tone="gold" size={32} />
            <Text style={styles.status}>{paused ? "Paused" : "Keep moving"}</Text>
          </View>
        </View>

        <View style={styles.progressTrack}>
          <View
            style={[styles.progressFill, { width: `${progress * 100}%`, backgroundColor: tint }]}
          />
        </View>
        <Text style={styles.reward}>
          <Ionicons name="flash" size={14} color={colors.warning} /> +{quest.xpReward} XP on completion
        </Text>
      </View>

      <View style={styles.controls}>
        <Button
          label={paused ? "Resume" : "Pause"}
          icon={paused ? "play" : "pause"}
          variant="secondary"
          onPress={() => {
            tapFeedback();
            if (!attempt) return;
            flushElapsed();
            const store = useGameStore.getState();
            if (paused) store.resumeQuest(attempt.id); else store.pauseQuest(attempt.id);
          }}
          style={styles.controlBtn}
        />
        <Button
          label="Finish"
          icon="checkmark"
          onPress={finish}
          disabled={!attempt || !hydrated}
          style={styles.controlBtn}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.xl },
  ring: { width: "100%", maxWidth: 320, minHeight: 260, paddingVertical: spacing.xl, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", borderWidth: 6, backgroundColor: colors.surface, gap: spacing.sm, ...shadows.float },
  timer: { ...type.display, fontSize: 56, lineHeight: 78, paddingVertical: spacing.xs, fontVariant: ["tabular-nums"] },
  status: { ...type.heading },
  questState: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  progressTrack: {
    alignSelf: "stretch",
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: radius.pill },
  reward: { ...type.caption, fontSize: 14, fontWeight: "600" },
  controls: { flexDirection: "row", gap: spacing.md, paddingVertical: spacing.md },
  controlBtn: { flex: 1 },
  missing: { ...type.body, fontSize: 16 },
});
