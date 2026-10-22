/**
 * Concept geometry for a future, opt-in territory overlay.
 *
 * SIMULATED / NOT LIVE. Nothing here is wired to the app or the API, and
 * nothing here implements clubs or territory. It shows how internal H3 cells
 * (backend-only) could become user-readable geographic coverage: merged
 * polygons per state, coarsened by zoom, with masked terrain omitted and
 * unconfirmed claims never drawn as confirmed. It also shows the only shape a
 * public board may take: coarse counts with a minimum crowd size, never cells,
 * routes or player ids.
 */
import { cellToParent, cellsToMultiPolygon, compactCells, getResolution, gridDisk, latLngToCell } from "h3-js";

/** Display states. `pending` is a claim the server has not confirmed. */
export type CoverageState = "solid" | "shade" | "contested" | "unclaimed" | "pending";

export interface CellRecord { cell: string; state: CoverageState; confirmed: boolean }

/** [lng, lat] rings, GeoJSON order. */
export type Ring = [number, number][];
export type MultiPolygon = Ring[][];

export interface Layer {
  state: CoverageState;
  /** Filled area. Never present for pending or unconfirmed records. */
  fill: MultiPolygon;
  /** Outline only, for claims awaiting the server. */
  outline: MultiPolygon;
  /** Visual encoding that does not rely on colour alone. */
  pattern: "solid" | "hatch" | "crosshatch" | "none" | "dashed-outline";
  label: string;
}

const PATTERN: Record<CoverageState, Layer["pattern"]> = {
  solid: "solid", shade: "hatch", contested: "crosshatch", unclaimed: "none", pending: "dashed-outline",
};
const LABEL: Record<CoverageState, string> = {
  solid: "Solid", shade: "Shade", contested: "Contested", unclaimed: "Open ground", pending: "Awaiting check",
};

/** Ring longitudes jump across ±180? Then unwrap them so the polygon stays contiguous. */
export function crossesAntimeridian(ring: Ring): boolean {
  for (let i = 1; i < ring.length; i++) if (Math.abs(ring[i]![0] - ring[i - 1]![0]) > 180) return true;
  return false;
}

export function unwrapRing(ring: Ring): Ring {
  if (!crossesAntimeridian(ring)) return ring;
  return ring.map(([lng, lat]) => [lng < 0 ? lng + 360 : lng, lat]);
}

/**
 * Chaikin corner cutting. Merged H3 rings still show hexagon teeth; the owner
 * rule is a real map with coloured geographic areas, not a hex board, so the
 * display ring is smoothed. Smoothing is display-only: it never decides state
 * and the authoritative cell set is unchanged.
 */
export function smoothRing(ring: Ring, iterations = 2): Ring {
  let pts = ring.slice(0, -1);
  for (let k = 0; k < iterations; k++) {
    const next: Ring = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!, b = pts[(i + 1) % pts.length]!;
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    pts = next;
  }
  return [...pts, pts[0]!];
}

/** Shoelace area in squared degrees (only for comparisons). */
export function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 1; i < ring.length; i++) a += ring[i - 1]![0] * ring[i]![1] - ring[i]![0] * ring[i - 1]![1];
  return Math.abs(a) / 2;
}

let smoothing = true;
/** For tests and comparison renders. */
export function setSmoothing(on: boolean): void { smoothing = on; }

function polygons(cells: string[]): MultiPolygon {
  if (cells.length === 0) return [];
  return (cellsToMultiPolygon(cells, true) as MultiPolygon).map((poly) => poly.map((ring) => {
    const unwrapped = unwrapRing(ring);
    return smoothing ? smoothRing(unwrapped) : unwrapped;
  }));
}

/**
 * Coarsen for the viewport. Below street zoom a res-8 cell is a few pixels, so
 * whole parents of one state are compacted and partial ones stay detailed.
 * Coarsening never changes a cell's state and never invents coverage.
 */
export function cellsForZoom(cells: string[], zoom: number): string[] {
  if (zoom >= 14) return cells;
  return compactCells(cells);
}

/** Merge cells into one layer per state, after masking. */
export function coverageLayers(records: readonly CellRecord[], options: { zoom?: number; masked?: ReadonlySet<string> } = {}): Layer[] {
  const masked = options.masked ?? new Set<string>();
  const visible = records.filter((r) => !masked.has(r.cell));
  const layers: Layer[] = [];
  for (const state of ["solid", "shade", "contested", "unclaimed", "pending"] as CoverageState[]) {
    const confirmed = visible.filter((r) => r.state === state && r.confirmed && state !== "pending").map((r) => r.cell);
    const unconfirmed = visible.filter((r) => r.state === state && (!r.confirmed || state === "pending")).map((r) => r.cell);
    layers.push({
      state,
      fill: polygons(cellsForZoom(confirmed, options.zoom ?? 15)),
      outline: polygons(unconfirmed),
      pattern: PATTERN[state],
      label: LABEL[state],
    });
  }
  return layers;
}

export interface Contribution { cell: string; playerId: string }
export interface PublicArea { area: string; players: number }

/** Smallest crowd a public board may show for one area. */
export const MIN_PUBLIC_CROWD = 3;
/** Public boards speak in res-6 areas (~36 km²), never res-8 cells. */
export const PUBLIC_RESOLUTION = 6;

/**
 * The only public shape: how many distinct players touched each coarse area,
 * suppressed below MIN_PUBLIC_CROWD. No cell ids, no routes, no player ids.
 */
export function publicBoard(contributions: readonly Contribution[]): PublicArea[] {
  const byArea = new Map<string, Set<string>>();
  for (const c of contributions) {
    const area = cellToParent(c.cell, PUBLIC_RESOLUTION);
    if (!byArea.has(area)) byArea.set(area, new Set());
    byArea.get(area)!.add(c.playerId);
  }
  return [...byArea.entries()]
    .filter(([, players]) => players.size >= MIN_PUBLIC_CROWD)
    .map(([area, players]) => ({ area, players: players.size }))
    .sort((a, b) => (a.area < b.area ? -1 : 1));
}

/** Cells of a disk around a coordinate, for fixtures. */
export function diskAround(latitude: number, longitude: number, k: number, resolution = 8): string[] {
  return gridDisk(latLngToCell(latitude, longitude, resolution), k);
}

export { getResolution };
