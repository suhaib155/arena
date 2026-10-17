/**
 * A synthetic city for the pilot simulation: a hexagonal grid of logical
 * units at the ruleset's scale (D5), synthetic district polygons (D20), and
 * a seeded population of walker profiles.
 *
 * Nothing here is geography. Units are axial hex coordinates inside a disc,
 * districts are a versioned Voronoi partition of that disc in metres, so they
 * do not depend on the unit size. Real H3 cells, real coastlines and real
 * administrative boundaries are not used.
 */

/* ── randomness ───────────────────────────────────────────────────────────── */

/** 32-bit FNV-1a of a string. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32: a small, fast, seedable generator. Returns [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A generator keyed by labels, so one decision's draws never depend on another's. */
export function keyed(...parts: (string | number)[]): () => number {
  return rng(hash32(parts.join("\u0000")));
}

/* ── the grid ─────────────────────────────────────────────────────────────── */

export interface Unit {
  id: string;
  q: number;
  r: number;
  /** Centre in metres from the city centre. */
  x: number;
  y: number;
  districtId: string;
}

export interface World {
  edgeMeters: number;
  /** Centre-to-centre distance of neighbouring units: √3 × edge. */
  spacingMeters: number;
  radiusUnits: number;
  cityRadiusMeters: number;
  units: Unit[];
  byId: Map<string, Unit>;
  districtsVersion: string;
  districtIds: string[];
}

export const DIRS: readonly [number, number][] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

export const unitId = (q: number, r: number) => `u${q}_${r}`;
export const hexDistance = (aq: number, ar: number, bq: number, br: number) =>
  (Math.abs(aq - bq) + Math.abs(ar - br) + Math.abs(aq + ar - bq - br)) / 2;

export function axialFromMeters(x: number, y: number, spacing: number): [number, number] {
  const rf = y / (spacing * (Math.sqrt(3) / 2));
  const qf = x / spacing - rf / 2;
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return [q, r];
}

export function buildWorld(opts: { edgeMeters: number; cityRadiusMeters: number; districtsVersion: string; districtCount: number }): World {
  const spacing = Math.sqrt(3) * opts.edgeMeters;
  const R = Math.max(1, Math.round(opts.cityRadiusMeters / spacing));
  // Districts: seeded by their version only, in metres, so the same polygons
  // cover every unit size (D20: geographic, versioned, not grid parents).
  const dr = keyed("districts", opts.districtsVersion);
  const seeds: { id: string; x: number; y: number }[] = [];
  for (let i = 0; i < opts.districtCount; i++) {
    const a = dr() * 2 * Math.PI;
    const d = Math.sqrt(dr()) * opts.cityRadiusMeters * 0.85;
    seeds.push({ id: `d${String(i + 1).padStart(2, "0")}`, x: d * Math.cos(a), y: d * Math.sin(a) });
  }
  const units: Unit[] = [];
  for (let q = -R; q <= R; q++) {
    for (let r = Math.max(-R, -q - R); r <= Math.min(R, -q + R); r++) {
      const x = spacing * (q + r / 2);
      const y = spacing * (Math.sqrt(3) / 2) * r;
      let best = seeds[0]!;
      let bestD = Infinity;
      for (const s of seeds) {
        const dd = (s.x - x) ** 2 + (s.y - y) ** 2;
        if (dd < bestD) {
          bestD = dd;
          best = s;
        }
      }
      units.push({ id: unitId(q, r), q, r, x, y, districtId: best.id });
    }
  }
  return {
    edgeMeters: opts.edgeMeters,
    spacingMeters: spacing,
    radiusUnits: R,
    cityRadiusMeters: opts.cityRadiusMeters,
    units,
    byId: new Map(units.map((u) => [u.id, u])),
    districtsVersion: opts.districtsVersion,
    districtIds: [...new Set(units.map((u) => u.districtId))].sort(),
  };
}

export function inCity(w: World, q: number, r: number): boolean {
  return hexDistance(q, r, 0, 0) <= w.radiusUnits;
}

