/**
 * The sealing engine.
 *
 * Sealing is the mechanic that decides whether a route can ever become ground,
 * so almost every test here is about refusing to seal: an endpoint brushed, a
 * road retraced, a line drawn across a pause, a loop counted twice. A false
 * positive here would hand a player territory they did not earn, and the
 * geometry that produces one is the geometry GPS noise produces all day.
 *
 * Routes are written in metres east and north of one origin, because that is
 * how the shapes are actually reasoned about; `at()` converts. Nothing in the
 * engine sees those metres — it sees the coordinates, and projects them itself.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { cellForCoordinate, type H3Cell } from "../h3";
import { SESSION_RULES_VERSION, type PauseInterval, type SessionMetadata } from "../session";
import { segmentCrossing } from "../geo";
import {
  GRID_CELL_M,
  MAX_SCAN_SEGMENTS,
  SEAL_METHODS,
  createSealScanner,
  evaluateSealing,
  isSealed,
  isSealMethod,
  sealingRulesFor,
  type SealEvaluation,
  type SealRoutePoint,
} from "../sealing";

const ORIGIN = { latitude: 12.9716, longitude: 77.5946 };
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((ORIGIN.latitude * Math.PI) / 180);
const T0 = 1_756_000_000_000;
const RULES = sealingRulesFor(SESSION_RULES_VERSION)!;

/** A point `eastM` east and `northM` north of the origin. */
function at(eastM: number, northM: number, origin = ORIGIN): { latitude: number; longitude: number } {
  return {
    latitude: origin.latitude + northM / M_PER_DEG_LAT,
    longitude: origin.longitude + eastM / M_PER_DEG_LON,
  };
}

/** A route through the given metre offsets, one fix every 10 seconds. */
function route(offsets: readonly (readonly [number, number])[], stepSeconds = 10): SealRoutePoint[] {
  return offsets.map(([e, n], i) => ({ ...at(e, n), timestamp: T0 + i * stepSeconds * 1000 }));
}

function session(over: Partial<SessionMetadata> = {}): SessionMetadata {
  return {
    mode: "onFoot",
    rulesVersion: SESSION_RULES_VERSION,
    startedAt: T0 - 1_000,
    finishedAt: T0 + 24 * 60 * 60_000,
    pauses: [],
    ...over,
  };
}

function evaluate(points: readonly SealRoutePoint[], over: Partial<SessionMetadata> = {}, heldCells?: ReadonlySet<H3Cell> | null): SealEvaluation {
  return evaluateSealing({ session: session(over), points, heldCells });
}

/**
 * The canonical self-cross: a lasso.
 *
 *      p3(-30,30) ─────────────────────── p2? no — see below
 *
 * Up the line, round to the right, and back across the line you came up. The
 * closing segment cuts the first one at (0, 30), which is strictly inside both.
 */
const LASSO: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, 60],
  [60, 60],
  [60, 30],
  [-30, 30],
];

/* A second lasso hung below the first, so one session closes twice. */
const DOUBLE_LASSO: readonly (readonly [number, number])[] = [
  ...LASSO,
  [-30, -40],
  [60, -40],
  [60, -10],
  [-40, -10],
];

/* ── methods and rules ────────────────────────────────────────────────────── */

test("there are exactly three seal methods, and no rival, pincer or admin seal", () => {
  assert.deepEqual([...SEAL_METHODS].sort(), [
    "finish_on_held_ground",
    "return_to_start",
    "self_cross",
  ]);
  for (const absent of ["trail_cut", "rival_cut", "pincer", "admin", "purchased", "timeout"]) {
    assert.equal(isSealMethod(absent), false, `${absent} is a recognised method`);
  }
});

test("the current rules version fixes a 150 m return radius", () => {
  assert.equal(RULES.returnRadiusMeters, 150);
  assert.equal(RULES.rulesVersion, SESSION_RULES_VERSION);
});

test("an unknown rules version has no rules and produces no events", () => {
  assert.equal(sealingRulesFor(2), null);
  assert.equal(sealingRulesFor(999), null);
  assert.equal(sealingRulesFor(0), null);
  assert.equal(sealingRulesFor(-1), null);
  const result = evaluate(route(LASSO), { rulesVersion: 7 });
  assert.equal(result.status, "unsupported_rules");
  assert.deepEqual(result.events, []);
  assert.equal(result.rulesVersion, null);
});

