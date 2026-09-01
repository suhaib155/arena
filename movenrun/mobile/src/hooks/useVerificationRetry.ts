/**
 * The only automatic trigger for a verification retry.
 *
 * Two moments, both deliberate and both in the foreground:
 *
 *   1. the app becoming authenticated (bootstrap resolved, a real account), and
 *   2. the app returning to the foreground while already authenticated.
 *
 * There is no timer, no interval, no background task, no background fetch and
 * no location task — a retry needs none of those, and adding one would require
 * exactly the Android permissions this app has committed to not asking for
 * (`ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE_LOCATION`; see the
 * runtime-policy guards). A run that could not be verified today is verified
 * the next time the user opens the app, which is soon enough for something the
 * user is not waiting on.
 *
 * The gate is `status === "signedIn"` plus a real user id, so nothing is read
 * from storage — let alone uploaded — before authentication has resolved. All
 * of the actual policy (ownership, expiry, budget, backoff, dedupe) lives in
 * `retryPendingVerifications`; this hook only says *when* to ask.
 */
import { useEffect } from "react";
import { AppState } from "react-native";
import { MovementApiClient } from "@/services/movementApi";
import { retryPendingVerifications } from "@/services/verifySession";
import { setVerificationState } from "@/services/moveSession";
import { toVerifiedRecord } from "@/lib/verifiedMovement";
import { useAuthStore } from "@/store/useAuthStore";
import { useGameStore } from "@/store/useGameStore";

export function useVerificationRetry(): void {
  const status = useAuthStore((s) => s.status);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const identityClient = useAuthStore((s) => s.client);
  const recordMovementVerification = useGameStore((s) => s.recordMovementVerification);

  useEffect(() => {
    if (status !== "signedIn" || userId === null || identityClient === null) return;

    /* One movement client on the shared authenticated transport — same bearer
       attachment and same single-flight refresh as every other call. A retry
       does not get its own fetch client or its own refresh slot. */
    const client = new MovementApiClient(identityClient.transport);

    const sweep = () => {
      void retryPendingVerifications({
        client,
        ownerUserId: userId,
        writeState: setVerificationState,
        onSettled: (clientSessionId, state) => {
          const record = toVerifiedRecord(clientSessionId, state);
          if (record) recordMovementVerification(record);
        },
      });
    };

    sweep();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") sweep();
    });
    return () => subscription.remove();
  }, [status, userId, identityClient, recordMovementVerification]);
}
