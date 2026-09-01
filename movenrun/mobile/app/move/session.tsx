import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, BackHandler, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { ScreenHeader } from "@/components/ScreenHeader";
import { RouteCanvas } from "@/components/RouteCanvas";
import { ReadinessChip } from "@/components/ReadinessChip";
import { MovementMetric } from "@/components/MovementMetric";
import { MovementControlBar } from "@/components/MovementControlBar";
import { colors, palette, radius, shadows, softTint, spacing, type } from "@/theme";
import {
  acceptPoint,
  distanceMeters,
  formatDistance,
  formatDuration,
  formatPace,
  type TrackPoint,
} from "@/lib/geo";
import { createTracker, type TrackerMode } from "@/services/moveTracker";
import {
  pushPoint,
  recordGap,
  shouldRefreshPreview,
  type TrackingGap,
} from "@/lib/trackPoints";
import { setLastSession } from "@/services/moveSession";
import { newClientSessionId } from "@/lib/movementVerification";
import { successFeedback, tapFeedback } from "@/lib/haptics";
import type { IoniconName } from "@/types";

/** Distance that fills the capture-preview ring once (territory beta teaser). */
const ZONE_PREVIEW_M = 500;

type GpsState = "waiting" | "locked" | "weak";

export default function MoveSessionScreen() {
  const router = useRouter();
  const { mode: modeParam } = useLocalSearchParams<{ mode?: string }>();
  const mode: TrackerMode = modeParam === "demo" ? "demo" : "gps";

  /* The drawn route is a throttled *snapshot* of the buffer, not the buffer
     itself: the canvas draws ~110 dots, so refreshing on every fix reconciles
     them for a change nobody can see. */
  const [routePreview, setRoutePreview] = useState<TrackPoint[]>([]);
  const [distanceM, setDistanceM] = useState(0);
  const [paused, setPaused] = useState(false);
  const [gpsState, setGpsState] = useState<GpsState>("waiting");

  /* Refs mirror state the tracker callback needs without re-subscribing. */
  const pausedRef = useRef(false);
  /** Mutated in place — appending must not copy the whole route per fix. */
  const pointsRef = useRef<TrackPoint[]>([]);
  const acceptedRef = useRef(0);
  const distanceRef = useRef(0);
  const finishedRef = useRef(false);
  const accumulatedRef = useRef(0);
  const resumedAtRef = useRef(Date.now());
  /** Spans where the app was backgrounded and no fixes arrived. */
  const gapsRef = useRef<TrackingGap[]>([]);
  const backgroundedAtRef = useRef<number | null>(null);
  /* This session's stable identity, minted once when the screen mounts — the
     semantic start of the session. It survives pause/resume, every re-render,
     finishing, the summary screen, and any later verification attempt. It is
     deliberately NOT minted at finish, at save, or per network attempt: the
     backend's idempotency is keyed on it. */
  const clientSessionIdRef = useRef<string>("");
  if (!clientSessionIdRef.current) clientSessionIdRef.current = newClientSessionId();

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
        /* Distance accumulates incrementally, so it stays exact even after the
           buffer decimates — it is never recomputed from the thinned route. */
        if (prev) distanceRef.current += distanceMeters(prev, p);
        pushPoint(pointsRef.current, p);
        acceptedRef.current += 1;
        setDistanceM(distanceRef.current);
        if (shouldRefreshPreview(acceptedRef.current)) {
          setRoutePreview(pointsRef.current.slice());
        }
      })
      .catch(() => setGpsState("weak"));
    return () => tracker.stop();
  }, [mode]);

  /** Elapsed time, read on demand. Kept out of this component's state so the
   *  once-a-second tick re-renders only the clock, not the route canvas. */
  const readElapsed = useCallback(
    () =>
      pausedRef.current
        ? accumulatedRef.current
        : accumulatedRef.current + (Date.now() - resumedAtRef.current),
    [],
  );

  /* Foreground-only tracking means backgrounding silently stops the fixes:
     distance stops growing while the clock keeps running, so the summary would
     under-report distance and over-report pace as though that were the truth.
     Record the span instead, and let the summary say so. */
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (finishedRef.current) return;
      if (next === "active") {
        const startedAt = backgroundedAtRef.current;
        if (startedAt != null) recordGap(gapsRef.current, startedAt, Date.now());
        backgroundedAtRef.current = null;
      } else if (backgroundedAtRef.current == null) {
        backgroundedAtRef.current = Date.now();
      }
    });
    return () => sub.remove();
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
    /* Close an open background span so a session finished right after
       returning still accounts for the time it missed. */
    if (backgroundedAtRef.current != null) {
      recordGap(gapsRef.current, backgroundedAtRef.current, Date.now());
      backgroundedAtRef.current = null;
    }
    const duration = readElapsed();
    successFeedback();
    setLastSession({
      clientSessionId: clientSessionIdRef.current,
      mode,
      points: pointsRef.current,
      distanceM: distanceRef.current,
      durationMs: duration,
      finishedAt: Date.now(),
      gaps: gapsRef.current,
    });
    router.replace("/move/summary");
  }, [mode, readElapsed, router]);

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

  const zoneProgress = Math.min(1, (distanceM % ZONE_PREVIEW_M) / ZONE_PREVIEW_M);
  const zonesPassed = Math.floor(distanceM / ZONE_PREVIEW_M);

  return (
    <Screen>
      <ScreenHeader
        title={paused ? "Paused" : "Moving"}
        action="dismiss"
        onAction={quit}
        actionLabel="End this movement session"
        dotColor={paused ? palette.moveGold : palette.pulseGreen}
        trailing={<GpsChip mode={mode} state={gpsState} />}
      />

      {/* Live map/route dominates the top of the screen */}
      <RouteCanvas points={routePreview} height={248} live />

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
          <SessionClock readElapsed={readElapsed} distanceM={distanceM} paused={paused} />
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

/**
 * Time and pace, on their own once-a-second tick.
 *
 * Elapsed time is the only thing in this screen that changes every second.
 * Holding it in the parent re-rendered the whole session — route canvas
 * included — 3,600 times an hour for a number the canvas does not use.
 */
function SessionClock({
  readElapsed,
  distanceM,
  paused,
}: {
  readElapsed: () => number;
  distanceM: number;
  paused: boolean;
}) {
  const [elapsedMs, setElapsedMs] = useState(readElapsed);
  useEffect(() => {
    setElapsedMs(readElapsed());
    if (paused) return;
    const timer = setInterval(() => setElapsedMs(readElapsed()), 1000);
    return () => clearInterval(timer);
  }, [readElapsed, paused]);
  return (
    <>
      <MovementMetric value={formatDuration(elapsedMs)} label="time" />
      <View style={styles.metricDivider} />
      <MovementMetric value={formatPace(distanceM, elapsedMs) ?? "—"} label="pace /km" />
    </>
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
    backgroundColor: softTint(palette.deedViolet),
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
