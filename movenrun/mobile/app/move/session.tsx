import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Alert, AppState, BackHandler, Linking, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { ScreenHeader } from "@/components/ScreenHeader";
import { MovenMap } from "@/components/map/MovenMap";
import { contextCells, currentCellKey } from "@/lib/mapCells";
import { ReadinessChip } from "@/components/ReadinessChip";
import { MovementMetric } from "@/components/MovementMetric";
import { MovementControlBar } from "@/components/MovementControlBar";
import { FinishSessionSheet } from "@/components/FinishSessionSheet";
import { gpsTimings, type GpsAcquisitionState } from "@/lib/gpsAcquisitionState";
import { gpsPresence, presenceLabel, type GpsPresence } from "@/lib/mapPresence";
import { Button } from "@/components/Button";
import { colors, ink, palette, radius, shadows, softTint, spacing, type } from "@/theme";
import {
  formatDistance,
  formatDuration,
  formatPace,
  type TrackPoint,
} from "@/lib/geo";
import { inspectFix, type FixDecision } from "@movenrun/shared/measurement";
import { distanceDiagnostics } from "@/lib/distanceDiagnostics";
import { createTracker, TrackerStartError, type TrackerMode } from "@/services/moveTracker";
import {
  pushPoint,
  recordGap,
  shouldRefreshPreview,
  type TrackingGap,
} from "@/lib/trackPoints";
import { setLastSession } from "@/services/moveSession";
import { onVerificationPrivacyReset } from "@/services/verificationPrivacy";
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
import {
  EMPTY_PREVIEW,
  createSealPreview,
  sealPreviewAnnouncement,
  sealPreviewLabel,
  type SealPreview,
  type SealPreviewTracker,
} from "@/lib/sealPreview";
import { successFeedback, tapFeedback } from "@/lib/haptics";
import type { IoniconName } from "@/types";

/**
 * The screen's own signal-quality opinion, which is only half of what the chip
 * says. The other half is whether the map has a position at all, and the two
 * are combined by `gpsPresence` — see `lib/mapPresence.ts` for why this screen
 * is not allowed to announce readiness on its own.
 */
type SignalQuality = "unknown" | "usable" | "degraded";

