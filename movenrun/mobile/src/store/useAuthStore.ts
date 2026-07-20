/**
 * Auth/wallet UI state (Zustand).
 *
 * This store holds ONLY non-secret, server-derived state — the current user,
 * linked auth methods, wallets, and a status flag. It is deliberately NOT
 * persisted (no AsyncStorage), and it NEVER holds an access/refresh token:
 * tokens live exclusively in the secure store (see lib/secureSession.ts). The
 * server remains authoritative — every action refetches from the API rather
 * than mutating optimistic local truth for security-relevant fields.
 */
import { create } from "zustand";
import {
  IdentityApiClient,
  IdentityApiError,
  type PublicIdentity,
  type PublicSessionSummary,
  type PublicUser,
  type PublicWallet,
} from "../services/identityApi";

export type AuthStatus = "signedOut" | "authenticating" | "signedIn" | "error";
export type SessionsStatus = "idle" | "loading" | "refreshing" | "ready" | "error";

interface AuthState {
  status: AuthStatus;
  user: PublicUser | null;
  identities: PublicIdentity[];
  wallets: PublicWallet[];
  /** Public error CODE (never a raw message with sensitive detail). */
  errorCode: string | null;
  /** Injected so screens/tests can supply a configured client. */
  client: IdentityApiClient | null;

  /** Server-derived session inventory — never fabricated locally. */
  sessions: PublicSessionSummary[];
  sessionsStatus: SessionsStatus;
  sessionsErrorCode: string | null;
  /** Dedup key for the in-flight destructive session action: a session id,
   *  "revoke-others", or null. While set, all session actions are refused. */
  pendingSessionAction: string | null;

  setClient: (client: IdentityApiClient) => void;
  beginEmailOtp: (email: string) => Promise<void>;
  completeEmailOtp: (email: string, code: string, deviceLabel?: string) => Promise<void>;
  refresh: () => Promise<void>;
  setActiveWallet: (walletId: string) => Promise<void>;
  revokeWallet: (walletId: string) => Promise<void>;
  /** Load or explicitly refresh the session inventory from the server. */
  loadSessions: (mode?: "initial" | "refresh") => Promise<void>;
  /** Revoke ONE other session, then re-list from the server (no optimistic
   *  deletion — the server confirms before the row disappears). */
  revokeSession: (sessionId: string) => Promise<void>;
  /** Revoke every other session, keep this device signed in, then re-list. */
  revokeOtherSessions: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Server-side revoke-all (every device), then local credential clear. */
  signOutEverywhere: () => Promise<void>;
}

function codeOf(err: unknown): string {
  return err instanceof IdentityApiError ? err.code : "request_failed";
}

/** A 401 after the client's single transparent refresh attempt means the
 *  current session was revoked externally: the client has already cleared the
 *  secure store, so runtime state must fall back to signed-out too. */
function isAuthLost(err: unknown): boolean {
  return err instanceof IdentityApiError && (err.status === 401 || err.code === "unauthenticated");
}

