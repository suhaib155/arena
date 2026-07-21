import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { RouteCanvas } from "@/components/RouteCanvas";
import { ReadinessChip } from "@/components/ReadinessChip";
import { MovementMetric } from "@/components/MovementMetric";
import { MovementControlBar } from "@/components/MovementControlBar";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import {
  acceptPoint,
  distanceMeters,
  formatDistance,
  formatDuration,
  formatPace,
  type TrackPoint,
} from "@/lib/geo";
import { createTracker, type TrackerMode } from "@/services/moveTracker";
import { setLastSession } from "@/services/moveSession";
import { successFeedback, tapFeedback } from "@/lib/haptics";
import type { IoniconName } from "@/types";

/** Distance that fills the capture-preview ring once (territory beta teaser). */
const ZONE_PREVIEW_M = 500;

type GpsState = "waiting" | "locked" | "weak";

export default function MoveSessionScreen() {
  const router = useRouter();
  const { mode: modeParam } = useLocalSearchParams<{ mode?: string }>();
  const mode: TrackerMode = modeParam === "demo" ? "demo" : "gps";

  const [points, setPoints] = useState<TrackPoint[]>([]);
  const [distanceM, setDistanceM] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [paused, setPaused] = useState(false);
  const [gpsState, setGpsState] = useState<GpsState>("waiting");

  /* Refs mirror state the tracker callback needs without re-subscribing. */
  const pausedRef = useRef(false);
  const pointsRef = useRef<TrackPoint[]>([]);
  const distanceRef = useRef(0);
  const finishedRef = useRef(false);
  const accumulatedRef = useRef(0);
  const resumedAtRef = useRef(Date.now());

  /* Foreground tracking — subscribed once for the life of the screen. */
  useEffect(() => {
    const tracker = createTracker(mode);
    tracker
      .start((p) => {
        if (pausedRef.current || finishedRef.current) return;
        if (p.accuracy != null && p.accuracy > 25) setGpsState("weak");
        else setGpsState("locked");
        const prev = pointsRef.current[pointsRef.current.length - 1] ?? null;
        if (!acceptPoint(prev, p)) return;
        if (prev) distanceRef.current += distanceMeters(prev, p);
        pointsRef.current = [...pointsRef.current, p];
        setPoints(pointsRef.current);
        setDistanceM(distanceRef.current);
      })
      .catch(() => setGpsState("weak"));
    return () => tracker.stop();
  }, [mode]);

  /* Pausable session clock. */
  useEffect(() => {
    const timer = setInterval(() => {
      if (!pausedRef.current && !finishedRef.current) {
        setElapsedMs(accumulatedRef.current + (Date.now() - resumedAtRef.current));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const togglePause = useCallback(() => {
    tapFeedback();
    setPaused((prev) => {
      const next = !prev;
      if (next) {
        accumulatedRef.current += Date.now() - resumedAtRef.current;
      } else {
        resumedAtRef.current = Date.now();
      }
      pausedRef.current = next;
      return next;
    });
  }, []);

  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const duration = pausedRef.current
      ? accumulatedRef.current
      : accumulatedRef.current + (Date.now() - resumedAtRef.current);
    successFeedback();
    setLastSession({
      mode,
      points: pointsRef.current,
      distanceM: distanceRef.current,
      durationMs: duration,
      finishedAt: Date.now(),
    });
    router.replace("/move/summary");
  }, [mode, router]);

  const quit = useCallback(() => {
    Alert.alert("End session?", "This session won't be saved if you leave now.", [
      { text: "Keep moving", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => {
          finishedRef.current = true;
          router.back();
        },
      },
    ]);
  }, [router]);

  /* Finish is a deliberate action — confirm before ending so it's never
     accidental. The confirmed path calls the unchanged finish(). */
  const confirmFinish = useCallback(() => {
    tapFeedback();
    Alert.alert("Finish session?", "End tracking and review your route.", [
      { text: "Keep moving", style: "cancel" },
      { text: "Finish", style: "default", onPress: finish },
    ]);
  }, [finish]);

  /* Android hardware back must not silently discard a session — intercept it
     and route through the same confirm dialog as the close button. */
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (finishedRef.current) return false;
      quit();
      return true;
    });
    return () => sub.remove();
  }, [quit]);

  const pace = formatPace(distanceM, elapsedMs);
  const zoneProgress = Math.min(1, (distanceM % ZONE_PREVIEW_M) / ZONE_PREVIEW_M);
  const zonesPassed = Math.floor(distanceM / ZONE_PREVIEW_M);

  return (
    <Screen>
      <View style={styles.topBar}>
        <Pressable onPress={quit} hitSlop={12} style={styles.quitBtn}>
          <Ionicons name="close" size={24} color={colors.textDim} />
        </Pressable>
        <View style={styles.statusWrap}>
          <View
            style={[styles.stateDot, { backgroundColor: paused ? palette.moveGold : palette.pulseGreen }]}
          />
          <Text style={styles.topTitle}>{paused ? "Paused" : "Moving"}</Text>
        </View>
        <GpsChip mode={mode} state={gpsState} />
      </View>

      {/* Live map/route dominates the top of the screen */}
      <RouteCanvas points={points} height={248} live />

      {mode === "demo" ? (
        <View style={styles.demoBanner}>
          <Ionicons name="flask-outline" size={14} color={colors.textDim} />
          <Text style={styles.demoText}>Demo route — not real GPS. Won't be saved.</Text>
        </View>
      ) : null}

      {/* Dominant distance metric + supporting time/pace */}
      <View style={styles.metrics}>
        <MovementMetric value={formatDistance(distanceM)} label="distance" size="hero" />
        <View style={styles.metricRow}>
          <MovementMetric value={formatDuration(elapsedMs)} label="time" />
          <View style={styles.metricDivider} />
          <MovementMetric value={pace ?? "—"} label="pace /km" />
        </View>
      </View>

      {/* Claim-in-progress */}
      <View style={styles.zoneCard}>
        <View style={styles.zoneHead}>
          <Text style={styles.zoneTitle}>Capture preview</Text>
          <Text style={styles.zoneTag}>territory beta</Text>
        </View>
        <View style={styles.zoneTrack}>
          <View style={[styles.zoneFill, { width: `${zoneProgress * 100}%` }]} />
        </View>
        <Text style={styles.zoneNote}>
          {zonesPassed > 0
            ? `${zonesPassed} zone pass${zonesPassed > 1 ? "es" : ""} this session — capture lands with the hex map.`
            : `${Math.round(ZONE_PREVIEW_M * zoneProgress)} / ${ZONE_PREVIEW_M} m toward your first zone pass.`}
        </Text>
      </View>

      {/* Large, unmistakable controls; Finish is separated + confirmed */}
      <View style={styles.controls}>
        <MovementControlBar paused={paused} onPauseResume={togglePause} onFinish={confirmFinish} />
      </View>
    </Screen>
  );
}

