/**
 * Local territory overview — the Territory board.
 *
 * A deterministic, read-only summary of the player's captured zones. It derives
 * everything from local zone state (status/control/defense/timestamps) and uses
 * no raw GPS, no coordinates, no route path and no place names. It does not
 * gate XP, capture, defend, fortify, clubs or ownership.
 *
 * ## What changed when the grid became real, and what did not
 *
 * Zone ids are now H3 resolution-8 cells, so for the first time the board can
 * order itself by where the ground actually is. It used to sort by a hash of
 * the zone id, which is to say arbitrarily: two cells the player could walk
 * between in a minute could land at opposite ends of the board.
 *
 * The ordering is now spatial — cells are placed on a local axial grid via
 * {@link localLayout} and read out north-to-south, west-to-east — while the
 * board itself is unchanged: still a dense four-column arrangement, still
 * without holes, still no scale, no bearing, no basemap and no distance.
 *
 * **It is still a board, not a map.** Adjacent ground now tends to appear near
 * adjacent ground, and that is the whole of the claim. Nothing here says where
 * on Earth anything is, and the arrangement must not be read as one.
 *
 * Bounded by construction: the store caps `zones` at 100, {@link localLayout}
 * is pure and allocates one position per zone, and cells too far apart to share
 * a local frame — a player who holds ground in two cities — are not given a
 * fabricated position. They are appended in the stable hash order the board has
 * always used.
 */
import { localLayout, parseGameplayCell, type H3Cell } from "@movenrun/shared/h3";

import type { Zone } from "@/types";
import { byRisk, zoneStatus, type ZoneStatus } from "@/lib/territory";

export interface MapCell {
  zone: Zone;
  status: ZoneStatus;
  /** Stable grid position derived from the zone id (no geography). */
  col: number;
  row: number;
}

export interface TerritoryOverview {
  total: number;
  healthy: number;
  atRisk: number;
  contestedPreview: number;
  dormant: number;
  recentlyDefended: number;
  strongest: Zone | null;
  /** Highest-risk zone to defend next, or null when all healthy/empty. */
  priority: Zone | null;
  territoryScore: number;
  cells: MapCell[];
}

/** Columns in the pseudo-hex board. */
export const MAP_COLUMNS = 4;

const RECENT_DEFEND_MS = 2 * 86_400_000;

/** Small deterministic FNV-1a hash for stable ordering (display only). */
function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Order zones so that ground near other ground reads near it on the board.
 *
 * Three groups, concatenated, and the split is what keeps this honest:
 *
 *  1. zones whose ids are real cells and which share a local frame, sorted by
 *     axial position — north to south, then west to east;
 *  2. zones whose ids are real cells but which are too far from the frame's
 *     anchor to be placed (another city, or across an icosahedron face), in the
 *     stable hash order;
 *  3. zones whose ids are not gameplay geography at all, likewise by hash.
 *
 * The third group should be empty on any migrated device — the store drops a
 * zone whose id is not a canonical cell — but this function is given a `Zone[]`
 * and does not get to assume that. Falling back is correct here in a way it
 * would not be in the migration: a board that cannot place a cell shows it
 * somewhere arbitrary, which is what it did for every cell until now. It never
 * invents a position and calls it geography.
 *
 * Deterministic: the anchor is the first placeable cell in hash order, so the
 * same zones always produce the same board.
 */
function orderSpatially<T extends { zone: Zone }>(entries: T[]): T[] {
  const byHash = [...entries].sort((a, b) => hashId(a.zone.id) - hashId(b.zone.id));

  const placeable: { entry: T; cell: H3Cell }[] = [];
  const notGeography: T[] = [];
  for (const entry of byHash) {
    const cell = parseGameplayCell(entry.zone.id);
    if (cell === null) notGeography.push(entry);
    else placeable.push({ entry, cell });
  }
  if (placeable.length === 0) return notGeography;

  const { placed, unplaced } = localLayout(placeable.map((p) => p.cell));
  const positions = new Map(placed.map((p) => [p.cell as string, p]));
  const elsewhere = new Set<string>(unplaced as string[]);

  const local = placeable
    .filter((p) => positions.has(p.cell))
    .sort((a, b) => {
      const pa = positions.get(a.cell)!;
      const pb = positions.get(b.cell)!;
      /* `r` increases southward and `q` eastward in the axial frame, so this
         reads the local grid the way the board is drawn: top row first, then
         left to right within it. */
      return pa.r - pb.r || pa.q - pb.q;
    })
    .map((p) => p.entry);

  const far = placeable.filter((p) => elsewhere.has(p.cell)).map((p) => p.entry);
  return [...local, ...far, ...notGeography];
}

/**
 * Build the territory overview deterministically from local zone state.
 * Same zones → same stats and same relative cell positions across reloads.
 */
export function buildTerritoryOverview(
  zones: Zone[],
  now: number = Date.now(),
): TerritoryOverview {
  const statuses = zones.map((z) => ({ zone: z, status: zoneStatus(z, now) }));

  let healthy = 0;
  let atRisk = 0;
  let contestedPreview = 0;
  let dormant = 0;
  let recentlyDefended = 0;
  for (const { zone, status } of statuses) {
    if (status.health === "yours") healthy++;
    else if (status.health === "atRisk") atRisk++;
    else if (status.health === "contestedPreview") contestedPreview++;
    else if (status.health === "dormant") dormant++;
    if (now - new Date(zone.lastDefendedAt).getTime() <= RECENT_DEFEND_MS) {
      recentlyDefended++;
    }
  }

  const territoryScore = statuses.reduce(
    (sum, { status }) => sum + Math.round(status.control * 0.6 + status.defense * 0.4),
    0,
  );

  const strongest =
    statuses.length > 0
      ? [...statuses].sort(
          (a, b) =>
            b.status.control + b.status.defense - (a.status.control + a.status.defense),
        )[0].zone
      : null;

  // Highest-risk non-healthy zone to defend next.
  const atRiskZones = statuses
    .filter((e) => e.status.health !== "yours")
    .map((e) => e.zone);
  const priority =
    atRiskZones.length > 0
      ? [...atRiskZones].sort((a, b) => byRisk(a, b, now))[0]
      : null;

  const cells: MapCell[] = orderSpatially(statuses).map((e, i) => ({
    zone: e.zone,
    status: e.status,
    col: i % MAP_COLUMNS,
    row: Math.floor(i / MAP_COLUMNS),
  }));

  return {
    total: zones.length,
    healthy,
    atRisk,
    contestedPreview,
    dormant,
    recentlyDefended,
    strongest,
    priority,
    territoryScore,
    cells,
  };
}