test("the rules version controls the radius, so history keeps its own rule", () => {
  /* A session 200 m from home under a hypothetical wider rule would seal; under
     version 1 it does not. The engine reads the session's stamp, never a
     current default — which is the whole point of the stamp. */
  const wide = route([
    [0, 0],
    [200, 0],
  ]);
  assert.equal(evaluate(wide).methods.includes("return_to_start"), false);
  const near = route([
    [0, 0],
    [140, 0],
  ]);
  assert.equal(evaluate(near).methods.includes("return_to_start"), true);
});

/* ── return to start ──────────────────────────────────────────────────────── */

test("finishing well inside the radius seals", () => {
  const result = evaluate(route([[0, 0], [500, 0], [500, 500], [40, 30]]));
  assert.equal(result.status, "evaluated");
  assert.ok(result.methods.includes("return_to_start"));
  const event = result.events.find((e) => e.method === "return_to_start")!;
  assert.equal(event.startIndex, 0);
  assert.equal(event.endIndex, 3);
  assert.equal(event.closure.kind, "endpoints");
  assert.equal(event.atFinish, true);
});

test("the boundary is inclusive — 150 m away is within 150 m", () => {
  /* Chosen deliberately and documented: the natural reading of "within 150
     metres" includes 150, and a rule whose behaviour at its own stated number
     is undefined is not a rule. */
  const exact = route([[0, 0], [1000, 0], [150, 0]]);
  const result = evaluate(exact);
  assert.ok(
    result.methods.includes("return_to_start"),
    "a finish at exactly the radius must seal",
  );
});

test("just outside the radius does not seal, and just inside does", () => {
  const outside = evaluate(route([[0, 0], [1000, 0], [150.5, 0]]));
  assert.equal(outside.methods.includes("return_to_start"), false);
  const inside = evaluate(route([[0, 0], [1000, 0], [149.5, 0]]));
  assert.equal(inside.methods.includes("return_to_start"), true);
});

test("a route that ends exactly where it began seals", () => {
  const result = evaluate(route([[0, 0], [300, 0], [300, 300], [0, 0]]));
  assert.ok(result.methods.includes("return_to_start"));
});

test("return-to-start works at high latitude and across the antimeridian", () => {
  for (const origin of [
    { latitude: 69.65, longitude: 18.96 },
    { latitude: -16.5, longitude: 179.999 },
  ]) {
    const local = (e: number, n: number) => ({
      latitude: origin.latitude + n / M_PER_DEG_LAT,
      longitude: origin.longitude + e / (M_PER_DEG_LAT * Math.cos((origin.latitude * Math.PI) / 180)),
    });
    const points: SealRoutePoint[] = [
      { ...local(0, 0), timestamp: T0 },
      { ...local(0, 400), timestamp: T0 + 60_000 },
      { ...local(100, 0), timestamp: T0 + 120_000 },
    ];
    const result = evaluateSealing({ session: session(), points });
    assert.ok(
      result.methods.includes("return_to_start"),
      `no seal at ${origin.latitude},${origin.longitude}`,
    );
  }
});

test("a route with fewer than two usable points seals nothing and says why", () => {
  for (const points of [[], route([[0, 0]])]) {
    const result = evaluate(points);
    assert.equal(result.status, "evaluated");
    assert.deepEqual(result.events, []);
    assert.ok(result.unavailable.some((u) => u.reason === "insufficient_route"));
  }
});

test("a malformed coordinate never becomes a seal", () => {
  const points: SealRoutePoint[] = [
    { latitude: Number.NaN, longitude: 77.5, timestamp: T0 },
    { latitude: 1000, longitude: 77.5, timestamp: T0 + 10_000 },
    { latitude: 12.9, longitude: Number.POSITIVE_INFINITY, timestamp: T0 + 20_000 },
  ];
  const result = evaluateSealing({ session: session(), points });
  assert.equal(result.status, "evaluated");
  assert.deepEqual(result.events, []);
});

/* ── self-cross ───────────────────────────────────────────────────────────── */

