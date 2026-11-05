/*
 * What the account deletion page may say after "Request deletion".
 *
 * Pure: takes the HTTP status and the parsed JSON body (or null) and returns
 * { kind, text, done }. No DOM, so it runs under plain Node in the website
 * checks. Mirrors the app's rule (mobile/src/lib/accountDeletionCopy.ts):
 * completion is claimed only when the response confirms every part of it.
 *
 * Server answers this handles:
 *  - 200 { deleted: true, signInRecord: "removed" | "none" }           (current server)
 *  - 200 { deleted: true, status: "completed", signInRecord: ... }       (queued server)
 *  - 200 with signInRecord "pending", or anything that does not confirm completion
 *  - 202 { deleted: false, status: "pending", ... }                    (queued server)
 *  - 409 account_deletion_pending, 503 deletion_busy, any other error
 */
(function (root) {
  var CONTACT = " Questions: info@movenrun.xyz, Team MovenRun.";

  var TEXT = {
    complete: "Deletion complete. The server confirmed that your MovenRun account, its data and your sign-in record have been removed.",
    completeNoRecord: "Deletion complete. The server confirmed that your MovenRun account and its data have been removed. There was no separate sign-in record to remove.",
    requested: "Deletion requested. You have been signed out everywhere. Removal of your account data and your sign-in record is in progress and is not confirmed as finished yet." + CONTACT,
    requestedRecordPending: "Deletion requested. Your MovenRun account data has been erased and you have been signed out everywhere. Removing your sign-in record at our sign-in provider is still in progress, so the deletion is not confirmed as finished yet." + CONTACT,
    pending: "Deletion pending. A deletion request for this account is already in progress and is not confirmed as finished yet." + CONTACT,
    busy: "MovenRun is busy and nothing was deleted. Please try again later.",
    failed: "Your deletion request could not be sent right now. Nothing was confirmed as deleted. Please try again, or email info@movenrun.xyz (Team MovenRun).",
  };

  function deletionOutcome(status, body) {
    if (status === 202) return { kind: "ok", done: false, text: TEXT.requested };
    if (status >= 200 && status < 300) {
      var b = body && typeof body === "object" ? body : null;
      var record = b && typeof b.signInRecord === "string" ? b.signInRecord : "";
      var confirmed = !!b && b.deleted === true && (b.status === undefined || b.status === "completed");
      if (confirmed && record === "removed") return { kind: "ok", done: true, text: TEXT.complete };
      if (confirmed && record === "none") return { kind: "ok", done: true, text: TEXT.completeNoRecord };
      if (confirmed && record === "pending") return { kind: "ok", done: false, text: TEXT.requestedRecordPending };
      return { kind: "ok", done: false, text: TEXT.requested };
    }
    if (status === 409) return { kind: "error", done: false, text: TEXT.pending };
    if (status === 503) return { kind: "error", done: false, text: TEXT.busy };
    return { kind: "error", done: false, text: TEXT.failed };
  }

  /* Statuses after which the sign-in token must be dropped and the form hidden. */
  function endsRequest(status) {
    return (status >= 200 && status < 300) || status === 409;
  }

  var api = { deletionOutcome: deletionOutcome, endsRequest: endsRequest, TEXT: TEXT };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MovenRunDeletionOutcome = api;
})(typeof window !== "undefined" ? window : this);
