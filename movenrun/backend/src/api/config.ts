import { z } from "zod";
import { resolveIdentityConfig } from "../identity/config.js";
import { getAllowedOrigins } from "../middleware/security.js";

const schema = z.object({
  NODE_ENV: z.enum(["production", "development", "test"]).default("production"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url().regex(/^postgres(?:ql)?:\/\//),
  CORS_ORIGINS: z.string().min(1),
  // Configure only for a deployment whose proxy path has been verified.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(1).default(0),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).max(3600000).default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1000).default(300),
  RATE_LIMIT_WRITE_MAX: z.coerce.number().int().min(1).max(100).default(20),
});

export function resolveApiConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) throw new Error("Invalid V3 API environment");
  const config = result.data;
  // The deployed entry always requires real identity secrets, even if an
  // operator accidentally selects a non-production NODE_ENV.
  const resolved = resolveIdentityConfig(env, { requireSecrets: true });
  if (!resolved.ok) throw new Error("Invalid identity environment");
  const identity = resolved.config;
  if (identity.sessionPepper.length < 32 || identity.otpPepper.length < 32 ||
      identity.sessionPepper === identity.otpPepper) {
    throw new Error("V3 API requires distinct identity peppers of at least 32 characters");
  }
  for (const origin of getAllowedOrigins({ ...config, NODE_ENV: "production" })) {
    let url: URL;
    try { url = new URL(origin); } catch { throw new Error("Invalid CORS origin"); }
    if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password) {
      throw new Error("V3 API CORS origins must be explicit HTTPS origins");
    }
  }
  return config;
}

export type ApiConfig = ReturnType<typeof resolveApiConfig>;
