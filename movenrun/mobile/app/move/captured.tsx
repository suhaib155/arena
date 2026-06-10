import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { Hexagon } from "@/components/Hexagon";
import { colors, glow, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { clearLastSession } from "@/services/moveSession";
import { successFeedback } from "@/lib/haptics";

const HEX = 120;
/** Flat-to-flat hexagon vertex angles (matches the 3-rect Hexagon). */
const VERTEX_ANGLES = [30, 90, 150, 210, 270, 330];

/**
 * The capture moment: the zone hex fills Dust Gray → Pulse Green, the route
 * touches it, six vertices light clockwise, the stamp pops, and a small
 * gold/green particle burst celebrates. Core Animated only.
 */
export default function ZoneCapturedScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const zone = useGameStore((s) => s.zones.find((z) => z.id === id));

  const fill = useRef(new Animated.Value(0)).current;
  const stamp = useRef(new Animated.Value(0)).current;
  const vertices = useRef(VERTEX_ANGLES.map(() => new Animated.Value(0))).current;
  const particles = useRef(
    Array.from({ length: 8 }, () => new Animated.Value(0)),
  ).current;
  const particleSpecs = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) => ({
        angle: (i / 8) * Math.PI * 2 + 0.4,
        dist: 70 + (i % 3) * 22,
        color: i % 2 === 0 ? palette.moveGold : palette.pulseGreen,
      })),
    [],
  );

  useEffect(() => {
    successFeedback();
    Animated.sequence([
      Animated.timing(fill, {
        toValue: 1,
        duration: 700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.stagger(
        90,
        vertices.map((v) =>
          Animated.spring(v, { toValue: 1, friction: 6, tension: 90, useNativeDriver: true }),
        ),
      ),
      Animated.parallel([
        Animated.spring(stamp, { toValue: 1, friction: 6, tension: 70, useNativeDriver: true }),
        Animated.stagger(
          40,
          particles.map((p) =>
            Animated.timing(p, {
              toValue: 1,
              duration: 900,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ),
        ),
      ]),
    ]).start();
  }, [fill, stamp, vertices, particles]);

  const done = () => {
    clearLastSession();
    router.dismissAll();
  };

  if (!zone) {
    return (
      <Screen>
        <View style={styles.missing}>
          <Text style={styles.missingText}>Zone not found.</Text>
          <Button label="Back to Today" variant="secondary" onPress={done} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.center}>
        <Text style={styles.kicker}>Common Zone</Text>

        <View style={styles.stage}>
          {/* faint map roads */}
          <View style={[styles.road, { top: "30%" }]} />
          <View style={[styles.road, { top: "70%" }]} />
          <View style={[styles.roadV, { left: "26%" }]} />

          {/* route line touching the hex */}
          <View style={styles.routeRow}>
            {Array.from({ length: 9 }).map((_, i) => (
              <View key={i} style={[styles.routeDot, { opacity: 0.3 + i * 0.08 }]} />
            ))}
          </View>

          {/* hex fills dust → pulse green */}
          <View style={styles.hexWrap}>
            <Hexagon size={HEX} color="#E8EDF0" />
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: fill }]}>
              <Hexagon size={HEX} color="#C9EEDE" coreColor={palette.pulseGreen} />
            </Animated.View>
            {/* six vertices light clockwise */}
            {VERTEX_ANGLES.map((deg, i) => {
              const rad = (deg * Math.PI) / 180;
              const R = (HEX * 1.1547) / 2;
              return (
                <Animated.View
                  key={deg}
                  style={[
                    styles.vertex,
                    {
                      left: HEX / 2 + Math.cos(rad) * (HEX / 2) - 5,
                      top: (HEX * 1.1547) / 2 + Math.sin(rad) * R * 0.86 - 5,
                      opacity: vertices[i],
                      transform: [{ scale: vertices[i] }],
                    },
                  ]}
                />
              );
            })}
          </View>

          {/* particles */}
          {particleSpecs.map((spec, i) => (
            <Animated.View
              key={i}
              style={[
                styles.particle,
                {
                  backgroundColor: spec.color,
                  opacity: particles[i].interpolate({
                    inputRange: [0, 0.2, 1],
                    outputRange: [0, 1, 0],
                  }),
                  transform: [
                    {
                      translateX: particles[i].interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, Math.cos(spec.angle) * spec.dist],
                      }),
                    },
                    {
                      translateY: particles[i].interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, Math.sin(spec.angle) * spec.dist - 24],
                      }),
                    },
                  ],
                },
              ]}
            />
          ))}

          {/* stamp */}
          <Animated.View
            style={[
              styles.stamp,
              {
                opacity: stamp,
                transform: [
                  { scale: stamp.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
                  { rotate: "-4deg" },
                ],
              },
            ]}
          >
            <Text style={styles.stampText}>Zone Captured</Text>
          </Animated.View>
        </View>

        <Text style={styles.title}>{zone.name}</Text>
        <Text style={styles.sub}>Control {zone.controlPercent}% · Defense unlocks next</Text>

        <View style={styles.noteCard}>
          <Text style={styles.noteText}>
            Local territory preview · on-device simulation. Locked MOVE remains
            in-app progress, not a payout.
          </Text>
        </View>
      </View>

      <View style={styles.footer}>
        <Button
          label="View zone"
          icon="map-outline"
          variant="secondary"
          onPress={() => router.push({ pathname: "/zone/[id]", params: { id: zone.id } })}
        />
        <Button label="Back to Today" icon="home" onPress={done} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  kicker: { ...type.kicker, color: palette.pulseGreen },
  stage: {
    width: "100%",
    height: 280,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginVertical: spacing.sm,
  },
  road: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#E2E8EC",
  },
  roadV: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 5,
    borderRadius: 3,
    backgroundColor: "#E6EBEF",
  },
  routeRow: {
    position: "absolute",
    left: 18,
    top: "48%",
    flexDirection: "row",
    gap: 9,
  },
  routeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: palette.baseBlue,
  },
  hexWrap: { width: HEX, height: HEX * 1.1547 },
  vertex: {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: palette.voltMint,
    ...glow(palette.voltMint),
  },
  particle: {
    position: "absolute",
    width: 8,
    height: 9,
    borderRadius: 2,
  },
  stamp: {
    position: "absolute",
    top: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: palette.pulseGreen,
    borderRadius: radius.sm,
    paddingVertical: 7,
    paddingHorizontal: spacing.md,
    ...shadows.card,
  },
  stampText: {
    ...type.kicker,
    color: "#0A8F60",
    fontSize: 12,
  },
  title: { ...type.display, fontSize: 30 },
  sub: { ...type.body, fontSize: 14.5 },
  noteCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
    ...shadows.card,
  },
  noteText: { ...type.caption, fontSize: 12, textAlign: "center", color: colors.textFaint },
  footer: { paddingVertical: spacing.md, gap: spacing.sm },
  missing: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg },
  missingText: { ...type.body },
});
