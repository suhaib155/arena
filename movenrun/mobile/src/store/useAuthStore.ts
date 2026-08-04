/**
 * Auth/wallet UI state (Zustand).
 *
 * This store holds ONLY non-secret, server-derived state — the current user,
 * linked auth methods, wallets, and a status flag. It is deliberately NOT
 * persisted (no AsyncStorage), and it NEVER holds an access/refresh token:
 * tokens live exclusively in the secure store (see lib/secureSession.ts). The
 * server remains authoritative — every action refetches from the API rather
 * than mutating optimistic local truth for security-relevant fields.
 *
 * The status starts at `unknown`, not `signedOut`: until `initialize()` has
 * asked the secure store and the server, "signed out" would be a claim the app
 * has no basis for. `initialize()` is also the ONE place the identity client is
 * constructed — screens read `client` from here and never build their own.
 */
import { create } from "zustand";
import {
  createIdentityApiClient,
  IdentityApiClient,
  IdentityApiError,
  type PublicIdentity,
  type PublicSessionSummary,
  type PublicUser,
  type PublicWallet,
} from "../services/identityApi";
import {
  restoreErrorCode,
  restoreKindToAuthStatus,
  type AuthOperation,
  type AuthStatus,
  type RestoreKind,
} from "../lib/authLifecycle";

export type { AuthOperation, AuthStatus } from "../lib/authLifecycle";
export type SessionsStatus = "idle" | "loading" | "refreshing" | "ready" | "error";

interface AuthState {
  status: AuthStatus;
  /** How the last session restore ended. Null until `initialize()` has run. */
  lastRestore: RestoreKind | null;
  /** The auth request currently in flight, if any. Separate from `status`
   *  because "a request is running" is not a fact about whether a session
   *  exists — conflating them is what froze the OTP form. */
  operation: AuthOperation;
  /** The user chose to continue without the account service after a recoverable
   *  restore failure. Transient, never persisted, never set automatically —
   *  stored credentials are left intact and the next launch retries. */
  restoreErrorAcknowledged: boolean;
  user: PublicUser | null;
  identities: PublicIdentity[];
  wallets: PublicWallet[];
  /** Why the last SIGN-IN ATTEMPT failed — a stable public code, never a raw
   *  message. Owned by the email/OTP form; a restore Retry must never be
   *  offered for one of these. */
  authErrorCode: string | null;
  /** Why the last SESSION RESTORE failed — set only for a genuinely recoverable
   *  `unavailable` outcome, which is the only case a restore Retry belongs to. */
  restoreErrorCode: string | null;
  /** Why the last ACCOUNT-MANAGEMENT action (activate/revoke wallet, sign out)
   *  failed — a stable public code. Kept apart from the two above so a wallet
   *  problem never appears as a sign-in error or earns a restore Retry. */
  accountErrorCode: string | null;
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
  /** App-level bootstrap: construct the client once, then restore any stored
   *  session. Safe to call repeatedly — subsequent calls are no-ops. */
  initialize: () => Promise<void>;
  /** User-initiated retry after a recoverable service failure. */
  retryRestore: () => Promise<void>;
  /** User chose to continue into the local experience despite that failure. */
  acknowledgeRestoreError: () => void;
  /** Ask the server to send a one-time code. Resolves true when it accepted,
   *  so the form can move to code entry without inspecting store internals. */
  beginEmailOtp: (email: string) => Promise<boolean>;
  /** Verify a one-time code. Resolves true only after the SERVER confirmed the
   *  sign-in — never optimistically. */
  completeEmailOtp: (email: string, code: string, deviceLabel?: string) => Promise<boolean>;
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
  status: "signedOut" as AuthStatus,
  operation: "idle" as AuthOperation,
  user: null,
  identities: [],
  wallets: [],
  sessions: [],
  sessionsStatus: "idle" as const,
  sessionsErrorCode: null,
  pendingSessionAction: null,
};

/**
 * Apply a restore outcome to the store. The mapping is the whole point:
 *  - restored  → signed in with server-derived state;
 *  - no-session / rejected → confirmed signed out (the client has already
 *    cleared any dead credentials);
 *  - unavailable → session truth stays `unknown` with a stable public code and
 *    credentials untouched, so the user gets a Retry, not a false sign-out.
 */
