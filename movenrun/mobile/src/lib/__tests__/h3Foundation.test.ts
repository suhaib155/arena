/**
 * The properties that make one world grid one world grid.
 *
 * The domain module has its own suite; this one guards the things that can only
 * be broken from outside it — a second resolution constant, a route back to the
 * retired lattice, a traversal that quietly becomes ownership, a cell trail that
 * reaches a log or a disk.
 *
 * Every guard here is written to fail on a specific mutation, and each was run
 * against that mutation rather than assumed to catch it. Structural scans are
 * scoped to the file where the mistake would actually be made, not swept over
 * the repository — a repo-wide regex is defeated by a line break, and passes
 * for years while checking nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { H3_RESOLUTION, isGameplayCell } from "@movenrun/shared/h3";
import { cellsForRoute } from "../territoryCells";

const MOBILE = process.cwd();
const SRC = join(MOBILE, "src");
const APP = join(MOBILE, "app");
/* The repository root, from the mobile workspace. Reached by name rather than
   by counting `..`, so moving the workspace does not silently aim these scans
   at the wrong tree. */
const REPO = join(MOBILE, "..");

const read = (p: string) => readFileSync(p, "utf8");

/** Source with comments stripped. A comment that explains why a thing is
 *  forbidden necessarily names the thing. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
    const full = join(dir, entry);
    const info = statSync(full, { throwIfNoEntry: false });
    if (!info) continue;
    if (info.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/* ── one resolution, one place ────────────────────────────────────────────── */

test("the app reads the gameplay resolution from the shared domain, and it is 8", () => {
  assert.equal(H3_RESOLUTION, 8);
});

test("no second definition of the gameplay resolution exists anywhere in the workspace", () => {
  /* The mutation: a mobile-only or backend-only `H3_RESOLUTION = 8`. It would
     look harmless and would work, right up until one of the two moved.
     `shared/src/constants/h3.ts` is the single owner; `mobile/_legacy/` is the
     parked pre-MVP scaffold, excluded from the app's tsconfig and shipped by
     nothing, and it is named here rather than skipped silently. */
  const OWNER = join("shared", "src", "constants", "h3.ts");
  const QUARANTINED = join("mobile", "_legacy") + sep;

  const definition = /(?:const|let|var|readonly)\s+\w*H3_RESOLUTION\w*\s*[:=]|H3_RESOLUTION\s*:\s*z\./;
  const offenders: string[] = [];
  let sawOwner = false;

  for (const file of walk(REPO)) {
    const rel = relative(REPO, file).split(sep).join(sep);
    if (rel === OWNER) {
      sawOwner = definition.test(read(file));
      continue;
    }
    if (rel.startsWith(QUARANTINED)) continue;
    if (definition.test(code(file))) offenders.push(rel);
  }

  assert.ok(sawOwner, "the canonical constant is not where this guard looks — the scan is broken");
  assert.deepEqual(
    offenders,
    [],
    "a second gameplay resolution exists; import it from @movenrun/shared/h3 instead",
  );
});

