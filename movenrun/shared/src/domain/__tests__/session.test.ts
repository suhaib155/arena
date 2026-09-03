/**
 * The session model — what a movement session is, and what it refuses to be.
 *
 * These are not tests that the language can add numbers. They are the rules
 * that stop a session from describing something impossible: a finish before a
 * start, two pauses at once, a pause outside the session it belongs to, a
 * rules version nobody has shipped, a mode nobody has built.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  activeMs,
  DEFAULT_MOVEMENT_MODE,
  elapsedMs,
  isMovementMode,
  isSupportedRulesVersion,
  isValidSessionMetadata,
  LEGACY_RULES_VERSION,
  MOVEMENT_MODES,
  pausedMs,
  sameSessionMetadata,
  SESSION_RULES_VERSION,
  sessionMetadataProblems,
  SUPPORTED_RULES_VERSIONS,
  type SessionMetadata,
} from "../session";

const START = 1_756_000_000_000;

function metadata(over: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    mode: DEFAULT_MOVEMENT_MODE,
    rulesVersion: SESSION_RULES_VERSION,
    startedAt: START,
    finishedAt: START + 60 * 60_000,
    pauses: [],
    ...over,
  };
}

/* ── movement mode ────────────────────────────────────────────────────────── */

test("there is exactly one movement mode, and it is the one the app can honestly claim", () => {
  /* The app has no walk/run classifier and no cadence sensor, so `onFoot` is
     the whole of what is known. If a second mode ever appears here, it must
     come with the thing that can tell them apart. */
  assert.deepEqual([...MOVEMENT_MODES], ["onFoot"]);
  assert.equal(DEFAULT_MOVEMENT_MODE, "onFoot");
});

test("cycling is absent rather than present-and-disabled", () => {
  /* V3 gives cycling its own territory treatment — a different map, not a
     different label — and none of it exists. A value here would be one the
     server must reject and a future reader would reasonably assume works. */
  assert.equal(isMovementMode("cycling"), false);
  assert.equal((MOVEMENT_MODES as readonly string[]).includes("cycling"), false);
});

test("an unknown mode is not a mode", () => {
  for (const bad of ["walk", "run", "Cycling", "onfoot", "ONFOOT", "", null, undefined, 1, {}]) {
    assert.equal(isMovementMode(bad), false, JSON.stringify(bad));
  }
});

/* ── rules version ────────────────────────────────────────────────────────── */

test("the current rules version is a small integer, and it is supported", () => {
  assert.equal(SESSION_RULES_VERSION, 1);
  assert.ok(Number.isInteger(SESSION_RULES_VERSION));
  assert.ok(isSupportedRulesVersion(SESSION_RULES_VERSION));
  assert.deepEqual([...SUPPORTED_RULES_VERSIONS], [SESSION_RULES_VERSION]);
});

test("an unshipped rules version fails closed rather than being treated as current", () => {
  /* The whole point of the stamp: a session captured under rules this build
     does not know must not be scored under the rules it does know. */
  for (const bad of [0, 2, 999, -1, 1.5, NaN, Infinity, "1", null, undefined]) {
    assert.equal(isSupportedRulesVersion(bad), false, String(bad));
  }
});

test("a legacy session is represented by absence, not by a number", () => {
  /* There is no truthful version to write for a session captured before
     versions existed. `null` says that; `0` or `1` would both be claims. */
  assert.equal(LEGACY_RULES_VERSION, null);
});

/* ── structural validation ────────────────────────────────────────────────── */

test("a well-formed session has no problems", () => {
  assert.deepEqual(sessionMetadataProblems(metadata()), []);
  assert.ok(isValidSessionMetadata(metadata()));
});

test("a session cannot finish before it starts", () => {
  const problems = sessionMetadataProblems(
    metadata({ startedAt: START, finishedAt: START - 1 }),
  );
  assert.ok(problems.some((p) => /finished before it started/.test(p)));
});

