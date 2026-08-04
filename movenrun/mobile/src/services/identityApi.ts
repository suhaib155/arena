/**
 * Typed client for the MovenRun identity/wallet API.
 *
 * The SERVER is authoritative: this client holds no auth logic beyond
 * attaching the bearer access token (read from the secure store, never from
 * AsyncStorage), transparently refreshing it once on a 401, and surfacing the
 * server's stable error codes. It never generates a wallet, never accepts a
 * seed phrase or private key, and never persists a secret outside the secure
 * store.
 *
 * Base URL comes from `EXPO_PUBLIC_API_URL` (an Expo public env var). When
 * unset, calls fail fast with a clear message rather than hitting a wrong host.
 */
import {
  getSecureSessionStore,
  isSecureSessionStorageError,
  type SecureSessionStore,
  type SecureSessionTokens,
} from "../lib/secureSession";
import type { RefreshOutcome, RestoreKind, UnavailableCode } from "../lib/authLifecycle";

export interface PublicUser {
  id: string;
  status: string;
  createdAt: string;
}

export interface PublicIdentity {
  id: string;
  provider: "email_otp" | "google" | "base_account" | string;
  verificationStatus: string;
  assuranceLevel: string;
  createdAt: string;
}

export interface PublicWallet {
  id: string;
  address: string | null;
  addressChecksum: string | null;
  walletType: "embedded_eoa" | "base_smart_account" | "external_eoa" | "external_smart_account" | string;
  sourceProvider: string;
  chainFamily: string;
  ownershipStatus: "unverified" | "verified" | "revoked" | string;
  isEmbedded: boolean;
  isActive: boolean;
  provisioningState: string | null;
  createdAt: string;
}

/** One row of the session inventory — only privacy-preserving public fields.
 *  The server never sends tokens, hashes, family IDs, user-agent data, or
 *  security versions here, and this client never re-derives them. */
export interface PublicSessionSummary {
  id: string;
  isCurrent: boolean;
  deviceLabel: string;
  status: "active" | "revoked" | "expired" | string;
  assuranceLevel: string;
  issuedAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface SessionEnvelope extends SecureSessionTokens {
  id: string;
  assuranceLevel: string;
  issuedAt: string;
  expiresAt: string;
}

export interface LoginResult {
  user: PublicUser;
  session: SessionEnvelope;
  embeddedWallet: PublicWallet | null;
}

/** A typed API error carrying the server's stable error code. */
export class IdentityApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(status: number, code: string) {
    super(`identity api error ${status}: ${code}`);
    this.name = "IdentityApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * THE base-URL parse — every caller goes through this one function, so a build
 * can never disagree with itself about where the backend lives.
 * Returns null when `EXPO_PUBLIC_API_URL` is unset (a legitimate configuration:
 * local-beta-only builds have no backend).
 */
export function readApiBaseUrl(): string | null {
  const url = process.env.EXPO_PUBLIC_API_URL;
  if (!url) return null;
  return url.replace(/\/+$/, "");
}

/** Whether this build has an account service at all. */
export function isBackendConfigured(): boolean {
  return readApiBaseUrl() !== null;
}

function resolveBaseUrl(): string {
  const url = readApiBaseUrl();
  if (url === null) {
    throw new IdentityApiError(0, "api_base_url_unset");
  }
  return url;
}

/**
 * Build the app's identity client, or null when no backend is configured.
 * Called exactly once, from the app-level bootstrap — screens consume the
 * client held by the auth store instead of constructing their own.
 */
export function createIdentityApiClient(): IdentityApiClient | null {
  const baseUrl = readApiBaseUrl();
  if (baseUrl === null) return null;
  return new IdentityApiClient({ baseUrl });
}

/** Result of restoring a stored session. `restored` carries only non-secret,
 *  server-derived state — never the tokens themselves. */
export type SessionRestoreResult =
  | {
      kind: Extract<RestoreKind, "restored">;
      user: PublicUser;
      identities: PublicIdentity[];
      wallets: PublicWallet[];
    }
  | { kind: "no-session" }
  | { kind: "rejected" }
  /** Carries WHY, so the UI can distinguish an unreachable backend from an
   *  unreadable keystore. Neither says anything about session existence. */
  | { kind: "unavailable"; code: UnavailableCode };

export class IdentityApiClient {
  private readonly baseUrl: string;
  private readonly store: SecureSessionStore;
  /**
   * The refresh currently in flight, shared by every caller that needs one.
   *
   * This is a security control, not an optimisation. The server rotates the
   * refresh token on every use and treats a second presentation of the same
   * token as a replay — it revokes the WHOLE session family and signs the user
   * out everywhere (see backend SessionService.refresh). Two concurrent
   * protected requests hitting 401 together (which `restoreSession` does by
   * design: `me()` and `listWallets()` run in parallel) would otherwise present
   * the same refresh token twice and destroy a perfectly valid session.
   */
  private refreshInFlight: Promise<RefreshOutcome> | null = null;

