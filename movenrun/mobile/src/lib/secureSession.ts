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
 *  - Fail closed: a read failure grants NO access, and a write/clear failure
 *    propagates so callers never believe a persist/clear happened when it
 *    didn't. There is NO fallback to insecure storage. Every such failure is
 *    reported as a typed {@link SecureSessionStorageError} — "unreadable" is
 *    deliberately distinguishable from "absent", because only the second is
 *    evidence that a session does not exist.
 *  - Malformed or expired stored data is deleted, not returned.
 *  - The registry throws until an adapter is installed — an uninstalled store
 *    can never silently degrade to something insecure.
 *  - Only the minimum session material is persisted (the four token fields);
 *    no profile, wallet state, permissions, audit data, or any secret beyond
 *    the session credentials themselves. The server stays authoritative.
 */

/** Why a secure-storage operation could not complete. */
export type SecureSessionStorageErrorCode =
  /** The keystore could not be READ. This is NOT evidence of "no session". */
  | "read_unavailable"
  /** The keystore could not be written — a persist did not happen. */
  | "write_failed"
  /** An explicit credential delete did not happen. */
  | "clear_failed";

/**
 * A typed storage failure.
 *
 * The distinction this class exists to make: "there is no credential" and "the
 * keystore could not be read" are different facts. Collapsing the second into
 * `null` let a transient keystore hiccup surface as an unauthenticated request,
 * which the restore path then classified as a REJECTED session — and rejected
 * sessions get deleted. A failure to read must never be able to destroy a valid
 * credential.
 *
 * It carries no token material and no platform exception text, so it is safe to
 * let it travel up to the classification layer.
 */
export class SecureSessionStorageError extends Error {
  readonly code: SecureSessionStorageErrorCode;
  constructor(code: SecureSessionStorageErrorCode) {
    super(`secure session storage ${code}`);
    this.name = "SecureSessionStorageError";
    this.code = code;
  }
}

export function isSecureSessionStorageError(err: unknown): err is SecureSessionStorageError {
  return err instanceof SecureSessionStorageError;
}

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

/**
 * Non-secret marker written when a credential must be destroyed but the
 * backend's delete failed.
 *
 * Leaving the record intact in that case is not merely untidy: the credential
 * being cleared is a SPENT one, so the next launch would load it and present it
 * to the refresh endpoint — which the server treats as a replay and answers by
 * revoking the entire session family, signing the user out on every device.
 * `load()` accepts only a record consisting of exactly the four token fields,
 * so overwriting with this marker makes the credential unloadable (and the
 * marker itself is then cleaned up on the next read). It contains no token
 * material and no user data.
 */
const CLEARED_TOMBSTONE = JSON.stringify({ cleared: true });

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
      // Propagates as a TYPED failure: a failed write must never be mistaken
      // for a persisted session.
      try {
        await backend.setItem(SESSION_STORAGE_KEY, JSON.stringify(tokens));
      } catch {
        throw new SecureSessionStorageError("write_failed");
      }
    },

    async load() {
      let raw: string | null;
      try {
        raw = await backend.getItem(SESSION_STORAGE_KEY);
      } catch {
        /* Still fail closed — no access is granted and there is no fallback to
           insecure storage — but the caller is told WHY. Returning `null` here
           used to make an unreadable keystore indistinguishable from an empty
           one, so a transient read failure could be classified as a rejected
           session and delete valid credentials. */
        throw new SecureSessionStorageError("read_unavailable");
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

    /**
     * Destroy the stored credential.
     *
     * Deleting is the normal path. If the backend refuses to delete, the record
     * is overwritten with a non-secret tombstone so the credential still cannot
     * be loaded again — see {@link CLEARED_TOMBSTONE} for why leaving a spent
     * credential readable is dangerous rather than merely untidy. Only when
     * BOTH the delete and the overwrite fail does this report failure, so a
     * caller never believes a clear happened when the credential is still
     * usable.
     */
    async clear() {
      try {
        await backend.deleteItem(SESSION_STORAGE_KEY);
        return;
      } catch {
        // Fall through to the tombstone attempt below.
      }
      try {
        await backend.setItem(SESSION_STORAGE_KEY, CLEARED_TOMBSTONE);
      } catch {
        // Nothing worked: fail closed and TELL the caller (typed, never silent).
        throw new SecureSessionStorageError("clear_failed");
      }
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
