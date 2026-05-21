import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Pressable,
} from "react-native";
import {
  Canvas,
  Path,
  Skia,
  Circle,
  Group,
  Shadow,
  useTiming,
  useComputedValue,
  useValue,
  useDerivedValue,
  runTiming,
  LinearGradient,
  vec,
  Paint,
  BlurMask,
} from "@shopify/react-native-skia";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSpring,
  withSequence,
  FadeInDown,
  Easing,
  runOnJS,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { GPSPoint } from "@movenrun/shared";

const { width: W, height: H } = Dimensions.get("window");

const C = {
  signal: "#00ff88",
  gold: "#ffd700",
  ember: "#ff6400",
  bg: "#0d0d0d",
  surface: "#1a1a1a",
  dim: "#666",
} as const;

const CANVAS_H = H * 0.45;

// Seed-stable particle layout — computed once, never during render
const PARTICLES = Array.from({ length: 48 }, (_, i) => {
  const angle = (Math.PI * 2 * i) / 48 + (i % 3) * 0.15;
  return {
    angle,
    speed: 60 + (i % 7) * 18,
    size: 2 + (i % 4),
    delay: (i % 5) * 0.04,
  };
});

// Each particle rendered as its own component to satisfy Rules of Hooks
function Particle({
  particleProgress,
  angle,
  speed,
  size,
  delay,
  color,
  cx,
  cy,
}: {
  particleProgress: ReturnType<typeof useValue>;
  angle: number;
  speed: number;
  size: number;
  delay: number;
  color: string;
  cx: number;
  cy: number;
}) {
  const t = useComputedValue(
    () => Math.max(0, particleProgress.current - delay),
    [particleProgress]
  );
  const px = useComputedValue(() => cx + Math.cos(angle) * speed * t.current, [t]);
  const py = useComputedValue(() => cy + Math.sin(angle) * speed * t.current, [t]);
  return <Circle cx={px} cy={py} r={size} color={color} />;
}

function ParticleBurst({
  particleProgress,
  particleOpacity,
  cx,
  cy,
}: {
  particleProgress: ReturnType<typeof useValue>;
  particleOpacity: ReturnType<typeof useComputedValue>;
  cx: number;
  cy: number;
}) {
  return (
    <Group opacity={particleOpacity}>
      {PARTICLES.map((p, i) => (
        <Particle
          key={i}
          particleProgress={particleProgress}
          angle={p.angle}
          speed={p.speed}
          size={p.size}
          delay={p.delay}
          color={i % 3 === 0 ? C.gold : C.signal}
          cx={cx}
          cy={cy}
        />
      ))}
    </Group>
  );
}

function buildRoutePath(
  points: GPSPoint[],
  canvasW: number,
  canvasH: number
): ReturnType<typeof Skia.Path.Make> {
  const path = Skia.Path.Make();
  if (points.length < 2) return path;

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latR = maxLat - minLat || 0.0005;
  const lngR = maxLng - minLng || 0.0005;
  const pad = 40;
  const iW = canvasW - pad * 2;
  const iH = canvasH - pad * 2;

  const toX = (lng: number) => pad + ((lng - minLng) / lngR) * iW;
  const toY = (lat: number) => canvasH - pad - ((lat - minLat) / latR) * iH;

  path.moveTo(toX(points[0].lng), toY(points[0].lat));
  for (let i = 1; i < points.length; i++) {
    path.lineTo(toX(points[i].lng), toY(points[i].lat));
  }
  return path;
}

function formatMOVE(raw: bigint): string {
  return (Number(raw) / 1e18).toFixed(3);
}

export interface RunCompleteProps {
  route: GPSPoint[];
  earnedMove: bigint;
  distanceMeters: number;
  durationSeconds: number;
  hexIds: string[];
  gearMultiplier?: number;
  zoneTaxReceived?: bigint;
  baseEarn?: bigint;
  onDismiss: () => void;
  onShare: () => void;
}

