/**
 * SIMULATION ONLY: the same-seed study after authoritative pushes. Real versus
 * inferred unit counting, the "before" control, identical inputs across rule
 * sets, thinning, and that no rule set changes. Not evidence about real players.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SCENARIOS, STUDY_METRICS, STUDY_RUNS, runScenario, summarize } from "./experiments/afterAuthoritative.js";
import { DEFAULT_1003, prepare1003, thinFixes } from "./experiments/harness1003.js";
import { DEFAULT_RULES_VERSION, PILOT_PROPOSAL, SIM_PILOT_2_PROPOSAL, rulesetDigest } from "./rules.js";

const SMALL = {
  days: 16,
  counts: { commuter: 3, runner: 1, loop: 2, long: 1, household: 2, sibling: 3, shared: 2, transit: 1, drift: 1, duplicate: 2, malicious: 1, spoofer: 1, ring: 2 },
};
const sc = (id: string) => SCENARIOS.find((s) => s.id === id)!;
const small = (id: string, seeds = [3]) => seeds.map((seed) => runScenario({ ...sc(id), over: { ...sc(id).over, ...SMALL } }, [seed], SMALL.days)[0]!);

test("authoritative pushes: inferred units are stored but never pushed, under every rule set", () => {
  const [rows] = small("after");
  for (const r of rows!) {
    assert.equal(r.inferredUnitsPushed, 0, `${r.label} pushes no inferred unit`);
    assert.ok(r.realUnitsPushed > 0);
    assert.equal(r.storedPathUnits, r.realUnitsPushed + r.inferredUnitsStored, `${r.label}: stored = real + inferred`);
  }
  const fine = rows!.filter((r) => r.label !== "1001");
  assert.ok(fine.every((r) => r.inferredUnitsStored > 0), "the path still keeps its inferred units for display");
  assert.equal(rows!.find((r) => r.label === "1001")!.inferredUnitsStored, 0, "a resolution 8 stored cell always holds a fix");
});

test("the before control pushes inferred units, and the same sessions are used", () => {
  const [before] = small("before");
  const [after] = small("after");
  const b = before!.find((r) => r.label === "1002")!, a = after!.find((r) => r.label === "1002")!;
  assert.ok(b.inferredUnitsPushed > 0, "pre-#152 behaviour is reproduced");
  assert.equal(a.inferredUnitsPushed, 0);
  assert.equal(b.acceptedSessions, a.acceptedSessions, "identical sessions");
  assert.equal(b.inferredUnitsStored, a.inferredUnitsStored, "the stored path is identical; only the push set differs");
  assert.equal(b.realUnitsPushed, a.realUnitsPushed, "real pushes are the same units");
  assert.ok(b.pushEvents > a.pushEvents);
});

test("every rule set of a scenario sees the same accepted sessions; 1001 is unaffected by the push switch", () => {
  const [rows] = small("after");
  const n = rows![0]!.acceptedSessions;
  assert.ok(rows!.every((r) => r.acceptedSessions === n));
  const [b] = small("before");
  assert.deepEqual(b!.find((r) => r.label === "1001")!.cohorts, rows!.find((r) => r.label === "1001")!.cohorts);
});

test("thinning keeps the first and last fix, keeps order, and is deterministic", () => {
  const f = Array.from({ length: 11 }, (_, i) => i);
  assert.deepEqual(thinFixes(f, 1), f);
  assert.deepEqual(thinFixes(f, 3), [0, 3, 6, 9, 10]);
  assert.deepEqual(thinFixes([1, 2], 5), [1, 2]);
  assert.throws(() => thinFixes(f, 0));
  assert.throws(() => thinFixes(f, 1.5));
  const spec = { ...DEFAULT_1003, ...SMALL, seed: 2 };
  const full = prepare1003(spec), thin = prepare1003({ ...spec, fixThin: 3 });
  assert.deepEqual(thin.sessions.map((s) => s.walker), full.sessions.map((s) => s.walker), "same sessions, same order");
  assert.ok(thin.sessions.every((s, i) => s.fixes[0]!.timestamp === full.sessions[i]!.fixes[0]!.timestamp && s.fixes.at(-1)!.timestamp === full.sessions[i]!.fixes.at(-1)!.timestamp));
  assert.ok(thin.counts10.reduce((a, c) => a + c.inferredStored, 0) > full.counts10.reduce((a, c) => a + c.inferredStored, 0), "sparser fixes mean more inferred units");
  assert.ok(thin.counts10.every((c) => c.inferredPushed === 0));
});

test("metrics: bounded, consistent and the retention snapshots are ordered sensibly", () => {
  const runs = small("after", [1, 2]);
  const rows = summarize(runs, SMALL.days);
  assert.equal(rows.length, STUDY_METRICS.length * STUDY_RUNS.length);
  for (const r of rows) {
    assert.ok(Number.isFinite(r.mean) && r.min <= r.mean + 1e-9 && r.mean <= r.max + 1e-9, `${r.key}/${r.label}`);
    const m = STUDY_METRICS.find((x) => x.key === r.key)!;
    if (m.pct) assert.ok(r.min >= 0 && r.max <= 1 + 1e-9, `${r.key} is a share`);
  }
  for (const run of runs) for (const r of run) {
    assert.ok(r.unheldEnd <= r.touchedUnits && r.unheld14 + r.held14 <= r.touchedUnits);
    assert.ok(r.held14StillSameEnd <= r.held14 && r.honestHeld14StillSameEnd <= r.honestHeld14 && r.honestHeld14 <= r.held14);
    assert.ok(r.unitsFlipped2plus <= r.flipsTotal);
  }
});

test("1002 blocks honest walker-days far more than 1003B, and 3 a day more than 5 a day (direction only, small synthetic set)", () => {
  const rows = summarize(small("after", [1, 2, 3]), SMALL.days);
  const v = (label: string) => rows.find((r) => r.key === "blocked_honest_days" && r.label === label)!.mean;
  assert.equal(v("1001"), 0);
  assert.ok(v("1002") > v("1003B3"), `1002 ${v("1002")} vs B3 ${v("1003B3")}`);
  assert.ok(v("1003B3") >= v("1003B5"), `B3 ${v("1003B3")} vs B5 ${v("1003B5")}`);
});

test("no rule set changes: 1001 stays the default with its digest, 1002 digest is the post-#152 one, every scenario is a distinct spec", () => {
  assert.equal(DEFAULT_RULES_VERSION, 1001);
  assert.equal(rulesetDigest(PILOT_PROPOSAL), "d4199ec60958750007bfa8884c88aad1bf810aed6bd2a054abb5dc74ffe41cd6");
  assert.equal(rulesetDigest(SIM_PILOT_2_PROPOSAL), "92e8e3cb12ac1f2cc07aeca2a9d50b9424182951a69de2fb8cd91c79cf27b788");
  assert.equal(SIM_PILOT_2_PROPOSAL.units.source!.rule.pushInterpolated, false);
  assert.equal(new Set(SCENARIOS.map((s) => s.id)).size, SCENARIOS.length);
  assert.deepEqual(STUDY_RUNS.map((r) => r.label), ["1001", "1002", "1003B5", "1003B3"]);
});
