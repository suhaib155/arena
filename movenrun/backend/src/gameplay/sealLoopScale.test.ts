/**
 * Sealing v2 at scale: long lollipops (the candidate search must find the
 * head however long the stick), claim scope (only fixes on or inside a
 * qualifying loop are claimable), and a bounded, fail-closed work budget on
 * worst-case-ish 10,000-point sessions. Synthetic geometry only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { projector } from "@movenrun/shared/geo";
import { ENCLOSED_LOOP_V1, evaluateSealLoop, SEAL_LOOP_REASONS, type SealLoopFix } from "./sealLoop.js";
import { fixtureFixes, STEP_MS, T0, toLatLng, polyline, type SealFixture } from "./sealLoopFixtures.js";

const R = ENCLOSED_LOOP_V1;
const ORIGIN = { latitude: 51.47, longitude: -0.05 };
const frame = projector(ORIGIN);
const xOf = (f: SealLoopFix) => frame.project({ latitude: f.lat, longitude: f.lng }).x;

/** A stick of `stick` metres east, a `w` x `h` block at its end (the stick meets the block's west side), and back along the stick. */
function lollipop(stick: number, w: number, h: number): [number, number][] {
  return [[0, 0], [stick, 0], [stick, h / 2], [stick + w, h / 2], [stick + w, -h / 2], [stick, -h / 2], [stick, 0], [0, 0]];
}

function walk(vertices: [number, number][], accuracy = 5, step = 14): SealLoopFix[] {
  return polyline(vertices, step).map(([x, y], i) => ({ ...toLatLng(x, y, ORIGIN), timestamp: T0 + i * STEP_MS, accuracy }));
}

function fixture(name: string, vertices: [number, number][]): SealFixture {
  return { name, group: "lollipop", shouldSeal: true, legs: [{ vertices }], origin: ORIGIN };
}

/** Every claimable fix lies on or in the head (x at least the stick's end, less the noise); most head fixes are claimable. */
function assertClaimsHeadOnly(fixes: SealLoopFix[], claim: number[], stick: number, w: number, slack: number, label: string) {
  assert.ok(claim.length > 0, `${label}: nothing claimable`);
  for (const q of claim) assert.ok(xOf(fixes[q]!) >= stick - slack, `${label}: fix ${q} at x ${xOf(fixes[q]!).toFixed(0)} m is on the stick`);
  const head = fixes.map((f, q) => [xOf(f), q] as const).filter(([x]) => x > stick + slack && x < stick + w - slack);
  const set = new Set(claim);
  const inHead = head.filter(([, q]) => set.has(q)).length;
  assert.ok(inHead >= 0.9 * head.length, `${label}: only ${inHead} of ${head.length} head fixes claimable`);
}

test("long lollipops seal on their head: a 100x100 m block after a 3 km and an 8 km stick, and only the head is claimable", () => {
  for (const stick of [3_000, 8_000]) {
    const fixes = walk(lollipop(stick, 100, 100));
    const r = evaluateSealLoop(fixes, [], R);
    assert.equal(r.sealed, true, `${stick} m stick: ${r.reason} after ${r.candidates} candidates, work ${r.work}`);
    assert.ok(r.work <= R.maxWorkUnits);
    assertClaimsHeadOnly(fixes, r.claimFixes, stick, 100, 15, `${stick} m stick`);
    for (const sigma of [5, 10]) for (let seed = 1; seed <= 4; seed++) {
      const noisy = fixtureFixes(fixture(`lollipop ${stick}`, lollipop(stick, 100, 100)), sigma, seed);
      const n = evaluateSealLoop(noisy, [], R);
      assert.equal(n.sealed, true, `${stick} m stick, sigma ${sigma}, seed ${seed}: ${n.reason}`);
      assertClaimsHeadOnly(noisy, n.claimFixes, stick, 100, 3 * sigma + 15, `${stick} m stick, sigma ${sigma}, seed ${seed}`);
    }
  }
});

test("a 50x50 m block after a 20 km stick gets the block's own verdict under the thresholds (seals at 5 m accuracy, not at 15 m), not one set by a cap", () => {
  for (const accuracy of [5, 15]) {
    const alone = evaluateSealLoop(walk([[0, 25], [50, 25], [50, -25], [0, -25], [0, 25]], accuracy), [], R);
    const r = evaluateSealLoop(walk(lollipop(20_000, 50, 50), accuracy), [], R);
    assert.equal(r.sealed, alone.sealed, `accuracy ${accuracy}: block alone ${alone.reason}, after the stick ${r.reason}`);
    // Unsealed either way; the reason may name a different failing candidate (the trim at 45 m eats into a 50 m block).
    if (alone.sealed) assert.equal(r.reason, "enclosed");
    assert.ok(r.work <= R.maxWorkUnits && r.reason !== "work_budget_exceeded");
  }
  assert.equal(evaluateSealLoop(walk(lollipop(20_000, 50, 50), 5), [], R).sealed, true);
  assert.equal(evaluateSealLoop(walk(lollipop(20_000, 50, 50), 15), [], R).sealed, false);
});

