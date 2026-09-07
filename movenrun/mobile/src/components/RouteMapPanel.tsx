import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { MovenMap } from "./map/MovenMap";
import { RouteMotif } from "./RouteMotif";
import type { OverlayCell } from "@/lib/mapCells";
import { colors, radius, spacing, type } from "@/theme";
import type { RouteMapState } from "@/lib/routeMapState";
import type { PauseSource } from "@movenrun/shared/sealing";
import type { TrackPoint } from "@/lib/geo";

/**
 * The map slot on a finished session, in whichever of its three states applies.
 *
 * The states come from `lib/routeMapState.ts` — this component only renders
 * them. That split is deliberate: the decision is the part that was wrong (a
 * 0 m session resolved to a world-scale view of nothing) and a decision in a
 * pure function can be tested for every route shape, which a decision spread
 * across JSX cannot.
 */
export function RouteMapPanel({
  state,
  points,
  pauses,
  cells,
  style,
}: {
  state: RouteMapState;
  points: readonly TrackPoint[];
  pauses?: PauseSource;
  cells?: readonly OverlayCell[];
  style?: StyleProp<ViewStyle>;
}) {
  if (state.kind === "none") {
    return (
      <View style={[styles.empty, style]} accessibilityRole="summary" accessibilityLabel={state.message ?? ""}>
        <RouteMotif />
        <Text style={styles.emptyText}>{state.message}</Text>
      </View>
    );
  }
  /* `seed` draws the player's ground with a marker and no line. `live` is what
     turns the marker on; there is no session running, but this is the same
     "here is the player" rendering, and inventing a second flag for it would be
     two names for one behaviour. */
  return (
    <MovenMap
      points={state.drawsRoute ? points : EMPTY_POINTS}
      currentLocation={state.currentLocation}
      pauses={pauses}
      cells={state.drawsRoute ? cells : EMPTY_CELLS}
      live={state.kind === "seed"}
      showStartMarker={state.drawsRoute}
      style={style}
      accessibilityLabel={
        state.drawsRoute
          ? "Map of the route you walked"
          : "Map of where this session took place, with no route recorded"
      }
    />
  );
}

const EMPTY_POINTS: readonly TrackPoint[] = [];
const EMPTY_CELLS: readonly OverlayCell[] = [];

const styles = StyleSheet.create({
  empty: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.lg,
  },
  emptyText: { ...type.caption, fontSize: 12.5, textAlign: "center", color: colors.textDim },
});
