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
import {
  activeMsSoFar,
  finish as finishLifecycle,
  idleLifecycle,
  pause as pauseLifecycle,
  requestStart,
  resume as resumeLifecycle,
  sessionMetadata,
  trackerFailed,
  trackerStarted,
  type SessionLifecycle,
} from "@/lib/sessionLifecycle";
import { successFeedback, tapFeedback } from "@/lib/haptics";
import type { IoniconName } from "@/types";

/** Distance that fills the capture-preview ring once (territory beta teaser). */
const ZONE_PREVIEW_M = 500;

type GpsState = "waiting" | "locked" | "weak";

export default function MoveSessionScreen() {
  const router = useRouter();
  const { mode: modeParam } = useLocalSearchParams<{ mode?: string }>();
  const mode: TrackerMode = modeParam === "demo" ? "demo" : "gps";
  /**
   * The evidence source for this session, pinned at mount.
   *
   * A session's source of evidence is decided by the route that opened this
   * screen and is fixed for its whole life. Reading it from a ref keeps the
   * start effect below a *mount* effect: were it to depend on `mode`, a change
   * would run the cleanup (stopping the tracker) and then be turned away by
   * the single-flight guard, leaving a session that still looks live with
   * nothing capturing. It is also what the finished session records, so the
   * declared source is the one that actually produced the points.
   */
  const evidenceSourceRef = useRef<TrackerMode>(mode);

  /* The drawn route is a throttled *snapshot* of the buffer, not the buffer
     itself: the canvas draws ~110 dots, so refreshing on every fix reconciles
     them for a change nobody can see. */
  const [routePreview, setRoutePreview] = useState<TrackPoint[]>([]);
  const [distanceM, setDistanceM] = useState(0);
  const [gpsState, setGpsState] = useState<GpsState>("waiting");

  /* Refs mirror state the tracker callback needs without re-subscribing. */
  /** Mutated in place — appending must not copy the whole route per fix. */
  const pointsRef = useRef<TrackPoint[]>([]);
  const acceptedRef = useRef(0);
  const distanceRef = useRef(0);
  /** Spans where the app was backgrounded and no fixes arrived. */
  const gapsRef = useRef<TrackingGap[]>([]);
  const backgroundedAtRef = useRef<number | null>(null);

  /**
   * The capture lifecycle.
   *
   * Held in a ref because the tracker callback and the AppState listener read
   * it without re-subscribing, and mirrored into state only for what the UI
   * actually renders. Every transition goes through the pure machine in
   * `lib/sessionLifecycle.ts`, so "one id", "one start", "no double finish"
   * and "pauses cannot overlap" are properties of a tested function rather
   * than of this component being read carefully.
   */
  const lifecycleRef = useRef<SessionLifecycle>(idleLifecycle());
  const [captureState, setCaptureState] = useState(lifecycleRef.current.state);

  const apply = useCallback((next: SessionLifecycle) => {
    lifecycleRef.current = next;
    setCaptureState(next.state);
  }, []);

  /**
   * Start, as one transaction.
   *
   * Nothing is stamped until the tracker is actually running: no session id, no
   * start timestamp, no mode, no rules version. Previously the id was minted
   * during render and the tracker was started in an effect that swallowed its
   * own failure, so a revoked permission left a session that looked live,
   * counted time, and recorded nothing. Now a failed start returns to idle with
   * nothing burned.
   */
  useEffect(() => {
    const requested = requestStart(lifecycleRef.current);
    if (requested.outcome !== "ok") return;
    apply(requested.lifecycle);

    let cancelled = false;
    const tracker = createTracker(evidenceSourceRef.current);
    tracker
      .start((p) => {
        /* Fixes are only evidence while capturing. A point arriving during a
           pause, or after Finish, is dropped rather than extending a route the
           user has already ended. */
        if (lifecycleRef.current.state !== "active") return;
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
      .then(() => {
        if (cancelled) return;
        const started = trackerStarted(lifecycleRef.current, {
          clientSessionId: newClientSessionId(),
          at: Date.now(),
        });
        if (started.outcome === "ok") apply(started.lifecycle);
      })
      .catch(() => {
        if (cancelled) return;
        setGpsState("weak");
        const failed = trackerFailed(lifecycleRef.current);
        if (failed.outcome === "ok") apply(failed.lifecycle);
      });
    return () => {
      cancelled = true;
      tracker.stop();
    };
  }, [apply]);

  /** Elapsed time, read on demand. Kept out of this component's state so the
   *  once-a-second tick re-renders only the clock, not the route canvas.
   *  Derived from the lifecycle, so the number on screen is the same one the
   *  finished session carries. */
  const readElapsed = useCallback(() => activeMsSoFar(lifecycleRef.current, Date.now()), []);

  /* Foreground-only tracking means backgrounding silently stops the fixes:
     distance stops growing while the clock keeps running, so the summary would
     under-report distance and over-report pace as though that were the truth.
     Record the span instead, and let the summary say so. */
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      /* Only a live capture can miss fixes. A finished session has nothing
         left to lose, and a session that never started has nothing to record.
         A gap is deliberately still recorded while PAUSED: pausing does not
         make the app's inability to observe untrue, and a pause and a gap are
         different facts that must not overwrite each other. */
      const state = lifecycleRef.current.state;
      if (state !== "active" && state !== "paused") return;
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

  /**
   * Pause and resume, through the lifecycle machine.
   *
   * The machine is what makes rapid taps safe: a second Pause while paused is
   * `ignored` and opens no second interval, and a Resume while active is
   * `ignored` and closes nothing. Haptics fire only on a transition that
   * actually happened, so a duplicate tap is silent rather than buzzing twice.
   */
  const togglePause = useCallback(() => {
    const current = lifecycleRef.current;
    const next =
      current.state === "paused"
        ? resumeLifecycle(current, Date.now())
        : pauseLifecycle(current, Date.now());
    if (next.outcome !== "ok") return;
    tapFeedback();
    apply(next.lifecycle);
  }, [apply]);

  /**
   * Finish, exactly once.
   *
   * Single-flight in the machine rather than in this closure: a second Finish
   * is `ignored`, so a double tap cannot produce two finished sessions, two
   * summaries, two save boundaries or two submissions. An open pause is closed
   * at `finishedAt` by the machine, so a session finished while paused still
   * yields coherent evidence.
   */
  const finish = useCallback(() => {
    const at = Date.now();
    const next = finishLifecycle(lifecycleRef.current, at);
    if (next.outcome !== "ok") return;
    apply(next.lifecycle);

    /* Close an open background span so a session finished right after
       returning still accounts for the time it missed. */
    if (backgroundedAtRef.current != null) {
      recordGap(gapsRef.current, backgroundedAtRef.current, at);
      backgroundedAtRef.current = null;
    }

    const metadata = sessionMetadata(next.lifecycle);
    const id = next.lifecycle.clientSessionId;
    /* Both are non-null in `finished` by construction; the machine returns
       null metadata only for a session that never started, which cannot reach
       here because Finish is invalid from `idle` and `starting`. */
    if (!metadata || id === null) return;

    successFeedback();
    setLastSession({
      clientSessionId: id,
      mode: evidenceSourceRef.current,
      session: metadata,
      points: pointsRef.current,
      distanceM: distanceRef.current,
      /* The same active-capture time the clock showed: elapsed minus paused. */
      durationMs: activeMsSoFar(next.lifecycle, at),
      finishedAt: metadata.finishedAt,
      gaps: gapsRef.current,
    });
    router.replace("/move/summary");
  }, [apply, router]);

  const quit = useCallback(() => {
    Alert.alert("End session?", "This session won't be saved if you leave now.", [
      { text: "Keep moving", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => {
          /* Discard: the lifecycle is abandoned without producing evidence.
             No FinishedSession, no save boundary, no queued verification —
             and the id, if one was minted, simply goes unused. */
          apply(idleLifecycle());
          router.back();
        },
      },
    ]);
  }, [apply, router]);

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
      const state = lifecycleRef.current.state;
      if (state !== "active" && state !== "paused") return false;
      quit();
      return true;
    });
    return () => sub.remove();
  }, [quit]);

  /* One source of truth for what the screen shows: the capture state. The
     screen used to hold its own `paused` boolean beside the tracker's, which
     is two places for one fact and two places for it to disagree. */
  const paused = captureState === "paused";
  const starting = captureState === "starting";

  const zoneProgress = Math.min(1, (distanceM % ZONE_PREVIEW_M) / ZONE_PREVIEW_M);
  const zonesPassed = Math.floor(distanceM / ZONE_PREVIEW_M);

  return (
    <Screen>
      {/* "Moving" is not shown until the tracker has actually started. Saying
          it while `starting` would be the screen claiming a session that does
          not exist yet — the precise thing the lifecycle boundary prevents. */}
      <ScreenHeader
        title={starting ? "Starting…" : paused ? "Paused" : "Moving"}
        action="dismiss"
        onAction={quit}
        actionLabel="End this movement session"
        dotColor={starting ? palette.silverTrail : paused ? palette.moveGold : palette.pulseGreen}
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
        <MovementControlBar
          paused={paused}
          disabled={starting}
          onPauseResume={togglePause}
          onFinish={confirmFinish}
        />
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
