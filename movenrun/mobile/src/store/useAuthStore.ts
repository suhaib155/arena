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
import { clearPendingQueue, discardPendingVerifications } from "@/services/verificationQueue";
import { setVerificationAccount } from "@/services/verificationPrivacy";
import {
  createIdentityApiClient,
  IdentityApiClient,
  IdentityApiError,
  type LoginResult,
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

const SIGNED_OUT_BASE = {
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
 * The one transition into signed-out.
 *
 * Every path that lands here — an explicit sign-out, sign-out-everywhere, a
 * restore that resolved to "no session", and any 401 that means the credential
 * is gone — must also discard queued movement-verification retries, because
 * those hold precise route observations bound to the account that is leaving.
 *
 * Doing it in a helper rather than at each `set` site is the point: there were
 * eight of those, and "remember to also clear the queue" at eight call sites is
 * a policy that lasts until the ninth. A source guard asserts `SIGNED_OUT_BASE`
 * is never spread anywhere but here.
 *
 * The policy is DISCARD, not retain-for-later. Keeping an unsent route across a
 * sign-out would mean holding someone's location after they left the account,
 * with only an ownership check standing between it and the next person to sign
 * in on that device — and if the same person signs back in, all they have lost
 * is a server measurement of a workout they still have. That is the cheaper
 * mistake by a wide margin.
 */
function signedOut<T extends object>(patch: T): typeof SIGNED_OUT_BASE & T {
  setVerificationAccount(null);
  discardPendingVerifications();
  return { ...SIGNED_OUT_BASE, ...patch };
}

/**
 * Monotonic session generation.
 *
 * Bumped whenever the authenticated identity changes (a login commits, a
 * restore resolves, a sign-out lands). Background work captures the generation
 * it started under and refuses to apply its result once the store has moved on
 * — so a slow account-sync response cannot resurrect a signed-out user, and a
 * first user's data can never land on top of a second user's session.
 */
let sessionGeneration = 0;

function beginSessionGeneration(): number {
  sessionGeneration += 1;
  return sessionGeneration;
}

/**
 * Post-login account synchronisation — enrichment, NOT authentication.
 *
 * By the time this runs the user is already signed in: the server confirmed the
 * login and the tokens are in the keystore. These reads only replace the seeded
 * public state with the server's full view, so a transient failure here must
 * never bounce the user back to code entry — and must never discard a session
 * the device legitimately holds.
 *
 * It never throws, and it applies nothing once its session generation has been
 * superseded.
 */
async function syncAccountState(
  client: IdentityApiClient,
  generation: number,
  set: (partial: Partial<AuthState>) => void,
  get: () => AuthState,
): Promise<void> {
  const stillCurrent = () => sessionGeneration === generation && get().status === "signedIn";
  try {
    // Both reads share the client's single-flight refresh, so they cannot
    // rotate the refresh token twice.
    const [me, wallets] = await Promise.all([client.me(), client.listWallets()]);
    if (!stillCurrent()) return; // superseded — discard, never resurrect
    set({
      user: me.user,
      identities: me.identities,
      wallets: wallets.wallets,
      accountErrorCode: null,
    });
  } catch (err) {
    if (!stillCurrent()) return;
    if (isAuthLost(err)) {
      /* The server says this session is gone. The client has already cleared
         the credentials, so runtime state falls closed too — this is the one
         enrichment failure that IS authoritative. */
      beginSessionGeneration();
      set(signedOut({ lastRestore: "rejected", accountErrorCode: codeOf(err) }));
      return;
    }
    /* Transient: the sign-in stands, the secure session stands, and the seeded
       account state stays. Only a stable sync code is surfaced. */
    set({ accountErrorCode: "account_sync_unavailable" });
  }
}

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
    beginSessionGeneration();
    set({
      status,
      operation: "idle",
      lastRestore: outcome.kind,
      user: outcome.user,
      identities: outcome.identities,
      wallets: outcome.wallets,
      restoreErrorCode: null,
      accountErrorCode: null,
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
      // Carries WHY: an unreachable backend and an unreadable keystore get
      // different (still stable, still public) copy.
      restoreErrorCode: restoreErrorCode(outcome.kind, outcome.code),
    });
    return;
  }
  beginSessionGeneration();
  set(signedOut({ lastRestore: outcome.kind, restoreErrorCode: null }));
}