export default function RunComplete({
  route,
  earnedMove,
  distanceMeters,
  durationSeconds,
  hexIds,
  gearMultiplier = 1,
  zoneTaxReceived = 0n,
  baseEarn,
  onDismiss,
  onShare,
}: RunCompleteProps) {
  const base = baseEarn ?? earnedMove;
  const earnedFloat = Number(earnedMove) / 1e18;

  // ── Haptic sequence on mount ────────────────────────────────────────────────
  useEffect(() => {
    const fire = async () => {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await new Promise((r) => setTimeout(r, 200));
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await new Promise((r) => setTimeout(r, 200));
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      await new Promise((r) => setTimeout(r, 400));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    };
    fire();
  }, []);

  // ── Route path animation (Skia) ─────────────────────────────────────────────
  const routePath = buildRoutePath(route, W, CANVAS_H);
  const routeProgress = useValue(0);
  useEffect(() => {
    runTiming(routeProgress, 1, { duration: 1500, easing: Easing.out(Easing.cubic) });
  }, [routeProgress]);

  // End point glow
  const lastPoint = route[route.length - 1];
  const lats = route.map((p) => p.lat);
  const lngs = route.map((p) => p.lng);
  const minLat = Math.min(...lats, 0);
  const maxLat = Math.max(...lats, 0.0005);
  const minLng = Math.min(...lngs, 0);
  const maxLng = Math.max(...lngs, 0.0005);
  const latR = (maxLat - minLat) || 0.0005;
  const lngR = (maxLng - minLng) || 0.0005;
  const pad = 40;
  const endX = lastPoint
    ? pad + ((lastPoint.lng - minLng) / lngR) * (W - pad * 2)
    : W / 2;
  const endY = lastPoint
    ? CANVAS_H - pad - ((lastPoint.lat - minLat) / latR) * (CANVAS_H - pad * 2)
    : CANVAS_H / 2;

  // ── Particle burst (Skia, capped at 48) ─────────────────────────────────────
  const particleProgress = useValue(0);
  useEffect(() => {
    // Particles fire after route draw completes
    const t = setTimeout(() => {
      runTiming(particleProgress, 1, { duration: 1200, easing: Easing.out(Easing.quad) });
    }, 1300);
    return () => clearTimeout(t);
  }, [particleProgress]);

  const particleOpacity = useComputedValue(() => {
    const t = particleProgress.current;
    return t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
  }, [particleProgress]);

  // ── $MOVE counter ────────────────────────────────────────────────────────────
  const [displayed, setDisplayed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const duration = 1800;
    let raf: ReturnType<typeof setTimeout>;
    const tick = () => {
      const elapsed = Date.now() - start;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplayed(eased * earnedFloat);
      if (t < 1) raf = setTimeout(tick, 16);
    };
    const delay = setTimeout(tick, 1400);
    return () => {
      clearTimeout(delay);
      clearTimeout(raf);
    };
  }, [earnedFloat]);

  // ── Card stagger ─────────────────────────────────────────────────────────────
  const minutes = String(Math.floor(durationSeconds / 60)).padStart(2, "0");
  const seconds = String(durationSeconds % 60).padStart(2, "0");
  const km = (distanceMeters / 1000).toFixed(2);

  return (
    <Pressable style={styles.root} onPress={onDismiss}>
      {/* Dark map canvas — route glow + particles */}
      <View style={styles.mapBg} pointerEvents="none">
        <Canvas style={{ width: W, height: CANVAS_H }}>
          {/* Grid dots for map feel */}
          <Group opacity={0.06}>
            {Array.from({ length: 20 }, (_, row) =>
              Array.from({ length: 12 }, (_, col) => (
                <Circle
                  key={`${row}-${col}`}
                  cx={(col / 11) * W}
                  cy={(row / 19) * CANVAS_H}
                  r={1}
                  color="#ffffff"
                />
              ))
            )}
          </Group>

          {/* Route trail — signal glow */}
          <Path
            path={routePath}
            style="stroke"
            strokeWidth={3}
            strokeCap="round"
            strokeJoin="round"
            color={C.signal}
            start={0}
            end={routeProgress}
          >
            <BlurMask blur={6} style="outer" />
          </Path>

          {/* Crisp inner line */}
          <Path
            path={routePath}
            style="stroke"
            strokeWidth={1.5}
            strokeCap="round"
            strokeJoin="round"
            color="#ffffff"
            start={0}
            end={routeProgress}
          />

          {/* End-point beacon */}
          <Circle cx={endX} cy={endY} r={8} color={C.signal} opacity={0.3}>
            <BlurMask blur={12} style="outer" />
          </Circle>
          <Circle cx={endX} cy={endY} r={4} color={C.signal} />

          {/* Particle burst — rendered via sub-component to isolate hook calls */}
          <ParticleBurst
            particleProgress={particleProgress}
            particleOpacity={particleOpacity}
            cx={endX}
            cy={endY}
          />
        </Canvas>

        {/* Fade to dark at bottom */}
        <View style={styles.mapFade} pointerEvents="none" />
      </View>

      {/* Scrollable reward content */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero MOVE count */}
        <Animated.View entering={FadeInDown.delay(1500).duration(400)}>
          <Text style={styles.earnLabel}>$MOVE EARNED</Text>
          <Text style={styles.earnHero}>{displayed.toFixed(3)}</Text>
        </Animated.View>

        {/* Breakdown cards */}
        <Animated.View
          entering={FadeInDown.delay(1700).duration(350)}
          style={styles.cards}
        >
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Base Earn</Text>
            <Text style={styles.cardValue}>{formatMOVE(base)}</Text>
          </View>

          {gearMultiplier > 1 && (
            <View style={[styles.card, styles.cardAccent]}>
              <Text style={styles.cardLabel}>Gear Bonus</Text>
              <Text style={[styles.cardValue, styles.goldText]}>
                ×{gearMultiplier.toFixed(2)}
              </Text>
            </View>
          )}

          {zoneTaxReceived > 0n && (
            <View style={[styles.card, styles.cardSignal]}>
              <Text style={styles.cardLabel}>Zone Tax In</Text>
              <Text style={[styles.cardValue, styles.signalText]}>
                +{formatMOVE(zoneTaxReceived)}
              </Text>
            </View>
          )}
        </Animated.View>

        {/* Run stats */}
        <Animated.View
          entering={FadeInDown.delay(1900).duration(350)}
          style={styles.statRow}
        >
          <View style={styles.stat}>
            <Text style={styles.statValue}>{km}</Text>
            <Text style={styles.statLabel}>km</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statValue}>
              {minutes}:{seconds}
            </Text>
            <Text style={styles.statLabel}>time</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statValue}>{hexIds.length}</Text>
            <Text style={styles.statLabel}>hexes</Text>
          </View>
        </Animated.View>

        {/* Hex thumbnails */}
        {hexIds.length > 0 && (
          <Animated.View entering={FadeInDown.delay(2100).duration(350)}>
            <Text style={styles.sectionLabel}>HEXES TOUCHED</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.hexScroll}
            >
              {hexIds.map((id) => (
                <HexThumbnail key={id} hexId={id} />
              ))}
            </ScrollView>
          </Animated.View>
        )}

        {/* Action buttons */}
        <Animated.View
          entering={FadeInDown.delay(2300).duration(350)}
          style={styles.actions}
        >
          <TouchableOpacity
            style={styles.shareBtn}
            onPress={onShare}
            activeOpacity={0.8}
          >
            <Text style={styles.shareBtnText}>SHARE</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.doneBtn}
            onPress={onDismiss}
            activeOpacity={0.8}
          >
            <Text style={styles.doneBtnText}>DONE</Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </Pressable>
  );
}

