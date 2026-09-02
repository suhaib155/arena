/**
 * The canonical H3 gameplay geography.
 *
 * MovenRun has exactly one world grid, and this module is its only definition.
 * Mobile and backend both import from here, so a coordinate produces the same
 * cell id on the device and on the server by construction rather than by two
 * implementations agreeing.
 *
 * ## What this module is, and is not
 *
 * H3 answers *where*. It does not answer *whose*. A cell id carries no holder,
 * no capture, no strength, no seal, no solid/shade classification, no deed and
 * no verification status. Those are gameplay state that later phases attach to
 * a cell from the outside; none of them belongs in the cell type, or this
 * module would have to be replaced the first time the rules change.
 *
 * ## Why there is a layer here at all, rather than calling `h3-js` directly
 *
 * Because the library fails open on bad input, in four separate ways that all
 * produce a plausible-looking answer instead of an error. Measured against
 * h3-js 4.5.0:
 *
 * | Call | Bad input | What happens |
 * |---|---|---|
 * | `latLngToCell` | latitude 91, or 1000 | returns a valid cell — the coordinate is wrapped, not rejected |
 * | `latLngToCell` | longitude 200, or 540 | returns a valid cell, wrapped the same way |
 * | `cellToLatLng` | `"zzz"` | returns `[79.24, 38.02]`, a real-looking point |
 * | `cellToBoundary` | `"zzz"` | returns a six-vertex polygon spanning most of the globe |
 * | `gridDisk` | `"zzz"` | returns `[]` — a neighbourhood that is silently empty |
 *
 * A latitude of 91 is not a location, and a route that reaches one is a bug or
 * an attack. Wrapping it produces territory somewhere real, which is the worst
 * available outcome. So every entry point here validates first and throws
 * {@link H3DomainError} rather than passing bad input through. NaN and Infinity
 * are the one class the library does reject; they are still checked here so the
 * failure is this module's, with this module's message.
 *
 * There is a fifth trap that is not about invalid input: `isValidCell` accepts
 * an UPPERCASE index, while `latLngToCell` only ever emits lowercase. Two
 * strings would then denote one cell and compare unequal — which would break
 * `Set`-based deduplication, and would let one cell hold two rows in any store
 * keyed by cell id. This module defines the canonical spelling as the lowercase
 * one the library emits, and rejects the other.
 */
import {
  cellToBoundary,
  cellToLatLng,
  cellToLocalIj,
  getResolution,
  gridDisk,
  isValidCell,
  latLngToCell,
} from "h3-js";

import { H3_RESOLUTION } from "../constants/h3";

/**
 * The one gameplay resolution, re-exported from the constant that has always
 * held it so there is a single literal `8` in the repository.
 *
 * Resolution is not a display concern and is never derived from zoom, from a
 * screen, or from configuration. A second definition anywhere — a backend
 * default, a mobile constant, an environment variable — means mobile and
 * backend can index different worlds while both look correct in isolation.
 */
export { H3_RESOLUTION };

/* ── types ────────────────────────────────────────────────────────────────── */

/**
 * A cell of the gameplay grid: a valid H3 index, at {@link H3_RESOLUTION}, in
 * canonical lowercase.
 *
 * Branded so an arbitrary string cannot be handed to something that requires a
 * real cell. The brand is not a substitute for validation — it is what makes
 * the validation impossible to skip by accident, because the only ways to
 * obtain one are {@link cellForCoordinate}, {@link toGameplayCell} and
 * {@link parseGameplayCell}, all of which check.
 */
export type H3Cell = string & { readonly __brand: "H3Cell" };

/**
 * A geographic coordinate, named rather than positional.
 *
 * Latitude/longitude reversal is silent: both orders type-check, both are
 * plausible numbers, and h3-js accepts an out-of-range latitude by wrapping it,
 * so a reversed pair yields a real cell in the wrong hemisphere rather than an
 * error. A positional `[number, number]` gives a call site no way to be wrong
 * loudly, so this API does not take one.
 *
 * The field names match the app's existing `TrackPoint`, so device samples pass
 * straight in.
 */
export interface GeoCoordinate {
  latitude: number;
  longitude: number;
}

/** Every rejection from this module. Never thrown for a legitimate location. */
export class H3DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "H3DomainError";
  }
}

/* ── coordinate validation ────────────────────────────────────────────────── */

export const MIN_LATITUDE = -90;
export const MAX_LATITUDE = 90;
export const MIN_LONGITUDE = -180;
export const MAX_LONGITUDE = 180;

/**
 * True when the coordinate is a real point on Earth.
 *
 * The bounds are closed: a pole and the antimeridian are locations. Longitude
 * is **not** normalised — 181 is rejected, not folded to −179. h3-js would fold
 * it, and a client sending 181 has a bug whose symptom should be a rejection
 * rather than territory a degree and a half away. If a caller ever genuinely
 * needs wrapping, it should ask for it by name.
 */
export function isValidCoordinate(value: unknown): value is GeoCoordinate {
  if (typeof value !== "object" || value === null) return false;
  const { latitude, longitude } = value as Partial<GeoCoordinate>;
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= MIN_LATITUDE &&
    latitude <= MAX_LATITUDE &&
    longitude >= MIN_LONGITUDE &&
    longitude <= MAX_LONGITUDE
  );
}

