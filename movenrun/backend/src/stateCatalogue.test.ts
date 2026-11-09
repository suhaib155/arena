/**
 * Every exported state, status or stage type in backend/src and shared/src is
 * named in `docs/STATE_MACHINES.md`. See the mobile twin of this test for why.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BACKEND_SRC = dirname(fileURLToPath(import.meta.url));
const ROOT = join(BACKEND_SRC, "..", "..");
const CATALOGUE = readFileSync(join(ROOT, "docs", "STATE_MACHINES.md"), "utf8");
const DECLARATION = /^export (?:type|enum) ([A-Z]\w*(?:State|Status|Stage))\b/gm;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : sources(path);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

test("every exported state type in backend/src and shared/src is in docs/STATE_MACHINES.md", () => {
  const found = new Set<string>();
  for (const file of [...sources(BACKEND_SRC), ...sources(join(ROOT, "shared", "src"))]) {
    for (const m of readFileSync(file, "utf8").matchAll(DECLARATION)) found.add(m[1]);
  }
  assert.ok(found.size >= 10, `the scan found ${found.size} types; the pattern or the paths are wrong`);
  const missing = [...found].filter((name) => !CATALOGUE.includes("`" + name + "`")).sort();
  assert.deepEqual(missing, [], "add these to docs/STATE_MACHINES.md");
});