/**
 * Restore lifecycle — three separate facts, never overlapping booleans:
 *
 *  - `initialized`     : automatic startup initialization has already run for
 *                        this app process, so the bootstrap effect is a no-op.
 *  - `restoreInFlight` : a restore is running RIGHT NOW, whoever started it.
 *  - `operation`       : an OTP send/verify is running (store state, above).
 *
 * One boolean used to stand in for the first two, which is how two rapid Retry
 * taps could start two concurrent `restoreSession()` calls: single-flight
 * refresh stopped the token being rotated twice, but the duplicate restores
 * still raced their outcomes into the store in arbitrary order.
 */
let initialized = false;
let restoreInFlight: Promise<void> | null = null;

/**
 * Run `work` as the one active restore. Callers arriving while a restore is
 * running share it — and therefore share its outcome — so two results can never
 * be applied out of order. The slot is released when the flight settles, and
 * only if it still holds that flight, so a later explicit Retry starts a new one.
 */
function restoreSingleFlight(work: () => Promise<void>): Promise<void> {
  const existing = restoreInFlight;
  if (existing) return existing;
  const run = work().finally(() => {
    if (restoreInFlight === run) restoreInFlight = null;
  });
  restoreInFlight = run;
  return run;
}

/**
 * Forget the process-level restore lifecycle so the next `initialize()` runs
 * again. Used ONLY by tests, which drive several independent bootstrap
 * scenarios through one module instance; app code never calls it.
 */
