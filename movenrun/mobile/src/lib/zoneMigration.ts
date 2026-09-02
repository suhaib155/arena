/**
 * The persisted-territory migration: from the retired lattice to real geography.
 *
 * ## Why a zone cannot be converted
 *
 * Before this change, a captured zone was keyed by an id from a local ~300 m
 * axial lattice — `mrx-` and a hash. That id is a hash of lattice coordinates,
 * and the lattice shares no coordinate system with H3. Reversing it would need
 * the latitude and longitude it was quantized from, and those were never
 * stored: the app has always kept derived stats and deliberately not
 * coordinates.
 *
 * So there is no lossless mapping, and every lossy one is a lie of a specific
 * and serious kind. Hashing the legacy id into an H3 index would produce a
 * valid-looking claim on ground the player has never visited. Re-keying to the
 * player's current cell would move every zone they have ever held to wherever
 * they happened to open the app. Both would then be indistinguishable from
 * territory actually earned — including to the server, once territory becomes
 * authoritative.
 *
 * Dropping is the honest option, and it is what this does.
 *
 * ## The test, and why it is the strong one
 *
 * A zone survives if and only if its id **is** a canonical H3 resolution-8
 * cell. Not "is not a lattice id" — that would be a blocklist, and a blocklist
 * passes everything it has not heard of, including a truncated write, a
 * hand-edited value and whatever the next id shape turns out to be. Requiring
 * real geography fails closed instead.
 *
 * Only zones are affected. XP, streaks, quest history, club choice, route-trust
 * summaries and settled server verifications are not keyed by geography and are
 * not this function's to touch — it is handed the zone list and returns a zone
 * list, so it structurally cannot reach them.
 */
import { parseGameplayCell } from "@movenrun/shared/h3";

import type { Zone } from "@/types";

/**
 * The persisted schema version at which zone ids became real H3 cells.
 *
 * The store declares this same number, and a guard asserts the two agree — so
 * bumping one without the other fails rather than shipping a migration that
 * never runs, or a version that claims a migration that is not there.
 */
export const ZONE_GEOGRAPHY_VERSION = 12;

export interface ZoneMigrationResult {
  /** Zones whose ids are canonical gameplay cells. Unmodified. */
  kept: Zone[];
  /** How many were removed. A count, never the ids — an archived list of
   *  places a player used to hold is still a record of where they have been. */
  dropped: number;
}

/**
 * Keep the zones that stand on real ground; drop the rest.
 *
 * Total: any input, including `undefined`, a non-array, or an array holding
 * nulls and objects with no id, produces a valid result rather than throwing.
 * This runs during store rehydration on app start, and a crash there is a
 * device that cannot open the app.
 *
 * Idempotent: the surviving zones satisfy the same predicate on a second pass,
 * so re-running over migrated state changes nothing. There is no flag to get
 * out of step with, and nothing to un-migrate.
 */
export function migrateZonesToRealGeography(zones: unknown): ZoneMigrationResult {
  if (!Array.isArray(zones)) return { kept: [], dropped: 0 };

  const kept: Zone[] = [];
  for (const zone of zones) {
    if (zone === null || typeof zone !== "object") continue;
    const id = (zone as { id?: unknown }).id;
    if (parseGameplayCell(id) === null) continue;
    kept.push(zone as Zone);
  }
  return { kept, dropped: zones.length - kept.length };
}
