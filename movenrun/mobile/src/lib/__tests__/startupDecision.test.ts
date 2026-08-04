/**
 * Startup matrix — every cold-start path the app supports, decided purely.
 *
 * The two failures these lock out are the dangerous ones: showing signed-out
 * UI before anything has been checked, and treating a transient backend/network
 * failure as proof that a user is signed out.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideStartup,
  isDecidingStartup,
  type StartupInput,
} from "../startupDecision";
import {
  isRecoverableRestore,
  restoreErrorCode,
  restoreKindToAuthStatus,
  type RestoreKind,
} from "../authLifecycle";
import { chooseLocalBeta, completeIntro, FRESH_FIRST_RUN, signInFirstRun } from "../firstRun";

const READY_LOCAL = completeIntro(chooseLocalBeta({ ...FRESH_FIRST_RUN }));
const READY_SIGNED_IN = completeIntro(signInFirstRun({ ...FRESH_FIRST_RUN }));

function input(patch: Partial<StartupInput> = {}): StartupInput {
  return {
    hydrated: true,
    authStatus: "signedOut",
    firstRun: { ...FRESH_FIRST_RUN },
    backendConfigured: true,
    serviceErrorAcknowledged: false,
    ...patch,
  };
}

// ---- still deciding ---------------------------------------------------------

test("hydration incomplete → splash, regardless of anything else", () => {
  const d = decideStartup(input({ hydrated: false, authStatus: "signedIn", firstRun: READY_SIGNED_IN }));
  assert.equal(d.route, "splash");
  assert.equal(d.status, "hydrating");
  assert.ok(isDecidingStartup(d));
});

test("session restoration incomplete → splash (no signed-out flash)", () => {
  for (const authStatus of ["unknown", "restoring"] as const) {
    const d = decideStartup(input({ authStatus }));
    assert.equal(d.route, "splash", authStatus);
    assert.equal(d.status, "restoring-session");
  }
});

// ---- resolved sessions ------------------------------------------------------

test("no stored session on a fresh install → account choice", () => {
  const d = decideStartup(input({ authStatus: "signedOut" }));
  assert.equal(d.route, "account");
  assert.equal(d.status, "ready");
  assert.equal(d.errorCode, null);
});

test("a valid restored session on a finished install → straight to the app", () => {
  const d = decideStartup(input({ authStatus: "signedIn", firstRun: READY_SIGNED_IN }));
  assert.equal(d.route, "app");
});

test("returning local-beta user → straight to the app, no account screen", () => {
  const d = decideStartup(input({ authStatus: "signedOut", firstRun: READY_LOCAL }));
  assert.equal(d.route, "app");
});

test("a rejected session signs the user out — and the client cleared credentials", () => {
  assert.equal(restoreKindToAuthStatus("rejected"), "signedOut");
  assert.equal(restoreKindToAuthStatus("no-session"), "signedOut");
  // A signed-out user who already finished first run still lands on the app;
  // the local experience does not require an account.
  assert.equal(decideStartup(input({ authStatus: "signedOut", firstRun: READY_LOCAL })).route, "app");
});

test("signed in but intro incomplete → the intro", () => {
  const d = decideStartup(input({ authStatus: "signedIn", firstRun: signInFirstRun({ ...FRESH_FIRST_RUN }) }));
  assert.equal(d.route, "intro");
});

// ---- failure semantics ------------------------------------------------------

test("a transient restore failure is recoverable, never a false signed-out truth", () => {
  assert.equal(restoreKindToAuthStatus("unavailable"), "error");
  assert.ok(isRecoverableRestore("unavailable"));
  assert.equal(restoreErrorCode("unavailable"), "service_unavailable");

  const d = decideStartup(input({ authStatus: "error", firstRun: READY_SIGNED_IN }));
  assert.equal(d.route, "service-error");
  assert.equal(d.status, "recoverable-error");
  assert.equal(d.errorCode, "service_unavailable", "a stable public code, not a raw message");
});

test("only a stable public code is ever produced (never raw error text)", () => {
  const kinds: RestoreKind[] = ["restored", "no-session", "rejected", "unavailable"];
  for (const kind of kinds) {
    const code = restoreErrorCode(kind);
    assert.ok(code === null || code === "service_unavailable", kind);
  }
});

test("a backend failure never blocks a user who has no session to restore", () => {
  // Local-beta user: the account service being down is irrelevant to them.
  assert.equal(decideStartup(input({ authStatus: "error", firstRun: READY_LOCAL })).route, "app");
  // Undecided user: they can still choose the local beta on the account screen.
  assert.equal(decideStartup(input({ authStatus: "error" })).route, "account");
});

test("backend URL absent → account choice with the local-beta fallback, never an error wall", () => {
  const d = decideStartup(input({ backendConfigured: false, authStatus: "signedOut" }));
  assert.equal(d.route, "account");
  assert.equal(d.errorCode, null);
  // Even if the auth store somehow reported an error, an unconfigured build
  // must not strand the user in a retry screen that cannot succeed.
  assert.equal(
    decideStartup(input({ backendConfigured: false, authStatus: "error", firstRun: READY_SIGNED_IN })).route,
    "app",
  );
});

test("acknowledging the service error continues into the local experience", () => {
  const d = decideStartup(
    input({ authStatus: "error", firstRun: READY_SIGNED_IN, serviceErrorAcknowledged: true }),
  );
  assert.equal(d.route, "app", "the user chose to continue; credentials are still stored");
});

// ---- totality ---------------------------------------------------------------

test("the decision is total: every combination yields a known route", () => {
  const statuses = ["unknown", "restoring", "signedOut", "authenticating", "signedIn", "error"] as const;
  const firstRuns = [{ ...FRESH_FIRST_RUN }, signInFirstRun({ ...FRESH_FIRST_RUN }), READY_LOCAL, READY_SIGNED_IN];
  const known = new Set(["splash", "account", "intro", "app", "service-error"]);
  let seen = 0;
  for (const hydrated of [true, false]) {
    for (const authStatus of statuses) {
      for (const firstRun of firstRuns) {
        for (const backendConfigured of [true, false]) {
          for (const serviceErrorAcknowledged of [true, false]) {
            const d = decideStartup({
              hydrated,
              authStatus,
              firstRun,
              backendConfigured,
              serviceErrorAcknowledged,
            });
            assert.ok(known.has(d.route), `${authStatus}/${firstRun.stage}`);
            seen += 1;
          }
        }
      }
    }
  }
  assert.equal(seen, 2 * statuses.length * firstRuns.length * 2 * 2);
});