async function runRestore(
  client: IdentityApiClient,
  set: (partial: Partial<AuthState>) => void,
): Promise<void> {
  const outcome = await client.restoreSession();
  const status = restoreKindToAuthStatus(outcome.kind);
  if (outcome.kind === "restored") {
    set({
      status,
      operation: "idle",
      lastRestore: outcome.kind,
      user: outcome.user,
      identities: outcome.identities,
      wallets: outcome.wallets,
      restoreErrorCode: null,
    });
    return;
  }
  if (outcome.kind === "unavailable") {
    /* Session truth stays `unknown` — the app could not ask, so it may not
       claim signed-out. `lastRestore` marks the attempt as RESOLVED (so
       startup stops waiting) and `restoreErrorCode` is what earns a Retry.
       Nothing already known is discarded and no credential is touched. */
    set({
      status,
      operation: "idle",
      lastRestore: outcome.kind,
      restoreErrorCode: restoreErrorCode(outcome.kind),
    });
    return;
  }
  set({ ...SIGNED_OUT_STATE, lastRestore: outcome.kind, restoreErrorCode: null });
}

/**
 * The initialization currently in flight, shared by every caller.
 *
 * A plain `bootstrapped = true` flag set *before* the async work was a trap:
 * if restoration ever rejected, the app stayed in `restoring` forever and the
 * flag suppressed every future attempt — an unrecoverable splash. An explicit
 * promise fixes both halves: concurrent callers share one initialization, and
 * the slot is released when a run ends without a definite answer, so Retry can
 * genuinely retry. A run that resolved the session keeps the slot (idempotent).
 */
let initInFlight: Promise<void> | null = null;

/**
 * Forget any completed initialization so the next `initialize()` runs again.
 * Used ONLY by tests, which drive several independent bootstrap scenarios
 * through one module instance; app code never calls it.
 */
export function resetAuthBootstrapForTests(): void {
  initInFlight = null;
}

/**
 * Run a restore that CANNOT reject.
 *
 * `restoreSession()` is written to return typed outcomes rather than throw,
 * but bootstrap must not depend on that promise: an unexpected throw anywhere
 * beneath it (a keystore adapter, a malformed response) would otherwise leave
 * the app pinned in `restoring` with no way back. An unexpected failure is
 * classified exactly like an unreachable backend — recoverable, credentials
 * untouched, Retry offered — and the exception text never reaches the UI.
 */
async function guardedRestore(
  client: IdentityApiClient,
  set: (partial: Partial<AuthState>) => void,
): Promise<void> {
  try {
    await runRestore(client, set);
  } catch {
    set({
      status: "unknown",
      operation: "idle",
      lastRestore: "unavailable",
      restoreErrorCode: "service_unavailable",
    });
  }
}

