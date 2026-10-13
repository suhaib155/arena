/**
 * Supabase Auth adapter: the server's only contact with the auth provider.
 *
 * - `SupabaseTokenVerifier` verifies a Supabase access token locally: signature
 *   against the project's published JWKS (ES256 / RS256), or the legacy shared
 *   secret (HS256) only when one is configured; then issuer, audience, role,
 *   expiry and subject. Nothing from an unverified token is ever trusted.
 * - `SupabaseAuthClient` makes the three server-side calls MovenRun needs: the
 *   Web3 (EIP-4361) token grant for wallet sign-in, deleting an auth user when
 *   a MovenRun account is erased, and looking a user up for reconciliation.
 *
 * Tokens, keys and signatures never appear in errors or logs.
 */
import { createHmac, createPublicKey, timingSafeEqual, verify as verifySignature, type JsonWebKey, type KeyObject } from "node:crypto";

const TIMEOUT_MS = 10_000;
const JWKS_TTL_MS = 10 * 60 * 1000;
/** A token is refused once it is this close to expiry, and `iat` may be at most this far ahead. */
const CLOCK_SKEW_SECONDS = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Failure with no token, key or provider payload attached. */
export class SupabaseAuthError extends Error {
  constructor(readonly reason: string) {
    super(`Supabase auth: ${reason}`);
    this.name = "SupabaseAuthError";
  }
}

export interface SupabaseAuthConfig {
  /** Project URL, e.g. https://<ref>.supabase.co (no trailing slash). */
  url: string;
  /** Publishable (or legacy anon) key: sent as `apikey` on public auth calls. */
  publishableKey: string;
  /** Secret (or legacy service role) key: admin calls only. Never leaves the server. */
  secretKey: string;
  /** Legacy HS256 JWT secret. Only for projects that have not moved to signing keys. */
  legacyJwtSecret?: string | null;
}

/** What MovenRun takes from a verified Supabase access token. */
export interface VerifiedSupabaseUser {
  /** auth.users.id — the stable principal for every login method of this user. */
  subject: string;
  /** The provider-verified email when the token carries one (Google), else null. */
  email: string | null;
  /** Authentication methods used for THIS session (`amr`), e.g. ["oauth"] or ["web3"]. */
  methods: string[];
  /** Providers linked to the auth user (`app_metadata.providers`). */
  providers: string[];
  expiresAt: Date;
}

type Jwks = { keys: Array<JsonWebKey & { kid?: string; alg?: string; use?: string }> };

function b64urlJson(segment: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new SupabaseAuthError("malformed_token");
  return parsed as Record<string, unknown>;
}

