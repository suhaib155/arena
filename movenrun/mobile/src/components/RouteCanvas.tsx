import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, glow, palette, radius, spacing, type } from "@/theme";
import { downsample, projectToBox, type TrackPoint } from "@/lib/geo";
import { Hexagon } from "./Hexagon";

interface RouteCanvasProps {
  points: TrackPoint[];
  /** Canvas height. */
  height?: number;
  /** Show the glowing runner marker at the route head. */
  live?: boolean;
}

const MAX_DOTS = 110;

/**
 * Map-free route preview: the session trace drawn as a glowing dotted Base
 * Blue line over a pale, map-like panel with faint roads and hex accents —
 * the same route motif as the website and the Today screen.
 */
export function RouteCanvas({ points, height = 240, live = false }: RouteCanvasProps) {
  const dots = useMemo(() => {
    const sampled = downsample(points, MAX_DOTS);
    return projectToBox(sampled);
  }, [points]);

  const head = dots.length > 0 ? dots[dots.length - 1] : null;
  /* inset so dots never clip the rounded edges */
  const place = (v: number): `${number}%` => `${Number((8 + v * 84).toFixed(2))}%`;

  return (
    <View style={[styles.canvas, { height }]}>
      {/* faint roads */}
      <View style={[styles.road, { top: "26%" }]} />
      <View style={[styles.road, { top: "64%" }]} />
      <View style={[styles.roadV, { left: "30%" }]} />
      <View style={[styles.roadV, { left: "74%" }]} />
      {/* hex accents */}
      <View style={styles.hexTL}>
        <Hexagon size={34} color="#E9EEF1" />
      </View>
      <View style={styles.hexBR}>
        <Hexagon size={46} color="#E3F4EA" />
      </View>

      {dots.length < 2 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {live ? "Waiting for movement…" : "No route recorded"}
          </Text>
        </View>
      ) : (
        <>
          {dots.map((d, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  left: place(d.x),
                  top: place(d.y),
                  opacity: 0.35 + 0.65 * (i / dots.length),
                },
              ]}
            />
          ))}
          {head ? (
            <View style={[styles.runner, { left: place(head.x), top: place(head.y) }]}>
              <View style={styles.runnerCore} />
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
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
  hexTL: { position: "absolute", top: 12, left: 14, opacity: 0.8 },
  hexBR: { position: "absolute", bottom: 14, right: 16, opacity: 0.8 },
  dot: {
    position: "absolute",
    width: 7,
    height: 7,
    marginLeft: -3.5,
    marginTop: -3.5,
    borderRadius: 4,
    backgroundColor: palette.baseBlue,
  },
  runner: {
    position: "absolute",
    width: 18,
    height: 18,
    marginLeft: -9,
    marginTop: -9,
    borderRadius: 9,
    backgroundColor: palette.pulseGreen,
    borderWidth: 3,
    borderColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...glow(palette.pulseGreen),
  },
  runnerCore: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.surface,
  },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyText: { ...type.caption, color: colors.textFaint },
});
