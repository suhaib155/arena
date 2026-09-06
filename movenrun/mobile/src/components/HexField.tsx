import { StyleSheet, View } from "react-native";
import { Hexagon } from "./Hexagon";
import { ground, palette, softTint, strongTint } from "@/theme";

interface HexFieldProps {
  /** Hexagon flat-to-flat width. The lattice spacing derives from it. */
  size?: number;
  /** Rows of cells to draw. Clipped by the parent, so over-drawing is fine. */
  rows?: number;
  /** Cells per row. */
  columns?: number;
}

/**
 * The decorative hex lattice behind an immersive card.
 *
 * ## Why this is drawn and not an image
 *
 * The design guide's hero cards sit on photographic isometric city renders.
 * Shipping those would put megabytes of raster into the bundle, and — the real
 * objection — a photoreal map behind a mission is a picture of *a* city, not
 * of yours. The app already has one place that shows real ground
 * (`components/map/MovenMap`), and a second surface that looks like a map
 * without being one is how a decorative backdrop gets mistaken for territory.
 *
 * So this is unmistakably abstract: an even lattice of translucent hexagons on
 * the dark ground, with no route, no roads, no labels, no "held" or "rival"
 * states and nothing that reads as a location. It is the game's *material* —
 * the thing MovenRun is made of — not a depiction of anywhere.
 *
 * ## Cost
 *
 * Static: no animation, no timers, no measurement, no state. The default 3×5
 * lattice is fifteen `Hexagon`s, each three plain views, so a hero card costs
 * about forty-five leaf views once, at mount. It is `pointerEvents="none"` and
 * hidden from assistive technology, because a backdrop with no meaning must not
 * appear in the reading order of a card that has one.
 */
export function HexField({ size = 62, rows = 3, columns = 5 }: HexFieldProps) {
  const height = size * 1.1547;
  return (
    <View
      style={styles.field}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {Array.from({ length: rows }, (_, r) => (
        <View
          key={r}
          style={[
            styles.row,
            {
              /* Rows overlap by a quarter of the cell height so the lattice
                 interlocks the way a hex grid does, rather than sitting in
                 stacked bands. Odd rows step half a cell right. */
              marginTop: r === 0 ? -height * 0.25 : -height * 0.28,
              marginLeft: r % 2 === 1 ? size * 0.5 : 0,
            },
          ]}
        >
          {Array.from({ length: columns }, (_, c) => (
            <Hexagon
              key={c}
              size={size}
              /* Two weights only. A third would start to read as a state, and
                 this surface deliberately has none. */
              color={(r + c) % 3 === 0 ? strongTint(palette.pulseGreen) : softTint(palette.baseBlue)}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: ground.base,
    overflow: "hidden",
  },
  row: { flexDirection: "row", gap: 3 },
});
