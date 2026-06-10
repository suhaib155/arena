import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { RouteCanvas } from "@/components/RouteCanvas";
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

  const pace = formatPace(distanceM, elapsedMs);
  const zoneProgress = Math.min(1, (distanceM % ZONE_PREVIEW_M) / ZONE_PREVIEW_M);
  const zonesPassed = Math.floor(distanceM / ZONE_PREVIEW_M);

  return (
    <Screen>
      <View style={styles.topBar}>
        <Pressable onPress={quit} hitSlop={12} style={styles.quitBtn}>
          <Ionicons name="close" size={24} color={colors.textDim} />
        </Pressable>
        <Text style={styles.topTitle}>{paused ? "Paused" : "Moving"}</Text>
        <GpsChip mode={mode} state={gpsState} />
      </View>

      <RouteCanvas points={points} height={236} live />

      {mode === "demo" ? (
        <View style={styles.demoBanner}>
          <Ionicons name="flask-outline" size={14} color={colors.textDim} />
          <Text style={styles.demoText}>Demo route — not real GPS. Won't be saved.</Text>
        </View>
      ) : null}

      <View style={styles.statHero}>
        <Text style={styles.statHeroValue}>{formatDistance(distanceM)}</Text>
        <Text style={styles.statHeroLabel}>distance</Text>
      </View>

      <View style={styles.statRow}>
        <StatTile label="Time" value={formatDuration(elapsedMs)} />
        <StatTile label="Pace /km" value={pace ?? "—"} />
      </View>

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

      <View style={styles.controls}>
        <Button
          label={paused ? "Resume" : "Pause"}
          icon={paused ? "play" : "pause"}
          variant="secondary"
          onPress={togglePause}
          style={styles.controlBtn}
        />
        <Button label="Finish" icon="checkmark" onPress={finish} style={styles.controlBtn} />
      </View>
    </Screen>
  );
}

function GpsChip({ mode, state }: { mode: TrackerMode; state: GpsState }) {
  if (mode === "demo") {
    return (
      <View style={styles.gpsChip}>
        <View style={[styles.gpsDot, { backgroundColor: palette.silverTrail }]} />
        <Text style={styles.gpsText}>Demo</Text>
      </View>
    );
  }
  const map: Record<GpsState, { color: string; label: string }> = {
    waiting: { color: palette.silverTrail, label: "Searching…" },
    locked: { color: palette.pulseGreen, label: "GPS locked" },
    weak: { color: palette.heatCoral, label: "Weak signal" },
  };
  const { color, label } = map[state];
  return (
    <View style={styles.gpsChip}>
      <View style={[styles.gpsDot, { backgroundColor: color }]} />
      <Text style={styles.gpsText}>{label}</Text>
    </View>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statTile}>
      <Text style={styles.statTileValue}>{value}</Text>
      <Text style={styles.statTileLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  quitBtn: { padding: spacing.xs },
  topTitle: { ...type.heading, fontSize: 16 },
  gpsChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    ...shadows.card,
  },
  gpsDot: { width: 8, height: 8, borderRadius: 4 },
  gpsText: { ...type.caption, fontSize: 11.5, fontWeight: "700", color: colors.text },
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
  statHero: { alignItems: "center", marginTop: spacing.lg },
  statHeroValue: {
    ...type.display,
    fontSize: 46,
    fontVariant: ["tabular-nums"],
  },
  statHeroLabel: { ...type.kicker },
  statRow: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
  statTile: {
    flex: 1,
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    gap: 2,
    ...shadows.card,
  },
  statTileValue: {
    ...type.title,
    fontSize: 22,
    fontVariant: ["tabular-nums"],
  },
  statTileLabel: { ...type.caption, fontSize: 11 },
  zoneCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    marginTop: spacing.md,
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
  controls: {
    flexDirection: "row",
    gap: spacing.md,
    paddingVertical: spacing.md,
    marginTop: "auto",
  },
  controlBtn: { flex: 1 },
});