test("cutting your own line seals the loop that just closed", () => {
  const result = evaluate(route(LASSO));
  const crosses = result.events.filter((e) => e.method === "self_cross");
  assert.equal(crosses.length, 1);
  const event = crosses[0]!;
  assert.equal(event.atFinish, false, "a self-cross happens while the session runs");
  /* The loop is the stretch between the crossed segment and the crossing one:
     p1 up, p2 across, p3 down — closed through the intersection. */
  assert.equal(event.startIndex, 1);
  assert.equal(event.endIndex, 3);
  assert.equal(event.closure.kind, "crossing");
  if (event.closure.kind === "crossing") {
    /* The cut lands halfway up the first segment and two thirds along the
       closing one — the geometry, not merely the fact of it. */
    assert.ok(Math.abs(event.closure.priorFraction - 0.5) < 1e-6);
    assert.ok(Math.abs(event.closure.closingFraction - 2 / 3) < 1e-6);
  }
});

test("an ordinary route does not seal itself", () => {
  const straight = evaluate(route([[0, 0], [100, 0], [200, 0], [300, 0], [400, 0]]));
  assert.equal(straight.events.filter((e) => e.method === "self_cross").length, 0);
  const curve = evaluate(
    route(Array.from({ length: 40 }, (_, i) => [i * 20, Math.sin(i / 4) * 60] as const)),
  );
  assert.equal(curve.events.filter((e) => e.method === "self_cross").length, 0);
});

test("consecutive segments share a vertex and never seal on it", () => {
  /* Every polyline's newest segment touches the one before it. If that counted,
     a session would seal on its third fix and never stop. */
  const zigzag = evaluate(
    route(Array.from({ length: 60 }, (_, i) => [i * 10, i % 2 === 0 ? 0 : 40] as const)),
  );
  assert.equal(zigzag.events.filter((e) => e.method === "self_cross").length, 0);
});

test("a T-junction that stops on the earlier line does not seal", () => {
  /* Up, right, and back down to touch the first line exactly — a touch, not a
     cut. Ending ON your own trail is not crossing it. */
  const result = evaluate(route([[0, 0], [0, 100], [60, 100], [60, 50], [0, 50]]));
  const crosses = result.events.filter((e) => e.method === "self_cross");
  assert.equal(crosses.length, 0, "an endpoint touch sealed");
});

test("retracing the same road, forwards or partly, never seals", () => {
  const outAndBack = evaluate(
    route([[0, 0], [100, 0], [200, 0], [300, 0], [200, 0], [100, 0], [0, 0]]),
  );
  assert.equal(
    outAndBack.events.filter((e) => e.method === "self_cross").length,
    0,
    "an out-and-back produced a self-cross",
  );
  const partial = evaluate(route([[0, 0], [200, 0], [120, 0], [260, 0], [60, 0]]));
  assert.equal(partial.events.filter((e) => e.method === "self_cross").length, 0);
});

test("a repeated identical fix is not a crossing", () => {
  const points = route([[0, 0], [0, 60], [0, 60], [60, 60], [60, 30], [-30, 30]]);
  const result = evaluateSealing({ session: session(), points });
  /* The duplicate contributes a zero-length segment, which has no direction —
     and the real lasso underneath still closes exactly once. */
  assert.equal(result.events.filter((e) => e.method === "self_cross").length, 1);
});

test("one session can close more than once", () => {
  const result = evaluate(route(DOUBLE_LASSO));
  const crosses = result.events.filter((e) => e.method === "self_cross");
  assert.equal(crosses.length, 2);
  assert.deepEqual(
    crosses.map((e) => e.sequence),
    [0, 1],
    "events are numbered in the order they happened",
  );
  assert.ok(crosses[0]!.endIndex < crosses[1]!.startIndex, "the two loops overlap");
});

