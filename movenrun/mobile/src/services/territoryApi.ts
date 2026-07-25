/**
 * Territory API client.
 *
 * Thin: it fetches, validates shape defensively, and maps to the app's types.
 * All the interesting logic — debounce, staleness, caching, reconciliation —
 * lives in the pure modules under `@/lib/territory`, which are unit-tested.
 *
 * Every response is treated as untrusted input. A backend that adds a field, or
 * a proxy that returns an HTML error page, must not crash the map.
 */
import { resolveMapConfig } from "@/config/map";
import { territoryAuthHeaders } from "@/lib/territory/territoryAuth";
import { toRelationship } from "@/lib/territory/territoryStyle";
import type { TerritoryCell, Viewport } from "@/lib/territory/viewport";
import type { CaptureResult } from "@/lib/territory/capturePreview";

export class TerritoryApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "TerritoryApiError";
  }
}

function baseUrl(): string {
  const { apiBaseUrl } = resolveMapConfig();
  if (!apiBaseUrl) {
    throw new TerritoryApiError(
      "No API base URL is configured. Set EXPO_PUBLIC_API_BASE_URL to load territory.",
    );
  }
  return apiBaseUrl;
}

/**
 * Every territory read goes through here, and every territory read carries the
 * runner's own session (D2 — see `@/lib/territory/territoryAuth`). Without it
 * the backend cannot tell a runner's own ground from a rival's, and labels all
 * of it `claimed`.
 */
async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      signal,
      headers: { Accept: "application/json", ...(await territoryAuthHeaders()) },
    });
  } catch (error) {
    if (error instanceof TerritoryApiError) throw error;
    // Offline, DNS failure, TLS failure — all the same to the caller, which
    // keeps showing what it already had.
    throw new TerritoryApiError("Couldn't reach the territory service.", null);
  }

  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body?.error === "string") detail = body.error;
    } catch {
      // Non-JSON error body — keep the status-based message.
    }
    throw new TerritoryApiError(detail, response.status);
  }

  try {
    return await response.json();
  } catch {
    throw new TerritoryApiError("The territory service returned an unreadable response.");
  }
}

/** Map one GeoJSON feature to a TerritoryCell, or null when it is unusable. */
function toCell(feature: unknown): TerritoryCell | null {
  if (!feature || typeof feature !== "object") return null;
  const f = feature as Record<string, unknown>;
  const properties = (f.properties ?? {}) as Record<string, unknown>;
  const geometry = (f.geometry ?? {}) as Record<string, unknown>;

  const cellId = properties.cellId;
  const coordinates = geometry.coordinates;
  if (typeof cellId !== "string" || !Array.isArray(coordinates)) return null;

  return {
    cellId,
    state: typeof properties.state === "string" ? properties.state : "neutral",
    relationship: toRelationship(properties.relationship),
    controlScore: typeof properties.controlScore === "number" ? properties.controlScore : 0,
    defenceScore: typeof properties.defenceScore === "number" ? properties.defenceScore : 0,
    gridVersion: typeof properties.gridVersion === "number" ? properties.gridVersion : 2,
    version: typeof properties.version === "number" ? properties.version : 0,
    coordinates: coordinates as number[][][],
  };
}

export interface TerritoryMapResult {
  cells: TerritoryCell[];
  /** True when the backend trimmed the response — the map is partial. */
  truncated: boolean;
  gridVersion: number;
}

/** Fetch the territories visible in a viewport. */
export async function fetchTerritoryMap(
  viewport: Viewport,
  signal?: AbortSignal,
): Promise<TerritoryMapResult> {
  const query = new URLSearchParams({
    west: String(viewport.west),
    south: String(viewport.south),
    east: String(viewport.east),
    north: String(viewport.north),
    zoom: String(Math.round(viewport.zoom)),
  });

  const body = (await getJson(`/v1/territories/map?${query}`, signal)) as Record<string, unknown>;
  const features = Array.isArray(body.features) ? body.features : [];
  const meta = (body.meta ?? {}) as Record<string, unknown>;

  return {
    cells: features.map(toCell).filter((cell): cell is TerritoryCell => cell !== null),
    truncated: meta.truncated === true,
    gridVersion: typeof meta.gridVersion === "number" ? meta.gridVersion : 2,
  };
}

export interface TerritoryDetail {
  cellId: string;
  state: string;
  relationship: string;
  classification: string;
  owner: { displayAddress: string; clubId: string | null } | null;
  controlScore: number;
  defenceScore: number;
  capturedAt: string | null;
  lastDefendedAt: string | null;
  neighbours: { cellId: string; state: string; relationship: string }[];
  recentEvents: {
    eventType: string;
    previousState: string | null;
    nextState: string;
    actor: string | null;
    at: string;
  }[];
  actions: { canCapture: boolean; canReinforce: boolean; canAttack: boolean };
  captureRequirements: string[];
}

export async function fetchTerritoryDetail(
  cellId: string,
  signal?: AbortSignal,
): Promise<TerritoryDetail> {
  return (await getJson(
    `/v1/territories/${encodeURIComponent(cellId)}`,
    signal,
  )) as TerritoryDetail;
}

export async function fetchTerritoryHistory(
  cellId: string,
  limit = 25,
  signal?: AbortSignal,
): Promise<TerritoryDetail["recentEvents"]> {
  const body = (await getJson(
    `/v1/territories/${encodeURIComponent(cellId)}/history?limit=${limit}`,
    signal,
  )) as Record<string, unknown>;
  return Array.isArray(body.events) ? (body.events as TerritoryDetail["recentEvents"]) : [];
}

/**
 * The runner's own capture result. Requires wallet-signature auth headers,
 * which the caller supplies — this module deliberately does not sign, so no
 * key material passes through it.
 */
export async function fetchCaptureResult(
  routeId: string,
  authHeaders: Record<string, string>,
  signal?: AbortSignal,
): Promise<CaptureResult | null> {
  const response = await fetch(
    `${baseUrl()}/v1/routes/${encodeURIComponent(routeId)}/capture-result`,
    { signal, headers: { Accept: "application/json", ...authHeaders } },
  ).catch(() => null);

  if (!response) throw new TerritoryApiError("Couldn't reach the territory service.");
  // 404 means "not processed yet or unknown" — the UI shows "verifying", which
  // is the honest state either way.
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new TerritoryApiError(`Couldn't load the capture result (${response.status})`, response.status);
  }

  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw new TerritoryApiError("The capture result was unreadable.");

  return {
    routeStatus: typeof body.routeStatus === "string" ? body.routeStatus : "UNKNOWN",
    captureEligible: body.captureEligible === true,
    capturedCells: Array.isArray(body.capturedCells) ? (body.capturedCells as string[]) : [],
    reinforcedCells: Array.isArray(body.reinforcedCells) ? (body.reinforcedCells as string[]) : [],
    attackedCells: Array.isArray(body.attackedCells) ? (body.attackedCells as string[]) : [],
    rejectedCells: Array.isArray(body.rejectedCells) ? (body.rejectedCells as string[]) : [],
    rejectionReasons: Array.isArray(body.rejectionReasons)
      ? (body.rejectionReasons as string[])
      : [],
    processedAt: typeof body.processedAt === "string" ? body.processedAt : null,
  };
}
