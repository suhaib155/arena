/**
 * Territory geometry: the shapes a map draws, made from the cells the server
 * holds.
 *
 * H3 is how the server indexes ground. It is not what a player sees. The map
 * shows areas on the real street map, coloured by their state, so this module
 * turns a set of gameplay cells into GeoJSON regions: neighbouring cells are
 * merged into one area, the internal cell edges disappear, and holes stay
 * holes. A client draws the result as filled polygons over the base map and
 * never needs to know a cell id.
 *
 * ## What the output claims, and what it does not
 *
 *  - **The cell set is the authority.** `exact` outlines are the true union of
 *    the cells, to about 0.1 m. `smoothed` outlines round off the stepped cell
 *    edges for display and cut corners by up to a few tens of metres; they are
 *    labelled so, and nothing may treat them as the ground a player holds.
 *  - **Precision is the cell, not the outline.** Every region carries
 *    `cellEdgeMeters` (about 530 m at the gameplay resolution, from
 *    `getHexagonEdgeLengthAvg`). A route that crossed a cell is not a claim to
 *    every square metre of it, and a client should not imply finer detail.
 *  - **State is whatever the caller says it is.** This module draws; it does
 *    not decide who holds what. {@link TERRITORY_STATES} lists the states a
 *    map may colour, and a caller must only emit one the server actually
 *    computes. Today that is `covered` alone.
 *
 * ## Privacy
 *
 * Input is cells, never route points. A region is at least one whole cell
 * (about 0.7 km²), so the output cannot reproduce a route, a start point or a
 * home address any more precisely than the cell list already does.
 *
 * ## Bounds
 *
 * At most {@link MAX_REGION_CELLS} distinct cells per call. Above that the
 * call throws rather than doing unbounded work; callers decide how to trim
 * (newest sessions first, a viewport, a district).
 */
import { cellArea, cellsToMultiPolygon, getHexagonEdgeLengthAvg, gridDisk } from "h3-js";

import { H3_RESOLUTION, H3DomainError, isGameplayCell, type H3Cell } from "./h3";

/* ── states ───────────────────────────────────────────────────────────────── */

/**
 * The states a territory map may colour.
 *
 *  - `covered`: ground the player's verified sessions passed through. Produced
 *    today by `GET /movement/coverage`.
 *  - `held`, `contested`, `at_risk`: need the server-authoritative territory
 *    ledger (sealing claims, erosion, other players). Not produced by any
 *    server yet; a client must not show them from local state.
 */
export const TERRITORY_STATES = ["covered", "held", "contested", "at_risk"] as const;
export type TerritoryState = (typeof TERRITORY_STATES)[number];

export function isTerritoryState(value: unknown): value is TerritoryState {
  return typeof value === "string" && (TERRITORY_STATES as readonly string[]).includes(value);
}

/* ── GeoJSON shapes (RFC 7946: [longitude, latitude], outer rings counter-clockwise) ── */

export type LngLat = [number, number];
/** One polygon: the outer ring, then any holes. Every ring is closed. */
export type PolygonRings = LngLat[][];

export type RegionOutline = "exact" | "smoothed";

export interface TerritoryRegionProperties {
  state: TerritoryState;
  /** Number of gameplay cells merged into this region. */
  cellCount: number;
  /** Area of those cells, km², rounded to 0.001. */
  areaKm2: number;
  /** Average cell edge at the gameplay resolution: the honest precision. */
  cellEdgeMeters: number;
  outline: RegionOutline;
}

export interface TerritoryRegionFeature {
  type: "Feature";
  /** Stable for the same set of cells, derived from them, never from input
   *  order. Opaque: it is a hash, not a cell id. */
  id: string;
  geometry: { type: "MultiPolygon"; coordinates: PolygonRings[] };
  properties: TerritoryRegionProperties;
}

export interface TerritoryFeatureCollection {
  type: "FeatureCollection";
  features: TerritoryRegionFeature[];
}

/* ── limits ───────────────────────────────────────────────────────────────── */

/** Upper bound on distinct cells per call (about 3,300 km² at resolution 8). */
export const MAX_REGION_CELLS = 5_000;
/** Coordinates are rounded to 6 decimal places (about 0.1 m). */
export const COORDINATE_DECIMALS = 6;
/** Chaikin corner-cutting passes for `smoothed` outlines. */
export const SMOOTHING_PASSES = 2;

const CELL_EDGE_METERS = Math.round(getHexagonEdgeLengthAvg(H3_RESOLUTION, "m"));

/* ── grouping ─────────────────────────────────────────────────────────────── */

/**
 * Groups cells into edge-connected areas. Deterministic: groups come back
 * sorted by their smallest cell id, and the cells in each group sorted.
 */
