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
  type SecureSessionStore,
  type SecureSessionTokens,
} from "../lib/secureSession";

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

function resolveBaseUrl(): string {
  const url = process.env.EXPO_PUBLIC_API_URL;
  if (!url) {
    throw new IdentityApiError(0, "api_base_url_unset");
  }
  return url.replace(/\/+$/, "");
}

export class IdentityApiClient {
  private readonly baseUrl: string;
  private readonly store: SecureSessionStore;

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
      const tokens = await this.store.load();
      if (!tokens) throw new IdentityApiError(401, "unauthenticated");
      headers.authorization = `Bearer ${tokens.accessToken}`;
    }
    const res = await fetch(this.baseUrl + path, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

    if (res.status === 401 && init.auth && init.retryOn401 !== false) {
      // One transparent refresh attempt, then retry the original call.
      const refreshed = await this.tryRefresh();
      if (refreshed) return this.request<T>(path, { ...init, retryOn401: false });
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
      throw new IdentityApiError(res.status, body?.error?.code ?? "request_failed");
    }
    return (await res.json()) as T;
  }

  private async tryRefresh(): Promise<boolean> {
    const tokens = await this.store.load();
    if (!tokens) return false;
    try {
      const res = await fetch(this.baseUrl + "/identity/auth/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });
      if (!res.ok) {
        await this.store.clear();
        return false;
      }
      const data = (await res.json()) as { session: SessionEnvelope };
      await this.persistSession(data.session);
      return true;
    } catch {
      return false;
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

  async completeEmailOtp(email: string, code: string, deviceLabel?: string): Promise<LoginResult> {
    const result = await this.request<LoginResult>("/identity/auth/email/complete", {
      method: "POST",
      body: deviceLabel === undefined ? { email, code } : { email, code, deviceLabel },
    });
    await this.persistSession(result.session);
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
