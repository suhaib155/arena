/** Process-local cancellation authority. It stores no credentials or route data. */
export interface VerificationScope {
  readonly generation: number;
  readonly ownerUserId: string | null;
}

let generation = 0;
let account: string | null | undefined;
const resetListeners = new Set<() => void>();

export function verificationGeneration(): number { return generation; }

export function captureVerificationScope(ownerUserId: string | null): VerificationScope {
  return { generation, ownerUserId };
}

export function isVerificationScopeCurrent(scope: VerificationScope): boolean {
  return scope.generation === generation &&
    (account === undefined || scope.ownerUserId === null || scope.ownerUserId === account);
}

/** undefined is bootstrap-only: a restored account may keep its bounded queue.
 * Once resolved, stale closures naming a former account cannot start uploads. */
export function setVerificationAccount(ownerUserId: string | null): void {
  if (account !== undefined && account !== ownerUserId) invalidateVerificationPrivacy();
  account = ownerUserId;
}

export function resetVerificationAccountForTests(): void { account = undefined; }

/** Invalidates work synchronously, before any storage or network await. */
export function invalidateVerificationPrivacy(): void {
  generation += 1;
  for (const erase of resetListeners) erase();
}

/** Active in-memory evidence owners register their bounded erasure here. */
export function onVerificationPrivacyReset(erase: () => void): () => void {
  resetListeners.add(erase);
  return () => { resetListeners.delete(erase); };
}