test("one long step crossing three earlier lines closes the nearest one", () => {
  /* Three verticals, deliberately laid out so that the order along the incoming
     step disagrees with the order of the segments' indices AND with the reverse
     of it. The step meets x = 40 first, then x = 20, then x = 0 — but those are
     segments 2, 4 and 0, so index order would pick a different loop and reverse
     index order a third. Only "nearest along the step" gives this answer, which
     is what makes the ordering rule testable rather than decorative.

     The first cut banks its loop and moves the open trail past the closing
     segment, so the other two are inside ground already sealed. */
  const result = evaluate(
    route([
      [0, 0], [0, 100], [40, 100], [40, 0], [20, 0], [20, 100],
      [80, 100], [80, 50], [-20, 50],
    ]),
  );
  const crosses = result.events.filter((e) => e.method === "self_cross");
  assert.equal(crosses.length, 1);
  assert.equal(crosses[0]!.startIndex, 3, "the loop closed is not the nearest one");
  assert.equal(crosses[0]!.endIndex, 7);
});

test("jitter across the same line does not seal it again and again", () => {
  /* Cross once, then walk back and forth over the very same line, six more
     times. Ground already banked cannot be banked again: the open trail has
     moved past that closure, so the crossings after it produce nothing. There
     is no cooldown timer and no clock a replay cannot see — the route
     structure itself is what makes the event unrepeatable. */
  const wobble: (readonly [number, number])[] = [...LASSO];
  for (let i = 0; i < 6; i++) wobble.push([30, 30], [-30, 30]);
  const result = evaluate(route(wobble));
  assert.equal(
    result.events.filter((e) => e.method === "self_cross").length,
    1,
    "the same closure was sealed more than once",
  );
});

test("the same route always produces the same events", () => {
  const points = route(DOUBLE_LASSO);
  const a = evaluateSealing({ session: session(), points });
  const b = evaluateSealing({ session: session(), points });
  assert.deepEqual(a, b);
  /* And the same route reversed is a different route, so the events differ —
     proving the comparison above is not vacuous. */
  const reversed = evaluateSealing({
    session: session(),
    points: [...points].reverse().map((p, i) => ({ ...p, timestamp: T0 + i * 10_000 })),
  });
  assert.notDeepEqual(a.events, reversed.events);
});

test("a self-cross at high latitude behaves the same as one at the equator", () => {
  for (const origin of [
    { latitude: 0.0, longitude: 0.0 },
    { latitude: 69.65, longitude: 18.96 },
    { latitude: -16.5, longitude: 179.998 },
  ]) {
    const points: SealRoutePoint[] = LASSO.map(([e, n], i) => ({
      ...at(e, n, origin),
      timestamp: T0 + i * 10_000,
    }));
    const result = evaluateSealing({ session: session(), points });
    assert.equal(
      result.events.filter((ev) => ev.method === "self_cross").length,
      1,
      `lasso at ${origin.latitude} did not close exactly once`,
    );
  }
});

test("a route reaching past the trusted frame stops evaluating geometry, and says so", () => {
  /* Not silently wrong geometry, and not a thrown error either: the method
     becomes unavailable, which is a different statement from "did not seal". */
  const points: SealRoutePoint[] = [
    { latitude: 0, longitude: 0, timestamp: T0 },
    { latitude: 0.001, longitude: 0, timestamp: T0 + 10_000 },
    { latitude: 5, longitude: 0, timestamp: T0 + 20_000 },
  ];
  const result = evaluateSealing({ session: session(), points });
  assert.equal(result.status, "evaluated");
  assert.ok(
    result.unavailable.some(
      (u) => u.method === "self_cross" && u.reason === "route_outside_local_frame",
    ),
  );
});

/* ── pauses and gaps ──────────────────────────────────────────────────────── */

/** The lasso, but the closing step happens either side of an interruption. */
function interruptedLasso(pauses: PauseInterval[]): SealEvaluation {
  return evaluate(route(LASSO), { pauses });
}

test("a pause is never bridged by an imaginary straight line", () => {
  /* The player paused between the fourth and fifth fix. Whatever happened in
     that gap, the app did not see it, and the line across it is not evidence —
     so the cut it would have made does not exist. */
  const points = route(LASSO);
  const pause: PauseInterval = {
    startedAt: points[3]!.timestamp + 1_000,
    endedAt: points[4]!.timestamp - 1_000,
  };
  const result = interruptedLasso([pause]);
  assert.equal(result.events.filter((e) => e.method === "self_cross").length, 0);
  assert.equal(result.subpathCount, 2, "the route is two continuous stretches");
});

