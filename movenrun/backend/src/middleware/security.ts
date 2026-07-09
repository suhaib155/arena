/**
 * Security headers (helmet) and an explicit CORS allowlist.
 */
import helmet from "helmet";
import cors, { type CorsOptions } from "cors";
import { getConfig, type Config } from "../config.js";

const DEFAULT_DEV_ORIGINS = [
  "http://localhost:19006", // Expo web / dev client
  "http://localhost:8081", // Expo Metro bundler
  "http://localhost:3000",
];

type CorsConfig = Pick<Config, "NODE_ENV" | "CORS_ORIGINS">;

/**
 * Resolves the CORS allowlist from config.
 *
 * - Production: `CORS_ORIGINS` MUST be set to an explicit, comma-separated
 *   list of origins. Unset — or containing a literal `*` — throws at startup
 *   (fail closed) rather than silently allowing every origin.
 * - Development/test: falls back to a small set of common local dev origins
 *   when `CORS_ORIGINS` isn't set, so local tooling works without extra setup.
 *
 * Note `*` is never treated as a wildcard match here — origins are compared
 * literally against the request's `Origin` header, which is never actually
 * the string `"*"`, so a `*` entry can only ever be a configuration mistake,
 * never an accidental allow-all.
 */
export function getAllowedOrigins(config: CorsConfig = getConfig()): string[] {
  const configured = config.CORS_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean) ?? [];

  if (config.NODE_ENV === "production") {
    if (configured.length === 0) {
      throw new Error(
        "CORS_ORIGINS must be set to an explicit comma-separated allowlist in production " +
          "— refusing to start with no allowed origins (fail closed)."
      );
    }
    if (configured.includes("*")) {
      throw new Error("CORS_ORIGINS must not contain '*' in production.");
    }
    return configured;
  }

  return configured.length > 0 ? configured : DEFAULT_DEV_ORIGINS;
}

export function createCorsMiddleware(config: CorsConfig = getConfig()) {
  const allowed = getAllowedOrigins(config);
  const options: CorsOptions = {
    origin(origin, callback) {
      // No Origin header = a non-browser client (curl, server-to-server, a
      // mobile app's fetch outside a WebView). CORS is a browser-enforced
      // mechanism and doesn't apply to these — wallet-signature auth
      // (middleware/auth.ts) is what actually authenticates them.
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, allowed.includes(origin));
    },
    credentials: false,
  };
  return cors(options);
}

/** Helmet with its default header set — safe for a JSON API (CSP only
 *  affects browser-rendered HTML/JS, never JSON responses). No options are
 *  customized. */
export function createSecurityHeadersMiddleware() {
  return helmet();
}
