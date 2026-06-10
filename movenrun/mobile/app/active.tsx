import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { categoryColor, colors, radius, shadows, spacing, type } from "@/theme";
import { questService } from "@/services/questService";
import { successFeedback, tapFeedback } from "@/lib/haptics";

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

  const [remaining, setRemaining] = useState(duration);
  const [paused, setPaused] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Guard so the tick and the "Finish" button can't both navigate.
  const finishedRef = useRef(false);

  const finish = useCallback(() => {
    if (finishedRef.current || !quest) return;
    finishedRef.current = true;
    if (intervalRef.current) clearInterval(intervalRef.current);
    successFeedback();
    router.replace({ pathname: "/result", params: { id: quest.id } });
  }, [quest, router]);

  useEffect(() => {
    if (paused) return;
    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          finish();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [paused, finish]);

  const quit = useCallback(() => {
    Alert.alert("Quit quest?", "You won't earn XP if you leave now.", [
      { text: "Keep going", style: "cancel" },
      {
        text: "Quit",
        style: "destructive",
        onPress: () => {
          finishedRef.current = true;
          if (intervalRef.current) clearInterval(intervalRef.current);
          router.back();
        },
      },
    ]);
  }, [router]);

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
      <View style={styles.topBar}>
        <Pressable onPress={quit} hitSlop={12} style={styles.quitBtn}>
          <Ionicons name="close" size={24} color={colors.textDim} />
        </Pressable>
        <Text style={styles.questName}>{quest.title}</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.center}>
        <View style={[styles.ring, { borderColor: tint }]}>
          <Text style={styles.timer}>{mmss(remaining)}</Text>
          <Text style={styles.status}>{paused ? "Paused" : "Keep moving"}</Text>
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
            setPaused((p) => !p);
          }}
          style={styles.controlBtn}
        />
        <Button
          label="Finish"
          icon="checkmark"
          onPress={finish}
          style={styles.controlBtn}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.md,
  },
  quitBtn: { padding: spacing.xs },
  questName: { ...type.heading, fontSize: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.xl },
  ring: {
    width: 240,
    height: 240,
    borderRadius: 120,
    borderWidth: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    gap: spacing.sm,
    ...shadows.float,
  },
  timer: { ...type.display, fontSize: 56, fontVariant: ["tabular-nums"] },
  status: { ...type.body },
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