test("a session that starts and finishes in the same millisecond is degenerate, not invalid", () => {
  /* Zero-length is not impossible — a session started and finished instantly
     is a user doing something odd, not a payload describing a contradiction.
     The eligibility rules that will reject it are a later PR's business. */
  assert.deepEqual(sessionMetadataProblems(metadata({ finishedAt: START })), []);
});

test("a non-finite lifecycle is rejected before anything else is inspected", () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    const problems = sessionMetadataProblems(metadata({ startedAt: bad }));
    assert.ok(problems.some((p) => /not a finite time range/.test(p)), String(bad));
  }
});

test("an unsupported mode or rules version is named as such", () => {
  const problems = sessionMetadataProblems(
    metadata({ mode: "cycling" as never, rulesVersion: 99 }),
  );
  assert.ok(problems.some((p) => /Unsupported movement mode/.test(p)));
  assert.ok(problems.some((p) => /Unsupported session rules version/.test(p)));
});

/* ── pauses ───────────────────────────────────────────────────────────────── */

test("ordered, non-overlapping pauses inside the session are fine", () => {
  const problems = sessionMetadataProblems(
    metadata({
      pauses: [
        { startedAt: START + 1000, endedAt: START + 2000 },
        { startedAt: START + 5000, endedAt: START + 9000 },
      ],
    }),
  );
  assert.deepEqual(problems, []);
});

test("overlapping pauses are rejected — nobody pauses twice at once", () => {
  const problems = sessionMetadataProblems(
    metadata({
      pauses: [
        { startedAt: START + 1000, endedAt: START + 5000 },
        { startedAt: START + 4000, endedAt: START + 9000 },
      ],
    }),
  );
  assert.ok(problems.some((p) => /overlap or are out of order/.test(p)));
});

test("out-of-order pauses are rejected by the same rule", () => {
  const problems = sessionMetadataProblems(
    metadata({
      pauses: [
        { startedAt: START + 5000, endedAt: START + 9000 },
        { startedAt: START + 1000, endedAt: START + 2000 },
      ],
    }),
  );
  assert.ok(problems.some((p) => /overlap or are out of order/.test(p)));
});

test("a pause that ends before it begins is rejected", () => {
  const problems = sessionMetadataProblems(
    metadata({ pauses: [{ startedAt: START + 5000, endedAt: START + 1000 }] }),
  );
  assert.ok(problems.some((p) => /end before they begin/.test(p)));
});

test("a pause outside the session is rejected at either end", () => {
  const before = sessionMetadataProblems(
    metadata({ pauses: [{ startedAt: START - 5000, endedAt: START - 1000 }] }),
  );
  assert.ok(before.some((p) => /fall outside the session/.test(p)));

  const after = sessionMetadataProblems(
    metadata({
      startedAt: START,
      finishedAt: START + 1000,
      pauses: [{ startedAt: START + 500, endedAt: START + 9999 }],
    }),
  );
  assert.ok(after.some((p) => /fall outside the session/.test(p)));
});

test("a malformed pause is reported rather than crashing the validator", () => {
  const problems = sessionMetadataProblems(
    metadata({ pauses: [{ startedAt: NaN, endedAt: START } as never, null as never] }),
  );
  assert.ok(problems.some((p) => /malformed/.test(p)));
});

test("pauses that are not a list are reported", () => {
  assert.ok(
    sessionMetadataProblems(metadata({ pauses: "none" as never })).some((p) =>
      /not a list/.test(p),
    ),
  );
});

test("problems are categories, never the values that caused them", () => {
  /* These strings reach an API response and a log. A timestamp in one would be
     a coarse disclosure of when somebody was moving. */
  const problems = sessionMetadataProblems(
    metadata({
      startedAt: START,
      finishedAt: START - 1,
      pauses: [{ startedAt: START + 777, endedAt: START + 111 }],
    }),
  );
  assert.ok(problems.length > 0);
  for (const problem of problems) {
    assert.ok(!problem.includes(String(START)), `problem quotes a timestamp: ${problem}`);
    assert.ok(!/\d{10,}/.test(problem), `problem quotes an epoch value: ${problem}`);
  }
});

