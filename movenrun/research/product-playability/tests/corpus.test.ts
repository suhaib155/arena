/**
 * The synthetic route corpus against today's client and server code.
 *
 * A fixture whose product expectation holds is a PASS. A fixture with a
 * recorded `knownDefect` is reported as TODO, never PASS, and a second test
 * proves the defect still reproduces, so the register cannot silently go stale
 * in either direction: fixing a defect fails "still reproduces" until the
 * fixture's `knownDefect` is removed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURES } from "../synthetic-routes/fixtures";
import { evaluate, measure } from "../synthetic-routes/measure";
import { sample } from "../synthetic-routes/scenario";

for (const fixture of FIXTURES) {
  const label = `${fixture.id}: ${fixture.title}`;
  if (fixture.knownDefect) {
    test(`[known defect] ${label}`, { todo: fixture.knownDefect }, async () => {
      const failed = evaluate(fixture, await measure(fixture)).filter((c) => !c.pass);
      assert.deepEqual(failed, []);
    });
    test(`[defect still reproduces] ${fixture.id}`, async () => {
      const failed = evaluate(fixture, await measure(fixture)).filter((c) => !c.pass);
      assert.ok(failed.length > 0, `${fixture.id} now meets its expectation: remove knownDefect and update the register`);
    });
  } else {
    test(label, async () => {
      const failed = evaluate(fixture, await measure(fixture)).filter((c) => !c.pass);
      assert.deepEqual(failed.map((c) => `${c.name}: ${c.detail}`), []);
    });
  }
}

test("every fixture is deterministic for its seed", () => {
  for (const fixture of FIXTURES) {
    assert.deepEqual(sample(fixture.scenario), sample(fixture.scenario), fixture.id);
  }
});

test("fixture ids are unique and every category in the spec is covered", () => {
  const ids = FIXTURES.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  const categories = new Set(FIXTURES.map((f) => f.category));
  for (const c of ["stationary", "walk", "threshold", "acquisition", "signal", "integrity", "clock", "lifecycle", "calendar", "social"]) {
    assert.ok(categories.has(c as never), `missing category ${c}`);
  }
});

test("no fixture is placed near a populated area: every coordinate is open ocean", () => {
  for (const fixture of FIXTURES) {
    for (const s of sample(fixture.scenario)) {
      if (!s.reported) continue;
      // The synthetic origin is at 0.5 N, 25.5 W, in the open Atlantic; fixtures stay within a few km.
      assert.ok(Math.abs(s.reported.latitude - 0.5) < 0.1 && Math.abs(s.reported.longitude + 25.5) < 0.1, fixture.id);
    }
  }
});
