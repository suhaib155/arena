import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { returnToToday } from "../todayNavigation";

test("Back to Today changes the route on the first tap even at a root summary", () => {
  const calls: string[] = [];
  returnToToday({ replace: path => calls.push(path) }, () => calls.push("released"));
  assert.deepEqual(calls, ["/(tabs)", "released"]);
});

test("both summary exit paths use explicit Today navigation", () => {
  const source = readFileSync("app/move/summary.tsx", "utf8");
  assert.equal((source.match(/returnToToday\(router, clearLastSession\)/g) ?? []).length, 2);
  assert.ok(!source.includes("router.dismissAll()"));
});
