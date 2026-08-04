/**
 * App-level bootstrap — the one place startup decides anything.
 *
 * Kicks off identity initialization exactly once (which constructs the single
 * identity client and restores any stored session), then folds gameplay
 * hydration, auth lifecycle, first-run state, and build configuration into one
 * {@link StartupDecision} via a pure function. Screens never build a client and
 * never re-derive the startup route.
 *
 * No secret ever passes through here: the hook reads only a status enum and a
 * first-run stage. Tokens stay in the secure store.
 */
import { useEffect } from "react";
import { useGameStore } from "@/store/useGameStore";
import { useAuthStore } from "@/store/useAuthStore";
import { isBackendConfigured } from "@/services/identityApi";
import { decideStartup, type StartupDecision } from "@/lib/startupDecision";

export function useAppBootstrap(): StartupDecision {
  const hydrated = useGameStore((s) => s._hydrated);
  const firstRun = useGameStore((s) => s.firstRun);
  const authStatus = useAuthStore((s) => s.status);
  const lastRestore = useAuthStore((s) => s.lastRestore);
  const restoreErrorCode = useAuthStore((s) => s.restoreErrorCode);
  const serviceErrorAcknowledged = useAuthStore((s) => s.restoreErrorAcknowledged);
  const initialize = useAuthStore((s) => s.initialize);

  useEffect(() => {
    // `initialize` is idempotent at the store level, so a re-run of this effect
    // (fast refresh, remount) cannot start a second restore.
    void initialize();
  }, [initialize]);

  return decideStartup({
    hydrated,
    authStatus,
    restoreResolved: lastRestore !== null,
    restoreErrorCode,
    firstRun,
    backendConfigured: isBackendConfigured(),
    serviceErrorAcknowledged,
  });
}
