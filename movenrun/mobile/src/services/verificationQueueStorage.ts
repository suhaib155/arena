/**
 * Production adapter for the verification retry queue: AsyncStorage.
 *
 * Kept in its own file, and imported by exactly one call site (the root
 * layout), so that `verificationQueue.ts` — and therefore the entire retry
 * policy — stays free of React Native imports and provable in a plain Node
 * test run. Nothing in `src/lib` or `src/services` may import this.
 *
 * ## What this storage does and does not give us
 *
 * AsyncStorage is app-private, unencrypted key/value storage. On Android it is
 * a SQLite file inside the app sandbox; on iOS a file in the app container.
 * That means:
 *
 *   - other apps cannot read it,
 *   - full-device encryption protects it at rest *if the user has a passcode*,
 *   - a rooted/jailbroken device, a backup, or a forensic image can read it.
 *
 * So this is NOT encrypted-at-rest storage and this module claims no such
 * thing. Credentials live in `expo-secure-store` (the OS keystore) and are
 * never written here; see `secureSession.ts`. The mitigation for holding
 * coordinates in unencrypted storage is that they are held briefly and in small
 * numbers — see `MAX_PENDING_AGE_MS`, `MAX_ATTEMPTS` and `MAX_PENDING_ITEMS`.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  installVerificationQueueStore,
  type VerificationQueueStore,
} from "./verificationQueue";

const asyncStorageAdapter: VerificationQueueStore = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

/** Called once at startup, before anything can queue a retry. */
export function installAsyncVerificationQueueStore(): void {
  installVerificationQueueStore(asyncStorageAdapter);
}