function HexThumbnail({ hexId }: { hexId: string }) {
  return (
    <View style={styles.hexThumb}>
      <Canvas style={{ width: 64, height: 72 }}>
        <HexShape cx={32} cy={36} r={28} />
      </Canvas>
      <Text style={styles.hexThumbId} numberOfLines={1}>
        {hexId.slice(-4)}
      </Text>
    </View>
  );
}

function HexShape({
  cx,
  cy,
  r,
}: {
  cx: number;
  cy: number;
  r: number;
}) {
  const path = Skia.Path.Make();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  path.close();
  return (
    <>
      <Path path={path} style="fill" color="rgba(0,255,136,0.08)" />
      <Path
        path={path}
        style="stroke"
        strokeWidth={1.5}
        color={C.signal}
        opacity={0.6}
      />
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: C.bg,
    zIndex: 999,
  },
  mapBg: {
    width: W,
    height: CANVAS_H,
    overflow: "hidden",
  },
  mapFade: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 80,
    // Gradient simulated with a dark semi-transparent block
    backgroundColor: "rgba(13,13,13,0.85)",
  },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
    gap: 20,
  },
  earnLabel: {
    color: C.dim,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2,
    textTransform: "uppercase",
    textAlign: "center",
  },
  earnHero: {
    color: C.gold,
    fontSize: 72,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: -1,
    marginTop: 4,
  },
  cards: { gap: 10 },
  card: {
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardAccent: { borderWidth: 1, borderColor: "rgba(255,215,0,0.2)" },
  cardSignal: { borderWidth: 1, borderColor: "rgba(0,255,136,0.2)" },
  cardLabel: { color: "#888", fontSize: 14 },
  cardValue: { color: "#fff", fontSize: 18, fontWeight: "700" },
  goldText: { color: C.gold },
  signalText: { color: C.signal },
  statRow: {
    flexDirection: "row",
    backgroundColor: C.surface,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "space-around",
  },
  stat: { alignItems: "center" },
  statValue: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  statLabel: {
    color: C.dim,
    fontSize: 11,
    textTransform: "uppercase",
    marginTop: 4,
  },
  statDivider: { width: 1, height: 32, backgroundColor: "#2a2a2a" },
  sectionLabel: {
    color: C.dim,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  hexScroll: { gap: 10, paddingVertical: 4 },
  hexThumb: { alignItems: "center", gap: 4 },
  hexThumbId: {
    color: "#555",
    fontSize: 9,
    fontFamily: "monospace",
    width: 64,
    textAlign: "center",
  },
  actions: { flexDirection: "row", gap: 12 },
  shareBtn: {
    flex: 1,
    backgroundColor: C.signal,
    borderRadius: 28,
    paddingVertical: 16,
    alignItems: "center",
  },
  shareBtnText: { color: "#000", fontWeight: "700", fontSize: 15, letterSpacing: 1 },
  doneBtn: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 28,
    paddingVertical: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  doneBtnText: { color: "#888", fontWeight: "600", fontSize: 15 },
});
