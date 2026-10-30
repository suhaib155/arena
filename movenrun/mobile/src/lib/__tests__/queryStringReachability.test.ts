/**
 * DEP-EXC-2026-001 reachability pin (static, offline, no device).
 *
 * Advisory GHSA-vcc3-ghjq-m6fr: `decode-uri-component` <= 0.4.2 decodes
 * malformed percent-encoded input in exponential time. In the shipped tree it
 * is reached only through `query-string@7.1.3`, and only the parse side of
 * that package decodes. This test pins why the app does not call that side
 * with outside input, and fails the moment a call site appears that could.
 *
 * It reads three things: yarn.lock (who depends on what), the installed
 * JavaScript of the two packages that depend on query-string, and the app's
 * own sources. It does not execute any of it.
 *
 * If a case here fails, do not edit the expectation to make it pass. Re-run
 * the reachability review in docs/security/DEP_EXC_2026_001_REASSESSMENT_29OCT.md
 * and either remove the new call site, or change the exception.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const MOBILE = process.cwd();
const ROOT = join(MOBILE, "..");
const NODE_MODULES = existsSync(join(MOBILE, "node_modules", "expo-router"))
  ? join(MOBILE, "node_modules")
  : join(ROOT, "node_modules");

// Methods of query-string@7 that reach decode-uri-component. `parse` decodes
// directly; `parseUrl` calls `parse`; `pick` and `exclude` call `parseUrl`.
const DECODING_METHODS = ["parse", "parseUrl", "pick", "exclude"];

interface LockEntry { names: string[]; version: string; deps: string[] }

function readLock(): LockEntry[] {
  const text = readFileSync(join(ROOT, "yarn.lock"), "utf8");
  const out: LockEntry[] = [];
  for (const block of text.split(/\n\n+/)) {
    const lines = block.split("\n");
    const header = lines.find((l) => l.startsWith('"') || /^[A-Za-z@]/.test(l));
    if (!header || header.startsWith("#") || !header.endsWith(":")) continue;
    const names = header
      .slice(0, -1)
      .split(",")
      .map((s) => s.trim().replace(/^"|"$/g, ""))
      .map((s) => s.slice(0, s.indexOf("@", 1)));
    const version = /^ {2}version: (.+)$/m.exec(block)?.[1]?.replace(/"/g, "") ?? "";
    const deps: string[] = [];
    let inDeps = false;
    for (const l of lines) {
      if (/^ {2}dependencies:$/.test(l)) { inDeps = true; continue; }
      if (inDeps) {
        const m = /^ {4}("?[^:"]+"?|"[^"]+"): /.exec(l);
        if (m) deps.push(m[1].replace(/"/g, ""));
        else inDeps = false;
      }
    }
    out.push({ names: [...new Set(names)], version, deps });
  }
  return out;
}

function dependentsOf(pkg: string, lock: LockEntry[]): string[] {
  return [...new Set(lock.filter((e) => e.deps.includes(pkg)).flatMap((e) => e.names))].sort();
}

function walkJs(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkJs(p, out);
    else if (/\.(c|m)?js$/.test(name) && !name.endsWith(".map")) out.push(p);
  }
  return out;
}

/** Every `alias.method(` use of the `query-string` module in one file. */
function queryStringUses(source: string): string[] {
  const aliases = new Set<string>();
  for (const m of source.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]query-string['"]/g)) aliases.add(m[1]);
  for (const m of source.matchAll(/import\s+(\w+)\s+from\s+['"]query-string['"]/g)) aliases.add(m[1]);
  for (const m of source.matchAll(/(?:const|var|let)\s+(\w+)\s*=\s*(?:__importStar\(|__importDefault\()?\s*require\(['"]query-string['"]\)/g)) aliases.add(m[1]);
  const uses: string[] = [];
  for (const a of aliases) for (const m of source.matchAll(new RegExp(`\\b${a}\\.(\\w+)\\s*\\(`, "g"))) uses.push(m[1]);
  for (const m of source.matchAll(/import\s*\{([^}]+)\}\s*from\s+['"]query-string['"]/g)) {
    for (const part of m[1].split(",")) uses.push(part.trim().split(/\s+as\s+/)[0]);
  }
  for (const m of source.matchAll(/require\(['"]query-string['"]\)\.(\w+)/g)) uses.push(m[1]);
  return uses;
}

function importsQueryString(source: string): boolean {
  return /from\s+['"]query-string['"]|require\(['"]query-string['"]\)|import\(['"]query-string['"]\)/.test(source);
}

test("the lockfile resolves decode-uri-component once, and only query-string uses it", () => {
  const lock = readLock();
  const decode = lock.filter((e) => e.names.includes("decode-uri-component"));
  assert.equal(decode.length, 1, "exactly one resolution of decode-uri-component");
  assert.equal(decode[0].version, "0.2.2");
  assert.deepEqual(dependentsOf("decode-uri-component", lock), ["query-string"]);
});

test("only @react-navigation/core and expo-router depend on query-string, and only one version is resolved", () => {
  const lock = readLock();
  const qs = lock.filter((e) => e.names.includes("query-string"));
  assert.equal(qs.length, 1);
  assert.equal(qs[0].version, "7.1.3");
  // @react-navigation/core 7.22.1 and later no longer depend on query-string, so the
  // list may shrink to expo-router alone; it must never gain a name.
  const dependents = dependentsOf("query-string", lock);
  assert.ok(
    JSON.stringify(dependents) === JSON.stringify(["@react-navigation/core", "expo-router"]) ||
      JSON.stringify(dependents) === JSON.stringify(["expo-router"]),
    `unexpected dependents of query-string: ${dependents.join(", ")}`,
  );
});

test("the app's own code never imports query-string or decode-uri-component, or builds its own navigation parser", () => {
  const offenders: string[] = [];
  for (const dir of ["app", "src"]) {
    for (const file of walkSource(join(MOBILE, dir))) {
      const text = readFileSync(file, "utf8");
      const rel = relative(MOBILE, file);
      if (importsQueryString(text)) offenders.push(`${rel}: imports query-string`);
      if (/['"]decode-uri-component['"]/.test(text)) offenders.push(`${rel}: imports decode-uri-component`);
      // A custom `linking` prop, or the library default parser, would replace expo-router's.
      if (/\bgetStateFromPath\b/.test(text) && !rel.includes("__tests__")) offenders.push(`${rel}: getStateFromPath`);
      if (/\buseLinking\b/.test(text) && !rel.includes("__tests__")) offenders.push(`${rel}: useLinking`);
      if (/@react-navigation\/(core|native)['"]/.test(text) && /\b(getStateFromPath|parse)\b/.test(text) && !rel.includes("__tests__")) {
        offenders.push(`${rel}: react-navigation parser`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

function walkSource(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules" || name === "__tests__" || name === "_legacy") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkSource(p, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) out.push(p);
  }
  return out;
}

test("the only call of a decoding query-string method in the shipped navigation code is React Navigation's default path parser", () => {
  const roots = [
    join(NODE_MODULES, "expo-router", "build"),
    join(NODE_MODULES, "@react-navigation", "core", "lib"),
  ];
  const decodingSites: string[] = [];
  const allUses = new Set<string>();
  for (const root of roots) {
    for (const file of walkJs(root)) {
      const text = readFileSync(file, "utf8");
      if (!importsQueryString(text)) continue;
      for (const use of queryStringUses(text)) {
        allUses.add(use);
        if (DECODING_METHODS.includes(use)) decodingSites.push(`${relative(NODE_MODULES, file)}#${use}`);
      }
    }
  }
  for (const use of allUses) assert.ok(["stringify", "parse"].includes(use), `unexpected query-string method ${use}`);
  assert.ok(allUses.has("stringify"), "the scan found the stringify call, so it is reading the right files");
  // With @react-navigation/core 7.21.x the one parse call is its default path parser; from
  // 7.22.1 there is none. Any other site is a new reachable decoder.
  const known = "@react-navigation/core/lib/module/getStateFromPath.js#parse";
  assert.ok(decodingSites.length === 0 || (decodingSites.length === 1 && decodingSites[0] === known), `decoding sites: ${decodingSites.join(", ")}`);
});

test("expo-router replaces that default parser: its linking config always supplies its own getStateFromPath", () => {
  const cfg = readFileSync(join(NODE_MODULES, "expo-router", "build", "getLinkingConfig.js"), "utf8");
  assert.match(cfg, /getStateFromPath:\s*\(path, options\)\s*=>\s*\{\s*return \(0, linking_1\.getStateFromPath\)\(path, options,/);
  const linking = readFileSync(join(NODE_MODULES, "expo-router", "build", "link", "linking.js"), "utf8");
  assert.match(linking, /require\("\.\.\/fork\/getStateFromPath"\)/, "the supplied parser is expo-router's own fork");
});

test("expo-router's own parser reads query strings with URLSearchParams and imports no query-string code", () => {
  const forkDir = join(NODE_MODULES, "expo-router", "build", "fork");
  const parserFiles = ["getStateFromPath.js", "getStateFromPath-forks.js"];
  for (const f of parserFiles) {
    const text = readFileSync(join(forkDir, f), "utf8");
    assert.equal(importsQueryString(text), false, `${f} must not import query-string`);
    assert.doesNotMatch(text, /decode-uri-component/);
  }
  const forks = readFileSync(join(forkDir, "getStateFromPath-forks.js"), "utf8");
  const start = forks.indexOf("function parseQueryParams(");
  assert.ok(start > 0, "parseQueryParams exists");
  const body = forks.slice(start, start + 1200);
  assert.match(body, /new URL\(path, 'https:\/\/phony\.example'\)\.searchParams/);
});

test("query-string@7.1.3 only reaches decode-uri-component from its parse side", () => {
  const src = readFileSync(join(NODE_MODULES, "query-string", "index.js"), "utf8");
  const stringifyStart = src.indexOf("exports.stringify = ");
  const parseUrlStart = src.indexOf("exports.parseUrl = ");
  assert.ok(stringifyStart > 0 && parseUrlStart > stringifyStart);
  const stringifyBody = src.slice(stringifyStart, parseUrlStart);
  assert.doesNotMatch(stringifyBody, /\bdecode\(|decodeComponent/, "stringify never decodes");
  // The module-level decode() helper is the only caller of the library.
  assert.equal([...src.matchAll(/decodeComponent\(/g)].length, 1);
});

test("the app registers no web link scheme: deep links are only the movenrun:// scheme", () => {
  const app = JSON.parse(readFileSync(join(MOBILE, "app.json"), "utf8")).expo;
  assert.equal(app.scheme, "movenrun");
  const filters = app.android?.intentFilters ?? [];
  assert.deepEqual(filters, [], "an https intent filter widens who can send a link; review the exception first");
});
