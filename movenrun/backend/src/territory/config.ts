/**
 * Territory configuration — every tunable value for closed-loop capture, the
 * H3 grid, and the map API, read from the environment and validated once.
 *
 * ## Why this module imports nothing
 * It deliberately imports no `zod`, no `@movenrun/shared`, and nothing from
 * `../config.js`. That keeps it inside the backend's type-check scope (see
 * `backend/tsconfig.json`) and lets every territory test construct a config
 * without touching `process.env` or triggering the root config's
 * `process.exit(1)` on missing unrelated variables.
 *
 * ## Fail closed
 * `loadTerritoryConfig` returns errors rather than throwing so callers choose
 * the policy; `assertTerritoryConfig` (used at server startup) throws. An
 * invalid production configuration must never silently fall back to defaults —
 * a mistyped `TERRITORY_MIN_AREA_SQUARE_METERS` would otherwise quietly hand
 * out territory for a route around a parked car.
 */

export interface TerritoryConfig {
  /** Grid version new ownership is written at. */
  gridVersion: number;
  /** H3 resolution paired with `gridVersion`. */
  resolution: number;

  // ----- closed-loop validity
  minRoutePoints: number;
  minRouteDistanceMeters: number;
  minDurationSeconds: number;
  /** Max distance between a route's first and last point to count as closed. */
  maxClosureDistanceMeters: number;
  minAreaSquareMeters: number;
  maxAreaSquareMeters: number;

  // ----- GPS quality / physics
  maxGpsAccuracyMeters: number;
  /** Share of points allowed to exceed `maxGpsAccuracyMeters` (0..1). */
  maxPoorAccuracyRatio: number;
  maxSpeedMetersPerSecond: number;
  /** A single hop longer than this is a teleport regardless of elapsed time. */
  maxJumpMeters: number;

  // ----- map API limits
  /** Max viewport area in square degrees. Rejects "give me the planet". */
  maxMapViewportArea: number;
  maxMapFeatures: number;
}

/**
 * Defaults are the spec's suggested starting values. They are deliberately
 * conservative: a first release that awards too little territory is a tuning
 * problem, one that awards too much is an economy problem.
 */
export const TERRITORY_DEFAULTS: TerritoryConfig = {
  gridVersion: 2,
  resolution: 9,

  minRoutePoints: 40,
  minRouteDistanceMeters: 800,
  minDurationSeconds: 300,
  maxClosureDistanceMeters: 50,
  minAreaSquareMeters: 10_000,
  // ~5 km² — larger than any plausible single run loop, so a GPS spike that
  // wraps the polygon around a city can't claim it.
  maxAreaSquareMeters: 5_000_000,

  maxGpsAccuracyMeters: 30,
  maxPoorAccuracyRatio: 0.3,
  // 8 m/s ≈ 28.8 km/h — comfortably above a sprint, below cycling/driving.
  maxSpeedMetersPerSecond: 8,
  maxJumpMeters: 250,

  // ~0.25° × 0.25°, roughly a large city at temperate latitudes.
  maxMapViewportArea: 0.0625,
  maxMapFeatures: 2_000,
};

/** Legacy grid — resolution 8, the value the deployed contracts and the
 *  existing route-proof path use. Never changed by territory configuration. */
export const LEGACY_GRID_VERSION = 1;
export const LEGACY_H3_RESOLUTION = 8;

export interface TerritoryConfigResult {
  config: TerritoryConfig;
  /** Non-empty when the environment held an unusable value. */
  errors: string[];
}

type EnvSource = Record<string, string | undefined>;

function readNumber(
  env: EnvSource,
  name: string,
  fallback: number,
  errors: string[],
  constraint: (value: number) => boolean,
  constraintText: string,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    errors.push(`${name} must be a number, got ${JSON.stringify(raw)}`);
    return fallback;
  }
  if (!constraint(value)) {
    errors.push(`${name} must be ${constraintText}, got ${value}`);
    return fallback;
  }
  return value;
}

const positive = (v: number) => v > 0;
const positiveInteger = (v: number) => Number.isInteger(v) && v > 0;
const ratio = (v: number) => v >= 0 && v <= 1;

/**
 * Parse a territory configuration from an environment-like record. Pure — pass
 * `process.env` in production, a literal in tests.
 */