/** Build the client (once) and restore. Never rejects. */
async function bootstrap(
  set: (partial: Partial<AuthState>) => void,
  get: () => AuthState,
): Promise<void> {
  // ONE construction point for the identity client. Construction itself can
  // throw (the secure-store registry refuses to hand out an uninstalled
  // store), so it is guarded too.
  let client: IdentityApiClient | null;
  try {
    client = get().client ?? createIdentityApiClient();
  } catch {
    set({
      status: "unknown",
      operation: "idle",
      lastRestore: "unavailable",
      restoreErrorCode: "service_unavailable",
    });
    return;
  }
  if (!client) {
    // No backend is configured: nothing can be restored and nothing can be
    // signed into. That is a *confirmed* signed-out state, not an unknown one.
    set({
      client: null,
      status: "signedOut",
      operation: "idle",
      lastRestore: "no-session",
      restoreErrorCode: null,
    });
    return;
  }
  set({ client, status: "restoring", restoreErrorCode: null, restoreErrorAcknowledged: false });
  await guardedRestore(client, set);
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "unknown",
  lastRestore: null,
  operation: "idle",
  restoreErrorAcknowledged: false,
  user: null,
  identities: [],
  wallets: [],
  authErrorCode: null,
  restoreErrorCode: null,
  accountErrorCode: null,
  client: null,
  sessions: [],
  sessionsStatus: "idle",
  sessionsErrorCode: null,
  pendingSessionAction: null,

  setClient: (client) => set({ client }),

  initialize: async () => {
    // Concurrent callers (a remount, fast refresh, a second screen) share the
    // SAME initialization instead of racing two restores against one another.
    if (initInFlight) return initInFlight;
    const run = bootstrap(set, get).finally(() => {
      /* Release the slot only while the session is still undetermined, so a
         recoverable failure stays retryable. Once a restore has produced a
         definite answer the slot is kept and initialize() is a no-op. */
      if (initInFlight === run && get().lastRestore === null) initInFlight = null;
    });
    initInFlight = run;
    return run;
  },

  retryRestore: async () => {
    if (get().operation !== "idle") return; // never race an in-flight auth request
    let client: IdentityApiClient | null;
    try {
      client = get().client ?? createIdentityApiClient();
    } catch {
      return set({
        status: "unknown",
        operation: "idle",
        lastRestore: "unavailable",
        restoreErrorCode: "service_unavailable",
      });
    }
    if (!client) {
      return set({
        client: null,
        status: "signedOut",
        operation: "idle",
        lastRestore: "no-session",
        restoreErrorCode: null,
      });
    }
    set({ client, status: "restoring", restoreErrorCode: null, restoreErrorAcknowledged: false });
    await guardedRestore(client, set);
  },

  acknowledgeRestoreError: () => set({ restoreErrorAcknowledged: true }),

  beginEmailOtp: async (email) => {
    const client = get().client;
    if (!client) {
      set({ operation: "idle", authErrorCode: "client_unavailable" });
      return false;
    }
    // One auth request at a time — repeated taps collapse into one call.
    if (get().operation !== "idle" || get().status === "signedIn") return false;
    set({ operation: "sendingOtp", authErrorCode: null });
    try {
      await client.beginEmailOtp(email);
      /* The code is on its way but the user is NOT authenticated: session
         truth is untouched and the operation returns to idle, which is exactly
         what re-enables the code field. Leaving `authenticating` set here was
         the defect that made signup impossible to finish. */
      set({ operation: "idle", authErrorCode: null });
      return true;
    } catch (err) {
      set({ operation: "idle", authErrorCode: codeOf(err) });
      return false;
    }
  },

  completeEmailOtp: async (email, code, deviceLabel) => {
    const client = get().client;
    if (!client) {
      set({ operation: "idle", authErrorCode: "client_unavailable" });
      return false;
    }
    if (get().operation !== "idle" || get().status === "signedIn") return false;
    set({ operation: "verifyingOtp", authErrorCode: null });
    try {
      const result = await client.completeEmailOtp(email, code, deviceLabel);
      // Server-confirmed only. These two reads share the client's single-flight
      // refresh, so they can never rotate the refresh token twice.
      const [me, wallets] = await Promise.all([client.me(), client.listWallets()]);
      set({
        status: "signedIn",
        operation: "idle",
        user: result.user,
        identities: me.identities,
        wallets: wallets.wallets,
        authErrorCode: null,
        restoreErrorCode: null,
        lastRestore: "restored",
      });
      return true;
    } catch (err) {
      /* Back to idle with a form-owned error, so the code field stays editable
         and the user can correct it. `status` is deliberately NOT rewritten: a
         wrong code says nothing about whether a stored session exists, and
         these actions already refuse to run while signed in. */
      set({ operation: "idle", authErrorCode: codeOf(err) });
      return false;
    }
  },

  refresh: async () => {
    const client = get().client;
    if (!client) return;
    // Goes through the same typed restore path, so a transient backend failure
    // here can't silently demote a signed-in user to signed out either.
    await runRestore(client, set);
  },

  setActiveWallet: async (walletId) => {
    const client = get().client;
    if (!client) return;
    try {
      await client.setActiveWallet(walletId);
      const wallets = await client.listWallets();
      set({ wallets: wallets.wallets, accountErrorCode: null });
    } catch (err) {
      set({ accountErrorCode: codeOf(err) });
    }
  },

  revokeWallet: async (walletId) => {
    const client = get().client;
    if (!client) return;
    try {
      await client.revokeWallet(walletId);
      const wallets = await client.listWallets();
      set({ wallets: wallets.wallets, accountErrorCode: null });
    } catch (err) {
      set({ accountErrorCode: codeOf(err) });
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
      if (isAuthLost(err)) return set({ ...SIGNED_OUT_STATE, accountErrorCode: codeOf(err) });
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
      if (isAuthLost(err)) return set({ ...SIGNED_OUT_STATE, accountErrorCode: codeOf(err) });
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
      if (isAuthLost(err)) return set({ ...SIGNED_OUT_STATE, accountErrorCode: codeOf(err) });
      set({ pendingSessionAction: null, sessionsStatus: "error", sessionsErrorCode: codeOf(err) });
    }
  },

  signOut: async () => {
    const client = get().client;
    try {
      await client?.signOut();
      set({ ...SIGNED_OUT_STATE, accountErrorCode: null });
    } catch (err) {
      // The UI state is cleared regardless, but a failed credential clear is
      // surfaced honestly — never silently reported as a clean sign-out.
      set({ ...SIGNED_OUT_STATE, accountErrorCode: codeOf(err) });
    }
  },

  signOutEverywhere: async () => {
    const client = get().client;
    try {
      await client?.signOutEverywhere();
      set({ ...SIGNED_OUT_STATE, accountErrorCode: null });
    } catch (err) {
      set({ ...SIGNED_OUT_STATE, accountErrorCode: codeOf(err) });
    }
  },
}));
