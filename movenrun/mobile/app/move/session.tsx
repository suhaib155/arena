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
import {
  calculateClosureDistance,
  estimateEnclosedAreaSquareMeters,
} from "@/lib/geo/routeGeoJson";
import {
  buildLivePreview,
  CAPTURE_PREVIEW_DEFAULTS,
  estimateCellCount,
  formatArea,
} from "@/lib/territory/capturePreview";
import { successFeedback, tapFeedback } from "@/lib/haptics";
import type { IoniconName } from "@/types";

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

  /* Live capture preview. Everything here is an on-device ESTIMATE — the
     server recomputes closure, area and cells from the raw route and its
     answer is the only one that awards territory. The copy in
     capturePreview.ts is written so no preview state can read as a claim. */
  const closureDistanceM = calculateClosureDistance(points);
  const estimatedArea = estimateEnclosedAreaSquareMeters(points);
  const estimatedCells = estimateCellCount(estimatedArea);
  const preview = buildLivePreview({
    closureDistanceMeters: closureDistanceM,
    estimatedAreaSquareMeters: estimatedArea,
    cellsCrossed: 0,
    estimatedCells,
    closureToleranceMeters: CAPTURE_PREVIEW_DEFAULTS.closureToleranceMeters,
    nearClosureMeters: CAPTURE_PREVIEW_DEFAULTS.nearClosureMeters,
    distanceMeters: distanceM,
    minDistanceMeters: CAPTURE_PREVIEW_DEFAULTS.minDistanceMeters,
  });
  /* Progress toward the minimum distance the backend requires — a concrete,
     honest target rather than an invented one. */
  const distanceProgress = Math.min(
    1,
    distanceM / CAPTURE_PREVIEW_DEFAULTS.minDistanceMeters,
  );

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

      {/* Live capture preview — estimate only, never a claim. */}
      <View style={styles.zoneCard}>
        <View style={styles.zoneHead}>
          <Text style={styles.zoneTitle}>Capture preview</Text>
          <Text style={styles.zoneTag}>estimate</Text>
        </View>

        <Text style={styles.previewHeadline}>{preview.headline}</Text>
        {preview.detail ? <Text style={styles.zoneNote}>{preview.detail}</Text> : null}

        <View style={styles.zoneTrack}>
          <View style={[styles.zoneFill, { width: `${distanceProgress * 100}%` }]} />
        </View>
        <Text style={styles.zoneNote}>
          {formatDistance(distanceM)} of {CAPTURE_PREVIEW_DEFAULTS.minDistanceMeters} m minimum
          {preview.showAreaEstimate ? ` · about ${formatArea(estimatedArea)} enclosed` : ""}
        </Text>

        <Text style={styles.previewFootnote}>
          Server verified after you finish — nothing is captured until then.
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
  previewHeadline: { ...type.heading, fontSize: 14, lineHeight: 19 },
  previewFootnote: { ...type.caption, fontSize: 10.5, color: colors.textFaint },
  controls: { paddingVertical: spacing.md, marginTop: "auto" },
});
