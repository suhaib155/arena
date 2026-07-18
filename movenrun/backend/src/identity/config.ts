/**
 * Identity/wallet configuration — validated, fail-closed, and independent of
 * the main backend config so the two can be reasoned about (and tested)
 * separately.
 *
 * Fail-closed philosophy:
 *  - Provider integrations are OFF unless their configuration is COMPLETE.
 *    A half-configured provider (e.g. Google client id but no secret) is a
 *    startup-visible error in production, never a silent "sort-of enabled"
 *    state that could fall back to a fake success.
 *  - Secrets required to protect sessions/OTPs (peppers) are mandatory in
 *    production; their absence is a hard error, not a generated default.
 *
 * Services never import a live singleton; they receive a resolved config
 * object, so unit tests stay hermetic and there is no process-local hidden
 * dependency. `getIdentityConfig()` exists only for the production wiring in
 * the HTTP layer and exits the process on invalid config (same contract as
 * config.ts's getConfig()).
 */
import { z } from "zod";

/** How a provider integration resolves after validation. */
export type ProviderStatus = "enabled" | "disabled" | "misconfigured";

const durationSecs = (def: number) => z.coerce.number().int().positive().default(def);

const identityEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Session security.
  IDENTITY_SESSION_PEPPER: z.string().min(16).optional(),
  IDENTITY_ACCESS_TOKEN_TTL_SECONDS: durationSecs(600), // 10 min — short-lived
  IDENTITY_REFRESH_TOKEN_TTL_SECONDS: durationSecs(60 * 60 * 24 * 30), // 30 days
  IDENTITY_RECENT_AUTH_WINDOW_SECONDS: durationSecs(300), // step-up recency

  // Email OTP.
  IDENTITY_OTP_PEPPER: z.string().min(16).optional(),
  IDENTITY_OTP_TTL_SECONDS: durationSecs(300),
  IDENTITY_OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  IDENTITY_OTP_RESEND_COOLDOWN_SECONDS: durationSecs(30),

  // Wallet-link / SIWE challenge.
  IDENTITY_CHALLENGE_TTL_SECONDS: durationSecs(300),
  // The exact domain a SIWE/wallet-link message must bind to. Set per
  // deployment; a wrong-domain signature is rejected.
  IDENTITY_AUTH_DOMAIN: z.string().optional(),
  // Comma-separated EVM chain ids accepted for Base Account / external links.
  IDENTITY_ALLOWED_CHAIN_IDS: z.string().optional(),

  // Embedded-wallet provider. This PR ships NO concrete vendor adapter, so the
  // flag exists to gate the architecture: when off, provisioning stays in
  // `requested` and the API reports status honestly rather than faking a wallet.
  IDENTITY_EMBEDDED_WALLET_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  // Google OIDC — all-or-nothing.
  IDENTITY_GOOGLE_CLIENT_ID: z.string().optional(),
  IDENTITY_GOOGLE_CLIENT_SECRET: z.string().optional(),
  IDENTITY_GOOGLE_REDIRECT_URIS: z.string().optional(), // comma-separated allowlist
});

export interface ResolvedIdentityConfig {
  nodeEnv: "development" | "production" | "test";

  sessionPepper: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  recentAuthWindowSeconds: number;

  otpPepper: string;
  otpTtlSeconds: number;
  otpMaxAttempts: number;
  otpResendCooldownSeconds: number;

  challengeTtlSeconds: number;
  authDomain: string | null;
  allowedChainIds: number[];

  embeddedWalletEnabled: boolean;
  googleStatus: ProviderStatus;
  google: { clientId: string; clientSecret: string; redirectUris: string[] } | null;
}

export type IdentityConfigResult =
  | { ok: true; config: ResolvedIdentityConfig }
  | { ok: false; errors: string[] };

