/**
 * "Waiting for the server check" may be said only when Save really asks the
 * server. A guest save sends nothing (no token) and a capacity-limited route
 * is never sent, so both are local saves and must read "Estimated on this
 * phone", not "waiting for the server check".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INITIAL_VERIFICATION, willRequestServerCheck } from "../movementVerification";
import { movementXpStatus, recordEstimate } from "../movementXp";

const base = { hasClient: true, verifiable: true, evidenceStatus: "complete", accountId: "acct-1" };

test("a signed-in, eligible, complete route asks the server", () => {
  assert.equal(willRequestServerCheck(base), true);
});

test("guest, capacity-limited, ineligible or client-less saves do not", () => {
  assert.equal(willRequestServerCheck({ ...base, accountId: null }), false);
  assert.equal(willRequestServerCheck({ ...base, evidenceStatus: "capacity_limited" }), false);
  assert.equal(willRequestServerCheck({ ...base, verifiable: false }), false);
  assert.equal(willRequestServerCheck({ ...base, hasClient: false }), false);
});

/* A guest save never starts a submission now, so its live state stays local. */
test("a guest save is labelled saved locally, never pending verification", () => {
  const submitted = willRequestServerCheck({ ...base, accountId: null });
  const [entry] = recordEstimate([], { clientSessionId: "mv-guest-1", estimatedXp: 53, submitted, savedAt: "x" });
  assert.equal(movementXpStatus(entry!, INITIAL_VERIFICATION), "saved_locally");
});

test("the summary uses the one predicate for the label, the submission and the upload notice", () => {
  const src = readFileSync(join(__dirname, "..", "..", "..", "app", "move", "summary.tsx"), "utf8");
  assert.match(src, /recordMovementXpEstimate\(session\.clientSessionId, outcome\.xpGained, serverCheck\)/);
  assert.match(src, /if \(movementClient && serverCheck\) \{\s*void submitCompletedSession/);
  assert.match(src, /\{serverCheck \? \(\s*<Text style=\{styles\.uploadNote\}>/);
  assert.doesNotMatch(src, /Boolean\(movementClient\) && willSubmit/);
});
