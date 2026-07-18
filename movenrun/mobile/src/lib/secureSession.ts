/**
 * Secure storage abstraction for session credentials.
 *
 * Hard rule (ADR-0006 / mobile security requirements): session tokens are
 * NEVER written to AsyncStorage or persisted Zustand — those are unencrypted on
 * device. Tokens live only behind this abstraction, whose production adapter is
 * the OS keystore/keychain via `expo-secure-store`.
 *
 * `expo-secure-store` is intentionally NOT added as a dependency in this PR
 * (the app doesn't yet have a live backend to authenticate against, and the
 * repo adds dependencies deliberately). The default adapter below keeps tokens
 * in memory only — they never touch disk — so nothing insecure ships. Wiring
 * the real keystore adapter is a one-file follow-up:
 *
 *   import * as SecureStore from "expo-secure-store";
 *   const KEY = "movenrun.session";
 *   export const keychainStore: SecureSessionStore = {
 *     async save(t) { await SecureStore.setItemAsync(KEY, JSON.stringify(t)); },
 *     async load()  { const raw = await SecureStore.getItemAsync(KEY); return raw ? JSON.parse(raw) : null; },
 *     async clear() { await SecureStore.deleteItemAsync(KEY); },
 *   };
 *
 * There is deliberately NO API here for a seed phrase or private key — MovenRun
 * never receives wallet secret material (ADR-0008).
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

/**
 * In-memory default. Tokens are held only for the lifetime of the JS runtime
 * and never written to disk — safe, if non-persistent across app restarts (the
 * user re-authenticates). Swap for the keystore adapter above to persist
 * securely.
 */
function createInMemorySecureStore(): SecureSessionStore {
  let tokens: SecureSessionTokens | null = null;
  return {
    async save(next) {
      tokens = next;
    },
    async load() {
      return tokens;
    },
    async clear() {
      tokens = null;
    },
  };
}

let _store: SecureSessionStore | null = null;

/** The app-wide secure session store. */
export function getSecureSessionStore(): SecureSessionStore {
  if (!_store) _store = createInMemorySecureStore();
  return _store;
}

/** Override the store (e.g. to install the keystore adapter, or in tests). */
export function setSecureSessionStore(store: SecureSessionStore): void {
  _store = store;
}