function parseChainIds(raw: string | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/**
 * Validate identity config from an env-like record. `requireSecrets` (true in
 * production) makes the session/OTP peppers mandatory and turns a
 * half-configured Google integration into a hard error instead of a silently
 * disabled one.
 */
export function resolveIdentityConfig(
  env: Record<string, string | undefined>,
  opts: { requireSecrets: boolean }
): IdentityConfigResult {
  const parsed = identityEnvSchema.safeParse(env);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const v = parsed.data;
  const errors: string[] = [];

  const sessionPepper = v.IDENTITY_SESSION_PEPPER;
  const otpPepper = v.IDENTITY_OTP_PEPPER;
  if (opts.requireSecrets) {
    if (!sessionPepper) errors.push("IDENTITY_SESSION_PEPPER is required in production");
    if (!otpPepper) errors.push("IDENTITY_OTP_PEPPER is required in production");
  }

  // Google: all-or-nothing. Partial config is a misconfiguration.
  const gId = v.IDENTITY_GOOGLE_CLIENT_ID;
  const gSecret = v.IDENTITY_GOOGLE_CLIENT_SECRET;
  const gRedirects = (v.IDENTITY_GOOGLE_REDIRECT_URIS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const anyGoogle = Boolean(gId || gSecret || gRedirects.length);
  const allGoogle = Boolean(gId && gSecret && gRedirects.length);
  let googleStatus: ProviderStatus = "disabled";
  let google: ResolvedIdentityConfig["google"] = null;
  if (anyGoogle && !allGoogle) {
    googleStatus = "misconfigured";
    const msg =
      "Google provider is partially configured (need client id, client secret, and at least one redirect URI)";
    if (opts.requireSecrets) errors.push(msg);
  } else if (allGoogle) {
    googleStatus = "enabled";
    google = { clientId: gId!, clientSecret: gSecret!, redirectUris: gRedirects };
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    config: {
      nodeEnv: v.NODE_ENV,
      // In non-production without an explicit pepper, derive a stable
      // dev-only pepper so local runs work; production always has a real one
      // because the checks above already failed otherwise.
      sessionPepper: sessionPepper ?? "dev-only-session-pepper-not-for-production",
      accessTokenTtlSeconds: v.IDENTITY_ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTtlSeconds: v.IDENTITY_REFRESH_TOKEN_TTL_SECONDS,
      recentAuthWindowSeconds: v.IDENTITY_RECENT_AUTH_WINDOW_SECONDS,
      otpPepper: otpPepper ?? "dev-only-otp-pepper-not-for-production",
      otpTtlSeconds: v.IDENTITY_OTP_TTL_SECONDS,
      otpMaxAttempts: v.IDENTITY_OTP_MAX_ATTEMPTS,
      otpResendCooldownSeconds: v.IDENTITY_OTP_RESEND_COOLDOWN_SECONDS,
      challengeTtlSeconds: v.IDENTITY_CHALLENGE_TTL_SECONDS,
      authDomain: v.IDENTITY_AUTH_DOMAIN ?? null,
      allowedChainIds: parseChainIds(v.IDENTITY_ALLOWED_CHAIN_IDS),
      embeddedWalletEnabled: v.IDENTITY_EMBEDDED_WALLET_ENABLED,
      googleStatus,
      google,
    },
  };
}

let _cached: ResolvedIdentityConfig | null = null;

/** Production accessor. Fails closed by exiting the process on invalid config
 *  — identical contract to config.ts's getConfig(). */
export function getIdentityConfig(): ResolvedIdentityConfig {
  if (_cached) return _cached;
  const requireSecrets = process.env.NODE_ENV === "production";
  const result = resolveIdentityConfig(process.env, { requireSecrets });
  if (!result.ok) {
    console.error("Invalid identity configuration:", result.errors);
    process.exit(1);
  }
  _cached = result.config;
  return _cached;
}

/** Test-only reset for the cached singleton. */
export function _resetIdentityConfigForTests(): void {
  _cached = null;
}