export function ring(cq: number, cr: number, k: number): [number, number][] {
  if (k === 0) return [[cq, cr]];
  const out: [number, number][] = [];
  let q = cq + DIRS[4]![0] * k;
  let r = cr + DIRS[4]![1] * k;
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < k; step++) {
      out.push([q, r]);
      q += DIRS[side]![0];
      r += DIRS[side]![1];
    }
  }
  return out;
}

export function disk(cq: number, cr: number, k: number): [number, number][] {
  const out: [number, number][] = [];
  for (let j = 0; j <= k; j++) out.push(...ring(cq, cr, j));
  return out;
}

/* ── the population ───────────────────────────────────────────────────────── */

export type Profile = "casual" | "regular" | "heavy" | "colluder" | "switcher" | "route_farmer" | "shade_farmer";
export const PROFILES: readonly Profile[] = ["casual", "regular", "heavy", "colluder", "switcher", "route_farmer", "shade_farmer"];

export interface Player {
  id: string;
  profile: Profile;
  homeQ: number;
  homeR: number;
  /** Switchers only: move for district control, or join whoever attacks them. */
  strategy?: "kingmaker" | "shield";
  /** A planned week away (casual and regular): the days player-selected away days are aimed at. */
  vacationStart: number | null;
  /** Route farmers: the same short route every session. */
  fixedRoute?: string[];
  /** Club at day 0, or null. */
  initialClub: string | null;
}

export interface PopulationSpec {
  casual: number;
  regular: number;
  heavy: number;
  colluder: number;
  switcher: number;
  route_farmer: number;
  shade_farmer: number;
  honestClubs: number;
}

export const DEFAULT_POPULATION: Readonly<PopulationSpec> = Object.freeze({
  casual: 200,
  regular: 100,
  heavy: 40,
  colluder: 8,
  switcher: 4,
  route_farmer: 8,
  shade_farmer: 8,
  honestClubs: 10,
});

export const COLLUDING_CLUB = "club-collude";
export const SHADE_CLUB = "club-shade";

export function buildPopulation(w: World, spec: PopulationSpec, seed: number, seasonDays: number): Player[] {
  const players: Player[] = [];
  const honest = Array.from({ length: spec.honestClubs }, (_, i) => `club-${String(i + 1).padStart(2, "0")}`);
  for (const profile of PROFILES) {
    for (let i = 0; i < spec[profile]; i++) {
      const id = `${profile}-${String(i + 1).padStart(3, "0")}`;
      const g = keyed(seed, "player", id);
      // Homes uniform over the disc, in metres, then snapped to a unit.
      const a = g() * 2 * Math.PI;
      const d = Math.sqrt(g()) * w.cityRadiusMeters * 0.95;
      let [q, r] = axialFromMeters(d * Math.cos(a), d * Math.sin(a), w.spacingMeters);
      if (!inCity(w, q, r)) [q, r] = [0, 0];
      const vacation = profile === "casual" || profile === "regular" ? Math.floor(g() * (seasonDays - 7)) : null;
      const pick = () => honest[Math.floor(g() * honest.length)]!;
      let initialClub: string | null = null;
      if (profile === "colluder") initialClub = COLLUDING_CLUB;
      else if (profile === "shade_farmer") initialClub = SHADE_CLUB;
      else if (profile === "route_farmer" || profile === "switcher") initialClub = pick();
      else if (profile === "casual") initialClub = g() < 0.25 ? pick() : null;
      else initialClub = g() < 0.5 ? pick() : null;
      const p: Player = { id, profile, homeQ: q, homeR: r, vacationStart: vacation, initialClub };
      if (profile === "switcher") p.strategy = i % 2 === 0 ? "kingmaker" : "shield";
      if (profile === "route_farmer") {
        const dir = DIRS[Math.floor(g() * 6)]!;
        const route = [0, 1, 2]
          .map((k) => [q + dir[0] * k, r + dir[1] * k] as [number, number])
          .filter(([a2, b2]) => inCity(w, a2, b2))
          .map(([a2, b2]) => unitId(a2, b2));
        p.fixedRoute = route;
      }
      players.push(p);
    }
  }
  return players;
}
