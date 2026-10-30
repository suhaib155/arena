/**
 * What the app may tell a person about the result of "Delete account".
 *
 * The server answers in one of three ways:
 *  - 200 with `deleted: true`, `status: "completed"` and a `signInRecord` of
 *    "removed" or "none": the data is gone and no provider removal is waiting.
 *  - 202 (or any 2xx whose body says pending, or does not clearly confirm
 *    completion): the request is accepted, the account is signed out, and the
 *    erasure, including removal of the Google or wallet sign-in record, is
 *    still being finished.
 *  - an error: 409 `account_deletion_pending` or 503 `deletion_busy`.
 *
 * Completion is claimed only when the response confirms every part of it.
 * Anything unclear is reported as requested, never as done.
 */

export type DeletionOutcome = "completed" | "requested";

export function deletionOutcomeFromResponse(body: unknown): DeletionOutcome {
  if (typeof body !== "object" || body === null) return "requested";
  const b = body as { deleted?: unknown; status?: unknown; signInRecord?: unknown };
  if (b.deleted !== true) return "requested";
  if (b.status !== undefined && b.status !== "completed") return "requested";
  if (b.signInRecord !== "removed" && b.signInRecord !== "none") return "requested";
  return "completed";
}

export const DELETION_REQUESTED_TITLE = "Deletion requested";
export const DELETION_REQUESTED_BODY =
  "We've signed you out and your deletion request has been received. Removal of your account data and Google or wallet sign-in record is still in progress and may take some time to finish. Your account is not confirmed as deleted yet.";

export const DELETION_COMPLETED_TITLE = "Account deleted";
export const DELETION_COMPLETED_BODY =
  "Your MovenRun account data and saved sessions have been deleted, and the server confirmed that your sign-in record has been removed.";

export const DELETION_PENDING_MESSAGE =
  "Deletion pending. A deletion request for this account is already in progress. It is not confirmed as finished yet.";

export const DELETION_BUSY_MESSAGE =
  "Deletion couldn't start right now. Nothing was deleted. Please try again later.";

export function deletionAlertCopy(outcome: DeletionOutcome): { title: string; body: string } {
  return outcome === "completed"
    ? { title: DELETION_COMPLETED_TITLE, body: DELETION_COMPLETED_BODY }
    : { title: DELETION_REQUESTED_TITLE, body: DELETION_REQUESTED_BODY };
}
