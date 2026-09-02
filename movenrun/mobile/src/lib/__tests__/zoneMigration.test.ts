/**
 * The v11 → v12 migration: the world grid became real.
 *
 * A device that has run any previous build holds zones keyed by ids from the
 * retired ~300 m lattice. Those ids cannot be converted into H3 cells — the
 * coordinates they were quantized from were never stored — so the only options
 * are to drop them or to invent geography, and inventing is what these tests
 * exist to prevent.
 *
 * The migration is a pure function so it can be exercised on plain Node against
 * realistic persisted state. What that alone would *not* prove is that it is
 * actually wired to run, or that the store's version moved with it, so the last
 * section asserts both against the store's source.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { migrateZonesToRealGeography, ZONE_GEOGRAPHY_VERSION } from "../zoneMigration";
import { isGameplayCell } from "../territoryCells";
import { isLegacyLatticeZoneId } from "../zones";
import type { Zone } from "@/types";

const SRC = join(process.cwd(), "src");
const read = (p: string) => readFileSync(p, "utf8");

/* Two real resolution-8 cells, and the lattice ids a device would actually
   hold. Committed literals — see shared/src/domain/__tests__/h3.test.ts. */
const REAL_A = "8860145b49fffff";
const REAL_B = "881f1d4895fffff";
const LEGACY_A = "mrx-1qz8x4";
const LEGACY_B = "mrx-7fk2m9";

/** A zone exactly as a v11 device persisted it. */
function persistedZone(id: string, name: string): Zone {
  return {
    id,
    name,
    state: "yours",
    controlPercent: 100,
    defensePercent: 40,
    lastTouchedAt: "2026-08-01T10:00:00.000Z",
    capturedAt: "2026-08-01T10:00:00.000Z",
    lastDefendedAt: "2026-08-01T10:00:00.000Z",
    lastFortifiedAt: null,
    fortifyCount: 2,
    isDeedPreview: false,
    isDemo: false,
  };
}

/**
 * Drop every `if (…) { … }` block, matching braces rather than reaching for the
 * first `}`. A nested object literal or a second condition inside the block
 * ends a lazy `[^}]*` early and leaves half a block behind, which is how a
 * scanner ends up asserting against text it did not mean to keep.
 */
function stripConditionalBlocks(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const next = source.indexOf("if (", i);
    if (next === -1) {
      out += source.slice(i);
      break;
    }
    out += source.slice(i, next);
    const open = source.indexOf("{", next);
    if (open === -1) {
      out += source.slice(next);
      break;
    }
    let depth = 1;
    let j = open + 1;
    for (; j < source.length && depth > 0; j++) {
      if (source[j] === "{") depth++;
      else if (source[j] === "}") depth--;
    }
    i = j;
  }
  return out;
}

/* ── fake territory does not become real geography ────────────────────────── */

test("legacy lattice zones are dropped, never converted into H3 cells", () => {
  const { kept, dropped } = migrateZonesToRealGeography([
    persistedZone(LEGACY_A, "Cedar Loop"),
    persistedZone(LEGACY_B, "Harbor Bend"),
  ]);
  assert.deepEqual(kept, [], "incompatible territory must be cleared, not translated");
  assert.equal(dropped, 2);
});

test("no surviving zone is keyed by a legacy id wearing a new label", () => {
  const { kept } = migrateZonesToRealGeography([
    persistedZone(LEGACY_A, "Cedar Loop"),
    persistedZone(REAL_A, "Market Square"),
    persistedZone(LEGACY_B, "Harbor Bend"),
  ]);
  for (const zone of kept) {
    assert.ok(isGameplayCell(zone.id), `${zone.id} survived and is not a real cell`);
    assert.equal(isLegacyLatticeZoneId(zone.id), false);
  }
});

test("the number of survivors is never larger than the number of real cells given", () => {
  /* The property a fabricating migration would break: two lattice zones in,
     two H3-looking zones out. */
  const input = [
    persistedZone(LEGACY_A, "Cedar Loop"),
    persistedZone(LEGACY_B, "Harbor Bend"),
    persistedZone(REAL_A, "Market Square"),
  ];
  const realCount = input.filter((z) => isGameplayCell(z.id)).length;
  assert.equal(migrateZonesToRealGeography(input).kept.length, realCount);
});