export default function MoveSessionScreen() {
  const router = useRouter();
  // The privacy-reset callback needs navigation, but navigation identity must
  // not restart an active tracker. Keep the mount router for that callback.
  const routerRef = useRef(router);
  const { mode: modeParam } = useLocalSearchParams<{ mode?: string }>();
  const mode: TrackerMode = __DEV__ && modeParam === "demo" ? "demo" : "gps";
  const { height, fontScale } = useWindowDimensions();
  const compact = height < 780 || fontScale > 1.2;
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
     itself. Refreshing on every fix would hand the map a new coordinate array
     several times a second for a change of a couple of metres — invisible at
     walking zoom, and a native polyline update each time. The stride in
     `lib/trackPoints.ts` decides how often; the buffer it snapshots is capped
     there too, so the polyline is bounded however long the session runs. */
  const [routePreview, setRoutePreview] = useState<TrackPoint[]>([]);
  const [distanceM, setDistanceM] = useState(0);
  const [signal, setSignal] = useState<SignalQuality>("unknown");
  const [acquisitionState, setAcquisitionState] = useState<GpsAcquisitionState>("locating");
  /**
   * Where the player is, for the map to draw.
   *
   * Separate from `routePreview` on purpose, and the reason this screen was
   * rebuilt. Route preview is *evidence* — points that passed `inspectFix` and
   * are being measured toward distance, a seal and eventually ground. This is
   * only a position: the warm-up fix that satisfied acquisition, and thereafter
   * each accepted fix. A stationary player has the second and, correctly, none
   * of the first, and the map must still be able to show them where they are.
   *
   * Nothing set here is measured, sealed, submitted or banked. It is erased
   * with the rest of the session's geometry.
   */
  const [displayLocation, setDisplayLocation] = useState<TrackPoint | null>(null);
  /**
   * The same position, readable without re-subscribing.
   *
   * `finish` needs it and must stay a stable callback: depending on the state
   * would rebuild the finish handler on every fix, which is how a Finish tap
   * ends up running against a closure from three seconds ago.
   */
  const displayLocationRef = useRef<TrackPoint | null>(null);
  const showLocation = useCallback((point: TrackPoint | null) => {
    displayLocationRef.current = point;
    setDisplayLocation(point);
  }, []);
  const [finishSheetOpen, setFinishSheetOpen] = useState(false);
  const [startAttempt, setStartAttempt] = useState(0);
  const [startError, setStartError] = useState<TrackerStartError | null>(null);

  /* Refs mirror state the tracker callback needs without re-subscribing. */
  /** Mutated in place — appending must not copy the whole route per fix. */
  const pointsRef = useRef<TrackPoint[]>([]);
  const acceptedRef = useRef(0);
  const lastFixTimestampRef = useRef(0);
  const distanceRef = useRef(0);
  /** Spans where the app was backgrounded and no fixes arrived. */
  const gapsRef = useRef<TrackingGap[]>([]);
  const backgroundedAtRef = useRef<number | null>(null);
  const trackerGapAtRef = useRef<number | null>(null);
  const continuityBrokenRef = useRef(false);

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

  /**
   * The live sealing preview.
   *
   * Guidance while the player is moving, never authority: the server recomputes
   * sealing from verified evidence and that is the answer that counts. Held in
   * a ref because the tracker callback feeds it on every accepted fix, and
   * mirrored into state only when the summary of it actually changes — a
   * re-render per GPS point would be the map's problem, not the geometry's.
   */
  const previewRef = useRef<SealPreviewTracker | null>(null);
  const [preview, setPreview] = useState<SealPreview>(EMPTY_PREVIEW);

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
    setStartError(null);
    setSignal("unknown");
    showLocation(null);
    apply(requested.lifecycle);
    distanceDiagnostics.reset();

    let cancelled = false;
    const tracker = createTracker(evidenceSourceRef.current);
    const eraseEvidence = () => {
      previewRef.current?.clear();
      previewRef.current = null;
      pointsRef.current.length = 0;
      acceptedRef.current = 0;
      lastFixTimestampRef.current = 0;
      distanceRef.current = 0;
      gapsRef.current.length = 0;
      backgroundedAtRef.current = null;
      trackerGapAtRef.current = null;
      continuityBrokenRef.current = false;
    };
    const unsubscribePrivacyReset = onVerificationPrivacyReset(() => {
      // Sign-out/reset/account replacement explicitly ends this evidence owner.
      // A delayed native start or fix must not repopulate either route buffer.
      cancelled = true;
      tracker.stop();
      eraseEvidence();
      setRoutePreview([]);
      showLocation(null);
      setPreview(EMPTY_PREVIEW);
      setDistanceM(0);
      setSignal("unknown");
      setStartError(null);
      apply(idleLifecycle());
      routerRef.current.replace("/move");
    });
    tracker
      .start((p) => {
        /* Fixes are only evidence while capturing. A point arriving during a
           pause, or after Finish, is dropped rather than extending a route the
           user has already ended. */
        if (cancelled || lifecycleRef.current.state !== "active") return;
        if (backgroundedAtRef.current !== null) return;
        const prev = continuityBrokenRef.current ? null : pointsRef.current[pointsRef.current.length - 1] ?? null;
        const now = Date.now();
        const decision: FixDecision = p.timestamp <= lastFixTimestampRef.current ||
          p.timestamp < (lifecycleRef.current.startedAt ?? now)
          ? { accepted: false, reason: "non_increasing_time", segmentMeters: 0 }
          : inspectFix(prev, p, now);
        if (Number.isFinite(p.timestamp) && p.timestamp <= now) {
          lastFixTimestampRef.current = Math.max(lastFixTimestampRef.current, p.timestamp);
        }
        if (!decision.accepted) {
          /* A rejected fix moves nothing — not the distance, and deliberately
             not the marker either. The common rejections are `within_uncertainty`
             (the player has not actually moved) and `weak_accuracy` (the fix is
             not honest geography); redrawing the player at either would make the
             marker jitter around a stationary person, or place them somewhere
             the app has already decided it does not believe. The display keeps
             the last position it had reason to trust. */
          distanceDiagnostics.record(p, decision, distanceRef.current, previewRef.current?.evidenceStats.retained ?? 0);
          return;
        }
        /* Accepted, so this is both evidence and the best answer to "where am
           I". The two channels agree here; they disagree while stationary and
           during acquisition, which is what the display channel is for. */
        showLocation(p);
        setSignal(p.accuracy != null && p.accuracy > 25 ? "degraded" : "usable");
        if (trackerGapAtRef.current !== null) {
          recordGap(gapsRef.current, trackerGapAtRef.current, Date.now());
          trackerGapAtRef.current = null;
          setStartError(null);
        }
        if (continuityBrokenRef.current) {
          p = { ...p, breakBefore: true };
          continuityBrokenRef.current = false;
        }
        // This buffer is only for drawing. Canonical evidence has its own budget.
        pushPoint(pointsRef.current, p);
        acceptedRef.current += 1;
        /* Geometry is evaluated per accepted fix and nowhere else — not on the
           clock tick, not on a re-render, not on pause or resume. A closure is
           a property of the route, so the only thing that can create one is the
           route growing. */
        const previousPreview = previewRef.current?.preview ?? EMPTY_PREVIEW;
        const closed = previewRef.current?.push(p) ?? false;
        distanceRef.current = previewRef.current?.distanceMeters ?? distanceRef.current;
        setDistanceM(distanceRef.current);
        distanceDiagnostics.record(p, decision, distanceRef.current, previewRef.current?.evidenceStats.retained ?? 0);
        const next = previewRef.current?.preview ?? EMPTY_PREVIEW;
        const announcement = sealPreviewAnnouncement(previousPreview, next);
        if (announcement !== null) AccessibilityInfo.announceForAccessibility(announcement);
        setPreview((current) => {
          if (current.sealedLoops === next.sealedLoops && current.nearStart === next.nearStart) {
            return current;
          }
          return next;
        });
        /* One short confirmation on the moment a loop closes. It marks a real
           state change in the route; it does not claim territory, because none
           has changed hands. */
        if (closed) successFeedback();
        if (shouldRefreshPreview(acceptedRef.current)) {
          setRoutePreview(pointsRef.current.slice());
        }
      }, (error) => {
        if (cancelled) return;
        setStartError(error);
        setSignal("degraded");
        continuityBrokenRef.current = true;
        trackerGapAtRef.current ??= Date.now();
      }, (state) => { if (!cancelled) setAcquisitionState(state); },
        /* The display channel. It runs before the lifecycle is active — that is
           its whole purpose — so it is guarded by `cancelled` alone and never
           by the capture state. It touches no evidence ref. */
        (p) => { if (!cancelled) showLocation(p); })
      .then(() => {
        if (cancelled) { tracker.stop(); return; }
        const started = trackerStarted(lifecycleRef.current, {
          clientSessionId: newClientSessionId(),
          at: Date.now(),
        });
        if (started.outcome !== "ok") return;
        distanceDiagnostics.bind(started.lifecycle.clientSessionId);
        /* Built here and nowhere earlier: a preview needs a session, and the
           session's own rules version is what decides how sealing is read. The
           pause list handed over is the lifecycle's live array, so a pause
           breaks the previewed route exactly where it will break the verified
           one. Null when this build does not know the rules version — the same
           fail-closed answer the server gives. */
        previewRef.current = createSealPreview(
          started.lifecycle.rulesVersion ?? -1,
          () => lifecycleRef.current.pauses,
        );
        apply(started.lifecycle);
        /* Nothing about readiness is announced here. A resolved `start()` means
           the acquisition policy is satisfied, not that the map has a position;
           this line used to say `locked` and was how the header came to claim
           GPS lock over a map showing no location at all. The chip now derives
           what it says from `displayLocation`. */
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStartError(error instanceof TrackerStartError ? error : new TrackerStartError("tracker_error"));
        setSignal("degraded");
        const failed = trackerFailed(lifecycleRef.current);
        if (failed.outcome === "ok") apply(failed.lifecycle);
      });
    return () => {
      cancelled = true;
      unsubscribePrivacyReset();
      tracker.stop();
      /* The session's geometry goes with the session. Nothing about a route
         outlives the screen that captured it. */
      eraseEvidence();
    };
  }, [apply, showLocation, startAttempt]);

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
        continuityBrokenRef.current = true;
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
    if (next.lifecycle.state === "active") continuityBrokenRef.current = true;
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
    if (trackerGapAtRef.current !== null) {
      recordGap(gapsRef.current, trackerGapAtRef.current, at);
      trackerGapAtRef.current = null;
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
      points: previewRef.current?.snapshot() ?? [],
      evidenceStatus: previewRef.current?.evidenceStatus ?? "capacity_limited",
      distanceM: distanceRef.current,
      /* The same active-capture time the clock showed: elapsed minus paused. */
      durationMs: activeMsSoFar(next.lifecycle, at),
      finishedAt: metadata.finishedAt,
      gaps: gapsRef.current.map((gap) => ({ ...gap })),
      /* Where the player is standing, so a session that recorded no route can
         still be shown on their own ground rather than at world scale. Copied,
         not aliased, and display-only — see `FinishedSession.displaySeed`. */
      displaySeed: displayLocationRef.current === null ? null : { ...displayLocationRef.current },
    });
    router.replace("/move/summary");
  }, [apply, router]);

  const quit = useCallback(() => {
    if (lifecycleRef.current.state === "idle" || lifecycleRef.current.state === "starting") {
      router.back();
      return;
    }
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
    setFinishSheetOpen(true);
  }, []);

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
  const controlsAvailable = captureState === "active" || paused;
  useEffect(() => {
    if (controlsAvailable) gpsTimings.live();
  }, [controlsAvailable]);

  /* The head fix, and the grid around it.
     Keyed on the cell rather than on the fix: the player crosses a resolution-8
     boundary every few minutes of walking, so the grid is rebuilt then and not
     on every accepted point. `routePreview` already updates on a stride rather
     than per fix, and this narrows it further to the one thing the overlay
     depends on. */
  /* Stable, so the drawn route's segment memo is not invalidated every render.
     Reads the lifecycle's live pause array, so the line breaks at exactly the
     pauses the measured distance breaks at. */
  const pauseSource = useCallback(() => lifecycleRef.current.pauses, []);

  /* Where the player is, which on this screen is the display location and only
     falls back to the route's head if the display channel has somehow produced
     nothing. Not `routePreview`'s head: that is the last point that became
     *evidence*, which a stationary player does not have and which lags the
     player's actual position by the preview stride even when they do. */
  const head = displayLocation ?? (routePreview.length > 0 ? routePreview[routePreview.length - 1]! : null);
  /* One derivation for the chip, the marker and the overlay, so the header
     cannot claim a lock over a map that is still saying it has no fix. */
  const presence: GpsPresence = gpsPresence({
    acquisition: acquisitionState,
    displayLocation: head,
    degraded: signal === "degraded",
  });
  const cellKey = currentCellKey(head);
  /* Keyed on the cell and not on `head` deliberately: while the player stays
     inside one cell the answer is identical, so recomputing it per fix would
     produce the same seven polygons over and over. */
  const cells = useMemo(() => contextCells(head), [cellKey]); // eslint-disable-line

  if (!controlsAvailable && captureState !== "finished") {
    /* The same vocabulary the chip uses once the session is running, so the
       player is not handed one set of words during warm-up and another after
       it. `acquisitionLabel` remains the policy's internal naming. */
    const title = starting ? presenceLabel(presence) : "Session not started";
    const detail = starting
      ? presence === "locating" ? "Getting your first location." : "Your session starts when the signal is stable."
      : startError?.code === "permission_denied"
        ? "Location permission is needed to record your route."
        : startError?.code === "services_off"
          ? "Location services are off. Turn them on, then retry."
          : startError?.code === "acquisition_timeout"
            ? "A stable location could not be found. Try again with a clearer view of the sky."
            : "Location tracking could not start. You can retry when ready.";
    return (
      <Screen>
        <ScreenHeader title={title} action="dismiss" onAction={quit} actionLabel="Back" />
        <View style={styles.zoneCard} accessibilityLiveRegion="polite">
          <Text style={styles.zoneTitle}>{title}</Text>
          <Text style={styles.zoneNote}>{detail}</Text>
          {!starting ? <Button label="Retry" onPress={() => setStartAttempt(value => value + 1)} /> : null}
          {!starting && startError?.settingsRelevant ? (
            <Button label="Open Settings" variant="secondary" onPress={() => {
              void Linking.openSettings().catch(() => Alert.alert("Settings unavailable", "Open your phone settings to enable location."));
            }} />
          ) : null}
          <Button label="Back" variant="secondary" onPress={quit} />
        </View>
      </Screen>
    );
  }

  /* One colour and one icon for the route's state, never colour alone. Sealed
     is Pulse Green; an open route is Base Blue, which is information rather
     than warning — Rival Red would say an open route was a problem, and it is
     not. There is no animation to reduce: the chip changes, the route does
     not move, and nothing pulses. */
  const sealed = preview.sealedLoops > 0;
  const sealCore = sealed ? palette.pulseGreen : palette.baseBlue;
  const sealInk = sealed ? ink.green : ink.blue;

  return (
    <Screen>
      {/* "Moving" is not shown until the tracker has actually started. Saying
          it while `starting` would be the screen claiming a session that does
          not exist yet — the precise thing the lifecycle boundary prevents. */}
      <ScreenHeader
        title={captureState === "finished" ? "Session complete" : paused ? "Paused" : "Moving"}
        action="dismiss"
        onAction={quit}
        actionLabel="End this movement session"
        dotColor={starting ? palette.silverTrail : paused ? palette.moveGold : palette.pulseGreen}
        trailing={<GpsChip mode={mode} presence={presence} />}
      />

      {/* The real map is the hero, and the first thing to give up height when
          there is not enough of it — `flex: 1` above a floor. Everything below
          keeps its natural height, so the controls cannot be pushed off a small
          screen or a large-text one. */}
      <MovenMap
        points={routePreview}
        currentLocation={head}
        pauses={pauseSource}
        cells={cells}
        live
        paused={paused}
        style={styles.map}
        accessibilityLabel="Map of the route recorded so far"
      />

      {/* Critical metrics and actions remain in the viewport. On constrained
          screens the map shrinks and tertiary route explanation is omitted. */}
      <View style={styles.middle}>
      {startError ? (
        <View style={styles.demoBanner} accessibilityLiveRegion="polite">
          <Text style={styles.demoText}>GPS tracking was interrupted. Time continues; missing route sections will be shown in your summary.</Text>
        </View>
      ) : null}

      {mode === "demo" ? (
        <View style={styles.demoBanner}>
          <Ionicons name="flask-outline" size={14} color={colors.textDim} />
          <Text style={styles.demoText}>Demo route — not real GPS. Won't be saved.</Text>
        </View>
      ) : null}

      {/* Dominant distance metric + supporting time/pace */}
      <View style={[styles.metrics, compact && styles.compactMetrics]}>
        <MovementMetric value={formatDistance(distanceM)} label="distance" size={compact ? "tile" : "hero"} />
        <View style={styles.metricRow}>
          <SessionClock readElapsed={readElapsed} distanceM={distanceM} paused={paused} />
        </View>
      </View>

      {/* The route's sealing state.
          This card used to promise capture from distance alone — "so many
          metres toward your first zone pass" — which is the one thing the game
          does not do: nothing about a route can become ground until the route
          seals. It says what is actually true instead.
          Calm on purpose. An unsealed route is an ordinary route, so there is
          no countdown, no warning colour and no urgency here; nobody should be
          crossing a road to close a loop. */}
      {!compact ? <View style={styles.zoneCard}>
        <View style={styles.zoneHead}>
          <Text style={styles.zoneTitle}>Your route</Text>
          <View style={[styles.sealChip, { backgroundColor: softTint(sealCore) }]}>
            <Ionicons
              name={sealed ? "checkmark-circle" : "git-branch-outline"}
              size={13}
              color={sealCore}
            />
            <Text style={[styles.sealChipText, { color: sealInk }]}>
              {sealPreviewLabel(preview)}
            </Text>
          </View>
        </View>
        <Text style={styles.zoneNote}>
          {sealed
            ? "Sealed sections are banked. The trail ahead is open again."
            : "Cross your own trail, or finish near where you started, to seal this route."}
        </Text>
      </View> : null}
      </View>

      {/* Large, unmistakable controls; Finish is separated + confirmed */}
      <View style={styles.controls}>
        <MovementControlBar
          paused={paused}
          disabled={!controlsAvailable}
          onPauseResume={togglePause}
          onFinish={confirmFinish}
        />
      </View>
      <FinishSessionSheet visible={finishSheetOpen} onKeepMoving={() => setFinishSheetOpen(false)}
        onFinish={() => { setFinishSheetOpen(false); finish(); }} />
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

/**
 * The readiness chip.
 *
 * Its words come from `presenceLabel`, so the only way to make it say `GPS
 * locked` is to hand it a presence that required a display location to exist.
 * There is no branch here that can announce a lock on its own.
 */
function GpsChip({ mode, presence }: { mode: TrackerMode; presence: GpsPresence }) {
  if (mode === "demo") {
    return <ReadinessChip icon="flask-outline" label="Demo" tone="neutral" />;
  }
  const icons: Record<GpsPresence, { icon: IoniconName; tone: "neutral" | "ok" | "warning" }> = {
    locating: { icon: "ellipsis-horizontal", tone: "neutral" },
    improving: { icon: "ellipsis-horizontal", tone: "neutral" },
    ready: { icon: "navigate", tone: "ok" },
    weak: { icon: "warning-outline", tone: "warning" },
  };
  const { icon, tone } = icons[presence];
  return <ReadinessChip icon={icon} label={presenceLabel(presence)} tone={tone} />;
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
  /* The hero, and the flexible one. A floor rather than a fixed height: on a
     320x640 screen at the largest font scale the map gives up its space to the
     metrics and the controls, and still shows the route. */
  map: { flex: 1, minHeight: 0, marginTop: spacing.sm },
  middle: { flexGrow: 0, flexShrink: 0, paddingBottom: spacing.sm },
  compactMetrics: { marginTop: spacing.xs, gap: spacing.xs },
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
  /* Icon + label, never colour alone: the chip says what state the route is in
     for a reader who cannot tell green from blue. */
  sealChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  sealChipText: { ...type.kicker, fontSize: 12, letterSpacing: 0 },
  zoneNote: { ...type.caption, fontSize: 12 },
  /* No `marginTop: "auto"` any more — the map above flexes, so the controls
     sit directly under the scrollable middle and are always on screen. */
  controls: { flexShrink: 0, paddingTop: spacing.sm, paddingBottom: spacing.sm },
});
