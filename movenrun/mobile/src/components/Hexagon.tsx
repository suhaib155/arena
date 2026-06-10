import { StyleSheet, View } from "react-native";

interface HexagonProps {
  /** Flat-to-flat width of the hexagon. */
  size: number;
  /** Solid fill. Use pre-blended pastels for zone fills (no translucency —
   *  the three rectangles would visibly overlap). */
  color: string;
  /** Optional small core dot (e.g. the “captured” pulse). */
  coreColor?: string;
}

/**
 * A solid regular hexagon built from three overlapping rectangles rotated at
 * 0°/60°/−60° — no SVG dependency needed. Used for the hex-zone motif that
 * ties the app to the territory map identity.
 */
export function Hexagon({ size, color, coreColor }: HexagonProps) {
  const rectH = size / Math.sqrt(3);
  const height = size * 1.1547; // point-to-point
  const rect = {
    position: "absolute" as const,
    width: size,
    height: rectH,
    top: (height - rectH) / 2,
    left: 0,
    backgroundColor: color,
  };
  return (
    <View style={{ width: size, height }}>
      <View style={rect} />
      <View style={[rect, styles.r60]} />
      <View style={[rect, styles.r120]} />
      {coreColor ? (
        <View
          style={[
            styles.core,
            {
              width: size * 0.22,
              height: size * 0.22,
              borderRadius: size * 0.11,
              backgroundColor: coreColor,
              top: height / 2 - size * 0.11,
              left: size / 2 - size * 0.11,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  r60: { transform: [{ rotate: "60deg" }] },
  r120: { transform: [{ rotate: "-60deg" }] },
  core: { position: "absolute" },
});
