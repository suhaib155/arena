/**
 * Local territory overview — Free Map Beta, on-device only.
 *
 * A deterministic, read-only summary of the player's captured zones for the
 * Territory Map board. It derives everything from existing local zone state
 * (status/control/defense/timestamps) and lays cells out on a **pseudo** hex
 * grid seeded from zone ids — it uses NO raw GPS, coordinates, route paths,
 * polylines, or location names, and discloses no real geography. It is a board,
 * not a map, and it does not gate XP/capture/defend/fortify/clubs/ownership.
 */
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

  // Stable pseudo-hex layout: order by id hash, then place row-major.
  const ordered = [...statuses].sort((a, b) => hashId(a.zone.id) - hashId(b.zone.id));
  const cells: MapCell[] = ordered.map((e, i) => ({
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
