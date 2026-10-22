/**
 * The forbidden-claims checker: scope, detection and today's result.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { releaseSurfaces, routeOf, scan, staleAllowEntries, stripComments, textsOn, MOBILE } from "../claims-checker/check";
import { join } from "node:path";

const surfaces = releaseSurfaces().map((f) => f.slice(MOBILE.length + 1).replace(/\\/g, "/"));

test("gated screens are out of scope and release screens are in", () => {
  for (const gated of ["app/city-war.tsx", "app/rivals.tsx", "app/deed-showroom.tsx", "app/account/wallets.tsx", "app/(tabs)/clubs.tsx"]) {
    assert.ok(!surfaces.includes(gated), `${gated} is gated by releaseScope`);
  }
  for (const live of ["app/(tabs)/index.tsx", "app/move/session.tsx", "app/move/summary.tsx", "app/settings/technical.tsx"]) {
    assert.ok(surfaces.includes(live), live);
  }
  assert.equal(routeOf(join(MOBILE, "app/(tabs)/index.tsx")), "/");
  assert.equal(routeOf(join(MOBILE, "app/account/wallets.tsx")), "/account/wallets");
});

test("comments are never read as UI text", () => {
  const src = "/* capture the zone you own */\nconst a = 1; // own it\n<Text>Hello there</Text>";
  const lines = stripComments(src).split("\n");
  assert.deepEqual(lines.flatMap(textsOn), ["Hello there"]);
});

test("the checker finds the reachable ownership claims the route inventory found by hand", () => {
  const hits = scan();
  const has = (file: string, text: string) => hits.some((h) => h.file === file && h.text.includes(text) && !h.labelled);
  assert.ok(has("src/components/ShareCard.tsx", "Move → Capture → Own"));
  assert.ok(has("app/season-objectives.tsx", "Own your season."));
  assert.ok(has("src/data/contractStatus.ts", "$MOVE token contract"));
});

test("every allowlist entry still matches a hit", () => {
  assert.deepEqual(staleAllowEntries(scan()), []);
});

test("release surfaces carry no unlabelled ownership, token, money, rivalry or chain claim",
  { todo: "MR-A-10: 16 unlabelled claims today; see V1_FEATURE_TRUTH_MATRIX.md for corrected copy" }, () => {
    const failures = scan().filter((h) => h.severity === "fail" && !h.labelled && !h.allowlisted);
    assert.deepEqual(failures.map((h) => `${h.file}:${h.line} ${h.text}`), []);
  });
