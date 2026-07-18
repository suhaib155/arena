/**
 * Provider-neutral production configuration for the (future) auth/wallet
 * provider integration and the webhook ingestion boundary (ADR-0011/0013).
 *
 * Fail-closed philosophy, mirroring identity/config.ts:
 *  - In production, a partially-configured provider or webhook boundary is a
 *    HARD startup error — never a silently half-enabled state.
 *  - "disabled" is an explicit, valid mode (the only mode until a provider is
 *    selected — see ADR-0011): every provider-dependent surface then fails
 *    closed and readiness reports the feature as disabled, not healthy.
 *  - Secrets are validated for length/format but never echoed in errors.
 *  - The resolved config is deep-frozen: read once, immutable thereafter.
 *  - There is NO flag anywhere that bypasses authentication or signature
 *    verification — feature gates only mount/unmount fail-closed surfaces.
 */
import { z } from "zod";

/** Providers this codebase knows how to talk about. "disabled" is the explicit
 *  no-provider mode; concrete names are added only when ADR-0011 selects one. */
export const PROVIDER_NAMES = ["disabled"] as const;
export type ProviderName = (typeof PROVIDER_NAMES)[number];

const MIN_SECRET_LENGTH = 32;

/** URL must be https, except loopback hosts (local integration tests). */
function isAcceptableHttpsUrl(raw: string, allowInsecureLoopback: boolean): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  if (!allowInsecureLoopback) return false;
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

/** Hostname patterns that indicate a debug/dev provider endpoint — never
 *  acceptable in production. */
const DEBUG_ENDPOINT_RE = /(^|\.)(localhost|local|dev|staging|ngrok\.io|ngrok-free\.app|trycloudflare\.com)$|^127\.|^\[::1\]$/i;

function isDebugHost(raw: string): boolean {
  try {
    return DEBUG_ENDPOINT_RE.test(new URL(raw).hostname);
  } catch {
    return true; // unparsable → treat as unacceptable
  }
}

const providerEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Provider identity. "disabled" is the only accepted value today.
  IDENTITY_PROVIDER_NAME: z.string().default("disabled"),
  IDENTITY_PROVIDER_API_BASE_URL: z.string().optional(),
  IDENTITY_PROVIDER_CLIENT_ID: z.string().optional(),
  IDENTITY_PROVIDER_API_SECRET: z.string().optional(),

  // OIDC-style binding values (validated now, consumed when a provider lands).
  IDENTITY_PROVIDER_ISSUER: z.string().optional(),
  IDENTITY_PROVIDER_AUDIENCE: z.string().optional(),
  // Comma-separated EXACT redirect origins (scheme+host+port). No wildcards.
  IDENTITY_REDIRECT_ORIGINS: z.string().optional(),
  // Comma-separated allowed mobile deep-link schemes (e.g. "movenrun").
  IDENTITY_DEEPLINK_SCHEMES: z.string().optional(),
  IDENTITY_IOS_BUNDLE_ID: z.string().optional(),
  IDENTITY_ANDROID_PACKAGE: z.string().optional(),

  // Webhook signing (current + optional previous key for rotation overlap).
  IDENTITY_WEBHOOK_CURRENT_KEY_ID: z.string().optional(),
  IDENTITY_WEBHOOK_CURRENT_SECRET: z.string().optional(),
  IDENTITY_WEBHOOK_PREVIOUS_KEY_ID: z.string().optional(),
  IDENTITY_WEBHOOK_PREVIOUS_SECRET: z.string().optional(),
  // RFC3339 instant after which the previous key is rejected (bounded overlap).
  IDENTITY_WEBHOOK_PREVIOUS_EXPIRES_AT: z.string().optional(),
  IDENTITY_WEBHOOK_MAX_SKEW_SECONDS: z.coerce.number().int().positive().max(3600).default(300),

  // Feature gates. Gates only mount/unmount fail-closed surfaces; there is no
  // gate that can skip authentication or signature verification.
  IDENTITY_FEATURE_WEBHOOKS: z
    .enum(["true", "false"]).default("false").transform((v) => v === "true"),
});

export interface WebhookKey {
  keyId: string;
  secret: string;
}

export interface ResolvedProviderConfig {
  nodeEnv: "development" | "production" | "test";
  providerName: ProviderName;
  providerStatus: "disabled" | "configured";
  apiBaseUrl: string | null;
  clientId: string | null;
  apiSecretPresent: boolean; // never expose the value beyond the closure below
  issuer: string | null;
  audience: string | null;
  redirectOrigins: string[];
  deepLinkSchemes: string[];
  iosBundleId: string | null;
  androidPackage: string | null;
  webhooks: {
    enabled: boolean;
    currentKey: WebhookKey | null;
    previousKey: (WebhookKey & { expiresAt: Date }) | null;
    maxSkewSeconds: number;
  };
}