  constructor(opts: { baseUrl?: string; store?: SecureSessionStore } = {}) {
    this.baseUrl = opts.baseUrl ?? resolveBaseUrl();
    this.store = opts.store ?? getSecureSessionStore();
  }

  private async request<T>(
    path: string,
    init: { method?: string; body?: unknown; auth?: boolean; retryOn401?: boolean } = {}
  ): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (init.auth) {
      /* A keystore that cannot be READ is not the same as an empty keystore.
         Treating it as 401 would let a transient read failure be classified as
         a rejected session — and rejected sessions get deleted. It becomes a
         recoverable client error instead, and never reaches the 401 path. */
      const tokens = await this.loadTokens();
      if (!tokens) throw new IdentityApiError(401, "unauthenticated");
      headers.authorization = `Bearer ${tokens.accessToken}`;
    }
    const res = await this.send(this.baseUrl + path, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

    if (res.status === 401 && init.auth && init.retryOn401 !== false) {
      // One transparent refresh attempt, then retry the original call. The
      // attempt is bounded: `retryOn401: false` makes the recursion depth 1,
      // and there is no polling or backoff loop anywhere in this client.
      // Concurrent 401s all await the SAME refresh (see refreshOnce), so the
      // rotating refresh token is never presented twice.
      const outcome = await this.refreshOnce();
      if (outcome.kind === "refreshed") return this.request<T>(path, { ...init, retryOn401: false });
      // A transient refresh failure must not be reported as "unauthenticated":
      // that would let a network blip look like a revoked session.
      if (outcome.kind === "unavailable") throw new IdentityApiError(0, outcome.code);
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
      throw new IdentityApiError(res.status, body?.error?.code ?? "request_failed");
    }
    return (await res.json()) as T;
  }

  /**
   * Read stored credentials, converting an unreadable keystore into a typed,
   * recoverable client error. `null` therefore means one thing only: there is
   * genuinely no valid stored session.
   */
  private async loadTokens(): Promise<SecureSessionTokens | null> {
    try {
      return await this.store.load();
    } catch (err) {
      if (isSecureSessionStorageError(err) && err.code === "read_unavailable") {
        throw new IdentityApiError(0, "secure_storage_unavailable");
      }
      throw err;
    }
  }

  /**
   * Perform one HTTP call, converting a transport failure into a typed
   * `service_unavailable` error. Raw exception text never escapes this client,
   * and a network problem is never allowed to masquerade as an auth answer.
   */
  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch {
      throw new IdentityApiError(0, "service_unavailable");
    }
  }

  /**
   * Single-flight wrapper around {@link performRefresh}.
   *
   * The first caller starts the refresh; every caller that arrives while it is
   * running receives the SAME promise and therefore the same outcome. The slot
   * is cleared once the operation settles — and only if it still holds that
   * operation — so a later, genuinely independent expiry starts a fresh
   * refresh. Nothing here polls, sleeps, or backs off.
   *
   * `performRefresh` never rejects (every failure is a typed outcome), so the
   * shared promise cannot leave an unhandled rejection behind for the callers
   * that merely awaited it.
   */
  private refreshOnce(): Promise<RefreshOutcome> {
    const existing = this.refreshInFlight;
    if (existing) return existing;

    const operation = this.performRefresh().then(
      (outcome) => {
        if (this.refreshInFlight === operation) this.refreshInFlight = null;
        return outcome;
      },
      (err: unknown) => {
        if (this.refreshInFlight === operation) this.refreshInFlight = null;
        throw err;
      },
    );

    this.refreshInFlight = operation;
    return operation;
  }

