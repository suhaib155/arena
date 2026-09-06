/**
 * Where this session began.
 *
 * The start is the reference point for the one seal method a player can aim
 * for deliberately — finishing near where they started — so it earns a
 * permanent mark on the map rather than being implied by the end of the line.
 *
 * It is the first *accepted* fix, not the position at the moment Start was
 * tapped. Those differ: the tracker acquires for a few seconds before it
 * accepts anything, and the fixes it rejects are rejected precisely because
 * they are not trustworthy enough to anchor a route. Marking an unaccepted fix
 * would put the origin somewhere the route does not begin.
 *
 * Static by construction — the start of a session never moves — so it is
 * rasterised once and frozen. See `CurrentLocationMarker` for why that matters.
 */
import { memo, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { avatar, colors, palette } from "@/theme";
import type { LatLng } from "@/lib/mapGeometry";

import { Marker } from "./provider";

const RASTERISE_MS = 800;

interface StartMarkerProps {
  coordinate: LatLng;
}

function StartMarkerView({ coordinate }: StartMarkerProps) {
  const [tracks, setTracks] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setTracks(false), RASTERISE_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={tracks}
      zIndex={3}
      accessibilityLabel="Where this session started"
    >
      <View style={styles.ring}>
        <View style={styles.core} />
      </View>
    </Marker>
  );
}

export const StartMarker = memo(StartMarkerView);

const styles = StyleSheet.create({
  ring: {
    ...avatar(20),
    backgroundColor: colors.surface,
    borderWidth: 2.5,
    borderColor: palette.baseBlue,
  },
  core: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: palette.baseBlue,
  },
});