function assertCoordinate(value: unknown): GeoCoordinate {
  if (!isValidCoordinate(value)) {
    /* Deliberately does not quote the value. This runs on the server against
       user route points, and an error string is the kind of place a coordinate
       leaks into a log without anyone deciding that it should. */
    throw new H3DomainError(
      "Not a coordinate: latitude must be within ±90 and longitude within ±180, both finite",
    );
  }
  return value;
}

/* ── cell validation ──────────────────────────────────────────────────────── */

/** H3 indexes are 15 lowercase hex digits at resolution 8. */
const CANONICAL_INDEX_RE = /^[0-9a-f]+$/;

/**
 * True when `value` is a canonical gameplay cell.
 *
 * Three conditions, and all three matter:
 *  - a valid H3 index, so nonsense cannot reach `cellToBoundary`, which would
 *    answer with a polygon rather than an error;
 *  - at {@link H3_RESOLUTION}, so a res-7 or res-9 index — both perfectly valid
 *    H3 — cannot enter a world tiled at 8;
 *  - lowercase, so one cell has one spelling and deduplication is sound.
 */
export function isGameplayCell(value: unknown): value is H3Cell {
  if (typeof value !== "string") return false;
  if (!CANONICAL_INDEX_RE.test(value)) return false;
  if (!isValidCell(value)) return false;
  return getResolution(value) === H3_RESOLUTION;
}

/**
 * Narrow a value to {@link H3Cell}, or throw.
 *
 * The checked entry point for anything crossing a runtime boundary — a network
 * response, persisted storage, a route parameter. `as H3Cell` is not a
 * substitute: the brand exists to force a call to this.
 */
export function toGameplayCell(value: unknown): H3Cell {
  if (!isGameplayCell(value)) {
    throw new H3DomainError(
      `Not a gameplay cell: expected a valid lowercase H3 index at resolution ${H3_RESOLUTION}`,
    );
  }
  return value;
}

/** Narrow a value to {@link H3Cell}, or `null`. For boundaries that filter
 *  rather than fail — persisted state that may predate this grid. */
export function parseGameplayCell(value: unknown): H3Cell | null {
  return isGameplayCell(value) ? value : null;
}

/* ── coordinate → cell ────────────────────────────────────────────────────── */

/**
 * The gameplay cell containing a coordinate.
 *
 * The single conversion in the product. Throws on anything that is not a real
 * coordinate rather than letting h3-js wrap it into a cell somewhere else.
 */
export function cellForCoordinate(coordinate: GeoCoordinate): H3Cell {
  const { latitude, longitude } = assertCoordinate(coordinate);
  return latLngToCell(latitude, longitude, H3_RESOLUTION) as H3Cell;
}

/** {@link cellForCoordinate} for callers that treat a bad sample as absent
 *  rather than exceptional — a stale or malformed device fix, say. */
export function tryCellForCoordinate(coordinate: unknown): H3Cell | null {
  return isValidCoordinate(coordinate) ? cellForCoordinate(coordinate) : null;
}

/**
 * The cells containing a sequence of observed points, in first-touch order,
 * each appearing once.
 *
 * ### The semantics, stated so they cannot drift
 *
 * This is **containment of observation points**, not intersection of the path
 * between them. A cell is included exactly when at least one observed point
 * falls inside it. If two consecutive samples sit in cells that are not
 * neighbours, the cells the traveller crossed in between are **not** here —
 * nothing interpolates.
 *
 * That is the honest description of what the data supports: the device reports
 * samples, and the space between two samples is an assumption, not an
 * observation. Sealing and solid capture will need true path intersection, and
 * they will need to derive it deliberately — from the geometry, with their own
 * proof — rather than inheriting a projection that was never that.
 *
 * Order is first touch, so a route that returns to an earlier cell does not
 * move it. Callers that need a set can build one; callers that need the
 * sequence would be building a trail, which is location history — see the
 * privacy note in the module header of `mobile/src/lib/territoryCells.ts`.
 */
export function cellsForObservations(points: readonly GeoCoordinate[]): H3Cell[] {
  const seen = new Set<string>();
  const cells: H3Cell[] = [];
  for (const point of points) {
    const cell = cellForCoordinate(point);
    if (seen.has(cell)) continue;
    seen.add(cell);
    cells.push(cell);
  }
  return cells;
}

/* ── cell → geometry ──────────────────────────────────────────────────────── */

/** The centre of a cell. */
export function cellCenter(cell: H3Cell): GeoCoordinate {
  const [latitude, longitude] = cellToLatLng(toGameplayCell(cell));
  return { latitude, longitude };
}

/**
 * The vertices of a cell, as named coordinates.
 *
 * Open: the first vertex is not repeated at the end. Vertex count is **not**
 * always six — the twelve pentagons of the H3 grid have five — so nothing here
 * or downstream may assume a hexagon.
 *
 * A fresh array every call: h3-js hands back arrays that a caller could mutate
 * into another caller's geometry, and this converts rather than forwards.
 */
