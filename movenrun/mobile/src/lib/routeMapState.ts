/**
 * What a finished session's map is allowed to show.
 *
 * ## The failure this module exists to prevent
 *
 * A 0 m / 0:28 session opened its summary on a world-scale basemap with no
 * route on it. That is not a map of a short session; it is a map of nowhere,
 * and a reader's only available conclusion is that the app lost the walk.
 *
 * The cause was that the summary asked one question — "draw these points" —
 * and had no answer prepared for the case where there are none. `initialRegion`
 * is legitimately null for an empty route (see `mapGeometry.boundsOf`: empty in,
 * null out, because inventing a fallback coordinate is worse), so the provider
 * fell back to its own default view.
 *
 * ## Three states, and no fourth
 *
 * A finished route resolves to exactly one of:
 *
 * - `route` — enough geometry to draw a line. The map leads, as it always has.
 * - `seed` — no drawable route, but a real position from the session that just
 *   ended. Show that ground, with a marker and no line: the honest picture of
 *   "you were here and did not move far enough to draw a route".
 * - `none` — no route and no position. A designed panel says so in words.
 *   There is deliberately no map in this state, because the only map available
 *   would be of somewhere the player has never been.
 *
 * A world-scale default is not one of the three, which is the whole point.
 *
 * Platform-free and pure, so what the summary claims is decided by a tested
 * function rather than by a component's render order.
 */
import { routeSegments } from "./mapGeometry";
import type { PauseSource } from "@movenrun/shared/sealing";
import type { TrackPoint } from "./geo";

export type RouteMapKind = "route" | "seed" | "none";

export interface RouteMapInput {
  /** The session's canonical route evidence. */
  points: readonly TrackPoint[];
  /** Session pauses, so a "route" claim uses the same breaks the line will. */
  pauses?: PauseSource;
  /** Where the player was standing when the session ended. Display-only. */
  displaySeed?: TrackPoint | null;
  /** False when this build cannot render a real basemap at all. */
  mapAvailable?: boolean;
}

export interface RouteMapState {
  kind: RouteMapKind;
  /** The position to centre on, for `seed`. Null otherwise. */
  currentLocation: TrackPoint | null;
  /** Whether a polyline can honestly be drawn. */
  drawsRoute: boolean;
  /** What the panel says when there is nothing to draw. */
  message: string | null;
}

/**
 * Whether these points can be drawn as a line at all.
 *
 * Two fixes in the same observed span. One fix is a position, not a route, and
 * two fixes separated by an evidence break are two positions — `routeSegments`
 * is the same function the polyline uses, so this cannot disagree with what
 * actually gets drawn.
 */
export function hasDrawableRoute(points: readonly TrackPoint[], pauses: PauseSource = []): boolean {
  /* A fast path, not the rule — the line below decides. Kept because the empty
     and single-fix cases are the common ones on a short session and there is no
     reason to build segment arrays for them. */
  if (points.length < 2) return false;
  return routeSegments(points, pauses).some((segment) => segment.length >= 2);
}

/** The one state a finished session's map may be in. */
export function routeMapState({
  points,
  pauses = [],
  displaySeed = null,
  mapAvailable = true,
}: RouteMapInput): RouteMapState {
  if (!mapAvailable) {
    /* No basemap in this build. `MovenMap` says so itself in words, and it is
       not this module's place to also claim there was no route. */
    return { kind: "none", currentLocation: null, drawsRoute: false, message: "Map unavailable on this build." };
  }
  if (hasDrawableRoute(points, pauses)) {
    return { kind: "route", currentLocation: null, drawsRoute: true, message: null };
  }
  /* A single recorded fix is a position, and a position is worth showing — but
     as a position. The seed is preferred when both exist because it is the
     later of the two. */
  const position = displaySeed ?? (points.length > 0 ? points[points.length - 1]! : null);
  if (position !== null) {
    return { kind: "seed", currentLocation: position, drawsRoute: false, message: null };
  }
  return {
    kind: "none",
    currentLocation: null,
    drawsRoute: false,
    message: "Not enough movement to draw a route.",
  };
}