/* ── durations ────────────────────────────────────────────────────────────── */

test("elapsed, paused and active are three different numbers with three names", () => {
  const m = metadata({
    startedAt: START,
    finishedAt: START + 60_000,
    pauses: [{ startedAt: START + 10_000, endedAt: START + 25_000 }],
  });
  assert.equal(elapsedMs(m), 60_000);
  assert.equal(pausedMs(m), 15_000);
  assert.equal(activeMs(m), 45_000);
});

test("active time is elapsed minus every pause", () => {
  const m = metadata({
    startedAt: START,
    finishedAt: START + 100_000,
    pauses: [
      { startedAt: START + 10_000, endedAt: START + 20_000 },
      { startedAt: START + 30_000, endedAt: START + 45_000 },
    ],
  });
  assert.equal(pausedMs(m), 25_000);
  assert.equal(activeMs(m), 75_000);
});

test("a session with no pauses has active equal to elapsed", () => {
  const m = metadata({ startedAt: START, finishedAt: START + 42_000 });
  assert.equal(pausedMs(m), 0);
  assert.equal(activeMs(m), elapsedMs(m));
});

test("durations never go negative, however strange the timestamps", () => {
  const m = metadata({ startedAt: START, finishedAt: START - 10_000 });
  assert.equal(elapsedMs(m), 0);
  assert.equal(activeMs(m), 0);
});

/* ── identity ─────────────────────────────────────────────────────────────── */

test("identical metadata is the same session", () => {
  const pauses = [{ startedAt: START + 1000, endedAt: START + 2000 }];
  assert.ok(sameSessionMetadata(metadata({ pauses }), metadata({ pauses: [...pauses] })));
});

test("any differing immutable field makes it a different session", () => {
  const base = metadata();
  const variants: Partial<SessionMetadata>[] = [
    { rulesVersion: 2 },
    { startedAt: START + 1 },
    { finishedAt: START + 1 },
    { pauses: [{ startedAt: START + 1, endedAt: START + 2 }] },
  ];
  for (const over of variants) {
    assert.equal(
      sameSessionMetadata(base, metadata(over)),
      false,
      `changing ${Object.keys(over)[0]} should not compare equal`,
    );
  }
});

test("a differing pause count is a different session even when the totals match", () => {
  /* Two pauses of five seconds and one of ten are not the same evidence, and a
     retry replaying the original cannot produce the other. */
  const a = metadata({
    pauses: [
      { startedAt: START + 1000, endedAt: START + 6000 },
      { startedAt: START + 7000, endedAt: START + 12_000 },
    ],
  });
  const b = metadata({ pauses: [{ startedAt: START + 1000, endedAt: START + 11_000 }] });
  assert.equal(pausedMs(a), pausedMs(b));
  assert.equal(sameSessionMetadata(a, b), false);
});

/* ── the model knows nothing about gameplay ───────────────────────────────── */

test("session metadata carries provenance and no measurement or reward", () => {
  const m = metadata();
  for (const forbidden of [
    "distanceMeters", "distance", "durationSeconds", "traversedCells", "traversedHexIds",
    "cells", "captured", "capturedCells", "owned", "ownership", "holder", "seal", "sealed",
    "solid", "shade", "strength", "xp", "points", "credits", "trustScore", "verified",
    "eligible", "qualifying",
  ]) {
    assert.ok(!(forbidden in m), `the session model grew ${forbidden}`);
  }
  assert.deepEqual(
    Object.keys(m).sort(),
    ["finishedAt", "mode", "pauses", "rulesVersion", "startedAt"],
  );
});
