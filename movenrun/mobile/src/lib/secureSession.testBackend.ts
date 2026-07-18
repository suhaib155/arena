/**
 * TEST-ONLY in-memory SecureKeyValueBackend.
 *
 * Never imported by production code — the guard test in
 * src/lib/__tests__/secureSession.test.ts scans mobile/src and fails if any
 * non-test module imports this file. Production uses the expo-secure-store
 * adapter (secureSessionExpo.ts) exclusively; there is no in-memory fallback
 * path in the app.
 *
 * The optional failure switches simulate an unavailable/failing keystore so
 * tests can prove the fail-closed behavior of the core.
 */
import type { SecureKeyValueBackend } from "./secureSession";

export interface TestBackendOptions {
  failGet?: boolean;
  failSet?: boolean;
  failDelete?: boolean;
}

export function createTestSecureBackend(opts: TestBackendOptions = {}): SecureKeyValueBackend & {
  readonly map: Map<string, string>;
  options: TestBackendOptions;
} {
  const map = new Map<string, string>();
  const options = { ...opts };
  return {
    map,
    options,
    async getItem(key) {
      if (options.failGet) throw new Error("secure store unavailable");
      return map.get(key) ?? null;
    },
    async setItem(key, value) {
      if (options.failSet) throw new Error("secure store write failure");
      map.set(key, value);
    },
    async deleteItem(key) {
      if (options.failDelete) throw new Error("secure store delete failure");
      map.delete(key);
    },
  };
}
