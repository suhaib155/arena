import { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { ringStroke, ringSweep } from "@/lib/ring";

interface ProgressRingProps {
  /** 0..1. Values outside the range clamp rather than throw. */
  progress: number;
  /** Outer diameter. */
  size?: number;
  /** Arc colour. */
  color: string;
  /** Unfilled remainder colour. */
  track?: string;
  /** Stroke width. Defaults to a diameter-proportional weight. */
  stroke?: number;
  /** Centred content — usually the value the ring is measuring. */
  children?: ReactNode;
}

/**
 * A circular progress arc with no SVG and no native dependency.
 *
 * Two semicircles, each clipped to one half of the circle and rotated into
 * place, compose the sweep (geometry in lib/ring.ts). The ring is decorative —
 * the value it measures is rendered as text in the centre, so the arc is hidden
 * from screen readers and progress is never conveyed by the arc alone.
 */
export function ProgressRing({
  progress,
  size = 132,
  color,
  track = "#FFFFFF24",
  stroke,
  children,
}: ProgressRingProps) {
  const { rightDeg, leftDeg } = ringSweep(progress);
  const w = stroke ?? ringStroke(size);
  const half = size / 2;

  /* A full ring, drawn inside a half-width clip so only one semicircle shows. */
  const ring = { width: size, height: size, borderRadius: half, borderWidth: w };

  return (
    <View style={{ width: size, height: size }}>
      {/* Unfilled track */}
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.abs, ring, { borderColor: track }]}
      />

      {/* First half of the sweep, clipped to the right of the circle. */}
      <View style={[styles.clip, { left: half, width: half, height: size }]}>
        <View
          style={[
            styles.rotator,
            { width: size, height: size, left: -half, transform: [{ rotate: `${rightDeg}deg` }] },
          ]}
        >
          <View style={[styles.clip, { right: 0, width: half, height: size }]}>
            <View style={[styles.abs, ring, { right: 0, borderColor: color }]} />
          </View>
        </View>
      </View>

      {/* Second half of the sweep, clipped to the left of the circle. */}
      <View style={[styles.clip, { left: 0, width: half, height: size }]}>
        <View
          style={[
            styles.rotator,
            { width: size, height: size, left: 0, transform: [{ rotate: `${leftDeg}deg` }] },
          ]}
        >
          <View style={[styles.clip, { left: 0, width: half, height: size }]}>
            <View style={[styles.abs, ring, { left: 0, borderColor: color }]} />
          </View>
        </View>
      </View>

      {children ? <View style={styles.center}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: "absolute", top: 0 },
  clip: { position: "absolute", top: 0, overflow: "hidden" },
  rotator: { position: "absolute", top: 0 },
  center: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
});