test("a crossing before a pause survives the pause", () => {
  /* The pause lands on the step that would have made the SECOND cut, so that
     one never happens — and the first, made long before, still stands. A break
     removes the geometry it interrupts and nothing else. */
  const points = route(DOUBLE_LASSO);
  const pause: PauseInterval = {
    startedAt: points[7]!.timestamp + 1_000,
    endedAt: points[8]!.timestamp - 1_000,
  };
  const result = evaluate(points, { pauses: [pause] });
  const crosses = result.events.filter((e) => e.method === "self_cross");
  assert.equal(crosses.length, 1, "the first loop was withdrawn by a later pause");
  assert.equal(crosses[0]!.startIndex, 1);
});

test("a genuine crossing after a resume still seals", () => {
  const points = route(DOUBLE_LASSO);
  /* The pause sits on a step neither crossing depends on — between the two
     loops. Both survive: a pause is not a session-wide veto on geometry. */
  const pause: PauseInterval = {
    startedAt: points[5]!.timestamp + 1_000,
    endedAt: points[6]!.timestamp - 1_000,
  };
  const result = evaluate(points, { pauses: [pause] });
  const crosses = result.events.filter((e) => e.method === "self_cross");
  assert.equal(crosses.length, 2, "both loops should survive a pause between them");
});

test("a tracking gap is a break too, recognised from the route itself", () => {
  /* Nothing tells the server the app was backgrounded. What it can see is a
     jump no sampling could have followed, and the line across that jump is the
     same guess a pause would have been. */
  const points = route([
    [0, 0],
    [0, 60],
    [60, 60],
    [60, 30],
    /* A 900 m detour appears between two fixes: the route between them is
       unknown, so the closing step is not a segment. */
    [-900, 30],
  ]);
  const result = evaluateSealing({ session: session(), points });
  assert.equal(result.events.filter((e) => e.method === "self_cross").length, 0);
  assert.equal(result.subpathCount, 2);
});

test("a break does not stop later stretches from crossing earlier ones", () => {
  /* Only the unobserved step is missing. The stretches either side are real
     route and may legitimately cut each other — refusing that would throw away
     evidence the app actually has. */
  const points = route([
    [0, 0],
    [0, 60],
    /* One unobserved jump, then ordinary sampling all the way back down and
       across the line from the first stretch. */
    [60, 660],
    [60, 500],
    [60, 340],
    [60, 180],
    [60, 30],
    [-30, 30],
  ]);
  const result = evaluateSealing({ session: session(), points });
  assert.equal(result.events.filter((e) => e.method === "self_cross").length, 1);
  assert.equal(result.subpathCount, 2);
});

test("return-to-start still evaluates across an interrupted route", () => {
  /* It depends on two endpoints, not on continuous geometry. Whether the
     enclosed shape is usable for territory is a later question, and the
     subpath count is what a later reader needs to decide it. */
  const points = route([[0, 0], [900, 0], [60, 0]]);
  const result = evaluateSealing({ session: session(), points });
  assert.ok(result.methods.includes("return_to_start"));
  assert.ok(result.subpathCount > 1, "the interruption is still recorded");
});

/* ── held ground ──────────────────────────────────────────────────────────── */

test("with no trusted territory the method is unavailable, never false", () => {
  const result = evaluate(route([[0, 0], [400, 0], [800, 0]]));
  assert.equal(result.methods.includes("finish_on_held_ground"), false);
  assert.deepEqual(
    result.unavailable.filter((u) => u.method === "finish_on_held_ground"),
    [{ method: "finish_on_held_ground", reason: "no_trusted_territory" }],
  );
});

test("finishing on held ground seals when an authority says it is held", () => {
  const points = route([[0, 0], [400, 0], [800, 0]]);
  const finishCell = cellForCoordinate(points[points.length - 1]!);
  const result = evaluateSealing({
    session: session(),
    points,
    heldCells: new Set([finishCell]),
  });
  assert.ok(result.methods.includes("finish_on_held_ground"));
  const event = result.events.find((e) => e.method === "finish_on_held_ground")!;
  assert.equal(event.atFinish, true);
  assert.equal(
    event.closure.kind,
    "undetermined",
    "what this method encloses is an open product question, not a guess",
  );
});