export type ProviderConfigResult =
  | { ok: true; config: Readonly<ResolvedProviderConfig> }
  | { ok: false; errors: string[] };

function splitCsv(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Validate provider/webhook configuration. Error strings name the offending
 * FIELD only — never a secret value. `requireStrict` (production) turns every
 * partial configuration into a hard error.
 */
export function resolveProviderConfig(
  env: Record<string, string | undefined>,
  opts: { requireStrict: boolean }
): ProviderConfigResult {
  const parsed = providerEnvSchema.safeParse(env);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const v = parsed.data;
  const errors: string[] = [];
  const allowLoopback = !opts.requireStrict;

  // Provider name must be known. Unknown names fail closed (never "best effort").
  if (!(PROVIDER_NAMES as readonly string[]).includes(v.IDENTITY_PROVIDER_NAME)) {
    errors.push(`IDENTITY_PROVIDER_NAME: unknown provider "${v.IDENTITY_PROVIDER_NAME}"`);
  }
  const providerName = (PROVIDER_NAMES as readonly string[]).includes(v.IDENTITY_PROVIDER_NAME)
    ? (v.IDENTITY_PROVIDER_NAME as ProviderName)
    : "disabled";

  // Provider block: all-or-nothing when any provider field is set.
  const anyProvider = Boolean(
    v.IDENTITY_PROVIDER_API_BASE_URL || v.IDENTITY_PROVIDER_CLIENT_ID || v.IDENTITY_PROVIDER_API_SECRET
  );
  if (providerName === "disabled" && anyProvider && opts.requireStrict) {
    errors.push("IDENTITY_PROVIDER_NAME: provider credentials are set but the provider is 'disabled'");
  }
  if (v.IDENTITY_PROVIDER_API_BASE_URL) {
    if (!isAcceptableHttpsUrl(v.IDENTITY_PROVIDER_API_BASE_URL, allowLoopback)) {
      errors.push("IDENTITY_PROVIDER_API_BASE_URL: must be a valid https URL (http allowed only for loopback outside production)");
    } else if (opts.requireStrict && isDebugHost(v.IDENTITY_PROVIDER_API_BASE_URL)) {
      errors.push("IDENTITY_PROVIDER_API_BASE_URL: debug/development endpoints are not allowed in production");
    }
  }
  if (v.IDENTITY_PROVIDER_API_SECRET && v.IDENTITY_PROVIDER_API_SECRET.length < MIN_SECRET_LENGTH) {
    errors.push(`IDENTITY_PROVIDER_API_SECRET: must be at least ${MIN_SECRET_LENGTH} characters`);
  }

  // Redirect origins: exact origins only. Any wildcard is rejected outright.
  const redirectOrigins = splitCsv(v.IDENTITY_REDIRECT_ORIGINS);
  for (const origin of redirectOrigins) {
    if (origin.includes("*")) {
      errors.push("IDENTITY_REDIRECT_ORIGINS: wildcard origins are forbidden");
      continue;
    }
    if (!isAcceptableHttpsUrl(origin, allowLoopback)) {
      errors.push("IDENTITY_REDIRECT_ORIGINS: every origin must be an exact https origin");
      continue;
    }
    try {
      const u = new URL(origin);
      if (u.pathname !== "/" || u.search || u.hash) {
        errors.push("IDENTITY_REDIRECT_ORIGINS: origins must not carry a path, query, or fragment");
      }
    } catch {
      errors.push("IDENTITY_REDIRECT_ORIGINS: invalid origin");
    }
  }

  const deepLinkSchemes = splitCsv(v.IDENTITY_DEEPLINK_SCHEMES);
  for (const scheme of deepLinkSchemes) {
    if (!/^[a-z][a-z0-9+.-]{2,63}$/.test(scheme)) {
      errors.push("IDENTITY_DEEPLINK_SCHEMES: invalid scheme");
    }
  }

  // Webhook block: the feature gate may only ENABLE a fully-configured
  // boundary. Gate on + missing/short key = hard error (fail closed).
  let currentKey: WebhookKey | null = null;
  let previousKey: (WebhookKey & { expiresAt: Date }) | null = null;
  if (v.IDENTITY_FEATURE_WEBHOOKS) {
    if (!v.IDENTITY_WEBHOOK_CURRENT_KEY_ID || !v.IDENTITY_WEBHOOK_CURRENT_SECRET) {
      errors.push("IDENTITY_WEBHOOK_CURRENT_KEY_ID/IDENTITY_WEBHOOK_CURRENT_SECRET: required when webhooks are enabled");
    } else if (v.IDENTITY_WEBHOOK_CURRENT_SECRET.length < MIN_SECRET_LENGTH) {
      errors.push(`IDENTITY_WEBHOOK_CURRENT_SECRET: must be at least ${MIN_SECRET_LENGTH} characters`);
    } else {
      currentKey = { keyId: v.IDENTITY_WEBHOOK_CURRENT_KEY_ID, secret: v.IDENTITY_WEBHOOK_CURRENT_SECRET };
    }
    const anyPrev = Boolean(
      v.IDENTITY_WEBHOOK_PREVIOUS_KEY_ID || v.IDENTITY_WEBHOOK_PREVIOUS_SECRET || v.IDENTITY_WEBHOOK_PREVIOUS_EXPIRES_AT
    );
    if (anyPrev) {
      const expiresAt = v.IDENTITY_WEBHOOK_PREVIOUS_EXPIRES_AT ? new Date(v.IDENTITY_WEBHOOK_PREVIOUS_EXPIRES_AT) : null;
      if (
        !v.IDENTITY_WEBHOOK_PREVIOUS_KEY_ID ||
        !v.IDENTITY_WEBHOOK_PREVIOUS_SECRET ||
        !expiresAt ||
        Number.isNaN(expiresAt.getTime())
      ) {
        errors.push(
          "IDENTITY_WEBHOOK_PREVIOUS_*: previous key requires key id, secret, and a valid RFC3339 expiry (bounded overlap — unlimited historical keys are not accepted)"
        );
      } else if (v.IDENTITY_WEBHOOK_PREVIOUS_SECRET.length < MIN_SECRET_LENGTH) {
        errors.push(`IDENTITY_WEBHOOK_PREVIOUS_SECRET: must be at least ${MIN_SECRET_LENGTH} characters`);
      } else {
        previousKey = { keyId: v.IDENTITY_WEBHOOK_PREVIOUS_KEY_ID, secret: v.IDENTITY_WEBHOOK_PREVIOUS_SECRET, expiresAt };
      }
    }
  }

  if (errors.length) return { ok: false, errors };

  const config: ResolvedProviderConfig = {
    nodeEnv: v.NODE_ENV,
    providerName,
    providerStatus: providerName === "disabled" ? "disabled" : "configured",
    apiBaseUrl: v.IDENTITY_PROVIDER_API_BASE_URL ?? null,
    clientId: v.IDENTITY_PROVIDER_CLIENT_ID ?? null,
    apiSecretPresent: Boolean(v.IDENTITY_PROVIDER_API_SECRET),
    issuer: v.IDENTITY_PROVIDER_ISSUER ?? null,
    audience: v.IDENTITY_PROVIDER_AUDIENCE ?? null,
    redirectOrigins,
    deepLinkSchemes,
    iosBundleId: v.IDENTITY_IOS_BUNDLE_ID ?? null,
    androidPackage: v.IDENTITY_ANDROID_PACKAGE ?? null,
    webhooks: {
      enabled: v.IDENTITY_FEATURE_WEBHOOKS && currentKey !== null,
      currentKey,
      previousKey,
      maxSkewSeconds: v.IDENTITY_WEBHOOK_MAX_SKEW_SECONDS,
    },
  };
  // Immutable: read once, frozen thereafter (shallow-freeze each level we own).
  Object.freeze(config.redirectOrigins);
  Object.freeze(config.deepLinkSchemes);
  Object.freeze(config.webhooks);
  return { ok: true, config: Object.freeze(config) };
}

let _cached: Readonly<ResolvedProviderConfig> | null = null;

/** Production accessor — exits the process on invalid config, identical
 *  contract to getIdentityConfig(). */
export function getProviderConfig(): Readonly<ResolvedProviderConfig> {
  if (_cached) return _cached;
  const requireStrict = process.env.NODE_ENV === "production";
  const result = resolveProviderConfig(process.env, { requireStrict });
  if (!result.ok) {
    // Field names only — never secret values.
    console.error("Invalid provider configuration:", result.errors);
    process.exit(1);
  }
  _cached = result.config;
  return _cached;
}

/** Test-only reset for the cached singleton. */
export function _resetProviderConfigForTests(): void {
  _cached = null;
}
