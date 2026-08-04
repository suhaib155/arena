/**
 * First-run state model — exhaustive pure transition tests.
 *
 * These are the tests that must fail if anyone reintroduces a second source of
 * truth for "has this user finished first run", drops the legacy migration, or
 * lets "Reset progress" push an established user back through signup.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chooseLocalBeta,
  completeIntro,
  CURRENT_FIRST_RUN_VERSION,
  firstRunAfterProgressReset,
  FRESH_FIRST_RUN,
  migrateFirstRun,
  normalizeFirstRunState,
  signInFirstRun,
  type FirstRunState,
} from "../firstRun";

const fresh = (): FirstRunState => ({ ...FRESH_FIRST_RUN });

// ---- fresh install ----------------------------------------------------------

test("a fresh install starts at account choice with no decision recorded", () => {
  assert.deepEqual(fresh(), {
    version: CURRENT_FIRST_RUN_VERSION,
    stage: "account",
    mode: "undecided",
  });
  // Nothing but the migration path may produce a state; migrate with no data
  // is the fresh state.
  assert.deepEqual(migrateFirstRun(undefined, {}), fresh());
});

test("fresh install + choose local beta → intro", () => {
  const next = chooseLocalBeta(fresh());
  assert.equal(next.stage, "intro");
  assert.equal(next.mode, "local_beta");
});

test("fresh install + successful sign-in → intro, mode signed_in", () => {
  const next = signInFirstRun(fresh());
  assert.equal(next.stage, "intro");
  assert.equal(next.mode, "signed_in");
});

test("finishing the intro → ready, and an undecided mode resolves to local beta", () => {
  assert.deepEqual(completeIntro(chooseLocalBeta(fresh())), {
    version: CURRENT_FIRST_RUN_VERSION,
    stage: "ready",
    mode: "local_beta",
  });
  // Defensive: completing from a stage that never recorded a mode.
  assert.equal(completeIntro(fresh()).mode, "local_beta");
});

// ---- returning / established users -----------------------------------------

test("signing in later never re-onboards a user who already finished", () => {
  const ready: FirstRunState = { version: 2, stage: "ready", mode: "local_beta" };
  const next = signInFirstRun(ready);
  assert.equal(next.stage, "ready", "an established user is not sent back to the intro");
  assert.equal(next.mode, "signed_in");
});

test("choosing local beta never demotes a ready user and never overwrites signed_in", () => {
  const ready: FirstRunState = { version: 2, stage: "ready", mode: "signed_in" };
  const next = chooseLocalBeta(ready);
  assert.equal(next.stage, "ready");
  assert.equal(next.mode, "signed_in", "a confirmed sign-in is not downgraded");
});

test("replaying the intro cannot regress persisted state", () => {
  for (const mode of ["signed_in", "local_beta"] as const) {
    const ready: FirstRunState = { version: 2, stage: "ready", mode };
    assert.deepEqual(completeIntro(ready), ready, `replay is idempotent for ${mode}`);
  }
});

test("reset progress preserves first-run state exactly", () => {
  for (const state of [
    { version: 2, stage: "ready", mode: "signed_in" },
    { version: 2, stage: "ready", mode: "local_beta" },
    { version: 2, stage: "intro", mode: "local_beta" },
  ] as FirstRunState[]) {
    assert.deepEqual(
      firstRunAfterProgressReset(state),
      state,
      "a progress reset must not sign the user out or restart signup",
    );
  }
});

// ---- migration --------------------------------------------------------------

test("legacy hasOnboarded=true migrates straight to ready", () => {
  const migrated = migrateFirstRun(undefined, { hasOnboarded: true, hasSeenOpeningIntro: true });
  assert.deepEqual(migrated, { version: CURRENT_FIRST_RUN_VERSION, stage: "ready", mode: "local_beta" });
});

test("a legacy user mid-old-flow keeps their local choice and only owes the intro", () => {
  const migrated = migrateFirstRun(undefined, { hasOnboarded: false, hasSeenOpeningIntro: true });
  assert.equal(migrated.stage, "intro", "never sent back to account choice");
  assert.equal(migrated.mode, "local_beta");
});

test("a legacy install that finished nothing starts at account choice", () => {
  const migrated = migrateFirstRun(undefined, { hasOnboarded: false, hasSeenOpeningIntro: false });
  assert.deepEqual(migrated, fresh());
});

test("an existing versioned record wins over the legacy booleans", () => {
  const stored: FirstRunState = { version: 2, stage: "ready", mode: "signed_in" };
  assert.deepEqual(migrateFirstRun(stored, { hasOnboarded: false }), stored);
});

test("a record written by an older first-run version is re-stamped, not discarded", () => {
  const old = { version: 1, stage: "ready", mode: "local_beta" };
  const migrated = migrateFirstRun(old, {});
  assert.equal(migrated.version, CURRENT_FIRST_RUN_VERSION);
  assert.equal(migrated.stage, "ready", "progress through first run survives a version bump");
});

// ---- invalid / hostile persisted data --------------------------------------

test("invalid persisted combinations resolve deterministically and safely", () => {
  // Decided mode but still parked on the account screen → they already chose.
  assert.deepEqual(normalizeFirstRunState({ stage: "account", mode: "signed_in" }), {
    version: CURRENT_FIRST_RUN_VERSION,
    stage: "intro",
    mode: "signed_in",
  });
  // Progressed without a recorded choice → the unprivileged mode.
  assert.deepEqual(normalizeFirstRunState({ stage: "ready", mode: "undecided" }), {
    version: CURRENT_FIRST_RUN_VERSION,
    stage: "ready",
    mode: "local_beta",
  });
  // Garbage in a known field falls back to that field's safe default and can
  // never *grant* signed_in.
  const junk = normalizeFirstRunState({ stage: "ready", mode: "administrator" });
  assert.equal(junk?.mode, "local_beta");
  assert.equal(normalizeFirstRunState({ stage: "wat", mode: "local_beta" })?.stage, "intro");
});

test("unrecognisable values fall through to migration instead of pretending", () => {
  for (const value of [null, undefined, 7, "ready", {}, { version: 2 }, []]) {
    assert.equal(normalizeFirstRunState(value), null);
  }
  assert.deepEqual(migrateFirstRun({ nonsense: true }, {}), fresh());
});

test("normalize is idempotent for every reachable state", () => {
  const reachable: FirstRunState[] = [
    fresh(),
    chooseLocalBeta(fresh()),
    signInFirstRun(fresh()),
    completeIntro(chooseLocalBeta(fresh())),
    completeIntro(signInFirstRun(fresh())),
  ];
  for (const state of reachable) {
    assert.deepEqual(normalizeFirstRunState(state), state);
  }
});
