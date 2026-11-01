/** The lifecycle capacity model (SIMULATION ONLY): levels, monotonicity and the hard-stop solver. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ASSUMED_TRIPWIRES, levelOf, maxPlayersUnder, projectLifecycle, scaledInputs } from "./lifecycleCapacity.js";

test("tripwire levels at 60 / 75 / 85% of the assumed 500 MiB, failing closed on nonsense", () => {
  assert.equal(levelOf(299), "ok");
  assert.equal(levelOf(300), "warn");
  assert.equal(levelOf(375), "backpressure");
  assert.equal(levelOf(425), "fail_closed");
  assert.equal(levelOf(Number.NaN), "fail_closed");
});

test("more players, seasons, hostility or churn never shrink the projection", () => {
  const base = { players: 500, hostileShare: 0, seasons: 1, churn: "vacuum_keeps_up" as const };
  const t = (o: Partial<typeof base> | { churn: "bench_bloat" }) => projectLifecycle({ ...base, ...o }).totalMiB;
  assert.ok(t({ players: 1_000 }) > t({}));
  assert.ok(t({ seasons: 4 }) > t({}));
  assert.ok(t({ hostileShare: 0.1 }) > t({ hostileShare: 0.02 }));
  assert.ok(t({ churn: "bench_bloat" }) > t({}));
  const p = projectLifecycle(base);
  assert.ok(Math.abs(Object.values(p.parts).reduce((a, b) => a + b, 0) - p.totalMiB) < 1e-6);
});

test("the 200-player pilot cap fits every profile; the solver lands just under the line", () => {
  for (const hostileShare of [0, 0.02, 0.1]) for (const seasons of [1, 4]) {
    assert.equal(levelOf(projectLifecycle({ players: 200, hostileShare, seasons, churn: "bench_bloat" }).totalMiB), "ok");
    const n = maxPlayersUnder({ hostileShare, seasons, churn: "vacuum_keeps_up" }, 0.85);
    const line = 0.85 * ASSUMED_TRIPWIRES.quotaMiB;
    assert.ok(projectLifecycle({ players: n, hostileShare, seasons, churn: "vacuum_keeps_up" }).totalMiB < line);
    assert.ok(projectLifecycle({ players: n + 1, hostileShare, seasons, churn: "vacuum_keeps_up" }).totalMiB >= line);
  }
  assert.ok(maxPlayersUnder({ hostileShare: 0, seasons: 1, churn: "vacuum_keeps_up" }, 0.85, 500, scaledInputs(1.5))
    < maxPlayersUnder({ hostileShare: 0, seasons: 1, churn: "vacuum_keeps_up" }, 0.85));
  assert.equal(maxPlayersUnder({ hostileShare: 0, seasons: 1, churn: "vacuum_keeps_up" }, 0.01), 0);
});
