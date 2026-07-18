/**
 * Production secure-session adapter: OS keystore/keychain via expo-secure-store
 * (ADR-0012). This is the ONLY module that touches the native secure storage
 * API; everything above it goes through the platform-free core in
 * secureSession.ts, so the lifecycle rules (validation, expiry, fail-closed)
 * are identical in production and in tests.
 *
 * expo-secure-store encrypts values with the platform keystore (Android
 * Keystore / iOS Keychain). Nothing here — and nothing anywhere in the app —
 * writes session credentials to AsyncStorage or persisted Zustand.
 *
 * Installed once at app startup (app/_layout.tsx). Until installed, the
 * registry in secureSession.ts throws — there is no insecure fallback.
 */
import * as SecureStore from "expo-secure-store";
import {
  createSecureSessionStore,
  setSecureSessionStore,
  type SecureKeyValueBackend,
} from "./secureSession";

const expoBackend: SecureKeyValueBackend = {
  async getItem(key) {
    return SecureStore.getItemAsync(key);
  },
  async setItem(key, value) {
    await SecureStore.setItemAsync(key, value);
  },
  async deleteItem(key) {
    await SecureStore.deleteItemAsync(key);
  },
};

/** Wire the keystore-backed store as the app-wide secure session store. */
export function installExpoSecureSessionStore(): void {
  setSecureSessionStore(createSecureSessionStore(expoBackend));
}
