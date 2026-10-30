import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deletionAlertCopy,
  deletionOutcomeFromResponse,
  DELETION_BUSY_MESSAGE,
  DELETION_PENDING_MESSAGE,
} from "../accountDeletionCopy";
import { authErrorMessage } from "../emailAuth";

test("only a response confirming completion and the sign-in record is completed", () => {
  assert.equal(deletionOutcomeFromResponse({ deleted: true, status: "completed", signInRecord: "removed" }), "completed");
  assert.equal(deletionOutcomeFromResponse({ deleted: true, status: "completed", signInRecord: "none" }), "completed");
  // Older servers omit `status`; the sign-in record still has to be settled.
  assert.equal(deletionOutcomeFromResponse({ deleted: true, signInRecord: "removed" }), "completed");
});

test("pending, partial, malformed or unknown responses are only requested", () => {
  const cases: unknown[] = [
    { deleted: false, status: "pending", requestId: "r1", signInRecord: "pending" },
    { deleted: true, status: "completed", signInRecord: "pending" },
    { deleted: true, status: "pending", signInRecord: "removed" },
    { deleted: true },
    { deleted: true, signInRecord: "something-new" },
    {},
    null,
    "ok",
    undefined,
  ];
  for (const body of cases) assert.equal(deletionOutcomeFromResponse(body), "requested", JSON.stringify(body));
});

test("the requested copy never claims the account is deleted", () => {
  const c = deletionAlertCopy("requested");
  assert.equal(c.title, "Deletion requested");
  assert.ok(!/permanent|has been deleted|have been deleted|is deleted|deleted\./i.test(c.body.replace("not confirmed as deleted", "")));
  assert.match(c.body, /signed you out/);
  assert.match(c.body, /in progress/);
  assert.match(c.body, /some time/);
});

test("the completed copy is used only for confirmed completion", () => {
  assert.equal(deletionAlertCopy("completed").title, "Account deleted");
  assert.ok(!/permanent/i.test(deletionAlertCopy("completed").body));
});

test("409 and 503 deletion codes have truthful messages", () => {
  assert.equal(authErrorMessage("account_deletion_pending"), DELETION_PENDING_MESSAGE);
  assert.match(DELETION_PENDING_MESSAGE, /^Deletion pending/);
  assert.equal(authErrorMessage("deletion_busy"), DELETION_BUSY_MESSAGE);
  assert.match(DELETION_BUSY_MESSAGE, /Nothing was deleted/);
  assert.match(DELETION_BUSY_MESSAGE, /try again later/);
});
