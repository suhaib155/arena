import { test } from "node:test";
import assert from "node:assert/strict";
import { splitPressLayout } from "../pressLayout";
import { readFileSync } from "node:fs";

test("press target owns parent constraints while its contents retain layout", () => {
  const style = { flex: 1, width: 120, marginTop: 8, alignSelf: "stretch" as const,
    padding: 12, flexDirection: "row" as const, borderRadius: 20, transform: [{ rotate: "3deg" }] };
  const { outer, inner } = splitPressLayout(style);
  assert.deepEqual(outer, { flex: 1, width: 120, marginTop: 8, alignSelf: "stretch" });
  assert.deepEqual(inner, { flexGrow: 1, padding: 12, flexDirection: "row", borderRadius: 20, transform: [{ rotate: "3deg" }] });
  assert.equal(style.flex, 1);
});

test("live actions are fixed and release navigation cannot select synthetic GPS", () => {
  const session = readFileSync("app/move/session.tsx", "utf8");
  const readiness = readFileSync("app/move/index.tsx", "utf8");
  assert.doesNotMatch(session, /<ScrollView/);
  assert.match(session, /controls: \{ flexShrink: 0/);
  assert.match(session, /__DEV__ && modeParam === "demo"/);
  assert.match(readiness, /if \(!__DEV__\) return/);
  assert.match(readiness, /\{__DEV__ && readiness.offerDemo/);
});
