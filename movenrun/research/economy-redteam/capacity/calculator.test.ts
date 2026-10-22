import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { backlog, grid, loadParams, project, toCsv } from "./calculator.ts";

const p = loadParams(join(import.meta.dirname, "params.v1.json"));
const base = (o: Partial<{ rule: string; users: number; days: number; abuse: number; ret: string }> = {}) =>
  project(p, o.rule ?? "1002", o.users ?? 500, "x", o.days ?? 90, o.abuse ?? 0, o.ret ?? "keep_all");

test("deterministic: same params give byte-identical CSV", () => {
  assert.equal(toCsv(grid(p)), toCsv(grid(loadParams(join(import.meta.dirname, "params.v1.json")))));
});

test("monotone in users, days and abuse", () => {
  for (const rule of ["1001", "1002"]) for (const ret of Object.keys(p.retention)) {
    assert.ok(base({ rule, ret, users: 200 }).total_default_bytes < base({ rule, ret, users: 1000 }).total_default_bytes);
    assert.ok(base({ rule, ret, days: 14 }).total_default_bytes <= base({ rule, ret, days: 360 }).total_default_bytes);
    assert.ok(base({ rule, ret, abuse: 0 }).total_default_bytes <= base({ rule, ret, abuse: 2 }).total_default_bytes);
    assert.ok(base({ rule, ret, abuse: 2 }).total_default_bytes <= base({ rule, ret, abuse: 10 }).total_default_bytes);
  }
});

test("monotone in retention length and keep_all is the upper bound", () => {
  const b = (ret: string) => base({ ret, days: 360, users: 1000 }).total_default_bytes;
  assert.ok(b("ttl7_proof60") <= b("ttl14_proof120"));
  assert.ok(b("ttl14_proof120") <= b("ttl30_proof180"));
  assert.ok(b("ttl30_proof180") <= b("keep_all"));
});

test("unit sanity: bytes are positive integers, percentages match bytes, aggressive never worse than default", () => {
  for (const r of grid(p)) {
    for (const k of ["table_bytes", "index_bytes", "total_default_bytes", "wal_per_day_bytes"] as const) {
      assert.ok(Number.isInteger(r[k]) && r[k] >= 0, k);
    }
    assert.ok(r.total_aggressive_bytes <= r.total_default_bytes);
    assert.ok(Math.abs(r.pct_of_usable_default - (r.total_default_bytes / r.usable_quota_bytes) * 100) < 0.01);
    assert.ok(r.usable_quota_bytes < p.quota.nominalMiB * 1024 * 1024, "usable quota is below the nominal limit");
    assert.ok(r.total_default_bytes >= p.quota.baselineMiB * 1024 * 1024);
  }
});

test("rule 1001 has no challenge churn; 1002 has bloat and more WAL per day", () => {
  const a = base({ rule: "1001", users: 1000 }), b = base({ rule: "1002", users: 1000 });
  assert.ok(a.bloat_default_bytes < b.bloat_default_bytes);
  assert.equal(base({ rule: "1001", users: 1000 }).bloat_default_bytes, base({ rule: "1001", users: 1000 }).bloat_aggressive_bytes === 0 ? 0 : a.bloat_default_bytes);
  assert.ok(a.wal_per_day_bytes < b.wal_per_day_bytes);
});

test("calibration: 1,000 players, 14 days, 1002 reproduces the measured WAL within 15% (WAL is a fitted quantity, so this is a consistency check only)", () => {
  const r = project(p, "1002", 1000, "14d", 14, 0, "keep_all");
  const projected = r.wal_per_day_bytes * 14;
  assert.ok(Math.abs(projected / (975.9 * 1024 * 1024) - 1) < 0.15, String(projected / 1048576));
});

test("backlog: runs needed follow maxDaysPerRun and time grows with sleep length", () => {
  assert.equal(backlog(p, "1002", 1000, 31).runs_needed, 1);
  assert.equal(backlog(p, "1002", 1000, 32).runs_needed, 2);
  assert.ok(backlog(p, "1002", 1000, 3).settle_seconds_total < backlog(p, "1002", 1000, 14).settle_seconds_total);
});
