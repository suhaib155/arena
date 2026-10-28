/**
 * Sealing v2 (enclosed-loop v1): the territory seal on synthetic fixtures
 * (sealLoopFixtures.ts, docs/g34/SEALING_V2_28OCT.md). Pure; no database.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { latLngToCell } from "h3-js";
import { evaluateSealing } from "@movenrun/shared/sealing";
import { DEFAULT_MOVEMENT_MODE, SESSION_RULES_VERSION } from "@movenrun/shared/session";
import { territorySealFor } from "../movement/http/productionRouter.js";
import { ENCLOSED_LOOP_V1, evaluateSealLoop, sealLoopRuleProblems, type SealLoopFix } from "./sealLoop.js";
import { fixtureFixes, polyline, SEAL_FIXTURES, STEP_MS, T0, toLatLng, type SealFixture } from "./sealLoopFixtures.js";

const R = ENCLOSED_LOOP_V1;
const byName = (name: string): SealFixture => {
  const f = SEAL_FIXTURES.find((x) => x.name === name);
  assert.ok(f, name);
  return f;
};

function v1Seals(fixes: SealLoopFix[]): boolean {
  return evaluateSealing({
    session: { mode: DEFAULT_MOVEMENT_MODE, rulesVersion: SESSION_RULES_VERSION, startedAt: fixes[0]!.timestamp - 1000, finishedAt: fixes[fixes.length - 1]!.timestamp + 1000, pauses: [] },
    points: fixes.map((p) => ({ latitude: p.lat, longitude: p.lng, timestamp: p.timestamp, ...(p.breakBefore ? { breakBefore: true } : {}) })),
    heldCells: null,
  }).events.length > 0;
}

/** Fixes every `step` metres along `vertices`, one every 10 s, 5 m accuracy. */
function walk(vertices: [number, number][], step = 14, accuracy: number | null = 5): SealLoopFix[] {
  return polyline(vertices, step).map(([x, y], i) => ({ ...toLatLng(x, y, { latitude: 51.52, longitude: -0.1 }), timestamp: T0 + i * STEP_MS, ...(accuracy === null ? {} : { accuracy }) }));
}

test("every fixture without GPS error: fair routes enclose ground, every loophole does not, and the movement engine (v1) sealed the loopholes", () => {
  const loopholesV1Sealed: string[] = [];
  for (const f of SEAL_FIXTURES) {
    const fixes = fixtureFixes(f);
    const r = evaluateSealLoop(fixes, [], R);
    if (f.shouldSeal === true) assert.equal(r.sealed, true, `${f.name}: ${r.reason}`);
    if (f.shouldSeal === false) {
      assert.equal(r.sealed, false, `${f.name}: ${JSON.stringify(r.best)}`);
      if (v1Seals(fixes)) loopholesV1Sealed.push(f.name);
    }
  }
  // The loopholes this closes: all but the 12 m loop (which v1 never sealed) were claimable under v1.
  assert.equal(loopholesV1Sealed.length, SEAL_FIXTURES.filter((f) => f.shouldSeal === false).length - 1);
});

test("GPS error never seals a route that encloses nothing: out-and-backs, knots, spurs and spoofed gaps stay unsealed at 5-25 m", () => {
  const never = SEAL_FIXTURES.filter((f) => ["out-and-back", "spur", "spoof-gap"].includes(f.group) || f.name === "figure eight 60x30 m");
  for (const f of never) for (const sigma of [5, 10, 15, 25]) for (let seed = 1; seed <= 6; seed++) {
    assert.equal(evaluateSealLoop(fixtureFixes(f, sigma, seed), [], R).sealed, false, `${f.name} sigma ${sigma} seed ${seed}`);
  }
});