export class SupabaseTokenVerifier {
  private readonly issuer: string;
  private keys = new Map<string, { key: KeyObject; alg: "ES256" | "RS256" }>();
  private fetchedAt = 0;
  private attemptedAt = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly config: Pick<SupabaseAuthConfig, "url" | "legacyJwtSecret">,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.issuer = `${config.url}/auth/v1`;
  }

  async verify(token: string): Promise<VerifiedSupabaseUser> {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) throw new SupabaseAuthError("malformed_token");
    let header: Record<string, unknown>;
    let claims: Record<string, unknown>;
    try {
      header = b64urlJson(parts[0]);
      claims = b64urlJson(parts[1]);
    } catch {
      throw new SupabaseAuthError("malformed_token");
    }
    const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
    const signature = Buffer.from(parts[2], "base64url");

    if (header.alg === "HS256") {
      // Only a project still on the legacy shared secret issues HS256 tokens.
      // Without a configured secret an HS256 token is refused outright.
      const secret = this.config.legacyJwtSecret;
      if (!secret) throw new SupabaseAuthError("bad_signature");
      const expected = createHmac("sha256", secret).update(signed).digest();
      if (expected.length !== signature.length || !timingSafeEqual(expected, signature)) throw new SupabaseAuthError("bad_signature");
    } else if (header.alg === "ES256" || header.alg === "RS256") {
      if (typeof header.kid !== "string" || !header.kid) throw new SupabaseAuthError("bad_signature");
      const entry = await this.keyFor(header.kid);
      // The key decides the algorithm; a header naming another one is refused.
      if (!entry || entry.alg !== header.alg) throw new SupabaseAuthError("bad_signature");
      const ok = verifySignature(
        "sha256",
        signed,
        entry.alg === "ES256" ? { key: entry.key, dsaEncoding: "ieee-p1363" } : entry.key,
        signature,
      );
      if (!ok) throw new SupabaseAuthError("bad_signature");
    } else {
      throw new SupabaseAuthError("bad_signature");
    }

    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    if (claims.iss !== this.issuer) throw new SupabaseAuthError("wrong_issuer");
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes("authenticated")) throw new SupabaseAuthError("wrong_audience");
    if (claims.role !== "authenticated") throw new SupabaseAuthError("wrong_role");
    if (claims.is_anonymous === true) throw new SupabaseAuthError("anonymous_user");
    if (typeof claims.exp !== "number" || claims.exp <= nowSeconds + CLOCK_SKEW_SECONDS) throw new SupabaseAuthError("expired");
    if (typeof claims.iat === "number" && claims.iat > nowSeconds + CLOCK_SKEW_SECONDS) throw new SupabaseAuthError("not_yet_valid");
    if (typeof claims.sub !== "string" || !UUID.test(claims.sub)) throw new SupabaseAuthError("bad_subject");

    const methods = Array.isArray(claims.amr)
      ? claims.amr.flatMap((m) => (m && typeof m === "object" && typeof (m as { method?: unknown }).method === "string" ? [(m as { method: string }).method] : []))
      : [];
    const appMetadata = claims.app_metadata && typeof claims.app_metadata === "object" ? (claims.app_metadata as Record<string, unknown>) : {};
    const providers = Array.isArray(appMetadata.providers) ? appMetadata.providers.filter((p): p is string => typeof p === "string") : [];
    const email = typeof claims.email === "string" && claims.email.includes("@") ? claims.email.trim().toLowerCase() : null;

    return { subject: claims.sub.toLowerCase(), email, methods, providers, expiresAt: new Date(claims.exp * 1000) };
  }

  private async keyFor(kid: string) {
    const now = this.now().getTime();
    // Refresh when the cache is old or the kid is unknown (a key rotation),
    // but never more than once a minute, so bad tokens cannot hammer the provider.
    const wanted = now - this.fetchedAt > JWKS_TTL_MS || !this.keys.has(kid);
    if (wanted && now - this.attemptedAt > 60_000) await this.refresh();
    return this.keys.get(kid) ?? null;
  }

  private refresh(): Promise<void> {
    this.inflight ??= (async () => {
      this.attemptedAt = this.now().getTime();
      try {
        const response = await this.fetchImpl(`${this.issuer}/.well-known/jwks.json`, {
          redirect: "error",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) throw new SupabaseAuthError("jwks_unavailable");
        const body = (await response.json()) as Jwks;
        if (!body || !Array.isArray(body.keys)) throw new SupabaseAuthError("jwks_unavailable");
        const next = new Map<string, { key: KeyObject; alg: "ES256" | "RS256" }>();
        for (const jwk of body.keys) {
          if (!jwk.kid || (jwk.use && jwk.use !== "sig")) continue;
          // Public keys only: a JWK carrying private material is ignored.
          if ("d" in jwk) continue;
          const alg = jwk.kty === "EC" && jwk.crv === "P-256" ? "ES256" : jwk.kty === "RSA" ? "RS256" : null;
          if (!alg || (jwk.alg && jwk.alg !== alg)) continue;
          next.set(jwk.kid, { key: createPublicKey({ key: jwk, format: "jwk" }), alg });
        }
        this.keys = next;
        this.fetchedAt = this.now().getTime();
      } catch {
        // Keep serving known keys through a provider blip; the caller fails
        // closed for any kid it cannot find.
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }
}

export interface Web3Session {
  accessToken: string;
}

export class SupabaseAuthClient {
  constructor(
    private readonly config: SupabaseAuthConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * EIP-4361 grant: Supabase checks the signature, the message's URI and
   * domain against the project's redirect allow list, and its age; it creates
   * the auth user on first use. MovenRun has already checked its own nonce and
   * the signature before calling this.
   */
  async signInWithEthereum(message: string, signature: string): Promise<Web3Session> {
    const body = await this.call("POST", "/token?grant_type=web3", this.config.publishableKey, {
      chain: "ethereum",
      message,
      signature,
    });
    const accessToken = body && typeof body === "object" ? (body as { access_token?: unknown }).access_token : undefined;
    if (typeof accessToken !== "string" || !accessToken) throw new SupabaseAuthError("web3_grant_failed");
    return { accessToken };
  }

  /** Delete an auth user. A user that is already gone counts as deleted. */
  async deleteUser(subject: string): Promise<void> {
    if (!UUID.test(subject)) throw new SupabaseAuthError("bad_subject");
    await this.call("DELETE", `/admin/users/${subject}`, this.config.secretKey, undefined, [404]);
  }

  private async call(method: string, path: string, key: string, payload?: unknown, okStatuses: number[] = []): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.url}/auth/v1${path}`, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
    } catch {
      throw new SupabaseAuthError("unavailable");
    }
    if (okStatuses.includes(response.status)) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel();
      // 4xx from the grant means the provider refused the proof; anything else is an outage.
      throw new SupabaseAuthError(response.status >= 400 && response.status < 500 ? "rejected" : "unavailable");
    }
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new SupabaseAuthError("malformed_response");
    }
  }
}

/**
 * Read Supabase settings from the environment. Nothing set → null (sign-in
 * fails closed). Partly set or malformed → startup error, never a silent fallback.
 */
export function supabaseAuthConfigFrom(env: Record<string, string | undefined>): SupabaseAuthConfig | null {
  const url = env.SUPABASE_URL;
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY;
  const secretKey = env.SUPABASE_SECRET_KEY;
  const legacyJwtSecret = env.SUPABASE_LEGACY_JWT_SECRET || null;
  if (url === undefined && publishableKey === undefined && secretKey === undefined) return null;
  if (!url || !/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url.replace(/\/$/, "")) || !publishableKey || !secretKey) {
    throw new Error("Invalid Supabase configuration: SUPABASE_URL (https), SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY are required together");
  }
  if (publishableKey === secretKey) throw new Error("Invalid Supabase configuration: the secret key must differ from the publishable key");
  if (legacyJwtSecret !== null && legacyJwtSecret.length < 32) throw new Error("Invalid Supabase configuration: SUPABASE_LEGACY_JWT_SECRET is too short");
  return { url: url.replace(/\/$/, ""), publishableKey, secretKey, legacyJwtSecret };
}
