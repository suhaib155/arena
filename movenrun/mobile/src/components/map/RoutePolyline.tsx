/**
 * The recorded route, drawn on real geography.
 *
 * One `<Polyline>` per *observed* span, never one polyline over every point.
 * The split comes from {@link polylineSegments}, which asks the shared domain
 * where evidence broke — so the line stops exactly where the measured distance
 * stops counting. A pause, a backgrounded app, a lost fix: the route shows a
 * break, because there was one.
 *
 * The alternative — a single polyline over the whole buffer — draws a straight
 * line between the last fix before a gap and the first fix after it. That line
 * is not a route. It crosses whatever happens to be in between, it is the
 * longest and most eye-catching stroke on the map, and it is the one section
 * the player definitely did not walk.
 *
 * ## The glow
 *
 * Two strokes per span: a wide translucent one under a narrow opaque one. The
 * halo is what makes a thin line legible against satellite imagery, road fill
 * and park green without making the line itself fat enough to hide the street
 * it follows. It is drawn from the same coordinates, so it can never imply a
 * different path than the route it sits under.
 */
import { memo, useMemo } from "react";

import { palette } from "@/theme";
import { isolatedFixes, polylineSegments } from "@/lib/mapGeometry";
import type { TrackPoint } from "@/lib/geo";
import type { PauseSource } from "@movenrun/shared/sealing";

import { Circle, Polyline } from "./provider";

interface RoutePolylineProps {
  points: readonly TrackPoint[];
  /** Pauses from the session lifecycle, so the line breaks where they do. */
  pauses?: PauseSource;
  /** Core stroke colour. */
  color?: string;
  /** Core stroke width in points. */
  width?: number;
}

/** Radius, in metres, of the dot marking a span that is a single fix. */
const ISOLATED_FIX_RADIUS_M = 4;

function RoutePolylineView({
  points,
  pauses = [],
  color = palette.baseBlue,
  width = 5,
}: RoutePolylineProps) {
  /* Recomputed only when the route array identity changes. The session screen
     hands over a fresh slice on a stride, not on every fix, so this runs a few
     times a minute rather than a few times a second. */
  const segments = useMemo(() => polylineSegments(points, pauses), [points, pauses]);
  const strays = useMemo(() => isolatedFixes(points, pauses), [points, pauses]);

  return (
    <>
      {segments.map((coordinates, index) => (
        <Polyline
          key={`halo-${index}`}
          coordinates={coordinates}
          strokeColor={`${color}33`}
          strokeWidth={width * 2.6}
          lineCap="round"
          lineJoin="round"
          zIndex={1}
        />
      ))}
      {segments.map((coordinates, index) => (
        <Polyline
          key={`core-${index}`}
          coordinates={coordinates}
          strokeColor={color}
          strokeWidth={width}
          lineCap="round"
          lineJoin="round"
          zIndex={2}
        />
      ))}
      {/* A span of exactly one fix has no length, so no line can show it.
          Drawing nothing would silently omit an observation the tracker really
          made; a dot says "one fix here, and nothing either side of it". */}
      {strays.map((centre, index) => (
        <Circle
          key={`fix-${index}`}
          center={centre}
          radius={ISOLATED_FIX_RADIUS_M}
          strokeColor={color}
          fillColor={`${color}66`}
          strokeWidth={1}
          zIndex={2}
        />
      ))}
    </>
  );
}

/**
 * Memoised. The live session screen re-renders whenever distance, seal state or
 * GPS quality changes — several times a minute — and re-projecting the route
 * for a number the map does not draw is pure waste.
 */
export const RoutePolyline = memo(RoutePolylineView);
