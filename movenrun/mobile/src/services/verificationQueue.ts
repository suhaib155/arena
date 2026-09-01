/**
 * Durable storage for movement sessions awaiting a verification retry.
 *
 * This is the app's ONLY durable store of precise coordinates, and it exists
 * under protest: `RouteTrustRecord` keeps no coordinates, `FinishedSession`
 * lives in memory only, and Task 4's `VerifiedMovementRecord` keeps a traversed
 * hex *count* rather than a trail — so there was no existing durable copy of a
 * route to point a retry at, and a retry that survives a restart has to hold
 * the observations itself.
 *
 * Everything below follows from treating that as a liability to be bounded
 * rather than a feature to be grown:
 *
 *   - its own storage key, NOT the game store. The game store survives sign-out
 *     by design (local progress is not account-bound) and has no retention
 *     policy, both of which are exactly wrong for unsent GPS. A separate key
 *     gets a lifecycle of its own and can be deleted in one call.
 *   - the store is INJECTED. Nothing here imports AsyncStorage, so the whole
 *     retry path is provable off-device, and an app that never installs an
 *     adapter simply does not persist rather than crashing.
 *   - it fails closed. A missing adapter, an unreadable file, a corrupt entry
 *     and an unknown schema version all resolve to "no pending work".
 *
 * ## What this does not do
 *
 * It never reads workout history, route-trust history, zones, or any other
 * existing record. The only way an item enters this queue is a submission that
 * ran and failed, carrying observations that were in memory at the time. There
 * is deliberately no code path from a stored session to a new upload, which is
 * what makes "old workouts are never silently uploaded" a structural property
 * rather than a promise.
 *
 * ## Encryption
 *
 * None is claimed. The production adapter is AsyncStorage, which is unencrypted
 * app-private storage on both platforms — it is protected by the OS sandbox and
 * by full-device encryption where the user has it, and by nothing else. Secure
 * storage in this app (`expo-secure-store`) is reserved for credentials and is
 * not used here. That is precisely why the retention and attempt bounds are
 * short: the mitigation for "not encrypted at rest" is "not there for long".
 */
import {
  MAX_PENDING_ITEMS,
  parseQueue,
  serializeQueue,
  upsertPending,
  type PendingVerificationItem,
} from "@/lib/pendingVerification";

/** The minimum a key/value store must do. Deliberately not AsyncStorage's whole
 *  surface — this module has no business clearing or enumerating anything else. */
export interface VerificationQueueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * Versioned in the key itself as well as in the envelope. If a future schema is
 * ever incompatible enough to need a new key, the old one is abandoned rather
 * than migrated: there is no user value in resurrecting a week-old unsent route,
 * and a migration is exactly the kind of code that accidentally enrols history.
 */
export const VERIFICATION_QUEUE_KEY = "movenrun-verification-retry-v1";

let store: VerificationQueueStore | null = null;

/**
 * Install the durable store. Called once at startup by the app; tests install a
 * fake. Passing `null` disables persistence entirely — a legitimate state, not
 * an error: verification still works, it just does not survive a restart.
 */
export function installVerificationQueueStore(next: VerificationQueueStore | null): void {
  store = next;
}

/** Test seam and app teardown. */
export function getVerificationQueueStore(): VerificationQueueStore | null {
  return store;
}

/**
 * Read the queue.
 *
 * Every failure mode — no adapter, unreadable storage, unparseable JSON, an
 * item that fails validation — produces an empty or shortened queue and never
 * an exception. Corrupt contents are dropped silently and are deliberately NOT
 * logged: a malformed GPS trace has no diagnostic value worth copying it into a
 * log buffer for.
 */
export async function loadPendingQueue(): Promise<PendingVerificationItem[]> {
  if (!store) return [];
  try {
    return parseQueue(await store.getItem(VERIFICATION_QUEUE_KEY));
  } catch {
    return [];
  }
}

async function writeQueue(items: readonly PendingVerificationItem[]): Promise<void> {
  if (!store) return;
  try {
    if (items.length === 0) {
      await store.removeItem(VERIFICATION_QUEUE_KEY);
      return;
    }
    await store.setItem(VERIFICATION_QUEUE_KEY, serializeQueue(items.slice(0, MAX_PENDING_ITEMS)));
  } catch {
    /* Storage refused the write. The in-memory verification state is already
       honest ("pending"), so the only thing lost is durability across restart —
       which is strictly the safe direction to fail in. */
  }
}

/** Insert or replace one item, keeping the queue bounded. */
export async function savePendingItem(item: PendingVerificationItem): Promise<void> {
  await writeQueue(upsertPending(await loadPendingQueue(), item));
}

/** Remove one session's observations. Called the moment they stop being needed:
 *  a verdict arrived, the failure turned out to be terminal, or the item died. */
export async function removePendingItem(clientSessionId: string): Promise<void> {
  const queue = await loadPendingQueue();
  const next = queue.filter((i) => i.clientSessionId !== clientSessionId);
  if (next.length === queue.length) return;
  await writeQueue(next);
}

/**
 * Delete every queued route.
 *
 * The logout and account-reset path. It removes the key rather than filtering
 * it, so nothing account-shaped is left behind to be reasoned about later, and
 * it runs even when the caller has no idea what is in there.
 */
export async function clearPendingQueue(): Promise<void> {
  if (!store) return;
  try {
    await store.removeItem(VERIFICATION_QUEUE_KEY);
  } catch {
    /* Best effort. The owner check is what actually prevents cross-account
       submission; this is the data-minimisation half of the policy. */
  }
}

/**
 * Fire-and-forget discard, for call sites that are synchronous by nature.
 *
 * Sign-out cannot wait on storage and must not fail because of it: the user is
 * signed out either way, and an unresolved promise here would be a rejection
 * nobody handles.
 */
export function discardPendingVerifications(): void {
  void clearPendingQueue();
}