const SIGNED_OUT_STATE = {
  status: "signedOut" as const,
  user: null,
  identities: [],
  wallets: [],
  sessions: [],
  sessionsStatus: "idle" as const,
  sessionsErrorCode: null,
  pendingSessionAction: null,
};

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "signedOut",
  user: null,
  identities: [],
  wallets: [],
  errorCode: null,
  client: null,
  sessions: [],
  sessionsStatus: "idle",
  sessionsErrorCode: null,
  pendingSessionAction: null,

  setClient: (client) => set({ client }),

  beginEmailOtp: async (email) => {
    const client = get().client;
    if (!client) return set({ status: "error", errorCode: "client_unavailable" });
    set({ status: "authenticating", errorCode: null });
    try {
      await client.beginEmailOtp(email);
      // Stay in 'authenticating' — the UI now collects the code.
    } catch (err) {
      set({ status: "error", errorCode: codeOf(err) });
    }
  },

  completeEmailOtp: async (email, code, deviceLabel) => {
    const client = get().client;
    if (!client) return set({ status: "error", errorCode: "client_unavailable" });
    set({ status: "authenticating", errorCode: null });
    try {
      const result = await client.completeEmailOtp(email, code, deviceLabel);
      const wallets = await client.listWallets();
      const me = await client.me();
      set({
        status: "signedIn",
        user: result.user,
        identities: me.identities,
        wallets: wallets.wallets,
        errorCode: null,
      });
    } catch (err) {
      set({ status: "error", errorCode: codeOf(err) });
    }
  },

  refresh: async () => {
    const client = get().client;
    if (!client) return;
    try {
      const [me, wallets] = await Promise.all([client.me(), client.listWallets()]);
      set({ status: "signedIn", user: me.user, identities: me.identities, wallets: wallets.wallets });
    } catch (err) {
      set({ status: "signedOut", errorCode: codeOf(err) });
    }
  },

  setActiveWallet: async (walletId) => {
    const client = get().client;
    if (!client) return;
    try {
      await client.setActiveWallet(walletId);
      const wallets = await client.listWallets();
      set({ wallets: wallets.wallets, errorCode: null });
    } catch (err) {
      set({ errorCode: codeOf(err) });
    }
  },

  revokeWallet: async (walletId) => {
    const client = get().client;
    if (!client) return;
    try {
      await client.revokeWallet(walletId);
      const wallets = await client.listWallets();
      set({ wallets: wallets.wallets, errorCode: null });
    } catch (err) {
      set({ errorCode: codeOf(err) });
    }
  },

  loadSessions: async (mode = "initial") => {
    const client = get().client;
    if (!client) return set({ sessionsStatus: "error", sessionsErrorCode: "client_unavailable" });
    // "refreshing" keeps the existing list on screen during pull-to-refresh;
    // "loading" is the first fetch (spinner over an empty list).
    set({
      sessionsStatus: mode === "refresh" && get().sessions.length > 0 ? "refreshing" : "loading",
      sessionsErrorCode: null,
    });
    try {
      const { sessions } = await client.listSessions();
      set({ sessions, sessionsStatus: "ready", sessionsErrorCode: null });
    } catch (err) {
      if (isAuthLost(err)) return set({ ...SIGNED_OUT_STATE, errorCode: codeOf(err) });
      // Transient failure: keep whatever list we had — recoverable, not stale-
      // as-truth (the error state tells the user the list may be outdated).
      set({ sessionsStatus: "error", sessionsErrorCode: codeOf(err) });
    }
  },

  revokeSession: async (sessionId) => {
    const client = get().client;
    if (!client || get().pendingSessionAction !== null) return; // dedup in-flight actions
    set({ pendingSessionAction: sessionId, sessionsErrorCode: null });
    try {
      await client.revokeSession(sessionId);
      // Only after server confirmation: re-list rather than optimistic delete.
      const { sessions } = await client.listSessions();
      set({ sessions, sessionsStatus: "ready", pendingSessionAction: null });
    } catch (err) {
      if (isAuthLost(err)) return set({ ...SIGNED_OUT_STATE, errorCode: codeOf(err) });
      set({ pendingSessionAction: null, sessionsStatus: "error", sessionsErrorCode: codeOf(err) });
    }
  },

  revokeOtherSessions: async () => {
    const client = get().client;
    if (!client || get().pendingSessionAction !== null) return;
    set({ pendingSessionAction: "revoke-others", sessionsErrorCode: null });
    try {
      await client.revokeOtherSessions();
      // The current session (and its SecureStore credentials) survive; the
      // list is re-fetched so the server stays the source of truth.
      const { sessions } = await client.listSessions();
      set({ sessions, sessionsStatus: "ready", pendingSessionAction: null });
    } catch (err) {
      if (isAuthLost(err)) return set({ ...SIGNED_OUT_STATE, errorCode: codeOf(err) });
      set({ pendingSessionAction: null, sessionsStatus: "error", sessionsErrorCode: codeOf(err) });
    }
  },

  signOut: async () => {
    const client = get().client;
    try {
      await client?.signOut();
      set({ ...SIGNED_OUT_STATE, errorCode: null });
    } catch (err) {
      // The UI state is cleared regardless, but a failed credential clear is
      // surfaced honestly — never silently reported as a clean sign-out.
      set({ ...SIGNED_OUT_STATE, errorCode: codeOf(err) });
    }
  },

  signOutEverywhere: async () => {
    const client = get().client;
    try {
      await client?.signOutEverywhere();
      set({ ...SIGNED_OUT_STATE, errorCode: null });
    } catch (err) {
      set({ ...SIGNED_OUT_STATE, errorCode: codeOf(err) });
    }
  },
}));