test("fair loops survive ordinary GPS error (5 and 10 m): parks, blocks and loops of 300 m and up", () => {
  const fair = SEAL_FIXTURES.filter((f) => f.shouldSeal === true && !["short loop 200 m (50 m square)", "short loop 250 m", "loop 200x200, stops 40 m short of start"].includes(f.name));
  for (const f of fair) for (const sigma of [5, 10]) {
    let ok = 0;
    for (let seed = 1; seed <= 6; seed++) if (evaluateSealLoop(fixtureFixes(f, sigma, seed), [], R).sealed) ok += 1;
    assert.ok(ok >= 5, `${f.name} sigma ${sigma}: ${ok}/6`);
  }
});

test("the gap rule: a step is observed only when unbroken, at most 50 m, at most 2 min and at most 12 m/s; a loop never crosses a gap", () => {
  // A 200 x 200 m block whose east side has one long step of `gap` metres taking `ms`.
  const block = (gap: number, ms: number, opts: { breakBefore?: boolean } = {}): SealLoopFix[] => {
    const a = walk([[0, 0], [200, 0], [200, 100 - gap / 2]]);
    const b = walk([[200, 100 + gap / 2], [200, 200], [0, 200], [0, 0]]);
    const t0 = a[a.length - 1]!.timestamp + ms;
    return [...a, ...b.map((p, i) => ({ ...p, timestamp: t0 + i * STEP_MS, ...(i === 0 && opts.breakBefore ? { breakBefore: true } : {}) }))];
  };
  assert.equal(evaluateSealLoop(block(50, 20_000), [], R).sealed, true, "50 m in 20 s is a step");
  assert.equal(evaluateSealLoop(block(51, 20_000), [], R).reason, "no_closed_loop", "51 m is a gap");
  assert.equal(evaluateSealLoop(block(150, 60_000), [], R).sealed, false, "v1 drew this 150 m line; v2 never does");
  assert.equal(evaluateSealLoop(block(30, 121_000), [], R).sealed, false, "over two minutes unobserved");
  assert.equal(evaluateSealLoop(block(48, 3_000), [], R).sealed, false, "16 m/s is not on foot");
  assert.equal(evaluateSealLoop(block(20, 15_000, { breakBefore: true }), [], R).sealed, false, "a declared break");
  const fixes = block(20, 15_000);
  const t = fixes.find((_, i) => i > 0 && fixes[i]!.timestamp - fixes[i - 1]!.timestamp === 15_000)!.timestamp;
  assert.equal(evaluateSealLoop(fixes, [{ startedAt: t - 10_000, endedAt: t - 5_000 }], R).sealed, false, "a pause");
  assert.equal(evaluateSealLoop(fixes, [], R).sealed, true);
  // v1 seals the 150 m one: this is the loophole.
  assert.equal(v1Seals(block(150, 60_000)), true);
});

test("closing edge: finishing within 50 m of a point walked earlier closes the loop; 80 m does not (v1 allowed 150 m)", () => {
  assert.equal(evaluateSealLoop(walk([[0, 0], [200, 0], [200, 200], [0, 200], [0, 45]]), [], R).sealed, true);
  assert.equal(evaluateSealLoop(walk([[0, 0], [200, 0], [200, 200], [0, 200], [0, 80]]), [], R).sealed, false);
  // A near pass in the middle of a walk counts too, with no invented edge longer than one step.
  assert.equal(evaluateSealLoop(walk([[-300, 0], [0, 0], [200, 0], [200, 200], [0, 200], [0, 30], [-300, 30]]), [], R).sealed, true);
});

test("GPS uncertainty raises the bar: the same 50 m square seals at 5 m accuracy, not at 15 m; a missing accuracy counts as 40 m", () => {
  const sq: [number, number][] = [[0, 0], [50, 0], [50, 50], [0, 50], [0, 0]];
  const good = evaluateSealLoop(walk(sq, 14, 5), [], R);
  assert.equal(good.sealed, true);
  const poor = evaluateSealLoop(walk(sq, 14, 15), [], R);
  assert.equal(poor.reason, "loop_too_thin");
  assert.equal(evaluateSealLoop(walk(sq, 14, null), [], R).sealed, false);
  assert.equal(evaluateSealLoop(walk([[0, 0], [300, 0], [300, 300], [0, 300], [0, 0]], 14, null), [], R).sealed, true, "a big loop still seals");
});