function GpsChip({ mode, state }: { mode: TrackerMode; state: GpsState }) {
  if (mode === "demo") {
    return <ReadinessChip icon="flask-outline" label="Demo" tone="neutral" />;
  }
  const map: Record<
    GpsState,
    { icon: IoniconName; label: string; tone: "neutral" | "ok" | "warning" }
  > = {
    waiting: { icon: "ellipsis-horizontal", label: "Searching…", tone: "neutral" },
    locked: { icon: "navigate", label: "GPS locked", tone: "ok" },
    weak: { icon: "warning-outline", label: "Weak signal", tone: "warning" },
  };
  const { icon, label, tone } = map[state];
  return <ReadinessChip icon={icon} label={label} tone={tone} />;
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  quitBtn: { padding: spacing.xs },
  statusWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    flex: 1,
    justifyContent: "center",
  },
  stateDot: { width: 9, height: 9, borderRadius: 5 },
  topTitle: { ...type.heading, fontSize: 16 },
  demoBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    paddingVertical: 7,
    marginTop: spacing.sm,
  },
  demoText: { ...type.caption, fontSize: 11.5, fontWeight: "600" },
  metrics: { marginTop: spacing.lg, gap: spacing.md },
  metricRow: { flexDirection: "row", alignItems: "center" },
  metricDivider: {
    width: 1,
    alignSelf: "stretch",
    marginVertical: 6,
    backgroundColor: colors.surfaceAlt,
  },
  zoneCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    marginTop: spacing.lg,
    ...shadows.card,
  },
  zoneHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  zoneTitle: { ...type.heading, fontSize: 14.5 },
  zoneTag: {
    ...type.kicker,
    fontSize: 10,
    color: palette.deedViolet,
    backgroundColor: `${palette.deedViolet}12`,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  zoneTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
  },
  zoneFill: {
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: palette.voltMint,
  },
  zoneNote: { ...type.caption, fontSize: 12 },
  controls: { paddingVertical: spacing.md, marginTop: "auto" },
});
