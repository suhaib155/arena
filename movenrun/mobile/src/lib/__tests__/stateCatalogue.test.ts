/**
 * Every exported state, status or stage type in the app is named in
 * `docs/STATE_MACHINES.md`.
 *
 * The catalogue is how a person or a tool finds a machine's table, its
 * proof and its known gaps before editing a call site. A new union that is
 * not listed fails here, which is the prompt to decide whether it is a
 * machine (and needs a table) or a derived label.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MOBILE = join(__dirname, "..", "..", "..");
const CATALOGUE = readFileSync(join(MOBILE, "..", "docs", "STATE_MACHINES.md"), "utf8");
const DECLARATION = /^export type ([A-Z]\w*(?:State|Status|Stage))\b/gm;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

test("every exported state type in mobile/src and mobile/app is in docs/STATE_MACHINES.md", () => {
  const found = new Set<string>();
  for (const file of [...sources(join(MOBILE, "src")), ...sources(join(MOBILE, "app"))]) {
    for (const m of readFileSync(file, "utf8").matchAll(DECLARATION)) found.add(m[1]);
  }
  assert.ok(found.size >= 20, `the scan found ${found.size} types; the pattern or the paths are wrong`);
  const missing = [...found].filter((name) => !CATALOGUE.includes("`" + name + "`")).sort();
  assert.deepEqual(missing, [], "add these to docs/STATE_MACHINES.md");
});
