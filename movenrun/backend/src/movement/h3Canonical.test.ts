/**
 * The backend's half of "one world grid".
 *
 * The claim this file exists to make good on is narrow and load-bearing: a
 * coordinate produces the same cell id on the server as it does on the device.
 * Not "both use H3" — both used H3-shaped ids before and still disagreed,
 * because the app was on a 300 m lattice of its own. The property is agreement
 * on the *same* function, so it is asserted against the same committed golden
 * vectors the shared and mobile suites use.
 *
 * It also asserts what the backend must NOT have started doing: writing
 * territory. Traversal is evidence of movement, and the endpoint that reports
 * it grants nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { H3_RESOLUTION, H3DomainError, isGameplayCell } from "@movenrun/shared/h3";

import { HexService } from "../services/hex.service.js";
import { verifyMovement } from "./domain/verification.js";
import type { MovementObservation, ObservedPoint } from "./domain/types.js";

const BACKEND = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p: string) => readFileSync(p, "utf8");

/**
 * The same committed cell ids as `shared/src/domain/__tests__/h3.test.ts` and
 * `mobile/src/lib/__tests__/territoryCells.test.ts`.
 *
 * Written out again rather than imported, on purpose. Three suites reading one
 * fixture would agree with each other by construction; three suites holding the
 * same literals agree about the world.
 */
const GOLDEN = [
  { place: "Bengaluru", lat: 12.9716, lng: 77.5946, cell: "8860145b49fffff" },
  { place: "New York City", lat: 40.7812, lng: -73.9665, cell: "882a100895fffff" },
  { place: "Berlin", lat: 52.52, lng: 13.405, cell: "881f1d4895fffff" },
  { place: "east of the antimeridian", lat: -16.9186, lng: 179.9, cell: "889b4360dbfffff" },
  { place: "west of the antimeridian", lat: -16.9186, lng: -179.9, cell: "889b436a65fffff" },
];

const hex = new HexService();

/* ── the same coordinate, the same cell ───────────────────────────────────── */

test("the backend indexes at the canonical gameplay resolution", () => {
  assert.equal(hex.resolution, H3_RESOLUTION);
  assert.equal(H3_RESOLUTION, 8);
});

test("the backend derives the cell the app derives, for the same coordinate", () => {
  for (const v of GOLDEN) {
    assert.equal(hex.latLngToHex(v.lat, v.lng), v.cell, v.place);
    assert.ok(isGameplayCell(hex.latLngToHex(v.lat, v.lng)));
  }
});

test("swapping latitude and longitude does not silently succeed on the server either", () => {
  /* Unguarded, h3-js wraps an out-of-range latitude and answers with a cell.
     The two antimeridian vectors have a longitude that is not a valid latitude,
     so the reversal has to be a rejection rather than a different cell. */
  assert.throws(() => hex.latLngToHex(179.9, -16.9186), H3DomainError);
  assert.throws(() => hex.latLngToHex(-179.9, -16.9186), H3DomainError);
  /* Where the reversal IS a valid coordinate, it must at least be a different
     cell — otherwise a swap would be undetectable. */
  assert.notEqual(hex.latLngToHex(77.5946, 12.9716), GOLDEN[0].cell);
});

test("an out-of-range coordinate is rejected rather than wrapped onto real ground", () => {
  for (const [lat, lng] of [
    [91, 0], [-91, 0], [1000, 0], [0, 200], [0, -200], [0, 540],
    [NaN, 0], [0, NaN], [Infinity, 0],
  ] as [number, number][]) {
    assert.throws(() => hex.latLngToHex(lat, lng), H3DomainError, `${lat},${lng} was accepted`);
  }
});

test("a malformed cell id cannot produce a plausible-looking answer", () => {
  /* `cellToLatLng("zzz")` returns a real-looking point and `gridDisk("zzz", 1)`
     an empty list, neither of which is an error the caller can see. */
  for (const call of [
    () => hex.hexToLatLng("zzz"),
    () => hex.getNeighbors("zzz"),
    () => hex.hexToLatLng(""),
    () => hex.getNeighbors("8960145b483ffff"), // valid H3, wrong resolution
  ]) {
    assert.throws(call, H3DomainError);
  }
});