  /**
   * The single bounded refresh attempt, with a typed outcome. Call it through
   * {@link refreshOnce}, never directly.
   *
   * The distinction matters for security: a server rejection means the
   * credentials are dead and must be cleared, while a network/backend failure
   * means we simply don't know — so the stored credentials are left untouched
   * and the caller surfaces a retryable state instead of signing the user out.
   */
  private async performRefresh(): Promise<RefreshOutcome> {
    let tokens: SecureSessionTokens | null;
    try {
      tokens = await this.loadTokens();
    } catch {
      // Unreadable keystore: nothing is known and nothing may be deleted.
      return { kind: "unavailable", code: "secure_storage_unavailable" };
    }
    if (!tokens) return { kind: "no-session" };
    let res: Response;
    try {
      res = await this.send(this.baseUrl + "/identity/auth/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });
    } catch {
      // Transport failure — credentials deliberately NOT cleared.
      return { kind: "unavailable", code: "service_unavailable" };
    }
    if (res.status >= 500) {
      // The backend is unhealthy; it has not judged these credentials.
      return { kind: "unavailable", code: "service_unavailable" };
    }
    if (!res.ok) {
      // The server rejected the refresh token: fail closed and clear.
      await this.discardCredentials();
      return { kind: "rejected" };
    }
    let data: { session: SessionEnvelope };
    try {
      data = (await res.json()) as { session: SessionEnvelope };
    } catch {
      return { kind: "unavailable", code: "service_unavailable" };
    }
    try {
      await this.persistSession(data.session);
    } catch {
      /* The server rotated successfully but the new credentials could not be
         written to the keystore. The OLD refresh token is now `rotated`
         server-side, so presenting it again would be treated as a replay and
         would revoke the entire session family. Drop it and re-authenticate —
         this is the safe direction, and it never reports a persist that did
         not happen. */
      await this.discardCredentials();
      return { kind: "rejected" };
    }
    return { kind: "refreshed" };
  }

  /**
   * Destroy stored credentials that are known to be dead (the server rejected
   * them, or a rotation left them spent).
   *
   * `clear()` already guarantees the credential becomes unloadable whenever the
   * keystore can perform EITHER a delete or a write — a failed delete is
   * neutralised with a tombstone, precisely so a spent refresh token can never
   * be re-presented after a restart and cost the user their other devices.
   *
   * What is tolerated here, and only here, is the residual case where neither
   * is possible: a keystore that can be read but can neither be written nor
   * deleted. No client-side mitigation exists for that — durably remembering
   * anything requires a write, which is the operation that failed — and the
   * outcome returned to the caller is `rejected` regardless, so the app never
   * believes a dead session is alive. Turning it into a rejected promise would
   * only trade a correct sign-out for a bootstrap that never completes.
   */
  private async discardCredentials(): Promise<void> {
    try {
      await this.store.clear();
    } catch {
      /* Total storage failure — see above. Deliberately tolerated: the returned
         outcome is unchanged, so this can never be mistaken for success. */
    }
  }

  /**
   * Restore a stored session at startup. Performs at most the client's normal
   * bounded refresh, never polls, and never retries on its own — a
   * user-initiated Retry calls this again.
   *
   * `me()` and `listWallets()` run in parallel deliberately (one round trip
   * instead of two on a cold start). That is safe ONLY because a 401 on both
   * funnels into {@link refreshOnce}: exactly one refresh request is sent and
   * both calls retry with the token it produced. Without that, the parallel
   * pair would present the rotating refresh token twice and the server would
   * revoke the whole family as a replay.
   *
   * This method never rejects: every failure is a typed outcome, so a caller
   * awaiting it can never be left hanging or throw into a bootstrap.
   */
  async restoreSession(): Promise<SessionRestoreResult> {
    let tokens: SecureSessionTokens | null;
    try {
      tokens = await this.loadTokens();
    } catch {
      /* The keystore could not be read. That is NOT "no session": nothing is
         deleted, nothing is claimed, and the caller offers a Retry. */
      return { kind: "unavailable", code: "secure_storage_unavailable" };
    }
    // No stored (or no *valid*, unexpired) session material: confirmed signed
    // out. The secure store already deleted anything malformed or expired.
    if (!tokens) return { kind: "no-session" };
    try {
      const [me, wallets] = await Promise.all([this.me(), this.listWallets()]);
      return {
        kind: "restored",
        user: me.user,
        identities: me.identities,
        wallets: wallets.wallets,
      };
    } catch (err) {
      if (err instanceof IdentityApiError) {
        if (err.code === "secure_storage_unavailable") {
          // A read failure mid-flight: still not evidence about the session.
          return { kind: "unavailable", code: "secure_storage_unavailable" };
        }
        if (err.code === "service_unavailable" || err.status >= 500 || err.status === 0) {
          return { kind: "unavailable", code: "service_unavailable" };
        }
        if (err.status === 401 || err.code === "unauthenticated") {
          // The refresh path already cleared the credentials; make sure the
          // device holds nothing dead even if the 401 came from elsewhere.
          await this.discardCredentials();
          return { kind: "rejected" };
        }
      }
      // Anything else is unclassifiable, so fail *safe* rather than closed:
      // never discard credentials we haven't been told are invalid.
      return { kind: "unavailable", code: "service_unavailable" };
    }
  }

  private async persistSession(session: SessionEnvelope): Promise<void> {
    await this.store.save({
      accessToken: session.accessToken,
      accessTokenExpiresAt: session.accessTokenExpiresAt,
      refreshToken: session.refreshToken,
      refreshTokenExpiresAt: session.refreshTokenExpiresAt,
    });
  }

  // ---- auth ---------------------------------------------------------------
  async beginEmailOtp(email: string): Promise<void> {
    await this.request<{ challengeId: string }>("/identity/auth/email/begin", { method: "POST", body: { email } });
  }

  /**
   * Verify a one-time code. Resolves ONLY when the server confirmed the login
   * AND the session was persisted — those two together are the authentication
   * commit point. A persist failure surfaces as a typed public code so the app
   * never claims a sign-in whose credentials were not stored.
   */
  async completeEmailOtp(email: string, code: string, deviceLabel?: string): Promise<LoginResult> {
    const result = await this.request<LoginResult>("/identity/auth/email/complete", {
      method: "POST",
      body: deviceLabel === undefined ? { email, code } : { email, code, deviceLabel },
    });
    try {
      await this.persistSession(result.session);
    } catch {
      throw new IdentityApiError(0, "secure_storage_unavailable");
    }
    return result;
  }

  async signOut(): Promise<void> {
    try {
      await this.request<{ revoked: boolean }>("/identity/session/revoke", { method: "POST", auth: true });
    } finally {
      // Always clear local credentials, even when the revoke call failed —
      // clear() itself propagates a storage failure (fail closed).
      await this.store.clear();
    }
  }

  /** Revoke EVERY session for the user server-side (bumps the server's
   *  security version, killing all devices' tokens), then clear local
   *  credentials. */
  async signOutEverywhere(): Promise<void> {
    try {
      await this.request<{ revoked: number }>("/identity/session/revoke-all", { method: "POST", auth: true });
    } finally {
      await this.store.clear();
    }
  }

  // ---- reads --------------------------------------------------------------
  me(): Promise<{ user: PublicUser; session: SessionEnvelope; identities: PublicIdentity[] }> {
    return this.request("/identity/me", { auth: true });
  }
  listWallets(): Promise<{ wallets: PublicWallet[] }> {
    return this.request("/identity/wallets", { auth: true });
  }
  listIdentities(): Promise<{ identities: PublicIdentity[] }> {
    return this.request("/identity/identities", { auth: true });
  }

  // ---- session management -------------------------------------------------
  /** The caller's session inventory (current first, server-ordered, bounded). */
  listSessions(): Promise<{ sessions: PublicSessionSummary[] }> {
    return this.request("/identity/sessions", { auth: true });
  }

  /** Revoke ONE other session by its opaque public id. The server refuses the
   *  current session (409) and answers foreign/nonexistent ids with an
   *  indistinguishable 404. Idempotent for already-settled owned sessions. */
  revokeSession(sessionId: string): Promise<{ revoked: boolean }> {
    return this.request(`/identity/sessions/${encodeURIComponent(sessionId)}/revoke`, {
      method: "POST",
      auth: true,
    });
  }

  /** Revoke every OTHER active session, keeping this device signed in. Local
   *  credentials are deliberately NOT cleared — the current session survives. */
  revokeOtherSessions(): Promise<{ revoked: number }> {
    return this.request("/identity/session/revoke-others", { method: "POST", auth: true });
  }

  // ---- wallet actions -----------------------------------------------------
  setActiveWallet(walletId: string): Promise<{ wallet: PublicWallet }> {
    return this.request("/identity/wallets/active", { method: "POST", auth: true, body: { walletId } });
  }
  revokeWallet(walletId: string): Promise<{ wallet: PublicWallet }> {
    return this.request("/identity/wallets/revoke", { method: "POST", auth: true, body: { walletId } });
  }
  beginWalletLink(input: {
    action: "link_external_wallet" | "base_account_login";
    address: string;
    chainId: number;
    walletType: PublicWallet["walletType"];
  }): Promise<{ nonce: string; message: string; expiresAt: string }> {
    return this.request("/identity/wallets/link/begin", { method: "POST", auth: true, body: input });
  }
}
