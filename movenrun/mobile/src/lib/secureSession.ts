/**
 * Secure session storage — pure core + fail-closed registry (ADR-0012).
 *
 * The production adapter (secureSessionExpo.ts) stores tokens in the OS
 * keystore/keychain via expo-secure-store; this module is deliberately free of
 * ANY platform import so the validation/lifecycle logic is unit-testable
 * offline and can never drag native modules into node test runs.
 *
 * Hard rules:
 *  - Session credentials are NEVER written to AsyncStorage or persisted
 *    Zustand, never logged, never sent to analytics/crash reporting.
 *  - Storage keys are namespaced and versioned (SESSION_STORAGE_KEY).
 *  - Fail closed: a read failure yields "no session" (deny → re-auth); a
 *    write/clear failure propagates so callers never believe a persist/clear
 *    happened when it didn't. There is NO fallback to insecure storage.
 *  - Malformed or expired stored data is deleted, not returned.
 *  - The registry throws until an adapter is installed — an uninstalled store
 *    can never silently degrade to something insecure.
 *  - Only the minimum session material is persisted (the four token fields);
 *    no profile, wallet state, permissions, audit data, or any secret beyond
 *    the session credentials themselves. The server stays authoritative.
 */

export interface SecureSessionTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface SecureSessionStore {
  save(tokens: SecureSessionTokens): Promise<void>;
  load(): Promise<SecureSessionTokens | null>;
  clear(): Promise<void>;
}

/** Minimal async key-value surface a platform adapter must provide. The
 *  production backend is the OS keystore via expo-secure-store. */
export interface SecureKeyValueBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

/** Namespaced + versioned storage key. Bump the version only with an explicit,
 *  documented migration (ADR-0012 "Upgrade behavior"). */
export const SESSION_STORAGE_KEY = "movenrun.session.v1";

function isValidTokens(value: unknown): value is SecureSessionTokens {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const fields = ["accessToken", "accessTokenExpiresAt", "refreshToken", "refreshTokenExpiresAt"] as const;
  if (!fields.every((f) => typeof v[f] === "string" && (v[f] as string).length > 0)) return false;
  // Reject any extra field: only the minimum session material may persist.
  if (Object.keys(v).length !== fields.length) return false;
  return !Number.isNaN(new Date(v.refreshTokenExpiresAt as string).getTime());
}

/**
 * Build a SecureSessionStore over a platform backend. All lifecycle rules
 * (validation, expiry, malformed deletion, fail-closed behavior) live here so
 * every adapter — production keystore or test backend — behaves identically.
 */
export function createSecureSessionStore(
  backend: SecureKeyValueBackend,
  now: () => Date = () => new Date()
): SecureSessionStore {
  return {
    async save(tokens) {
      // Propagates backend failures: a failed write must never be mistaken
      // for a persisted session.
      await backend.setItem(SESSION_STORAGE_KEY, JSON.stringify(tokens));
    },

    async load() {
      let raw: string | null;
      try {
        raw = await backend.getItem(SESSION_STORAGE_KEY);
      } catch {
        // Storage unavailable → fail closed as "no session" (deny; the user
        // re-authenticates). Never guess, never fall back to insecure storage.
        return null;
      }
      if (raw === null) return null;

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        await safeDelete(backend);
        return null;
      }
      if (!isValidTokens(parsed)) {
        await safeDelete(backend);
        return null;
      }
      if (new Date(parsed.refreshTokenExpiresAt).getTime() <= now().getTime()) {
        // Expired session material is dead weight and a theft target — delete.
        await safeDelete(backend);
        return null;
      }
      return parsed;
    },

    async clear() {
      // Propagates backend failures: callers must know credentials may remain
      // on the device (fail closed — never report a clear that didn't happen).
      await backend.deleteItem(SESSION_STORAGE_KEY);
    },
  };
}

/** Deleting corrupt data is best-effort — the value is already unusable, and a
 *  delete failure must not turn a defensive cleanup into a crash. */
async function safeDelete(backend: SecureKeyValueBackend): Promise<void> {
  try {
    await backend.deleteItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignored by design: load() still returns null (fail closed).
  }
}

let _store: SecureSessionStore | null = null;

/**
 * App-wide store accessor. THROWS until an adapter is installed (the app root
 * installs the expo-secure-store adapter at startup; tests install a
 * memory-backed one). The absence of any default is deliberate: there is no
 * code path that silently falls back to non-secure storage.
 */
export function getSecureSessionStore(): SecureSessionStore {
  if (!_store) {
    throw new Error(
      "secure session store not installed — call installExpoSecureSessionStore() (app) or setSecureSessionStore() (tests) first"
    );
  }
  return _store;
}

/** Install an adapter (expo keystore in the app; memory-backed in tests). */
export function setSecureSessionStore(store: SecureSessionStore): void {
  _store = store;
}