test("a cell centre round-trips back to its own cell", () => {
  for (const v of GOLDEN) {
    const [lat, lng] = hex.hexToLatLng(v.cell);
    assert.equal(hex.latLngToHex(lat, lng), v.cell, v.place);
  }
});

test("neighbours are real cells, and exclude the cell itself", () => {
  const neighbours = hex.getNeighbors(GOLDEN[0].cell);
  assert.ok(neighbours.length <= 6);
  assert.ok(!neighbours.includes(GOLDEN[0].cell));
  for (const n of neighbours) assert.ok(isGameplayCell(n));
});

/* ── traversed-cell semantics ─────────────────────────────────────────────── */

test("traversed cells are the cells the observed points fall in, deduplicated, first-touch first", () => {
  const points = [
    { lat: 12.9716, lng: 77.5946 },
    { lat: 12.9716, lng: 77.5946 },
    { lat: 52.52, lng: 13.405 },
    { lat: 12.9716, lng: 77.5946 },
  ];
  assert.deepEqual(hex.getHexIdsForPoints(points), [GOLDEN[0].cell, GOLDEN[2].cell]);
});

test("the order is first touch, and revisiting does not reorder", () => {
  const forward = hex.getHexIdsForPoints([
    { lat: 52.52, lng: 13.405 },
    { lat: 12.9716, lng: 77.5946 },
    { lat: 52.52, lng: 13.405 },
  ]);
  assert.deepEqual(forward, [GOLDEN[2].cell, GOLDEN[0].cell]);
});

test("the semantics are containment of samples, not intersection of the path", () => {
  /* Two points far enough apart that the straight line between them crosses
     many cells. Exactly two are reported, which is the honest answer for
     sampled observations — and the limitation sealing will have to address
     deliberately rather than inherit. */
  const cells = hex.getHexIdsForPoints([
    { lat: 12.9716, lng: 77.5946 },
    { lat: 12.9716, lng: 77.6946 },
  ]);
  assert.equal(cells.length, 2, "the projection interpolated between samples");
});

test("an empty observation traverses nothing", () => {
  assert.deepEqual(hex.getHexIdsForPoints([]), []);
});

/* ── verification still behaves exactly as it did ─────────────────────────── */

function observation(points: ObservedPoint[]): MovementObservation {
  return { startTime: 1_756_000_000_000, endTime: 1_756_000_600_000, points };
}

const deps = {
  detectAnomalies: () => ({ isAnomaly: false, reasons: [] as string[], confidence: 0.95 }),
  calculateDistance: () => 431,
  traversedHexIds: (points: ObservedPoint[]) =>
    hex.getHexIdsForPoints(points.map((p) => ({ lat: p.lat, lng: p.lng }))),
  now: () => 1_756_000_700_000,
};

test("a verified session reports real cells, through the same shared domain", () => {
  const result = verifyMovement(
    observation([
      { lat: 12.9716, lng: 77.5946, accuracy: 8, timestamp: 1_756_000_100_000 },
      { lat: 52.52, lng: 13.405, accuracy: 8, timestamp: 1_756_000_200_000 },
    ]),
    deps,
  );
  assert.equal(result.status, "verified");
  assert.deepEqual(result.traversedHexIds, [GOLDEN[0].cell, GOLDEN[2].cell]);
  for (const cell of result.traversedHexIds) assert.ok(isGameplayCell(cell));
});

test("a structurally rejected session derives no cells at all", () => {
  /* Rejection short-circuits before measurement, so the H3 call is never
     reached — which is also why an out-of-range coordinate cannot crash the
     endpoint: the HTTP schema bounds latitude and longitude before this. */
  const result = verifyMovement(
    { startTime: 2, endTime: 1, points: [] },
    { ...deps, traversedHexIds: () => { throw new Error("must not be called"); } },
  );
  assert.equal(result.status, "rejected");
  assert.deepEqual(result.traversedHexIds, []);
});

