/**
 * Test support: seal summaries produced by the real sealing engine
 * (`evaluateSealing`, the same call the movement pipeline makes) on synthetic
 * routes, so fixtures that write movement rows directly carry a seal the
 * server would actually have computed instead of a hand-written
 * `sealed = true`. Synthetic geometry only; no real route.
 */
import { evaluateSealing } from "@movenrun/shared/sealing";
import { DEFAULT_MOVEMENT_MODE, SESSION_RULES_VERSION, type SessionMetadata } from "@movenrun/shared/session";
import { toSealSummary } from "../movement/domain/types.js";
import { fixesOf, poly, ROUTE_FIXTURES } from "./pathFixtures.js";
import { getResolution, isValidCell } from "h3-js";
import { H3_RESOLUTION } from "@movenrun/shared/h3";
import { claimCellsOf, ENCLOSED_LOOP_V1, evaluateSealLoop } from "./sealLoop.js";

export interface SealColumns {
  sealed: boolean | null;
  seal_methods: string[] | null;
  seal_event_count: number | null;
  rules_version: number | null;
  /** Sealing v2 (gameplay/sealLoop.ts), as the pipeline writes it when gameplay asks. */
  territory_seal_version: number | null;
  territory_sealed: boolean | null;
  territory_seal_reason: string | null;
  /** Claimable cells (H3 ids, resolution 8 here) and their resolution; null unless the territory seal is true. */
  territory_claim_units: string[] | null;
  territory_claim_resolution: number | null;
}

/** Session metadata for a capture that spans `points`, under the current session rules. */
export function sessionFor(points: readonly { timestamp: number }[], rulesVersion = SESSION_RULES_VERSION): SessionMetadata {
  return { mode: DEFAULT_MOVEMENT_MODE, rulesVersion, startedAt: points[0]!.timestamp - 1_000, finishedAt: points[points.length - 1]!.timestamp + 1_000, pauses: [] };
}

/**
 * The stored summary the pipeline would write for these fixes (v1 all NULL
 * when the engine refuses the rules version), with sealing v2's territory
 * seal under the pilot loop rule, the fixes reporting 5 m accuracy.
 */
export function sealColumnsFor(points: readonly { lat: number; lng: number; timestamp: number }[], rulesVersion = SESSION_RULES_VERSION): SealColumns {
  const fixes = points.map((p) => ({ ...p, accuracy: 5 }));
  const loop = evaluateSealLoop(fixes, [], ENCLOSED_LOOP_V1);
  const cells = claimCellsOf(fixes, loop, { resolution: H3_RESOLUTION });
  const territory = {
    territory_seal_version: loop.version, territory_sealed: loop.sealed, territory_seal_reason: loop.reason,
    territory_claim_units: cells, territory_claim_resolution: cells === null ? null : H3_RESOLUTION,
  };
  const evaluation = evaluateSealing({
    session: sessionFor(points, rulesVersion),
    points: points.map((p) => ({ latitude: p.lat, longitude: p.lng, timestamp: p.timestamp })),
    heldCells: null,
  });
  const summary = toSealSummary(evaluation);
  if (!summary) return { sealed: null, seal_methods: null, seal_event_count: null, rules_version: rulesVersion, ...territory };
  return { sealed: summary.sealed, seal_methods: [...summary.methods], seal_event_count: summary.eventCount, rules_version: rulesVersion, ...territory };
}

/** A closed square walk (route fixture "square"), sealed by the real engine. */
export const SEALED_LOOP: Readonly<SealColumns> = (() => {
  const f = ROUTE_FIXTURES[1]!;
  const c = sealColumnsFor(fixesOf(poly(f.vertices, 14), f.origin, 10_000));
  if (c.sealed !== true || c.territory_sealed !== true) throw new Error("the square fixture must seal and enclose ground");
  return Object.freeze(c);
})();

/** An open out-and-away walk, evaluated by the real engine and not sealed. */
export const OPEN_ROUTE: Readonly<SealColumns> = (() => {
  const f = ROUTE_FIXTURES[0]!;
  const c = sealColumnsFor(fixesOf(poly([[0, 0], [400, 0], [400, 250], [750, 250]], 14), f.origin, 10_000));
  if (c.sealed !== false || c.territory_sealed !== false) throw new Error("the open fixture must not seal");
  return Object.freeze(c);
})();

/**
 * The seal columns as an SQL literal list (column order of `SEAL_COLUMNS`),
 * from a real engine result. A fixture that writes its own cells (not the
 * route the seal was computed on) names the cells its loop encloses as
 * `claimUnits` (H3 cells, one resolution); with null, or when none is a
 * valid cell, the result's own claimable cells are written. `claimResolution`
 * overrides the resolution recorded with them (a row as the pipeline of a
 * rule set at that resolution would have stamped it).
 */
export function sealLiteral(c: SealColumns, claimUnits: readonly string[] | null, claimResolution?: number): string {
  const lit = (v: unknown) => (v === null ? "NULL" : typeof v === "string" ? `'${v.replace(/'/g, "''")}'` : String(v));
  const methods = c.seal_methods === null ? "NULL" : `ARRAY[${c.seal_methods.map(lit).join(", ")}]::text[]`;
  // Claimable cells exist only on a true territory seal (the database refuses anything else).
  let units = c.territory_sealed === true ? c.territory_claim_units : null;
  let res = c.territory_sealed === true ? c.territory_claim_resolution : null;
  if (c.territory_sealed === true && claimUnits) {
    const given = [...new Set(claimUnits.filter((u) => isValidCell(u)))];
    if (given.length > 0) { units = given; res = getResolution(given[0]!); }
  }
  if (units !== null && claimResolution !== undefined) res = claimResolution;
  const claim = units === null ? "NULL" : `ARRAY[${units.map((u) => BigInt(`0x${u}`).toString(10)).join(", ")}]::bigint[]`;
  return `${lit(c.sealed)}, ${methods}, ${lit(c.seal_event_count)}, ${lit(c.rules_version)}, ${lit(c.territory_seal_version)}, ${lit(c.territory_sealed)}, ${lit(c.territory_seal_reason)}, ${claim}, ${lit(res)}`;
}

export const SEAL_COLUMNS = "sealed, seal_methods, seal_event_count, rules_version, territory_seal_version, territory_sealed, territory_seal_reason, territory_claim_units, territory_claim_resolution";
