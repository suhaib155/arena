/**
 * Where the player is now — the head of the recorded route.
 *
 * Deliberately *not* `showsUserLocation`. The platform blue dot is the OS's
 * own reading of the device position, updated on its own schedule from its own
 * fixes. This app draws the head of the route it actually accepted, which is a
 * different thing: fixes the tracker rejected as too inaccurate never move this
 * marker, so it can never sit somewhere the recorded route does not reach. Two
 * dots that disagree, one of them ahead of the line, is precisely the artefact
 * that makes a walking demo look broken — and the honest marker is the one tied
 * to the evidence.
 *
 * ## `tracksViewChanges`
 *
 * A `<Marker>` with React children is rasterised into a bitmap by the native
 * Android view, and while `tracksViewChanges` is true it is re-rasterised on
 * every render of the map. For a marker that moves with every GPS fix that is a
 * continuous re-encode for the entire session — the single most expensive thing
 * a naive map screen does, and the usual reason a route screen stutters after a
 * few minutes.
 *
 * The marker is therefore tracked only long enough to capture its appearance
 * once, then frozen. Moving it afterwards is a coordinate change, which the
 * native view handles without touching the bitmap.
 */
import { memo, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { avatar, colors, palette } from "@/theme";
import type { LatLng } from "@/lib/mapGeometry";

import { Marker } from "./provider";

/** Long enough for the marker's views to lay out and rasterise once. */
const RASTERISE_MS = 800;

interface CurrentLocationMarkerProps {
  coordinate: LatLng;
  /** Capture is paused — shown as a muted marker rather than a live one. */
  paused?: boolean;
}

function CurrentLocationMarkerView({ coordinate, paused = false }: CurrentLocationMarkerProps) {
  const [tracks, setTracks] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setTracks(false), RASTERISE_MS);
    return () => clearTimeout(timer);
  }, []);
  /* Re-rasterise once when the paused look changes, then freeze again. */
  useEffect(() => {
    setTracks(true);
    const timer = setTimeout(() => setTracks(false), RASTERISE_MS);
    return () => clearTimeout(timer);
  }, [paused]);

  const core = paused ? palette.moveGold : palette.pulseGreen;

  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={tracks}
      zIndex={4}
      accessibilityLabel={paused ? "Your position, capture paused" : "Your current position"}
    >
      <View style={styles.halo}>
        <View style={[styles.core, { backgroundColor: core }]} />
      </View>
    </Marker>
  );
}

export const CurrentLocationMarker = memo(CurrentLocationMarkerView);

const styles = StyleSheet.create({
  /* A round affordance, so it goes through the shared `avatar` shape rather
     than a hand-rolled square-with-radius — see `lib/shape.ts`. */
  halo: { ...avatar(26), backgroundColor: `${palette.pulseGreen}33` },
  core: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 3,
    borderColor: colors.surface,
  },
});