export function loadTerritoryConfig(env: EnvSource = process.env): TerritoryConfigResult {
  const errors: string[] = [];
  const d = TERRITORY_DEFAULTS;

  const config: TerritoryConfig = {
    gridVersion: readNumber(env, "TERRITORY_GRID_VERSION", d.gridVersion, errors, positiveInteger, "a positive integer"),
    resolution: readNumber(env, "TERRITORY_H3_RESOLUTION", d.resolution, errors, (v) => Number.isInteger(v) && v >= 0 && v <= 15, "an integer between 0 and 15"),

    minRoutePoints: readNumber(env, "TERRITORY_MIN_ROUTE_POINTS", d.minRoutePoints, errors, positiveInteger, "a positive integer"),
    minRouteDistanceMeters: readNumber(env, "TERRITORY_MIN_ROUTE_DISTANCE_METERS", d.minRouteDistanceMeters, errors, positive, "greater than 0"),
    minDurationSeconds: readNumber(env, "TERRITORY_MIN_DURATION_SECONDS", d.minDurationSeconds, errors, positive, "greater than 0"),
    maxClosureDistanceMeters: readNumber(env, "TERRITORY_MAX_CLOSURE_DISTANCE_METERS", d.maxClosureDistanceMeters, errors, positive, "greater than 0"),
    minAreaSquareMeters: readNumber(env, "TERRITORY_MIN_AREA_SQUARE_METERS", d.minAreaSquareMeters, errors, positive, "greater than 0"),
    maxAreaSquareMeters: readNumber(env, "TERRITORY_MAX_AREA_SQUARE_METERS", d.maxAreaSquareMeters, errors, positive, "greater than 0"),

    maxGpsAccuracyMeters: readNumber(env, "TERRITORY_MAX_GPS_ACCURACY_METERS", d.maxGpsAccuracyMeters, errors, positive, "greater than 0"),
    maxPoorAccuracyRatio: readNumber(env, "TERRITORY_MAX_POOR_ACCURACY_RATIO", d.maxPoorAccuracyRatio, errors, ratio, "between 0 and 1"),
    maxSpeedMetersPerSecond: readNumber(env, "TERRITORY_MAX_SPEED_METERS_PER_SECOND", d.maxSpeedMetersPerSecond, errors, positive, "greater than 0"),
    maxJumpMeters: readNumber(env, "TERRITORY_MAX_JUMP_METERS", d.maxJumpMeters, errors, positive, "greater than 0"),

    maxMapViewportArea: readNumber(env, "TERRITORY_MAX_MAP_VIEWPORT_AREA", d.maxMapViewportArea, errors, positive, "greater than 0"),
    maxMapFeatures: readNumber(env, "TERRITORY_MAX_MAP_FEATURES", d.maxMapFeatures, errors, positiveInteger, "a positive integer"),
  };

  // Cross-field checks — individually valid values that make no sense together.
  if (config.minAreaSquareMeters >= config.maxAreaSquareMeters) {
    errors.push(
      `TERRITORY_MIN_AREA_SQUARE_METERS (${config.minAreaSquareMeters}) must be below TERRITORY_MAX_AREA_SQUARE_METERS (${config.maxAreaSquareMeters})`,
    );
  }
  if (config.gridVersion === LEGACY_GRID_VERSION) {
    errors.push(
      `TERRITORY_GRID_VERSION must not be ${LEGACY_GRID_VERSION} — that version is reserved for the legacy resolution-${LEGACY_H3_RESOLUTION} route-proof grid and must not be reused for territory ownership`,
    );
  }

  return { config, errors };
}

/**
 * Startup guard. Throws with every problem listed at once, so a misconfigured
 * deployment fails immediately instead of silently mis-awarding territory.
 */
export function assertTerritoryConfig(env: EnvSource = process.env): TerritoryConfig {
  const { config, errors } = loadTerritoryConfig(env);
  if (errors.length > 0) {
    throw new Error(`Invalid territory configuration:\n  - ${errors.join("\n  - ")}`);
  }
  return config;
}

let cached: TerritoryConfig | null = null;

/** Process-wide territory configuration, validated on first use. */
export function getTerritoryConfig(): TerritoryConfig {
  if (!cached) cached = assertTerritoryConfig();
  return cached;
}

/** Exported for tests only — do not use as a general-purpose reset. */
export function _resetTerritoryConfigForTests(): void {
  cached = null;
}
