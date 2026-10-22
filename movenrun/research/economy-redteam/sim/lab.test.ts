import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { VERIFIED_STEPS_V1 } from "../../../backend/src/gameplay/path.ts";
import { PILOT_PROPOSAL, rulesetDigest, rulesetProblems, SIM_PILOT_2_PROPOSAL } from "../../../backend/src/gameplay/rules.ts";
import { gini, hhi, runVariant } from "./engine.ts";
import { allocate, buildScenario, type ScenarioSpec } from "./population.ts";
import { loadManifest, meanCi } from "./run.ts";
import { VARIANTS, variant } from "./variants.ts";

const m = loadManifest();
const SPEC: ScenarioSpec = { seed: 101, population: 25, horizonDays: 10, maliciousShare: 0.2, density: "high", timingNoise: true };
const digest = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");

// Digests of the server rule objects as this lab was written against them (base cb27318).
const DIGEST_1001 = rulesetDigest(PILOT_PROPOSAL);
const DIGEST_1002 = rulesetDigest(SIM_PILOT_2_PROPOSAL);

test("same seed gives byte-identical participants, sessions and results", () => {
  const a = buildScenario(SPEC, m, VERIFIED_STEPS_V1);
  const b = buildScenario(SPEC, m, VERIFIED_STEPS_V1);
  const key = (sc: typeof a) => digest(sc.sessions.map((s) => [s.id, s.walker, s.route.id, s.route.clean.res10, s.gapped, s.slice, s.endMs, s.receivedMs]));
  assert.equal(key(a), key(b));
  assert.deepEqual(a.participants, b.participants);
  for (const id of ["R1001", "R1002", "R1002-nogap"]) {
    assert.equal(digest(runVariant(a, variant(id)).row), digest(runVariant(b, variant(id)).row), id);
  }
  const c = buildScenario({ ...SPEC, seed: 202 }, m, VERIFIED_STEPS_V1);
  assert.notEqual(key(a), key(c), "a different seed gives different sessions");
});

test("R1001 and R1002 are the server's rule objects, unchanged", () => {
  assert.equal(variant("R1001").rules, PILOT_PROPOSAL);
  assert.equal(variant("R1001-res10").rules, PILOT_PROPOSAL);
  assert.equal(variant("R1002").rules, SIM_PILOT_2_PROPOSAL);
  assert.ok(Object.isFrozen(PILOT_PROPOSAL) && Object.isFrozen(SIM_PILOT_2_PROPOSAL));
  assert.equal(PILOT_PROPOSAL.holding.rulesVersion, 1001);
  assert.equal(SIM_PILOT_2_PROPOSAL.holding.rulesVersion, 1002);
  assert.equal(PILOT_PROPOSAL.ruleset, "server-pilot-proposal-1");
  assert.equal(SIM_PILOT_2_PROPOSAL.ruleset, "server-sim-pilot-2-proposal");
  // Running the lab does not change them.
  const sc = buildScenario(SPEC, m, VERIFIED_STEPS_V1);
  for (const v of VARIANTS) runVariant(sc, v);
  assert.equal(rulesetDigest(PILOT_PROPOSAL), DIGEST_1001);
  assert.equal(rulesetDigest(SIM_PILOT_2_PROPOSAL), DIGEST_1002);
});

test("every lab variant is a well-formed rule set and differs from 1002 only where its id says", () => {
  for (const v of VARIANTS) assert.deepEqual(rulesetProblems(v.rules), [], v.id);
  const base = JSON.parse(JSON.stringify(SIM_PILOT_2_PROPOSAL));
  const diff = (id: string) => Object.keys(base).filter((k) => JSON.stringify((variant(id).rules as Record<string, unknown>)[k]) !== JSON.stringify(base[k])).sort();
  assert.deepEqual(diff("R1002-nogap"), ["takeover"]);
  assert.deepEqual(diff("R1002-gap24"), ["takeover"]);
  assert.deepEqual(diff("R1002-win2"), ["holding", "takeover"]);
  assert.deepEqual(diff("R1002-b5"), ["takeBudget"]);
  assert.deepEqual(diff("R1002-b20"), ["takeBudget"]);
  assert.deepEqual(diff("R1002-unitorder"), ["takeBudget"]);
  assert.deepEqual(diff("R1002-stepped"), ["units"]);
  assert.deepEqual(diff("R1002-ub150"), []);
  assert.notEqual(variant("R1002-win2").rules.holding.rulesVersion, 1002, "a changed holding rule never carries a server version");
  assert.equal(new Set(VARIANTS.map((v) => v.id)).size, VARIANTS.length);
  assert.deepEqual(VARIANTS.map((v) => v.id), m.allVariants);
});

test("invariants hold in every variant: consistent units, one push per walker/unit/day, budgets never exceeded", () => {
  const sc = buildScenario(SPEC, m, VERIFIED_STEPS_V1);
  for (const v of VARIANTS) {
    const r = runVariant(sc, v, { audit: true });
    assert.deepEqual(r.invariantViolations, [], v.id);
    assert.equal(r.row.invariantViolations, 0);
  }
});

test("the 20 h gap stops straddle completions that the no-gap intervention allows", () => {
  const sc = buildScenario(SPEC, m, VERIFIED_STEPS_V1);
  const gap = runVariant(sc, variant("R1002")).row;
  const nogap = runVariant(sc, variant("R1002-nogap")).row;
  assert.equal(gap.straddleFlips, 0);
  assert.ok((nogap.straddleFlips as number) > 0, "the fixture's attackers straddle midnight");
});

test("statistics helpers", () => {
  assert.equal(gini([1, 1, 1, 1]), 0);
  assert.equal(gini([0, 0, 0, 4]), 0.75);
  assert.equal(hhi([5, 5]), 5000);
  assert.equal(hhi([10]), 10000);
  const ci = meanCi([1, 2, 3]);
  assert.equal(ci.mean, 2);
  assert.ok(Math.abs(ci.hi - (2 + 4.303 / Math.sqrt(3))) < 1e-9);
  assert.deepEqual([...allocate(10, { a: 0.5, b: 0.3, c: 0.2 }, ["a", "b", "c"]).values()], [5, 3, 2]);
});