test("a real cell captured before the migration survives untouched", () => {
  const original = persistedZone(REAL_A, "Market Square");
  const { kept } = migrateZonesToRealGeography([original, persistedZone(LEGACY_A, "Cedar Loop")]);
  assert.deepEqual(kept.map((z) => z.id), [REAL_A]);
  assert.deepEqual(kept[0], original, "a surviving zone keeps every field it had");
});

test("order is preserved among survivors", () => {
  const { kept } = migrateZonesToRealGeography([
    persistedZone(REAL_B, "Birch Run"),
    persistedZone(LEGACY_A, "Cedar Loop"),
    persistedZone(REAL_A, "Market Square"),
  ]);
  assert.deepEqual(kept.map((z) => z.id), [REAL_B, REAL_A]);
});

/* ── malformed state cannot crash a cold start ────────────────────────────── */

test("malformed persisted zones cannot crash startup, and do not survive", () => {
  const { kept } = migrateZonesToRealGeography([
    persistedZone(REAL_B, "Birch Run"),
    { id: null },
    { id: "" },
    { id: "8860145b49ffff" },        // one digit short
    { id: "8960145b483ffff" },       // valid H3, wrong resolution
    { id: "8860145B49FFFFF" },       // uppercase: the same cell, another spelling
    { id: 12345 },
    { notAnId: true },
    null,
    undefined,
    "8860145b49fffff",               // a bare string where a zone was expected
    [],
  ]);
  assert.deepEqual(kept.map((z) => z.id), [REAL_B]);
});

test("state that is not a list at all is survivable", () => {
  for (const bad of [undefined, null, 0, "zones", {}, true]) {
    assert.deepEqual(
      migrateZonesToRealGeography(bad),
      { kept: [], dropped: 0 },
      JSON.stringify(bad),
    );
  }
});

test("a wrong-resolution cell is not gameplay geography even though it is real H3", () => {
  const { kept } = migrateZonesToRealGeography([
    persistedZone("8960145b483ffff", "Res Nine"),
    persistedZone("8760145b4ffffff", "Res Seven"),
    persistedZone("8061fffffffffff", "Res Zero"),
  ]);
  assert.deepEqual(kept, []);
});

/* ── it runs once, and running it again changes nothing ───────────────────── */

test("migrating already-migrated state is a no-op", () => {
  const input = [persistedZone(REAL_A, "Market Square"), persistedZone(LEGACY_A, "Cedar Loop")];
  const once = migrateZonesToRealGeography(input);
  const twice = migrateZonesToRealGeography(once.kept);
  assert.deepEqual(twice.kept, once.kept);
  assert.equal(twice.dropped, 0, "a second pass must have nothing left to drop");
});

test("a third pass is still the same state", () => {
  const first = migrateZonesToRealGeography([
    persistedZone(REAL_A, "Market Square"),
    persistedZone(REAL_B, "Birch Run"),
    persistedZone(LEGACY_B, "Harbor Bend"),
  ]);
  const second = migrateZonesToRealGeography(first.kept);
  const third = migrateZonesToRealGeography(second.kept);
  assert.deepEqual(third.kept, first.kept);
  assert.equal(third.dropped, 0);
});

test("a fresh install has nothing to migrate", () => {
  assert.deepEqual(migrateZonesToRealGeography([]), { kept: [], dropped: 0 });
});

test("the count of removals is a number, never a list of places", () => {
  const result = migrateZonesToRealGeography([
    persistedZone(LEGACY_A, "Cedar Loop"),
    persistedZone(LEGACY_B, "Harbor Bend"),
  ]);
  assert.equal(typeof result.dropped, "number");
  assert.deepEqual(Object.keys(result).sort(), ["dropped", "kept"]);
  /* An archive of the ids would still be a record of where the player has
     been, which is the thing the whole app is careful not to keep. */
  assert.ok(!JSON.stringify(result).includes(LEGACY_A));
});

/* ── the migration is wired, versioned, and narrow ────────────────────────── */

test("the store runs this migration, at this version", () => {
  const store = read(join(SRC, "store", "useGameStore.ts"));
  assert.match(
    store,
    /state\.zones = migrateZonesToRealGeography\(state\.zones\)\.kept;/,
    "the store must actually run the migration",
  );
  assert.match(
    store,
    /version: ZONE_GEOGRAPHY_VERSION,/,
    "the persisted version must be the one this migration declares",
  );
  assert.equal(ZONE_GEOGRAPHY_VERSION, 12);
});