export function resetAuthBootstrapForTests(): void {
  initialized = false;
  restoreInFlight = null;
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

/**
 * Resolve THE identity client, or record why it is impossible. Never throws.
 * Shared by bootstrap and Retry so client construction stays centralised.
 */
function resolveClient(
  set: (partial: Partial<AuthState>) => void,
  get: () => AuthState,
): IdentityApiClient | null {
  // Construction itself can throw (the secure-store registry refuses to hand
  // out an uninstalled store), so it is guarded too.
  let client: IdentityApiClient | null;
  try {
    client = get().client ?? createIdentityApiClient();
  } catch {
    set({
      status: "unknown",
      operation: "idle",
      lastRestore: "unavailable",
      restoreErrorCode: "secure_storage_unavailable",
    });
    return null;
  }
  if (!client) {
    // No backend is configured: nothing can be restored and nothing can be
    // signed into. That is a *confirmed* signed-out state, not an unknown one.
    beginSessionGeneration();
    set({
      client: null,
      status: "signedOut",
      operation: "idle",
      lastRestore: "no-session",
      restoreErrorCode: null,
    });
    return null;
  }
  return client;
}

/** Build the client (once) and restore. Never rejects. */
async function bootstrap(
  set: (partial: Partial<AuthState>) => void,
  get: () => AuthState,
): Promise<void> {
  const client = resolveClient(set, get);
  if (!client) return;
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
    /* Automatic startup initialization runs once per process. Concurrent
       callers (a remount, fast refresh, a second screen) share the SAME
       restore; an explicit Retry is the path back after a recoverable
       failure, so this does not need to re-arm itself. */
    if (initialized) return;
    return restoreSingleFlight(async () => {
      try {
        await bootstrap(set, get);
      } finally {
        initialized = true;
      }
    });
  },

  retryRestore: async () => {
    if (get().operation !== "idle") return; // never race an in-flight auth request
    // Repeated Retry taps share the one active restore.
    return restoreSingleFlight(async () => {
      const client = resolveClient(set, get);
      if (!client) return;
      set({ client, status: "restoring", restoreErrorCode: null, restoreErrorAcknowledged: false });
      await guardedRestore(client, set);
    });
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

    let result: LoginResult;
    try {
      // Resolves only when the server confirmed the login AND the session was
      // persisted; the client turns a failed persist into a typed code.
      result = await client.completeEmailOtp(email, code, deviceLabel);
    } catch (err) {
      /* Back to idle with a form-owned error, so the code field stays editable
         and the user can correct it. `status` is deliberately NOT rewritten: a
         wrong code says nothing about whether a stored session exists, and
         these actions already refuse to run while signed in. No partial
         identity state is set, because nothing was committed. */
      set({ operation: "idle", authErrorCode: codeOf(err) });
      return false;
    }

    /* ── AUTHENTICATION COMMIT POINT ──────────────────────────────────────
       The server confirmed the login and the tokens are in the keystore. The
       device now holds a valid authenticated session, so the UI must say so
       BEFORE any optional read. Waiting for /identity/me and /identity/wallets
       first meant a transient read failure left the app claiming sign-in had
       failed while valid credentials sat on the device — and the one-time code
       was already spent, so the user could not even retry. */
    const generation = beginSessionGeneration();
    set({
      status: "signedIn",
      operation: "idle",
      // `result.user` is the server's authoritative answer for who signed in.
      user: result.user,
      // Identities arrive with the sync below; the login response carries none.
      identities: [],
      // Seed from the login response so the wallet section is never empty-by-
      // accident; the sync replaces it with the server's full list.
      wallets: result.embeddedWallet ? [result.embeddedWallet] : [],
      authErrorCode: null,
      restoreErrorCode: null,
      accountErrorCode: null,
      lastRestore: "restored",
    });

    // Enrichment only — it can refine or (on an authoritative 401) close the
    // session, but it can never turn this successful sign-in into a failure.
    await syncAccountState(client, generation, set, get);
    return true;
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
      if (isAuthLost(err)) return set(signedOut({ accountErrorCode: codeOf(err) }));
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
      if (isAuthLost(err)) return set(signedOut({ accountErrorCode: codeOf(err) }));
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
      if (isAuthLost(err)) return set(signedOut({ accountErrorCode: codeOf(err) }));
      set({ pendingSessionAction: null, sessionsStatus: "error", sessionsErrorCode: codeOf(err) });
    }
  },

  signOut: async () => {
    setVerificationAccount(null);
    const client = get().client;
    const clearing = clearPendingQueue();
    void clearing.catch(() => {});
    // Supersede any in-flight enrichment so a late response cannot resurrect
    // the user or their wallets after this sign-out lands.
    const generation = beginSessionGeneration();
    try {
      await client?.signOut();
      await clearing;
      if (generation !== sessionGeneration) return;
      set(signedOut({ accountErrorCode: null }));
    } catch (err) {
      // The UI state is cleared regardless, but a failed credential clear is
      // surfaced honestly — never silently reported as a clean sign-out.
      if (generation !== sessionGeneration) return;
      set(signedOut({ accountErrorCode: codeOf(err) }));
    }
  },

  signOutEverywhere: async () => {
    setVerificationAccount(null);
    const client = get().client;
    const clearing = clearPendingQueue();
    void clearing.catch(() => {});
    const generation = beginSessionGeneration();
    try {
      await client?.signOutEverywhere();
      await clearing;
      if (generation !== sessionGeneration) return;
      set(signedOut({ accountErrorCode: null }));
    } catch (err) {
      if (generation !== sessionGeneration) return;
      set(signedOut({ accountErrorCode: codeOf(err) }));
    }
  },
}));

useAuthStore.subscribe((state) => {
  if (state.status === "signedIn" && state.user) setVerificationAccount(state.user.id);
});
