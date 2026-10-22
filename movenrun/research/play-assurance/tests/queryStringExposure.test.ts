/**
 * Track C: bounded exposure test for GHSA-vcc3-ghjq-m6fr (decode-uri-component 0.2.2 via query-string 7.1.3).
 * Offline. Uses the INSTALLED node_modules copies. Inputs are at most 64 characters (no DoS payloads) and each
 * call must return or throw within 50 ms. It does not prove the advisory is fixed; it bounds the cost of
 * short hostile input and pins where expo-router 6.0.24 does (and does not) call query-string.
 * Run from movenrun/:  node --import tsx --test research/play-assurance/tests/queryStringExposure.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
const queryString = require("query-string") as { parse(s: string, o?: object): unknown; stringify(o: object): string };
const decodeUriComponent = require("decode-uri-component") as (s: string) => string;
const pkgVersion = (name: string): string => JSON.parse(readFileSync(require.resolve(`${name}/package.json`), "utf8")).version;

const INPUTS = [
  "code=%",
  "code=%E0%A4%A",
  "a=%E0%A4%A%E0%A4%A%E0%A4%A%E0%A4%A%E0%A4%A%E0%A4%A",
  "a=%ff%fe%fd%fc%fb%fa%f9%f8",
  "a[b][c][d]=%zz&a[b][c]=%",
  "a=1&a=2&a=%E0&a=%E0%A4",
  "%25%25%25%25%25%25%25%25%25%25=%25%25%25%25%25%25%25%25%25%25",
  "__proto__=%E0%A4&constructor=%",
  "x=" + "%C2".repeat(20),
] as const;

function timed<T>(fn: () => T): { ms: number; threw: boolean } {
  const t = performance.now();
  let threw = false;
  try { fn(); } catch { threw = true; }
  return { ms: performance.now() - t, threw };
}

test("installed versions are the audited ones (query-string 7.1.3, decode-uri-component 0.2.2)", () => {
  assert.equal(pkgVersion("query-string"), "7.1.3");
  assert.equal(pkgVersion("decode-uri-component"), "0.2.2");
});

test("every input is at most 64 characters (bounded by construction)", () => {
  for (const i of INPUTS) assert.ok(i.length <= 64, `${i.length}: ${i}`);
});

test("query-string.parse returns or throws within 50 ms on short malformed input", () => {
  for (const input of INPUTS) {
    const { ms } = timed(() => queryString.parse(input));
    assert.ok(ms < 50, `parse took ${ms.toFixed(2)} ms for ${JSON.stringify(input)}`);
  }
});

test("decode-uri-component returns or throws within 50 ms on short malformed input", () => {
  for (const input of INPUTS) {
    const { ms } = timed(() => decodeUriComponent(input));
    assert.ok(ms < 50, `decode took ${ms.toFixed(2)} ms for ${JSON.stringify(input)}`);
  }
});

test("query-string.parse with malformed escapes in special keys returns a plain result and leaves Object.prototype unchanged", () => {
  const before = Object.getOwnPropertyNames(Object.prototype).sort().join(",");
  const parsed = queryString.parse("__proto__=%E0%A4&constructor=%&x=1&__proto__[x]=1") as Record<string, unknown>;
  assert.equal(parsed.x, "1", "ordinary keys still parse");
  assert.equal(Object.getOwnPropertyNames(Object.prototype).sort().join(","), before);
  assert.equal(({} as Record<string, unknown>).x, undefined);
});

test("source pin: expo-router 6.0.24 inbound path parsing uses URL.searchParams, not query-string.parse", () => {
  const fork = readFileSync(require.resolve("expo-router/build/fork/getStateFromPath.js"), "utf8");
  const forks = readFileSync(require.resolve("expo-router/build/fork/getStateFromPath-forks.js"), "utf8");
  assert.equal(pkgVersion("expo-router"), "6.0.24");
  const liveParseCalls = fork.split("\n").filter(l => /queryString\.parse\(/.test(l) && !l.trim().startsWith("//"));
  assert.deepEqual(liveParseCalls, [], "queryString.parse must appear only inside a comment in the forked getStateFromPath");
  assert.match(forks, /new URL\(path, 'https:\/\/phony\.example'\)\.searchParams/);
  const linking = readFileSync(require.resolve("expo-router/build/getLinkingConfig.js"), "utf8");
  assert.match(linking, /getStateFromPath: \(path, options\) =>/, "expo-router supplies its own getStateFromPath to the container");
});

test("source pin: expo-router's remaining query-string use is stringify (outbound), not parse", () => {
  for (const f of ["getPathFromState.js", "getPathFromState-forks.js"]) {
    const src = readFileSync(require.resolve(`expo-router/build/fork/${f}`), "utf8");
    assert.match(src, /queryString\.stringify\(/);
    assert.doesNotMatch(src, /queryString\.parse\(/);
  }
});

test("source pin: @react-navigation/core default getStateFromPath still calls queryString.parse (fallback, not used when linking supplies its own)", () => {
  const core = readFileSync(new URL("../../../node_modules/@react-navigation/core/lib/module/getStateFromPath.js", import.meta.url), "utf8");
  assert.match(core, /queryString\.parse\(query\)/);
});