test("claim scope: a 2 km stick plus one 100x100 m block claims the block (on and inside it) and none of the stick", () => {
  // The block is crossed once through the middle, so fixes strictly inside the loop exist.
  const stick = 2_000;
  const v: [number, number][] = [[0, 0], [stick, 0], [stick, 50], [stick + 100, 50], [stick + 100, -50], [stick, -50], [stick, 0], [stick + 100, 0], [stick, 0], [0, 0]];
  const fixes = walk(v);
  const r = evaluateSealLoop(fixes, [], R);
  assert.equal(r.sealed, true, r.reason);
  assertClaimsHeadOnly(fixes, r.claimFixes, stick, 100, 15, "2 km stick");
  const stickFixes = fixes.filter((f) => xOf(f) < stick - 15).length;
  assert.ok(stickFixes > 250, "the stick is most of the route");
  assert.ok(r.claimFixes.length < fixes.length - stickFixes + 1);
  // Steps are filled only between claimable fixes.
  const set = new Set(r.claimFixes);
  for (const q of r.claimSteps) assert.ok(set.has(q) && set.has(q + 1));
});

/** Deterministic pseudo-random numbers. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 10,000 fixes, `step` metres apart, 10 s apart: a heading random walk (`turn` radians of jitter per step) confined to a `box` metre square. */
function randomWalk(seed: number, step: number, turn: number, box: number): SealLoopFix[] {
  const r = rng(seed);
  let x = 0, y = 0, h = r() * 2 * Math.PI;
  const out: SealLoopFix[] = [];
  for (let i = 0; i < 10_000; i++) {
    out.push({ ...toLatLng(x, y, ORIGIN), timestamp: T0 + i * STEP_MS, accuracy: 5 });
    h += (r() - 0.5) * 2 * turn;
    let nx = x + step * Math.cos(h), ny = y + step * Math.sin(h);
    if (Math.abs(nx) > box || Math.abs(ny) > box) { h += Math.PI; nx = x + step * Math.cos(h); ny = y + step * Math.sin(h); }
    x = nx; y = ny;
  }
  return out;
}

/** The stated bound for one 10,000-point evaluation on the test machine (it is a test of the budget, not a benchmark). */
const BOUND_MS = 2_000;

test(`bounded: worst-case-ish 10,000-point sessions finish in under ${BOUND_MS} ms each, within the work budget, with a valid reason`, () => {
  const cases: [string, SealLoopFix[]][] = [
    ["dense random direction, 5 m steps in 150 m", randomWalk(1, 5, Math.PI, 75)],
    ["dense random direction, 14 m steps in 300 m", randomWalk(2, 14, Math.PI, 150)],
    ["heading random walk, 5 m steps in 400 m", randomWalk(3, 5, 0.6, 200)],
    ["heading random walk, 14 m steps in 1 km", randomWalk(4, 14, 0.4, 500)],
    ["back and forth on one 140 m line", walk(Array.from({ length: 72 }, (_, i) => [i % 2 === 0 ? 0 : 140, 0] as [number, number]), 5, 1)],
    ["lawnmower, 30 m rows, 10,000 fixes", walk(Array.from({ length: 200 }, (_, i) => [[i % 2 === 0 ? 0 : 700, i * 30], [i % 2 === 0 ? 700 : 0, i * 30]] as [number, number][]).flat(), 5, 14).slice(0, 10_000)],
  ];
  for (const [name, fixes] of cases) {
    assert.ok(fixes.length >= 9_000, `${name}: ${fixes.length} fixes`);
    const t0 = performance.now();
    const r = evaluateSealLoop(fixes, [], R);
    const ms = performance.now() - t0;
    assert.ok(ms < BOUND_MS, `${name}: ${ms.toFixed(0)} ms`);
    assert.ok(r.work <= R.maxWorkUnits, `${name}: work ${r.work}`);
    assert.ok((SEAL_LOOP_REASONS as readonly string[]).includes(r.reason));
    assert.equal(r.sealed, r.reason === "enclosed");
    if (!r.sealed) assert.deepEqual(r.claimFixes, []);
    if (process.env.SEAL_TIMING) console.log(`${name}: ${fixes.length} fixes, ${ms.toFixed(0)} ms, work ${r.work}, ${r.candidates} candidates, ${r.reason}`);
  }
});

test("honest long sessions still seal within the budget: 50 laps of a 1 km park at 5 m, 140 laps at 14 m with 5 and 10 m GPS error", () => {
  const laps = (count: number): [number, number][] => {
    const v: [number, number][] = [[0, 0]];
    for (let l = 0; l < count; l++) v.push([250, 0], [250, 250], [0, 250], [0, 0]);
    return v;
  };
  const cases: [string, SealLoopFix[]][] = [
    ["50 laps, 5 m", walk(laps(50), 5, 5)],
    ["140 laps, 14 m, sigma 5", fixtureFixes(fixture("laps", laps(140)), 5, 1)],
    ["140 laps, 14 m, sigma 10", fixtureFixes(fixture("laps", laps(140)), 10, 2)],
  ];
  for (const [name, fixes] of cases) {
    assert.ok(fixes.length >= 10_000, `${name}: ${fixes.length}`);
    const t0 = performance.now();
    const r = evaluateSealLoop(fixes, [], R);
    const ms = performance.now() - t0;
    assert.equal(r.sealed, true, `${name}: ${r.reason}`);
    assert.ok(ms < BOUND_MS, `${name}: ${ms.toFixed(0)} ms`);
    if (process.env.SEAL_TIMING) console.log(`${name}: ${fixes.length} fixes, ${ms.toFixed(0)} ms, work ${r.work}, ${r.candidates} candidates, ${r.claimFixes.length} claimable`);
  }
});

test("the budget fails closed: with too little work allowed the answer is no, with reason work_budget_exceeded", () => {
  const fixes = walk(lollipop(3_000, 100, 100));
  const r = evaluateSealLoop(fixes, [], { ...R, maxWorkUnits: 5_000 });
  assert.equal(r.sealed, false);
  assert.equal(r.reason, "work_budget_exceeded");
  assert.deepEqual(r.claimFixes, []);
});
