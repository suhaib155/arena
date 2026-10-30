/**
 * The owner-approved account erasure queue policy (30 Oct 2026,
 * docs/G34_ERASURE_QUEUE.md sections 5, 8 and 10), pinned without a
 * database: the retry budget, backoff cap and lease; the receipt retention;
 * and that requeue is an operator library call with no HTTP route and no
 * automatic caller. The PostgreSQL behaviour is in erasureQueue.pg.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "../db/client.js";
import {
  DEFAULT_ERASURE_RETRY,
  ERASURE_RECEIPT_PURGE_BATCH,
  ERASURE_RECEIPT_RETENTION_DAYS,
  purgeCompletedErasureJobs,
} from "../gameplay/erasureJobs.js";
import { createErasureWorker } from "./erasureWorker.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

const unusedDb = new Proxy({}, { get() { throw new Error("no query expected"); } }) as unknown as Db;

test("retry policy: 40 attempts, 2 s base doubling to a 5-minute cap, 120 s lease, 3 s lock budget", () => {
  assert.deepEqual({ ...DEFAULT_ERASURE_RETRY }, { baseDelayMs: 2_000, maxDelayMs: 300_000, maxAttempts: 40, leaseMs: 120_000, lockTimeoutMs: 3_000 });
  const worker = createErasureWorker({ db: unusedDb, store: { eraseJob: async () => { throw new Error("not called"); } } });
  assert.equal(worker.policy.leaseMs, 120_000, "the wired worker leases a job for 120 s");
  assert.equal(worker.policy.maxAttempts, 40);
  assert.equal(worker.policy.maxDelayMs, 300_000);
});

test("receipt retention is 30 days, purged in bounded batches; a bad batch size is refused before any query", async () => {
  assert.equal(ERASURE_RECEIPT_RETENTION_DAYS, 30);
  assert.ok(Number.isInteger(ERASURE_RECEIPT_PURGE_BATCH) && ERASURE_RECEIPT_PURGE_BATCH >= 1 && ERASURE_RECEIPT_PURGE_BATCH <= 10_000);
  for (const bad of [0, -1, 1.5, 10_001, Number.NaN]) {
    await assert.rejects(purgeCompletedErasureJobs(unusedDb, bad), /purge limit/);
  }
});

test("requeue has no HTTP route and no automatic caller: only the operator library function exists", () => {
  const files = sourceFiles(SRC);
  assert.ok(files.length > 50, "the source walk found the backend sources");
  const rel = (p: string) => relative(SRC, p).split(sep).join("/");
  // Nothing but its own module names it: no router, no worker, no maintenance task.
  const naming = files.filter((f) => /requeueErasureJob/.test(readFileSync(f, "utf8"))).map(rel);
  assert.deepEqual(naming, ["gameplay/erasureJobs.ts"]);
  // No module that registers HTTP handlers mentions requeue, the job table or erasureJobs at all
  // (the identity router reaches the queue only through the account deletion store).
  const registers = /\b(?:router|app)\.(?:get|post|put|patch|delete|all|use|route)\(/;
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    if (!registers.test(text)) continue;
    assert.ok(!/requeue/i.test(text), `${rel(f)} registers HTTP handlers and mentions requeue`);
    assert.ok(!/gameplay_account_deletion_jobs|erasureJobs\.js/.test(text), `${rel(f)} registers HTTP handlers and touches the job table directly`);
  }
});
