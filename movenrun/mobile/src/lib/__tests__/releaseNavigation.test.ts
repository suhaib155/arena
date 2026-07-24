/**
 * Release-hardening navigation guards — offline, source-level.
 *
 * These lock invariants that are currently correct but silently regress if a
 * route is added, renamed, or reorganised:
 *
 *  1. Every navigable route file under app/ has an explicit <Stack.Screen> in
 *     the root layout. Expo Router auto-registers files, so a missing entry does
 *     not crash — it silently drops that screen's configured options (e.g. the
 *     gesture lock below). This guard makes registration intentional.
 *  2. The movement/result screens keep `gestureEnabled: false`, so an in-progress
 *     or just-finished movement can't be dismissed by an accidental swipe-back
 *     (movement state lives only in memory during that flow).
 *  3. The bottom navigation stays a five-destination bar (Home · Territory ·
 *     Move · Clubs · Profile) with no sixth destination, and respects the bottom
 *     safe-area inset.
 *  4. The not-found screen offers a recovery action (no dead end).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const APP = join(process.cwd(), "app");
const COMPONENTS = join(process.cwd(), "src", "components");

function read(...parts: string[]): string {
  return readFileSync(join(...parts), "utf8");
}

/** Recursively list *.tsx files under a directory. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/**
 * Route files that are NOT registered individually in the root Stack:
 *  - `_layout.tsx` files (layouts, not screens)
 *  - `+not-found.tsx` (Expo Router's reserved not-found route)
 *  - anything inside the `(tabs)` group (registered via the single `(tabs)` entry)
 */
function isIndividuallyRegistered(routeName: string, file: string): boolean {
  if (file.endsWith("_layout.tsx")) return false;
  if (file.endsWith("+not-found.tsx")) return false;
  if (routeName.startsWith("(tabs)/") || routeName === "(tabs)") return false;
  return true;
}

/** Map an app/ file path to its Expo Router route name (path without extension). */
function routeNameOf(file: string): string {
  return relative(APP, file).replace(/\.tsx$/, "");
}

test("every navigable route file is explicitly registered in the root Stack", () => {
  const layout = read(APP, "_layout.tsx");
  const registered = new Set(
    [...layout.matchAll(/<Stack\.Screen\s+name="([^"]+)"/g)].map((m) => m[1]),
  );

  // The tab group itself must be registered.
  assert.ok(registered.has("(tabs)"), "root Stack must register the (tabs) group");

  const missing: string[] = [];
  let checked = 0;
  for (const file of walk(APP)) {
    const name = routeNameOf(file);
    if (!isIndividuallyRegistered(name, file)) continue;
    checked += 1;
    if (!registered.has(name)) missing.push(name);
  }
  assert.deepEqual(missing, [], `unregistered route files: ${missing.join(", ")}`);
  // Guard against a vacuous pass if the walk ever stops finding routes.
  assert.ok(checked >= 20, `expected to check the full route surface, only saw ${checked}`);
});

test("movement and result screens keep the swipe-back gesture disabled", () => {
  const layout = read(APP, "_layout.tsx");
  // Grab each <Stack.Screen ...> block and check the safety-critical ones.
  const blocks = [...layout.matchAll(/<Stack\.Screen[\s\S]*?\/>/g)].map((m) => m[0]);
  const byName = (name: string) =>
    blocks.find((b) => b.includes(`name="${name}"`)) ?? "";

  for (const name of ["move/session", "move/summary", "move/captured", "active", "result"]) {
    const block = byName(name);
    assert.ok(block, `expected a Stack.Screen for ${name}`);
    assert.match(block, /gestureEnabled:\s*false/, `${name} must disable swipe-back`);
  }
});

test("bottom navigation stays five destinations with no sixth, and respects the safe area", () => {
  const bar = read(COMPONENTS, "MovenTabBar.tsx");
  // Three real tab screens reached via goTab, two push destinations.
  const tabButtons = (bar.match(/goTab\("(index|clubs|profile)"\)/g) ?? []).length;
  assert.equal(tabButtons, 3, "exactly three tab-screen destinations");
  const pushTargets = new Set(
    [...bar.matchAll(/push\("([^"]+)"\)/g)].map((m) => m[1]),
  );
  assert.deepEqual([...pushTargets].sort(), ["/move", "/territory/map"]);
  // No accidental extra tab-screen navigation target.
  assert.ok(!/goTab\("(?!index|clubs|profile)/.test(bar), "no sixth tab destination");
  // Floating bar clears the bottom safe-area inset.
  assert.match(bar, /Math\.max\(insets\.bottom/);
});

test("not-found screen offers a recovery action (no dead end)", () => {
  const src = read(APP, "+not-found.tsx");
  assert.match(src, /<Button/, "not-found must render a recovery Button");
  assert.match(src, /router\.(replace|push)\("\/"\)/, "recovery action returns to home");
});
