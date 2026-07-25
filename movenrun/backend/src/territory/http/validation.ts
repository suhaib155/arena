/**
 * Territory API request validation.
 *
 * Pure functions returning `{ ok, value } | { ok: false, error }` rather than
 * throwing, so every rule is unit-testable without Express and the router stays
 * a thin adapter.
 *
 * The map viewport rules matter more than they look: an unbounded bounding box
 * is a request to serialise every territory on the planet into one JSON
 * response. Both the viewport *area* and the returned *feature count* are
 * capped, and the caps are configuration, not constants.
 */
import type { TerritoryConfig } from "../config.js";
import { isKnownGridVersion } from "../h3.js";

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface MapViewportQuery {
  west: number;
  south: number;
  east: number;
  north: number;
  zoom: number | null;
  gridVersion: number;
}

/** Parse one query parameter as a finite number. */
function parseNumber(raw: unknown, name: string): ValidationResult<number> {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: false, error: `${name} is required` };
  }
  if (Array.isArray(raw)) {
    return { ok: false, error: `${name} must be a single value` };
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return { ok: false, error: `${name} must be a number` };
  }
  return { ok: true, value };
}

/**
 * Validate a `GET /v1/territories/map` query.
 *
 * Rejects: missing or non-numeric bounds, out-of-range coordinates, inverted
 * west/east or south/north ordering, a degenerate zero-area box, an oversized
 * viewport, and an unknown grid version.
 */
export function validateMapViewport(
  query: Record<string, unknown>,
  config: TerritoryConfig,
): ValidationResult<MapViewportQuery> {
  const bounds: Record<string, number> = {};
  for (const name of ["west", "south", "east", "north"]) {
    const parsed = parseNumber(query[name], name);
    if (!parsed.ok) return parsed;
    bounds[name] = parsed.value;
  }
  const { west, south, east, north } = bounds;

  if (west < -180 || west > 180 || east < -180 || east > 180) {
    return { ok: false, error: "west and east must be between -180 and 180" };
  }
  if (south < -90 || south > 90 || north < -90 || north > 90) {
    return { ok: false, error: "south and north must be between -90 and 90" };
  }
  // Ordering, not absolute value: a viewport that wraps the antimeridian would
  // need explicit splitting, so it is rejected rather than silently mishandled.
  if (west >= east) {
    return { ok: false, error: "west must be less than east" };
  }
  if (south >= north) {
    return { ok: false, error: "south must be less than north" };
  }

  const area = (east - west) * (north - south);
  if (area > config.maxMapViewportArea) {
    return {
      ok: false,
      error: `Viewport too large: ${area.toFixed(4)} square degrees exceeds the ${config.maxMapViewportArea} limit. Zoom in.`,
    };
  }

  let zoom: number | null = null;
  if (query.zoom !== undefined && query.zoom !== "") {
    const parsed = parseNumber(query.zoom, "zoom");
    if (!parsed.ok) return parsed;
    if (parsed.value < 0 || parsed.value > 24) {
      return { ok: false, error: "zoom must be between 0 and 24" };
    }
    zoom = parsed.value;
  }

  let gridVersion = config.gridVersion;
  if (query.gridVersion !== undefined && query.gridVersion !== "") {
    const parsed = parseNumber(query.gridVersion, "gridVersion");
    if (!parsed.ok) return parsed;
    if (!Number.isInteger(parsed.value) || !isKnownGridVersion(parsed.value)) {
      return { ok: false, error: `Unknown gridVersion: ${parsed.value}` };
    }
    gridVersion = parsed.value;
  }

  return { ok: true, value: { west, south, east, north, zoom, gridVersion } };
}

/** H3 indexes are 15 lowercase hex characters at these resolutions. */
const CELL_ID_RE = /^[0-9a-f]{15,16}$/;

/**
 * Validate a `:cellId` path parameter as *well-formed* before it reaches a
 * query. Whether the cell is a real H3 index at the right resolution is checked
 * separately (`isCellOnGrid`); this is the cheap syntactic gate that stops
 * arbitrary strings from becoming database predicates.
 */
export function validateCellId(raw: unknown): ValidationResult<string> {
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, error: "cellId is required" };
  }
  const cellId = raw.toLowerCase();
  if (!CELL_ID_RE.test(cellId)) {
    return { ok: false, error: "cellId is not a valid H3 index" };
  }
  return { ok: true, value: cellId };
}

/** Validate a history `limit`, clamped to something a client can render. */
export function validateHistoryLimit(raw: unknown, fallback = 25, max = 100): ValidationResult<number> {
  if (raw === undefined || raw === "") return { ok: true, value: fallback };
  const parsed = parseNumber(raw, "limit");
  if (!parsed.ok) return parsed;
  if (!Number.isInteger(parsed.value) || parsed.value < 1) {
    return { ok: false, error: "limit must be a positive integer" };
  }
  return { ok: true, value: Math.min(parsed.value, max) };
}

/**
 * Cap the number of features a map response may carry. Returns the truncated
 * list plus whether truncation happened, so the response can say so honestly
 * rather than silently showing a partial map as if it were complete.
 */
export function capFeatures<T>(
  items: T[],
  config: TerritoryConfig,
): { items: T[]; truncated: boolean; total: number } {
  if (items.length <= config.maxMapFeatures) {
    return { items, truncated: false, total: items.length };
  }
  return {
    items: items.slice(0, config.maxMapFeatures),
    truncated: true,
    total: items.length,
  };
}