export function cellBoundary(cell: H3Cell): GeoCoordinate[] {
  return cellToBoundary(toGameplayCell(cell)).map(([latitude, longitude]) => ({
    latitude,
    longitude,
  }));
}

/**
 * The vertices of a cell as a closed GeoJSON linear ring: `[longitude,
 * latitude]` pairs, first vertex repeated last.
 *
 * The axis order is the whole reason this function exists. GeoJSON is
 * longitude-first and H3 is latitude-first, so the swap has to happen exactly
 * once, somewhere it can be tested — not at each renderer that happens to want
 * a polygon.
 *
 * Not used by any renderer today (the app has no map provider; see
 * `docs/H3_GEOGRAPHY.md`). It is here because the conversion is a property of
 * the geometry rather than of whichever library eventually draws it.
 */
export function cellBoundaryRing(cell: H3Cell): [number, number][] {
  const ring: [number, number][] = cellToBoundary(toGameplayCell(cell)).map(
    ([latitude, longitude]) => [longitude, latitude] as [number, number],
  );
  if (ring.length > 0) ring.push([ring[0][0], ring[0][1]]);
  return ring;
}

/* ── adjacency ────────────────────────────────────────────────────────────── */

/**
 * Hard ceiling on a neighbourhood radius.
 *
 * A disk grows quadratically — 37 cells at radius 3, 91 at 5, 331 at 10 — so an
 * unbounded radius reaching this from a screen, a zoom level or corrupted state
 * is a render explosion and a large pile of geometry work. Three rings is more
 * than any current surface draws, and the bound is a constant rather than a
 * caller's discretion so that raising it is a reviewed change.
 */
export const MAX_NEIGHBORHOOD_RADIUS = 3;

/** Cells in a disk of radius k: `3k² + 3k + 1`. The true count can be lower —
 *  a disk touching a pentagon has fewer — so this is an upper bound. */
export function maxCellsInRadius(radius: number): number {
  return 3 * radius * radius + 3 * radius + 1;
}

/**
 * The cells within `radius` steps of `cell`, origin first, the rest sorted.
 *
 * Ordering is promised rather than inherited: h3-js returns a disk in a stable
 * but unspecified spiral, and a caller keying React children off array position
 * would be depending on an implementation detail. Origin first because it is
 * the one cell with a distinguished role; lexicographic after, because it is
 * total, cheap and obviously deterministic.
 *
 * Pentagons are handled by not assuming: a disk around one is simply shorter,
 * and the count is asserted as an upper bound everywhere rather than an
 * equality.
 */
export function neighborhood(cell: H3Cell, radius: number): H3Cell[] {
  const origin = toGameplayCell(cell);
  if (!Number.isInteger(radius) || radius < 0) {
    throw new H3DomainError("Neighbourhood radius must be a non-negative integer");
  }
  if (radius > MAX_NEIGHBORHOOD_RADIUS) {
    throw new H3DomainError(
      `Neighbourhood radius ${radius} exceeds the maximum of ${MAX_NEIGHBORHOOD_RADIUS}`,
    );
  }
  const disk = gridDisk(origin, radius) as H3Cell[];
  const rest = disk.filter((c) => c !== origin).sort();
  return [origin, ...rest];
}

/* ── local layout ─────────────────────────────────────────────────────────── */

/** A cell's position on a local axial hex lattice, relative to an anchor. */
export interface LocalCellPosition {
  cell: H3Cell;
  /** Axial coordinates. Neighbouring cells differ by one step. */
  q: number;
  r: number;
}

/**
 * Lay cells out on a local axial grid so that cells adjacent in the world are
 * adjacent on screen.
 *
 * H3 offers local IJ coordinates around an anchor, valid only while the cells
 * stay near it — the projection is undefined across a large distance or an
 * icosahedron face boundary, and h3-js throws there rather than guessing. Cells
 * that cannot be placed are returned in `unplaced` for the caller to lay out
 * however it already did; they are never given a made-up position, because a
 * fabricated position on a map that claims to be relative is a lie about
 * geography.
 *
 * IJ is converted to standard axial (`q = i`, `r = −j`) so the six neighbours
 * are the six axial steps, which is what a renderer expects.
 *
 * Pure geometry: it holds no state, caches nothing, and the anchor is the first
 * cell given, so the same input always produces the same layout.
 */
export function localLayout(cells: readonly H3Cell[]): {
  placed: LocalCellPosition[];
  unplaced: H3Cell[];
} {
  const placed: LocalCellPosition[] = [];
  const unplaced: H3Cell[] = [];
  if (cells.length === 0) return { placed, unplaced };

  const anchor = toGameplayCell(cells[0]);
  for (const cell of cells) {
    const target = toGameplayCell(cell);
    try {
      const { i, j } = cellToLocalIj(anchor, target);
      placed.push({ cell: target, q: i, r: -j });
    } catch {
      /* Too far from the anchor, or across a face boundary. Not an error —
         a player can hold ground in two cities. */
      unplaced.push(target);
    }
  }
  return { placed, unplaced };
}
