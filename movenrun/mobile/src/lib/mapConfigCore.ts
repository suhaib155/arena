/**
 * Pure map-configuration resolution.
 *
 * Split out of `@/config/map` so it can be verified offline under
 * `node --test`: this module imports nothing from `expo-constants`,
 * `react-native`, or any other native package. `@/config/map` is the thin
 * adapter that reads the real Expo environment and calls into here.
 */

/** Where a resolved value came from — surfaced in dev diagnostics. */
export type ConfigSource = "env" | "appConfig" | "fallback";

export interface MapConfig {
  /** Vector style URL handed to MapLibre's `mapStyle` prop. */
  styleUrl: string;
  styleUrlSource: ConfigSource;
  /** True when `styleUrl` is the development fallback, not a configured provider. */
  usingDevelopmentFallback: boolean;
  /** Base URL of the MovenRun backend (territory API). Null when unconfigured. */
  apiBaseUrl: string | null;
  /** Realtime (SSE) endpoint. Defaults to `${apiBaseUrl}/v1/territories/stream`. */
  realtimeUrl: string | null;
}

/** The raw inputs `@/config/map` collects from the Expo environment. */
export interface MapConfigInput {
  envStyleUrl?: string | null;
  envApiBaseUrl?: string | null;
  envRealtimeUrl?: string | null;
  extraStyleUrl?: string | null;
  extraApiBaseUrl?: string | null;
  extraRealtimeUrl?: string | null;
}

/**
 * Demotiles is MapLibre's own low-zoom demonstration style. It is a *development
 * placeholder only*: it has no street detail and is explicitly not a production
 * tile backend. Public OpenStreetMap tile servers are **not** used here and must
 * not be — their tile usage policy forbids app backends.
 */
export const DEVELOPMENT_FALLBACK_STYLE_URL =
  "https://demotiles.maplibre.org/style.json";

function clean(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Strips trailing slashes so callers can always append `/v1/...`. */
function normalizeBaseUrl(url: string | null): string | null {
  if (!url) return null;
  const trimmed = url.replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resolve the map/API configuration from already-collected inputs.
 *
 * Precedence for every value: environment variable → app-config `extra` →
 * development fallback. There is no hardcoded provider token: a production
 * style URL always comes from the build environment.
 */
export function resolveMapConfigFrom(input: MapConfigInput): MapConfig {
  const envStyle = clean(input.envStyleUrl);
  const extraStyle = clean(input.extraStyleUrl);

  let styleUrl: string;
  let styleUrlSource: ConfigSource;
  if (envStyle) {
    styleUrl = envStyle;
    styleUrlSource = "env";
  } else if (extraStyle) {
    styleUrl = extraStyle;
    styleUrlSource = "appConfig";
  } else {
    styleUrl = DEVELOPMENT_FALLBACK_STYLE_URL;
    styleUrlSource = "fallback";
  }

  const apiBaseUrl = normalizeBaseUrl(
    clean(input.envApiBaseUrl) ?? clean(input.extraApiBaseUrl),
  );
  const realtimeUrl =
    clean(input.envRealtimeUrl) ??
    clean(input.extraRealtimeUrl) ??
    (apiBaseUrl ? `${apiBaseUrl}/v1/territories/stream` : null);

  return {
    styleUrl,
    styleUrlSource,
    usingDevelopmentFallback: styleUrlSource === "fallback",
    apiBaseUrl,
    realtimeUrl,
  };
}

/**
 * Production guard. Returns the problems with a resolved config that would make
 * a release build unusable. Empty array means the config is releasable.
 *
 * Returns reasons rather than throwing so it is testable offline and so the
 * caller decides whether to warn or hard-fail.
 */
export function productionConfigProblems(config: MapConfig): string[] {
  const problems: string[] = [];
  if (config.usingDevelopmentFallback) {
    problems.push(
      "EXPO_PUBLIC_MAP_STYLE_URL is not set — the build would ship the MapLibre demo style, which is not a production tile backend.",
    );
  }
  if (!config.apiBaseUrl) {
    problems.push(
      "EXPO_PUBLIC_API_BASE_URL is not set — territory data cannot be loaded.",
    );
  }
  return problems;
}