test("finishing off held ground does not seal, and is not unavailable either", () => {
  const points = route([[0, 0], [400, 0], [800, 0]]);
  const elsewhere = cellForCoordinate({ latitude: 51.5, longitude: -0.12 });
  const result = evaluateSealing({
    session: session(),
    points,
    heldCells: new Set([elsewhere]),
  });
  assert.equal(result.methods.includes("finish_on_held_ground"), false);
  assert.equal(
    result.unavailable.some((u) => u.method === "finish_on_held_ground"),
    false,
    "the method was evaluated; it simply did not seal",
  );
});

test("an empty trusted set means held nothing, not unknown", () => {
  const result = evaluateSealing({
    session: session(),
    points: route([[0, 0], [400, 0], [800, 0]]),
    heldCells: new Set<H3Cell>(),
  });
  assert.equal(result.methods.includes("finish_on_held_ground"), false);
  assert.equal(result.unavailable.some((u) => u.method === "finish_on_held_ground"), false);
});

test("held ground is the exact finish cell, never a neighbour", () => {
  const points = route([[0, 0], [400, 0], [800, 0]]);
  const finish = points[points.length - 1]!;
  /* A cell roughly 2 km away — adjacent enough to be a neighbour at this
     resolution, and not the cell the player is standing in. */
  const neighbour = cellForCoordinate(at(2_800, 0));
  assert.notEqual(neighbour, cellForCoordinate(finish));
  const result = evaluateSealing({
    session: session(),
    points,
    heldCells: new Set([neighbour]),
  });
  assert.equal(result.methods.includes("finish_on_held_ground"), false);
});

/* ── more than one method ─────────────────────────────────────────────────── */

test("a route that cuts its line and then comes home closes both ways", () => {
  /* Both are kept and ordered — mid-session closures first, then the finish.
     Collapsing them into one winning method would throw away a slice the
     territory work needs. */
  const result = evaluate(route([...LASSO, [-30, 100], [40, 100], [40, 20], [30, 20]]));
  assert.deepEqual(result.methods, ["self_cross", "return_to_start"]);
  assert.equal(result.events[0]!.atFinish, false);
  assert.equal(result.events[result.events.length - 1]!.atFinish, true);
  assert.deepEqual(
    result.events.map((e) => e.sequence),
    result.events.map((_, i) => i),
  );
});

test("two closures and a finish on held ground are all three kept, in order", () => {
  const points = route([...DOUBLE_LASSO, [-40, 20], [20, 20]]);
  const finishCell = cellForCoordinate(points[points.length - 1]!);
  const result = evaluateSealing({
    session: session(),
    points,
    heldCells: new Set([finishCell]),
  });
  assert.deepEqual(result.methods, ["self_cross", "return_to_start", "finish_on_held_ground"]);
  assert.equal(result.events.filter((e) => e.method === "self_cross").length, 2);
  assert.ok(isSealed(result));
});

test("an unsealed route is an ordinary outcome, not a failure", () => {
  const result = evaluate(route([[0, 0], [400, 0], [800, 0], [1200, 0]]));
  assert.equal(result.status, "evaluated");
  assert.deepEqual(result.events, []);
  assert.deepEqual(result.methods, []);
  assert.equal(isSealed(result), false);
});

/* ── no ownership anywhere near this ──────────────────────────────────────── */

test("a seal event carries no coordinate, and no territory vocabulary", () => {
  const result = evaluateSealing({
    session: session(),
    points: route(DOUBLE_LASSO),
    heldCells: new Set<H3Cell>(),
  });
  const serialized = JSON.stringify(result);
  /* The lasso runs through Bengaluru. None of it may be in the result — the
     event addresses the route by index, and only whoever holds the route can
     turn that back into a place. */
  for (const fragment of ["12.97", "77.59", "latitude", "longitude"]) {
    assert.ok(!serialized.includes(fragment), `a seal result carries ${fragment}`);
  }
  for (const forbidden of [
    "owner", "owned", "holder", "captured", "capture", "solid", "shade", "strength",
    "deed", "credits", "reward", "token", "toll",
  ]) {
    assert.ok(
      !serialized.toLowerCase().includes(forbidden),
      `a seal result claims ${forbidden}`,
    );
  }
  /* Keys, not substrings, for the words that legitimately appear inside other
     words — a closure that joins the route's two ends is `endpoints`, and a
     substring scan would read that as the economy's points. */
  assert.deepEqual(
    keysDeep(result).filter((k) => ["points", "xp", "value", "amount"].includes(k)),
    [],
    "a seal result grew a scoring field",
  );
});