export function connectedCellGroups(cells: readonly H3Cell[]): H3Cell[][] {
  const remaining = new Set(cells);
  const groups: H3Cell[][] = [];
  for (const start of [...remaining].sort()) {
    if (!remaining.has(start)) continue;
    remaining.delete(start);
    const group: H3Cell[] = [start];
    for (let i = 0; i < group.length; i++) {
      for (const next of gridDisk(group[i], 1) as H3Cell[]) {
        if (remaining.delete(next)) group.push(next);
      }
    }
    groups.push(group.sort());
  }
  return groups;
}

/* ── geometry helpers ─────────────────────────────────────────────────────── */

const round = (value: number) => Number(value.toFixed(COORDINATE_DECIMALS));

function roundRing(ring: LngLat[]): LngLat[] {
  return ring.map(([lng, lat]) => [round(lng), round(lat)] as LngLat);
}

/**
 * Chaikin corner cutting on a closed ring. Each pass replaces every edge with
 * points at 1/4 and 3/4 along it, which rounds corners while staying inside
 * the convex hull of the original ring. Works in degrees: at city scale the
 * distortion is far below the cell size this output is honest about.
 */
export function smoothRing(ring: readonly LngLat[], passes: number = SMOOTHING_PASSES): LngLat[] {
  let open = ring.slice(0, -1);
  if (open.length < 3) return ring.slice() as LngLat[];
  for (let p = 0; p < passes; p++) {
    const next: LngLat[] = [];
    for (let i = 0; i < open.length; i++) {
      const [ax, ay] = open[i];
      const [bx, by] = open[(i + 1) % open.length];
      next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
      next.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    open = next;
  }
  return [...open, open[0]];
}

/** Twice the signed planar area; positive when counter-clockwise. */
function signedArea2(ring: readonly LngLat[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return sum;
}

/** RFC 7946 §3.1.6: exterior rings counter-clockwise, holes clockwise. */
function orient(polygon: PolygonRings): PolygonRings {
  return polygon.map((ring, index) => {
    const ccw = signedArea2(ring) > 0;
    const wantCcw = index === 0;
    return ccw === wantCcw ? ring : ring.slice().reverse();
  });
}

/** FNV-1a over the sorted cell ids: a stable, opaque region id that works the
 *  same on the server and in an app bundle (no Node crypto needed). */
function regionId(state: TerritoryState, group: readonly H3Cell[]): string {
  let hash = 0x811c9dc5;
  for (const char of `${state}|${group.join(",")}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${state}-${hash.toString(16).padStart(8, "0")}-${group.length}`;
}

/* ── the contract ─────────────────────────────────────────────────────────── */

export interface RegionOptions {
  /** `exact` (default) for the true cell union; `smoothed` for display. */
  outline?: RegionOutline;
}

/**
 * Turns cells into territory regions for one state.
 *
 * Validates every cell (canonical lowercase, gameplay resolution) and throws
 * {@link H3DomainError} on the first bad one, because a silently dropped cell
 * is ground that vanishes from the map. Duplicates are merged.
 */
export function regionsForCells(
  cells: readonly unknown[],
  state: TerritoryState,
  options: RegionOptions = {},
): TerritoryFeatureCollection {
  if (!isTerritoryState(state)) throw new H3DomainError("unknown territory state");
  const outline: RegionOutline = options.outline ?? "exact";
  if (outline !== "exact" && outline !== "smoothed") throw new H3DomainError("unknown outline");

  const unique = new Set<H3Cell>();
  for (const cell of cells) {
    if (!isGameplayCell(cell)) throw new H3DomainError("not a gameplay cell");
    unique.add(cell);
    if (unique.size > MAX_REGION_CELLS) throw new H3DomainError(`more than ${MAX_REGION_CELLS} cells`);
  }

  const features = connectedCellGroups([...unique]).map((group): TerritoryRegionFeature => {
    const polygons = (cellsToMultiPolygon(group, true) as LngLat[][][]).map((polygon) =>
      orient(polygon.map((ring) => roundRing(outline === "smoothed" ? smoothRing(ring) : ring))),
    );
    const area = group.reduce((sum, cell) => sum + cellArea(cell, "km2"), 0);
    return {
      type: "Feature",
      id: regionId(state, group),
      geometry: { type: "MultiPolygon", coordinates: polygons },
      properties: {
        state,
        cellCount: group.length,
        areaKm2: Number(area.toFixed(3)),
        cellEdgeMeters: CELL_EDGE_METERS,
        outline,
      },
    };
  });

  return { type: "FeatureCollection", features };
}
