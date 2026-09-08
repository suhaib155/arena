/**
 * Phase 4 source guards — offline, scoped to the identity/progression files.
 *
 * Fail if a new control drops its label, if the collections locked accordion
 * stops exposing its state, if a redesigned screen adds a JS-driven animation,
 * or if Profile ever renders a wallet address or a raw user/session id.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const COMPONENTS = join(process.cwd(), "src", "components");
const APP = join(process.cwd(), "app");

function read(...parts: string[]): string {
  return readFileSync(join(...parts), "utf8");
}

test("StatusPill states its status as a label (not colour-only)", () => {
  const src = read(COMPONENTS, "StatusPill.tsx");
  assert.match(src, /accessibilityLabel=/);
  // pairs an icon with the text label
  assert.match(src, /<Ionicons/);
});

test("Collections locked accordion exposes expanded/collapsed state", () => {
  const src = read(APP, "collections.tsx");
  assert.match(src, /accessibilityRole="button"/);
  assert.match(src, /Collapse locked|Expand locked/);
});

test("no redesigned identity screen enables the JS animation driver", () => {
  for (const f of [
    join(APP, "collections.tsx"),
    join(APP, "route", "passport.tsx"),
    join(APP, "(tabs)", "profile.tsx"),
  ]) {
    assert.ok(!/useNativeDriver:\s*false/.test(read(f)), `${f} must not use the JS animation driver`);
  }
});

test("Profile never renders a wallet address or a raw user/session id", () => {
  const src = read(APP, "(tabs)", "profile.tsx");
  assert.ok(!/\.address/.test(src), "must not read a wallet address");
  assert.ok(!/authUser\.id|user\.id|\.sessionId|\.privateKey|\.seed/.test(src), "must not render ids/secrets");
});

function assertPassportTruth(src: string): void {
  // Require rendered clarification at the score, not a matching source comment.
  assert.match(src, /<Text style=\{styles\.readyHint\}>Local preview · not official verification<\/Text>/);
  assert.match(src, /<Text style=\{styles\.readyExplain\}>Saved summaries only; no route coordinates in this passport\.<\/Text>/);
  assert.match(src, /label="Privacy Policy"/);
  assert.match(src, /pathname: "\/legal", params: \{ kind: "privacy" \}/);
}

test("Passport labels its score local preview / not official verification", () => {
  assertPassportTruth(read(APP, "route", "passport.tsx"));
});

test("Passport truth guard rejects removing the visible score clarification", () => {
  const src = read(APP, "route", "passport.tsx");
  const mutated = src.replace(/<Text style=\{styles\.readyHint\}>[^<]*<\/Text>/, "");
  assert.notEqual(mutated, src);
  assert.throws(() => assertPassportTruth(mutated), assert.AssertionError);
});
