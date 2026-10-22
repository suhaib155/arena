import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HERE, loadManifest } from "./helpers.ts";
import { segmentSweep, sparseWalkSweep } from "./sweep.ts";

test("sweeps are deterministic: same manifest, byte-identical CSV, equal to the committed outputs", () => {
  const m = loadManifest();
  const a = segmentSweep(m), b = sparseWalkSweep(m);
  assert.equal(segmentSweep(m), a);
  assert.equal(sparseWalkSweep(m), b);
  for (const [file, body] of [["segment_sweep.csv", a], ["sparse_walk_sweep.csv", b]] as const) {
    const p = join(HERE, "out", file);
    if (existsSync(p)) assert.equal(readFileSync(p, "utf8"), body, `${file} is stale: rerun run.ts`);
  }
});

test("H1 holds on the sweep; H3 is NOT supported: random right-angle walks pushed no off-route unit at any fix interval, sparse fixes lose units instead", () => {
  const m = loadManifest();
  const seg = segmentSweep(m).trim().split("\n").slice(1).map((r) => r.split(",").map(Number));
  for (const r of seg) assert.ok(r[3]! > 0, `seed ${r[0]}: some walkable gaps interpolate`);
  const sw = sparseWalkSweep(m).trim().split("\n").slice(1).map((r) => r.split(",").map(Number));
  const sum = (s: number, col: number) => sw.filter((r) => r[1] === s).reduce((a, r) => a + r[col]!, 0);
  // Recorded outcome, not a pass criterion chosen after the fact: H3 predicted off(100) > off(10); the sample shows 0 and 0.
  assert.equal(sum(100, 4), 0);
  assert.equal(sum(10, 4), 0);
  assert.ok(sum(100, 2) < sum(5, 2), "fewer units pushed with sparse fixes (lower recall)");
});