test("the request schema rejects a coordinate before it can reach the grid", () => {
  const validation = read(join(BACKEND, "src", "movement", "http", "validation.ts"));
  assert.match(validation, /lat:\s*z\.number\(\)\.finite\(\)\.min\(-90\)\.max\(90\)/);
  assert.match(validation, /lng:\s*z\.number\(\)\.finite\(\)\.min\(-180\)\.max\(180\)/);
});

/* ── traversal is not territory ───────────────────────────────────────────── */

test("a verification result has no field that could mean owned", () => {
  const result = verifyMovement(
    observation([
      { lat: 12.9716, lng: 77.5946, accuracy: 8, timestamp: 1_756_000_100_000 },
      { lat: 12.9717, lng: 77.5947, accuracy: 8, timestamp: 1_756_000_200_000 },
    ]),
    deps,
  );
  for (const forbidden of [
    "owner", "ownedHexIds", "capturedHexIds", "captured", "zones", "zoneIds",
    "solid", "shade", "sealed", "strength", "deed", "holder",
  ]) {
    assert.ok(!(forbidden in result), `the verification result leaked ${forbidden}`);
  }
  assert.deepEqual(Object.keys(result).sort(), [
    "confidence", "distanceMeters", "durationSeconds", "rejectionReasons",
    "status", "traversedHexIds",
  ]);
});

test("verifying movement writes no territory", () => {
  /* The structural half, at the two places a write could be introduced: the
     verification service, and the repository it is given. Neither may reach a
     zone or hex-activity table. */
  for (const file of [
    join(BACKEND, "src", "movement", "services", "movementVerification.service.ts"),
    join(BACKEND, "src", "movement", "repositories", "drizzle", "store.ts"),
  ]) {
    const source = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
    for (const forbidden of ["zones", "hexActivities", "hex_activities", "userRouteHexes", "user_route_hexes", "deed"]) {
      assert.ok(
        !new RegExp(`\\b${forbidden}\\b`).test(source),
        `${file} reaches for ${forbidden} — verification must not write territory`,
      );
    }
  }
});

test("the public response reports traversal and nothing that grants it", () => {
  const router = read(join(BACKEND, "src", "movement", "http", "router.ts"));
  const shape = router.slice(
    router.indexOf("function toPublicVerification"),
    router.indexOf("export function createMovementRouter"),
  );
  assert.ok(shape.length > 0, "the response-shape guard found nothing");
  assert.match(shape, /traversedHexIds: record\.traversedHexIds/);
  for (const forbidden of ["owned", "captured", "zone", "deed", "confidence", "userId", "wallet"]) {
    assert.ok(
      !new RegExp(`\\b${forbidden}`, "i").test(shape),
      `the public verification response carries ${forbidden}`,
    );
  }
});

/* ── no second definition of the world ────────────────────────────────────── */

test("the backend has no resolution of its own, and no way to configure one", () => {
  const config = read(join(BACKEND, "src", "config.ts"));
  assert.ok(
    !/H3_RESOLUTION\s*:\s*z\./.test(config),
    "the environment can set a gameplay resolution — mobile and backend could index different worlds",
  );
  const service = read(join(BACKEND, "src", "services", "hex.service.ts")).replace(
    /\/\*[\s\S]*?\*\/|\/\/.*/g,
    "",
  );
  assert.ok(
    !/H3_RESOLUTION\s*=/.test(service),
    "hex.service.ts defines its own resolution instead of importing the canonical one",
  );
  assert.ok(
    !/from\s+["']h3-js["']/.test(service),
    "hex.service.ts calls h3-js directly, bypassing the domain layer's validation",
  );
  assert.match(service, /from "@movenrun\/shared\/h3"/);
});