test("the app never calls h3-js directly, so the validation cannot be skipped", () => {
  /* h3-js accepts a latitude of 91 by wrapping it, and answers a malformed cell
     id with a plausible-looking point. Every one of those calls has to go
     through the domain layer, which is where the checks are. */
  const offenders: string[] = [];
  for (const file of [...walk(SRC), ...walk(APP)]) {
    if (/\bfrom\s+["']h3-js["']/.test(code(file))) {
      offenders.push(relative(MOBILE, file).split(sep).join("/"));
    }
  }
  assert.deepEqual(offenders, [], "import from @movenrun/shared/h3, not h3-js");
});

/* ── the lattice does not come back ───────────────────────────────────────── */

test("nothing in the app can mint a lattice id any more", () => {
  const zones = code(join(SRC, "lib", "zones.ts"));
  for (const gone of ["cellForCoord", "zoneIdForCell", "deriveZonesFromRoute", "CELL_M"]) {
    assert.ok(!new RegExp(`\\b${gone}\\b`).test(zones), `${gone} is back in zones.ts`);
  }
  /* And no other module has quietly reimplemented it. */
  const offenders: string[] = [];
  for (const file of [...walk(SRC), ...walk(APP)]) {
    if (/`mrx-\$\{|"mrx-"\s*\+|'mrx-'\s*\+/.test(code(file))) {
      offenders.push(relative(MOBILE, file).split(sep).join("/"));
    }
  }
  assert.deepEqual(offenders, [], "something is minting a lattice zone id");
});

test("the active territory path derives cells from the shared domain", () => {
  /* The mutation: route the summary's zone derivation back through a local
     approximation. This asserts the call by name at the one call site that
     turns a route into ground. */
  const summary = code(join(APP, "move", "summary.tsx"));
  assert.match(summary, /cellsForRoute\(session\.points\)/);
  assert.match(read(join(SRC, "lib", "territoryCells.ts")), /from "@movenrun\/shared\/h3"/);

  const derived = cellsForRoute([
    { latitude: 12.9716, longitude: 77.5946, timestamp: 1_756_000_000_000, accuracy: 8 },
  ]);
  assert.equal(derived.length, 1);
  assert.ok(isGameplayCell(derived[0].id), "the active path produced something that is not a cell");
});

test("nothing persists a zone whose id is not real geography", () => {
  /* Capture is the only writer, and rehydration filters. Both are asserted in
     zoneMigration.test.ts; this is the negative half — no other module writes
     `zones` into the store. */
  const offenders: string[] = [];
  for (const file of [...walk(SRC), ...walk(APP)]) {
    if (file.endsWith(join("store", "useGameStore.ts"))) continue;
    if (/\bset\w*\(\s*\{[^}]*\bzones\s*:/.test(code(file))) {
      offenders.push(relative(MOBILE, file).split(sep).join("/"));
    }
  }
  assert.deepEqual(offenders, [], "a module outside the store writes the zone list");
});

/* ── traversal is not ownership ───────────────────────────────────────────── */

test("a verified traversed cell is not ownership merely by being a valid cell", () => {
  /* The point stated as an assertion: the cells the server reports and the
     cells a player holds are the same *kind* of thing, and that is exactly why
     the distinction has to be structural rather than by naming. */
  const traversed = "8860145b49fffff";
  assert.ok(isGameplayCell(traversed), "the fixture must be a real cell for this to mean anything");

  const record = code(join(SRC, "lib", "verifiedMovement.ts"));
  assert.ok(
    !/traversedHexIds\s*:/.test(record.slice(record.indexOf("interface VerifiedMovementRecord"), record.indexOf("export function toVerifiedRecord"))),
    "the persisted verification record grew a cell list",
  );
  assert.match(record, /traversedHexCount:\s*state\.traversedHexIds\.length/);
});

test("the verification path cannot capture, defend or award", () => {
  const summary = code(join(APP, "move", "summary.tsx"));
  const callback = summary.slice(summary.indexOf("toVerifiedRecord("), summary.indexOf("if (trust) setRouteTrust"));
  assert.ok(callback.length > 0, "the verification callback guard found nothing");
  for (const forbidden of ["captureZone", "newCapturedZone", "defendZones", "completeQuest", "fortifyZone"]) {
    assert.ok(
      !new RegExp(`\\b${forbidden}\\b`).test(callback),
      `the verification callback calls ${forbidden} — traversal must not become capture`,
    );
  }
});

test("generating neighbours does not mark anything held", () => {
  /* The board orders cells by real position. That is a layout, and a layout
     must not be able to change a zone's state. */
  const map = code(join(SRC, "lib", "territoryMap.ts"));
  for (const forbidden of [
    "captureZone", "newCapturedZone", "applyDefend", "applyFortify", "useGameStore",
    "state = \"yours\"", "isDeedPreview = true",
  ]) {
    assert.ok(
      !new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(map),
      `the board layout reaches for ${forbidden}`,
    );
  }
});

/* ── a cell trail is location data ────────────────────────────────────────── */

test("no cell list is logged, anywhere on the movement path", () => {
  /* The mutation: `console.log(traversedHexIds)` in the verification flow. The
     scan is scoped to the files that actually hold a cell list, and it looks
     for a console call at all rather than for a particular argument — a
     module on this path has no business logging. */
  const onThePath = [
    join(SRC, "lib", "territoryCells.ts"),
    join(SRC, "lib", "verifiedMovement.ts"),
    join(SRC, "lib", "movementVerification.ts"),
    join(SRC, "services", "verifySession.ts"),
    join(SRC, "services", "movementApi.ts"),
    join(SRC, "lib", "zoneMigration.ts"),
    join(SRC, "lib", "territoryMap.ts"),
    join(APP, "move", "summary.tsx"),
  ];
  const offenders: string[] = [];
  for (const file of onThePath) {
    const src = code(file);
    for (const sink of [/\bconsole\s*\./, /\btrack\s*\(/, /\banalytics\b/, /\bSentry\b/, /\bbreadcrumb/i]) {
      if (sink.test(src)) offenders.push(`${relative(MOBILE, file).split(sep).join("/")}: ${sink}`);
    }
  }
  assert.deepEqual(offenders, [], "a module on the movement path reaches a logging or analytics sink");
});

test("the guard would notice a log, rather than passing because it scans nothing", () => {
  /* The fail-closed half. The scan above returning an empty list proves nothing
     unless the scanner can see a console call when there is one. */
  const files = [
    join(SRC, "lib", "territoryCells.ts"),
    join(APP, "move", "summary.tsx"),
  ];
  for (const file of files) {
    assert.ok(read(file).length > 200, `${file} is empty — the scan reads nothing`);
    const withLog = read(file) + "\nconsole.log(traversedHexIds);\n";
    assert.ok(/\bconsole\s*\./.test(withLog), "the scanner cannot see a console call");
  }
});

test("no cell trail reaches durable storage", () => {
  /* Two things reach disk on this path: the game store and the pending
     verification queue. The store keeps zone ids, which are single captured
     cells rather than a route, and a traversed COUNT. Neither may become a
     list. */
  const store = code(join(SRC, "store", "useGameStore.ts"));
  for (const forbidden of ["traversedHexIds", "cellTrail", "routeCells", "visitedCells", "cellHistory"]) {
    assert.ok(
      !new RegExp(`\\b${forbidden}\\b`).test(store),
      `the persisted store grew ${forbidden} — a cell sequence is location history`,
    );
  }
  /* Fail-closed: the store holds `VerifiedMovementRecord[]`, and that record is
     where the count lives. If the record ever stopped carrying one, the scan
     above would pass for the wrong reason — because there is nothing left on
     this path to find. */
  const record = code(join(SRC, "lib", "verifiedMovement.ts"));
  assert.match(record, /traversedHexCount:\s*number/, "the guard lost its subject");
  assert.match(store, /movementVerifications/, "the store no longer holds the records at all");
});

test("the shareable proof carries no cells", () => {
  const proof = code(join(SRC, "lib", "routeProof.ts"));
  for (const forbidden of ["traversedHexIds", "hexIds", "cells", "cellIds", "h3"]) {
    assert.ok(
      !new RegExp(`\\b${forbidden}\\b`, "i").test(proof),
      `the shared proof model carries ${forbidden}`,
    );
  }
});

test("deriving cells for the screen writes nothing down", () => {
  const derivation = code(join(SRC, "lib", "territoryCells.ts"));
  for (const forbidden of ["AsyncStorage", "SecureStore", "localStorage", "writeFile", "cache", "Map<"]) {
    assert.ok(
      !new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(derivation),
      `the projection keeps ${forbidden} — cells must be derived transiently`,
    );
  }
});

/* ── boundedness ──────────────────────────────────────────────────────────── */

test("the board's cell count is bounded by the store's own cap", () => {
  const store = read(join(SRC, "store", "useGameStore.ts"));
  assert.match(store, /\[zone, \.\.\.state\.zones\]\.slice\(0, 100\)/, "the zone list is unbounded");
});

test("a long route produces at most one cell per observed point", () => {
  /* Cells are deduplicated, so the count can only be smaller. This is the
     property that keeps a two-hour session from producing an unbounded list
     independent of how many samples the device emitted. */
  const points = Array.from({ length: 500 }, (_, i) => ({
    latitude: 12.9716 + i * 0.0001,
    longitude: 77.5946,
    timestamp: 1_756_000_000_000 + i * 1000,
    accuracy: 8,
  }));
  const cells = cellsForRoute(points);
  assert.ok(cells.length <= points.length);
  assert.equal(new Set(cells.map((c) => c.id)).size, cells.length, "cells are not deduplicated");
});
