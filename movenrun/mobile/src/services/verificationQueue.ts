/** Bounded, account-scoped temporary verification storage. No encryption claim:
 * the production adapter is app-private storage. Expiry is enforced on access,
 * not by a background erasure service while the app is stopped. */
import {
  MAX_PENDING_ITEMS, parseQueue, serializeQueue, upsertPending,
  type PendingVerificationItem,
} from "@/lib/pendingVerification";
import {
  captureVerificationScope, invalidateVerificationPrivacy,
  isVerificationScopeCurrent,
} from "./verificationPrivacy";

export interface VerificationQueueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}
export const VERIFICATION_QUEUE_KEY = "movenrun-verification-retry-v1";
let store: VerificationQueueStore | null = null;
let serial: Promise<unknown> = Promise.resolve();
function serialize<T>(work: () => Promise<T>): Promise<T> {
  const operation = serial.then(work, work);
  serial = operation.catch(() => {});
  return operation;
}
export function installVerificationQueueStore(next: VerificationQueueStore | null): void { store = next; }
export function getVerificationQueueStore(): VerificationQueueStore | null { return store; }
async function read(adapter: VerificationQueueStore): Promise<PendingVerificationItem[]> {
  try { return parseQueue(await adapter.getItem(VERIFICATION_QUEUE_KEY)); }
  catch { return []; }
}
async function write(adapter: VerificationQueueStore, items: readonly PendingVerificationItem[]): Promise<void> {
  if (items.length === 0) {
    try { await adapter.removeItem(VERIFICATION_QUEUE_KEY); }
    catch {
      // Failed deletion can still be neutralised by overwriting with no GPS.
      await adapter.setItem(VERIFICATION_QUEUE_KEY, serializeQueue([]));
    }
  } else {
    await adapter.setItem(VERIFICATION_QUEUE_KEY, serializeQueue(items.slice(0, MAX_PENDING_ITEMS)));
  }
}
export function loadPendingQueue(scope = captureVerificationScope(null)): Promise<PendingVerificationItem[]> {
  const adapter = store;
  return serialize(async () => {
    if (!adapter || !isVerificationScopeCurrent(scope)) return [];
    const items = await read(adapter);
    if (!isVerificationScopeCurrent(scope)) return [];
    // Drop malformed entries durably as well as refusing to submit them.
    try { await write(adapter, items); } catch { /* No raw-data diagnostics. */ }
    return isVerificationScopeCurrent(scope) ? items : [];
  });
}
export function savePendingItem(item: PendingVerificationItem, scope = captureVerificationScope(item.ownerUserId)): Promise<void> {
  const adapter = store;
  return serialize(async () => {
    if (!adapter || !isVerificationScopeCurrent(scope) || scope.ownerUserId !== item.ownerUserId) return;
    const queue = await read(adapter);
    if (!isVerificationScopeCurrent(scope)) return;
    try { await write(adapter, upsertPending(queue, item)); } catch { /* Durability unavailable. */ }
  });
}
export function removePendingItem(clientSessionId: string, scope = captureVerificationScope(null)): Promise<void> {
  const adapter = store;
  return serialize(async () => {
    if (!adapter || !isVerificationScopeCurrent(scope)) return;
    const queue = await read(adapter);
    if (!isVerificationScopeCurrent(scope)) return;
    const next = queue.filter((i) => i.clientSessionId !== clientSessionId ||
      (scope.ownerUserId !== null && i.ownerUserId !== scope.ownerUserId));
    try { await write(adapter, next); } catch { /* Durability unavailable. */ }
  });
}
/** Invalidation is synchronous. Removal is ordered after any already-started
 * write and before later-generation writes. Await for a durable checkpoint;
 * total storage failure rejects instead of claiming erasure. */
export function clearPendingQueue(): Promise<void> {
  invalidateVerificationPrivacy();
  const adapter = store;
  return serialize(async () => { if (adapter) await write(adapter, []); });
}
export function discardPendingVerifications(): Promise<void> {
  const clearing = clearPendingQueue();
  // Synchronous auth transitions may intentionally ignore the result; explicit
  // reset/sign-out actions await it before claiming durable erasure.
  void clearing.catch(() => {});
  return clearing;
}
