/**
 * Map + territory-API configuration for the real MapLibre basemap.
 *
 * This module is the thin Expo adapter: it reads `EXPO_PUBLIC_*` environment
 * variables and `expo.extra.*` from `app.json`, then hands them to the pure
 * resolver in `@/lib/mapConfigCore` (which is unit-tested offline).
 *
 * There is deliberately **no hardcoded provider token anywhere in this file**.
 * A production tile provider needs a key, and a key belongs in the build
 * environment — never in the repository.
 *
 * See `movenrun/docs/REAL_MAP_TERRITORY_SETUP.md` for provider setup.
 */
import Constants from "expo-constants";
import {
  productionConfigProblems,
  resolveMapConfigFrom,
  type MapConfig,
} from "@/lib/mapConfigCore";

export {
  DEVELOPMENT_FALLBACK_STYLE_URL,
  productionConfigProblems,
} from "@/lib/mapConfigCore";
export type { ConfigSource, MapConfig } from "@/lib/mapConfigCore";

/** Camera defaults. Zoom 15 ≈ a few city blocks, which is the scale a
 *  resolution-9 H3 territory cell reads at. */
export const MAP_DEFAULTS = {
  zoom: 15,
  minZoom: 10,
  maxZoom: 18,
  /** Zoom used when recentring on the runner mid-run. */
  followZoom: 16.5,
  /** Camera pitch — flat, so territory fills stay readable. */
  pitch: 0,
  animationDurationMs: 450,
  /** Fallback centre used only before the first location fix arrives. */
  fallbackCenter: [-0.1276, 51.5072] as [number, number],
} as const;

/** Rendering defaults for the territory + route layers. */
export const MAP_RENDER_DEFAULTS = {
  /** Territory fill opacity ceiling. Low enough that streets stay readable. */
  territoryFillOpacity: 0.38,
  territoryOutlineWidth: 1.4,
  selectedOutlineWidth: 3,
  /** Wide, pale underlay drawn beneath the route so it reads on any basemap. */
  routeUnderlayWidth: 9,
  routeLineWidth: 4.5,
  /** Max vertices sent to the route ShapeSource. Display only — the evidence
   *  uploaded to the backend is never simplified (see lib/geo/routeGeoJson). */
  maxRenderedRoutePoints: 600,
  /** Max territory features rendered in one ShapeSource. */
  maxRenderedTerritoryFeatures: 1500,
} as const;

/** `process.env.EXPO_PUBLIC_*` is statically inlined by the Expo bundler, so
 *  each name must be written out literally rather than looked up dynamically. */
function readEnvValues() {
  return {
    envStyleUrl: process.env.EXPO_PUBLIC_MAP_STYLE_URL ?? null,
    envApiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? null,
    envRealtimeUrl: process.env.EXPO_PUBLIC_REALTIME_URL ?? null,
  };
}

function readExtra(key: string): string | null {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const value = extra[key];
  return typeof value === "string" ? value : null;
}

/**
 * Resolve the map/API configuration. Pure with respect to its inputs (it only
 * reads env + app config), so it is safe to call from render.
 */
export function resolveMapConfig(): MapConfig {
  return resolveMapConfigFrom({
    ...readEnvValues(),
    extraStyleUrl: readExtra("mapStyleUrl"),
    extraApiBaseUrl: readExtra("apiBaseUrl"),
    extraRealtimeUrl: readExtra("realtimeUrl"),
  });
}

/** Convenience for a startup diagnostic: the problems that would break a
 *  release build with the currently resolved configuration. */
export function currentProductionConfigProblems(): string[] {
  return productionConfigProblems(resolveMapConfig());
}