test("figure eight: each lobe is a loop; the whole eight's signed area cancels and is not what seals", () => {
  const f = byName("figure eight 1200x600 m");
  const r = evaluateSealLoop(fixtureFixes(f), [], R);
  assert.equal(r.sealed, true);
  assert.ok(r.best!.areaM2 < 600 * 300 * 2, "one lobe, not the bounding box");
});

test("H3 boundaries do not matter: the same block seals inside one resolution 8 cell and across a boundary", () => {
  const inside = byName("block 100x150 inside one res8 cell");
  const across = byName("block 100x150 across a res8 boundary");
  const cells = (f: SealFixture, res: number) => new Set(fixtureFixes(f).map((p) => latLngToCell(p.lat, p.lng, res))).size;
  assert.equal(cells(inside, 8), 1);
  assert.ok(cells(across, 8) >= 2);
  assert.ok(cells(inside, 10) >= 2 && cells(across, 10) >= 2);
  const a = evaluateSealLoop(fixtureFixes(inside), [], R), b = evaluateSealLoop(fixtureFixes(across), [], R);
  assert.equal(a.sealed, true);
  assert.equal(b.sealed, true);
  assert.ok(Math.abs(a.best!.areaM2 - b.best!.areaM2) < 1);
});

test("bounded and deterministic: a noisy 10 km out-and-back measures at most the candidate cap and gives the same answer twice", () => {
  const f: SealFixture = { name: "long", group: "out-and-back", shouldSeal: false, legs: [{ vertices: [[0, 0], [5000, 0], [0, 0]] }] };
  const fixes = fixtureFixes(f, 15, 3);
  const started = performance.now();
  const r = evaluateSealLoop(fixes, [], R);
  const ms = performance.now() - started;
  assert.equal(r.sealed, false);
  assert.ok(r.candidates <= R.maxCandidates);
  assert.deepEqual(evaluateSealLoop(fixes, [], R), r);
  assert.ok(ms < 5_000, `${Math.round(ms)} ms`);
});

test("refusals: too few fixes, an invalid coordinate", () => {
  assert.equal(evaluateSealLoop(walk([[0, 0], [20, 0]]), [], R).reason, "insufficient_route");
  const bad = walk([[0, 0], [200, 0], [200, 200], [0, 200], [0, 0]]);
  bad[3] = { ...bad[3]!, lat: Number.NaN };
  assert.equal(evaluateSealLoop(bad, [], R).reason, "insufficient_route");
});

test("the rule's numbers are checked, and the stored result is a version, a verdict and a reason code only", () => {
  assert.deepEqual(sealLoopRuleProblems(R), []);
  assert.ok(sealLoopRuleProblems({ ...R, maxClosureMeters: 60 }).length > 0);
  assert.ok(sealLoopRuleProblems({ ...R, maxStepMeters: 250, maxClosureMeters: 50 }).length > 0);
  assert.ok(sealLoopRuleProblems({ ...R, maxSpeedMetersPerSecond: 20 }).length > 0);
  assert.ok(sealLoopRuleProblems({ ...R, version: 2 as never }).length > 0);
  const fixes = walk([[0, 0], [200, 0], [200, 200], [0, 200], [0, 0]]);
  const stored = territorySealFor(R)({ startTime: fixes[0]!.timestamp, endTime: fixes[fixes.length - 1]!.timestamp,
    points: fixes.map((p) => ({ lat: p.lat, lng: p.lng, accuracy: 5, timestamp: p.timestamp })) });
  assert.deepEqual(stored, { version: 1, sealed: true, reason: "enclosed" });
});
