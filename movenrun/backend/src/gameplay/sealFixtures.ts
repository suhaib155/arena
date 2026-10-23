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

export interface SealColumns {
  sealed: boolean | null;
  seal_methods: string[] | null;
  seal_event_count: number | null;
  rules_version: number | null;
}

/** Session metadata for a capture that spans `points`, under the current session rules. */
export function sessionFor(points: readonly { timestamp: number }[], rulesVersion = SESSION_RULES_VERSION): SessionMetadata {
  return { mode: DEFAULT_MOVEMENT_MODE, rulesVersion, startedAt: points[0]!.timestamp - 1_000, finishedAt: points[points.length - 1]!.timestamp + 1_000, pauses: [] };
}

/** The stored summary the pipeline would write for these fixes (all NULL when the engine refuses the rules version). */
export function sealColumnsFor(points: readonly { lat: number; lng: number; timestamp: number }[], rulesVersion = SESSION_RULES_VERSION): SealColumns {
  const evaluation = evaluateSealing({
    session: sessionFor(points, rulesVersion),
    points: points.map((p) => ({ latitude: p.lat, longitude: p.lng, timestamp: p.timestamp })),
    heldCells: null,
  });
  const summary = toSealSummary(evaluation);
  if (!summary) return { sealed: null, seal_methods: null, seal_event_count: null, rules_version: rulesVersion };
  return { sealed: summary.sealed, seal_methods: [...summary.methods], seal_event_count: summary.eventCount, rules_version: rulesVersion };
}

/** A closed square walk (route fixture "square"), sealed by the real engine. */
export const SEALED_LOOP: Readonly<SealColumns> = (() => {
  const f = ROUTE_FIXTURES[1]!;
  const c = sealColumnsFor(fixesOf(poly(f.vertices, 14), f.origin, 10_000));
  if (c.sealed !== true) throw new Error("the square fixture must seal");
  return Object.freeze(c);
})();

/** An open out-and-away walk, evaluated by the real engine and not sealed. */
export const OPEN_ROUTE: Readonly<SealColumns> = (() => {
  const f = ROUTE_FIXTURES[0]!;
  const c = sealColumnsFor(fixesOf(poly([[0, 0], [400, 0], [400, 250], [750, 250]], 14), f.origin, 10_000));
  if (c.sealed !== false) throw new Error("the open fixture must not seal");
  return Object.freeze(c);
})();

/** The four seal columns as an SQL literal list (column order of `SEAL_COLUMNS`), from a real engine result. */
export function sealLiteral(c: SealColumns): string {
  const lit = (v: unknown) => (v === null ? "NULL" : typeof v === "string" ? `'${v.replace(/'/g, "''")}'` : String(v));
  const methods = c.seal_methods === null ? "NULL" : `ARRAY[${c.seal_methods.map(lit).join(", ")}]::text[]`;
  return `${lit(c.sealed)}, ${methods}, ${lit(c.seal_event_count)}, ${lit(c.rules_version)}`;
}

export const SEAL_COLUMNS = "sealed, seal_methods, seal_event_count, rules_version";
