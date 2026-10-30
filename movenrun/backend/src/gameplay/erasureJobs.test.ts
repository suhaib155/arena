/**
 * The erasure job retry policy and outcome classification, without a
 * database (docs/G34_ERASURE_QUEUE.md). The PostgreSQL behaviour is in
 * src/identity/erasureQueue.pg.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ERASURE_RETRY,
  ErasureLeaseLostError,
  TRANSIENT_ERASURE_CLASSES,
  checkErasureRetryPolicy,
  classifyErasureError,
  erasureBackoffMs,
} from "./erasureJobs.js";

test("backoff is capped exponential with equal jitter: never zero, never above the cap, bounded for any attempt count", () => {
  const p = DEFAULT_ERASURE_RETRY;
  assert.equal(erasureBackoffMs(p, 1, 0), 1_000);
  assert.equal(erasureBackoffMs(p, 1, 0.999999), 1_999);
  assert.equal(erasureBackoffMs(p, 2, 0), 2_000);
  assert.equal(erasureBackoffMs(p, 3, 0.5), 6_000);
  for (const n of [9, 10, 40, 1_000, 1e9]) {
    for (const r of [0, 0.5, 0.999999, 1, -1, Number.NaN]) {
      const ms = erasureBackoffMs(p, n, r);
      assert.ok(ms >= p.maxDelayMs / 2 && ms <= p.maxDelayMs, `attempt ${n} draw ${r}: ${ms}`);
    }
  }
});

test("each failure class is told apart; only lock timeout, serialization, deadlock, statement timeout and connection loss are retried", () => {
  const e = (code: string) => Object.assign(new Error("x"), { code });
  assert.equal(classifyErasureError(e("55P03")), "lock_timeout");
  assert.equal(classifyErasureError(e("40001")), "serialization");
  assert.equal(classifyErasureError(e("40P01")), "deadlock");
  assert.equal(classifyErasureError(e("57014")), "statement_timeout");
  assert.equal(classifyErasureError(e("57P01")), "connection");
  assert.equal(classifyErasureError(e("08006")), "connection");
  assert.equal(classifyErasureError(new Error("timeout exceeded when trying to connect")), "connection");
  assert.equal(classifyErasureError(new Error("Query read timeout")), "connection");
  assert.equal(classifyErasureError({ cause: { code: "40001" } }), "serialization");
  assert.equal(classifyErasureError(new ErasureLeaseLostError()), "lease_lost");
  for (const fatal of [e("23514"), e("23503"), e("42P01"), new Error("boom"), null, undefined, "x"]) assert.equal(classifyErasureError(fatal), "fatal");
  assert.deepEqual([...TRANSIENT_ERASURE_CLASSES].sort(), ["connection", "deadlock", "lock_timeout", "serialization", "statement_timeout"]);
});

test("the policy is validated: whole milliseconds, a lease and a lock budget within bounds", () => {
  assert.doesNotThrow(() => checkErasureRetryPolicy(DEFAULT_ERASURE_RETRY));
  for (const bad of [{ baseDelayMs: 0 }, { maxDelayMs: 1 }, { maxAttempts: 0 }, { leaseMs: 10 }, { lockTimeoutMs: 0 }, { baseDelayMs: 1.5 }]) {
    assert.throws(() => checkErasureRetryPolicy({ ...DEFAULT_ERASURE_RETRY, ...bad }), /erasure retry policy/);
  }
});