test("the coordinate scan can see a coordinate, so a clean result means something", () => {
  const serialized = JSON.stringify({ point: route([[0, 0]])[0] });
  assert.ok(serialized.includes("12.97") && serialized.includes("latitude"));
});

function keysDeep(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) keysDeep(item, out);
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysDeep(v, out);
    }
  }
  return out;
}

/* ── the scanner ──────────────────────────────────────────────────────────── */

test("feeding points one at a time gives exactly the batch answer", () => {
  /* The live preview and the server's authority are the same algorithm, and
     this is where that stops being a claim. */
  for (const shape of [LASSO, DOUBLE_LASSO, [[0, 0], [300, 0], [300, 300]] as const]) {
    const points = route(shape as readonly (readonly [number, number])[]);
    const scanner = createSealScanner(RULES, []);
    const streamed = points.flatMap((p) => [...scanner.push(p)]);
    const batch = evaluateSealing({ session: session(), points }).events.filter(
      (e) => e.method === "self_cross",
    );
    assert.deepEqual(streamed, batch);
  }
});

test("the scanner reports a closure on the step that made it, not later", () => {
  const points = route(LASSO);
  const scanner = createSealScanner(RULES, []);
  const perPoint = points.map((p) => scanner.push(p).length);
  assert.deepEqual(perPoint, [0, 0, 0, 0, 1], "the seal must land on the crossing step");
});

test("two scanners never share state", () => {
  const a = createSealScanner(RULES, []);
  for (const p of route(LASSO)) a.push(p);
  assert.equal(a.events.length, 1);
  const b = createSealScanner(RULES, []);
  assert.equal(b.events.length, 0);
  assert.equal(b.length, 0);
  assert.equal(b.subpathCount, 0);
});

test("the index is bounded and the bound is a real one", () => {
  assert.ok(GRID_CELL_M > 0);
  assert.ok(MAX_SCAN_SEGMENTS >= 10_000, "the cap must be past any real session");
  assert.ok(MAX_SCAN_SEGMENTS <= 1_000_000, "the cap must actually bound memory");
});

test("a long ordinary route stays quiet and stays bounded", () => {
  /* Four thousand fixes — a couple of hours of movement — spiralling outward so
     the route never crosses itself. The cost of this test passing at all is the
     evidence that the candidate search is indexed rather than pairwise. */
  const points: SealRoutePoint[] = [];
  for (let i = 0; i < 4_000; i++) {
    const angle = i * 0.06;
    const radius = 20 + i * 0.6;
    points.push({
      ...at(Math.cos(angle) * radius, Math.sin(angle) * radius),
      timestamp: T0 + i * 4_000,
    });
  }
  const result = evaluateSealing({ session: session(), points });
  assert.equal(result.status, "evaluated");
  assert.equal(result.events.filter((e) => e.method === "self_cross").length, 0);
});

test("route continuation is excluded by properness, not only by the adjacency check", () => {
  /* The shared-vertex early-out is redundant today: a crossing must be strictly
     interior to both segments, and two segments meeting at a vertex meet at the
     end of one and the start of the other. This pins WHICH rule does the work,
     so a future version that let endpoint contact seal cannot silently turn
     every third fix into a closure.

     A right-angle turn is the whole test: the two segments share a vertex and
     touch nowhere else, and `segmentCrossing` — asked directly, with no
     adjacency filter in front of it — refuses. */
  const corner = { x: 0, y: 0 };
  assert.equal(
    segmentCrossing({ x: -50, y: 0 }, corner, corner, { x: 0, y: 50 }),
    null,
    "a shared vertex was read as a crossing",
  );
  /* And the same shape through the whole engine, many times over, stays quiet. */
  const staircase = evaluate(
    route(Array.from({ length: 80 }, (_, i) => [Math.floor(i / 2) * 25, (i % 2) * 25] as const)),
  );
  assert.equal(staircase.events.filter((e) => e.method === "self_cross").length, 0);
});