test("the declared version is ahead of the one that shipped the lattice", () => {
  /* v11 was the last version whose zones were lattice ids. Anything at or below
     it would leave persisted fake territory unmigrated on upgrade. */
  assert.ok(ZONE_GEOGRAPHY_VERSION > 11);
});

test("the migration cannot map a legacy id onto real ground", () => {
  const source = read(join(SRC, "lib", "zoneMigration.ts")).replace(
    /\/\*[\s\S]*?\*\/|\/\/.*/g,
    "",
  );
  /* Each of these is a way to produce a cell rather than to check one, and
     none of them belongs in a migration. */
  for (const forbidden of [
    "cellForCoordinate", "tryCellForCoordinate", "latLngToCell", "cellsForRoute",
    "currentCell", "getCurrentPosition", "hash", "Math.random", "Date.now",
  ]) {
    assert.ok(
      !new RegExp(`\\b${forbidden}\\b`).test(source),
      `the migration reaches for ${forbidden} — legacy ids must not be mapped onto real ground`,
    );
  }
  assert.match(source, /parseGameplayCell/, "survival must be decided by real-cell validation");
});

test("the migration step in the store touches zones and nothing else", () => {
  const store = read(join(SRC, "store", "useGameStore.ts"));
  const start = store.indexOf("migrate: (persisted, _version) => {");
  assert.ok(start > 0, "the migrate function must exist");
  const body = store.slice(start, store.indexOf("partialize:"));

  /* Nothing that is progress rather than geography may be reset here.
     Conditional blocks are removed first, brace-aware: an
     `if (!Array.isArray(state.x)) { state.x = [] }` supplies a field an older
     schema never had, which is the opposite of discarding one it did. Scanning
     without that distinction flags every backfill in the function, and the
     guard then means nothing. What is left is the unconditional statements —
     which is exactly where a reset would have to live. */
  const unconditional = stripConditionalBlocks(body);
  assert.match(
    unconditional,
    /migrateZonesToRealGeography/,
    "the stripper ate the whole body — the guard is scanning nothing",
  );
  assert.ok(
    !/state\.routeTrustHistory\s*=\s*\[\]/.test(unconditional),
    "the stripper is not removing backfills — the guard would flag them",
  );
  for (const kept of [
    "totalXp", "streak", "history", "routeTrustHistory", "movementVerifications",
    "firstRun", "selectedClubId", "timesDefended", "questsCompleted", "completedQuestIds",
  ]) {
    assert.ok(
      !new RegExp(`state\\.${kept}\\s*=\\s*(\\[\\]|0|null)\\s*;`).test(unconditional),
      `the migration resets ${kept}, which is progress rather than geography`,
    );
  }

  /* And it may not reach outside this store. Auth and the queued-verification
     store have their own keys, their own lifecycles and their own retention. */
  for (const forbidden of ["useAuthStore", "SecureStore", "discardPendingVerifications", "verificationQueue"]) {
    assert.ok(!new RegExp(`\\b${forbidden}\\b`).test(body), `the migration touches ${forbidden}`);
  }
});

test("only capture writes a zone, and it writes the cell it was given", () => {
  /* The other half of "fake territory does not come back": the migration drops
     it, and nothing re-adds it. `captureZone` is the sole writer, and its input
     is a cell derived from the route. */
  const store = read(join(SRC, "store", "useGameStore.ts"));
  const setters = store.match(/set\(\{[^}]*zones:/g) ?? [];
  assert.ok(setters.length > 0, "the zone-writing guard found no writers — it is broken");
  /* `lastIndexOf`: both names appear first in the state interface above, so
     `indexOf` would slice a zero-length window and match nothing. */
  const capture = store.slice(
    store.lastIndexOf("captureZone: (zone) => {"),
    store.lastIndexOf("defendZones: (zoneIds) =>"),
  );
  assert.ok(capture.length > 0, "the capture-writer guard found no capture action");
  assert.match(capture, /state\.zones\.find\(\(z\) => z\.id === zone\.id\)/);
  assert.ok(
    !/mrx-/.test(store),
    "the store mentions a lattice id — nothing should mint or match one",
  );
});
