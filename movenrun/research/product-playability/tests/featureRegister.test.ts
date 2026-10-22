/**
 * The machine-readable feature register agrees with the release switchboard.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { isRouteInRelease } from "../../../mobile/src/lib/releaseScope";
import { routeOf, MOBILE } from "../claims-checker/check";

const register = JSON.parse(readFileSync(join(__dirname, "../feature-register.json"), "utf8")) as {
  states: Record<string, string>; features: { id: string; routes: string[]; state: string }[]; unlinked: { route: string }[];
};

function screens(dir = join(MOBILE, "app"), out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) screens(f, out);
    else if (/\.tsx$/.test(n) && !/_layout|\+not-found/.test(n)) out.push(routeOf(f));
  }
  return out;
}

test("every screen route appears in the register exactly where it belongs", () => {
  const listed = new Set([...register.features.flatMap((f) => f.routes), ...register.unlinked.map((u) => u.route)]);
  const missing = screens().filter((r) => !listed.has(r));
  assert.deepEqual(missing, []);
});

test("hidden_excluded features are exactly the routes releaseScope gates", () => {
  for (const f of register.features) {
    for (const route of f.routes) {
      const gated = !isRouteInRelease(route);
      assert.equal(f.state === "hidden_excluded", gated, `${f.id} ${route}`);
    }
  }
});

test("every feature uses a defined state and names its evidence", () => {
  for (const f of register.features as { id: string; state: string; evidence?: string }[]) {
    assert.ok(f.state in register.states, f.id);
    assert.ok(f.evidence && f.evidence.length > 0, f.id);
  }
});
