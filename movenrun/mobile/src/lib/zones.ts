/**
 * Mock H3-style territory zones — Free Map Beta, on-device simulation.
 *
 * Routes are quantized onto a local hexagonal lattice (~300 m cells, axial
 * coordinates with cube rounding) so a session deterministically touches the
 * same zone ids at the same place. This is intentionally NOT real H3: the
 * proper `h3-js` indexing (res 9, matching `shared/`) lands with the live
 * territory map. Everything here is local, cosmetic, and reversible.
 */
import type { TrackPoint } from "./geo";
import type { Zone, ZoneState } from "@/types";

/** Approximate hex cell size in meters (between H3 res 8 and 9 — beta only). */
const CELL_M = 300;
const M_PER_DEG_LAT = 111_320;

export interface ZoneTouch {
  id: string;
  name: string;
}

/** Deterministic 32-bit hash → unsigned. */
function hash2(a: number, b: number): number {
  let h = 2166136261 ^ a;
  h = Math.imul(h, 16777619) ^ b;
  h = Math.imul(h, 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return h >>> 0;
}

/** Axial hex cell for a coordinate (pointy-top lattice, cube-rounded). */
export function cellForCoord(latitude: number, longitude: number): { q: number; r: number } {
  /* Local equirectangular meters. cos() of the rounded latitude keeps the
     mapping deterministic for nearby points while staying locally accurate. */
  const latBand = Math.round(latitude * 10) / 10;
  const x = longitude * M_PER_DEG_LAT * Math.cos((latBand * Math.PI) / 180);
  const y = latitude * M_PER_DEG_LAT;

  const qf = ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / CELL_M;
  const rf = ((2 / 3) * y) / CELL_M;
  /* cube rounding */
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

/** Mock zone id, namespaced so it can never collide with future real H3 ids. */
export function zoneIdForCell(q: number, r: number): string {
  return `mrx-${hash2(q | 0, r | 0).toString(36)}`;
}

const NAME_A = [
  "Riverside", "Market", "North Park", "Sunrise", "Harbor", "Cedar",
  "Old Town", "Granite", "Meadow", "Birch", "Summit", "Willow",
];
const NAME_B = ["Block", "Loop", "Tile", "Corner", "Run", "Square", "Bend", "Cross"];

/** Cosmetic, deterministic zone name derived from the zone id. */
export function zoneNameForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
  return `${NAME_A[h % NAME_A.length]} ${NAME_B[(h >>> 4) % NAME_B.length]}`;
}

/** Unique zones a route passes through, in first-touch order. */
export function deriveZonesFromRoute(points: TrackPoint[]): ZoneTouch[] {
  const seen = new Set<string>();
  const touches: ZoneTouch[] = [];
  for (const p of points) {
    const { q, r } = cellForCoord(p.latitude, p.longitude);
    const id = zoneIdForCell(q, r);
    if (!seen.has(id)) {
      seen.add(id);
      touches.push({ id, name: zoneNameForId(id) });
    }
  }
  return touches;
}

/** Build a freshly-captured common zone record. */
export function newCapturedZone(touch: ZoneTouch, isDemo: boolean): Zone {
  const now = new Date().toISOString();
  return {
    id: touch.id,
    name: touch.name,
    state: "yours",
    controlPercent: 60,
    defensePercent: 0,
    lastTouchedAt: now,
    capturedAt: now,
    isDeedPreview: false,
    isDemo,
  };
}

/** Display color per zone state (Daylight Cartography semantics). */
export const ZONE_STATE_LABEL: Record<ZoneState, string> = {
  unclaimed: "Unclaimed",
  yours: "Yours",
  contested: "Contested",
  dormant: "Dormant",
  deedPreview: "Deed preview",
};
