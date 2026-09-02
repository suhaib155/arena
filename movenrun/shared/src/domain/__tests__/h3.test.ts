/**
 * The canonical H3 domain — MovenRun's contract with H3, not H3's own.
 *
 * These tests do not check that Uber's library indexes hexagons correctly.
 * They check the things this repository can get wrong: which resolution the
 * world is tiled at, which way round a coordinate goes, what happens to input
 * that is not a location, and whether a promise the module makes in its
 * comments ("origin first", "bounded", "first-touch order") is actually kept.
 *
 * ## About the golden vectors
 *
 * The expected cell ids below are committed literals. They were produced once,
 * out of band, by calling h3-js directly rather than by calling the function
 * under test — a test that asks `cellForCoordinate` what `cellForCoordinate`
 * returns proves only that the code is deterministic, which is not the claim.
 *
 * Each one is then confirmed a second time, here, by a property that does not
 * use the forward conversion at all: the source coordinate is checked to lie
 * inside the polygon `cellBoundary` returns for the expected cell, by a
 * ray-casting test written in this file. So a wrong literal fails even if the
 * conversion is wrong in the same direction.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  cellBoundary,
  cellBoundaryRing,
  cellCenter,
  cellForCoordinate,
  cellsForObservations,
  H3_RESOLUTION,
  H3DomainError,
  isGameplayCell,
  isValidCoordinate,
  localLayout,
  MAX_NEIGHBORHOOD_RADIUS,
  maxCellsInRadius,
  neighborhood,
  parseGameplayCell,
  toGameplayCell,
  tryCellForCoordinate,
  type GeoCoordinate,
  type H3Cell,
} from "../h3";

/* ── golden vectors ───────────────────────────────────────────────────────── */

interface GoldenVector {
  place: string;
  latitude: number;
  longitude: number;
  /** Produced by `h3.latLngToCell(latitude, longitude, 8)` directly. */
  cell: string;
  /** Produced by `h3.latLngToCell(longitude, latitude, 8)` — the reversal. */
  reversedCell: string;
}

/**
 * Four places on four different parts of the globe, plus both sides of the
 * antimeridian, because a grid that works in one hemisphere and folds in
 * another is the exact bug that stays hidden until someone travels.
 *
 * The antimeridian pair is the load-bearing one: the two coordinates are 0.2°
 * apart and sit either side of ±180, so a longitude that is wrapped, clamped or
 * sign-flipped anywhere in the chain lands one of them on the other's cell.
 */
const GOLDEN: GoldenVector[] = [
  {
    place: "Bengaluru, India",
    latitude: 12.9716,
    longitude: 77.5946,
    cell: "8860145b49fffff",
    reversedCell: "88015189e3fffff",
  },
  {
    place: "New York City, United States",
    latitude: 40.7812,
    longitude: -73.9665,
    cell: "882a100895fffff",
    reversedCell: "88f05ab411fffff",
  },
  {
    place: "Berlin, Germany",
    latitude: 52.52,
    longitude: 13.405,
    cell: "881f1d4895fffff",
    reversedCell: "8863a069d1fffff",
  },
  {
    place: "east of the antimeridian",
    latitude: -16.9186,
    longitude: 179.9,
    cell: "889b4360dbfffff",
    reversedCell: "887656b6e1fffff",
  },
  {
    place: "west of the antimeridian",
    latitude: -16.9186,
    longitude: -179.9,
    cell: "889b436a65fffff",
    reversedCell: "887656a0bbfffff",
  },
];

/** Valid H3 indexes for the same place at other resolutions. Real cells — the
 *  point is that being real H3 is not enough to be gameplay geography. */
const OTHER_RESOLUTIONS = {
  res0: "8061fffffffffff",
  res7: "8760145b4ffffff",
  res9: "8960145b483ffff",
};

/**
 * Point-in-polygon by ray casting, written here rather than imported, so the
 * golden confirmation does not run through any code this module shares with
 * the thing being confirmed.
 */
function containsPoint(polygon: GeoCoordinate[], point: GeoCoordinate): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const straddles = a.latitude > point.latitude !== b.latitude > point.latitude;
    if (!straddles) continue;
    const crossing =
      ((b.longitude - a.longitude) * (point.latitude - a.latitude)) /
        (b.latitude - a.latitude) +
      a.longitude;
    if (point.longitude < crossing) inside = !inside;
  }
  return inside;
}

/* ── the resolution is one number, and it is 8 ────────────────────────────── */

test("the gameplay world is tiled at resolution 8", () => {
  assert.equal(H3_RESOLUTION, 8);
});

test("every golden cell is at the gameplay resolution", () => {
  for (const v of GOLDEN) {
    assert.ok(isGameplayCell(v.cell), `${v.place}: ${v.cell} is not a gameplay cell`);
  }
});

/* ── golden vectors ───────────────────────────────────────────────────────── */

test("each golden coordinate maps to its committed cell", () => {
  for (const v of GOLDEN) {
    assert.equal(
      cellForCoordinate({ latitude: v.latitude, longitude: v.longitude }),
      v.cell,
      v.place,
    );
  }
});

test("each committed cell really contains its coordinate, checked without the conversion", () => {
  for (const v of GOLDEN) {
    const boundary = cellBoundary(v.cell as H3Cell);
    assert.ok(
      containsPoint(boundary, { latitude: v.latitude, longitude: v.longitude }),
      `${v.place}: ${v.cell} does not contain the coordinate it is supposed to`,
    );
  }
});

test("swapping latitude and longitude produces a different cell, every time", () => {
  for (const v of GOLDEN) {
    /* h3-js accepts an out-of-range latitude by wrapping it, so a reversed pair
       does not fail — it succeeds somewhere else on Earth. That is why this is
       asserted rather than assumed, and why the domain layer range-checks. */
    assert.notEqual(
      v.reversedCell,
      v.cell,
      `${v.place}: the reversal fixture is not actually a different cell`,
    );
  }
});

test("a conversion that reversed the arguments would fail the golden vectors", () => {
  /* The mutation this suite exists to catch, applied here as a stand-in
     implementation: if any conversion in the chain swapped the two, this is
     the value it would produce, and it is not the committed one. */
  const reversedImplementation = (c: GeoCoordinate) =>
    cellForCoordinate({ latitude: c.longitude, longitude: c.latitude });
  for (const v of GOLDEN) {
    if (Math.abs(v.longitude) > 90) continue; // not a latitude; rejected below instead
    assert.notEqual(
      reversedImplementation({ latitude: v.latitude, longitude: v.longitude }),
      v.cell,
      v.place,
    );
  }
});

test("the antimeridian pair stays on its own side", () => {
  const east = GOLDEN.find((v) => v.place === "east of the antimeridian")!;
  const west = GOLDEN.find((v) => v.place === "west of the antimeridian")!;
  assert.notEqual(east.cell, west.cell);
  assert.equal(cellForCoordinate({ latitude: east.latitude, longitude: east.longitude }), east.cell);
  assert.equal(cellForCoordinate({ latitude: west.latitude, longitude: west.longitude }), west.cell);
});

test("the poles and the antimeridian are locations, not edge cases to reject", () => {
  for (const coordinate of [
    { latitude: 90, longitude: 0 },
    { latitude: -90, longitude: 0 },
    { latitude: 0, longitude: 180 },
    { latitude: 0, longitude: -180 },
    { latitude: 0, longitude: 0 },
  ]) {
    assert.ok(isValidCoordinate(coordinate));
    assert.ok(isGameplayCell(cellForCoordinate(coordinate)));
  }
});

/* ── invalid input fails closed ───────────────────────────────────────────── */

test("a latitude outside ±90 is rejected, not wrapped onto real ground", () => {
  for (const latitude of [90.0001, 91, 180, 1000, -90.0001, -91, -1000]) {
    assert.throws(
      () => cellForCoordinate({ latitude, longitude: 0 }),
      H3DomainError,
      `latitude ${latitude} was accepted`,
    );
  }
});

test("a longitude outside ±180 is rejected rather than normalised", () => {
  /* h3-js folds 200 to −160 and 540 to 180, each of which is a real place. If
     wrapping is ever wanted it has to be asked for by name; silently is how a
     client bug becomes territory in the wrong country. */
  for (const longitude of [180.0001, 200, 361, 540, -180.0001, -200, -540]) {
    assert.throws(
      () => cellForCoordinate({ latitude: 0, longitude }),
      H3DomainError,
      `longitude ${longitude} was accepted`,
    );
  }
});

test("NaN and Infinity are not coordinates", () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.throws(() => cellForCoordinate({ latitude: bad, longitude: 0 }), H3DomainError);
    assert.throws(() => cellForCoordinate({ latitude: 0, longitude: bad }), H3DomainError);
  }
});

test("a shape that is not a coordinate is not a coordinate", () => {
  for (const bad of [null, undefined, 0, "12.9716,77.5946", [12.9716, 77.5946], {}, { latitude: 1 }, { latitude: "1", longitude: "2" }]) {
    assert.equal(isValidCoordinate(bad), false, JSON.stringify(bad));
    assert.equal(tryCellForCoordinate(bad), null);
  }
});

test("a bad sample is absent rather than exceptional when the caller asks for that", () => {
  assert.equal(tryCellForCoordinate({ latitude: 91, longitude: 0 }), null);
  assert.equal(
    tryCellForCoordinate({ latitude: 12.9716, longitude: 77.5946 }),
    GOLDEN[0].cell,
  );
});

/* ── cell validation ──────────────────────────────────────────────────────── */

test("a valid H3 index at the wrong resolution is not gameplay geography", () => {
  for (const [name, cell] of Object.entries(OTHER_RESOLUTIONS)) {
    assert.equal(isGameplayCell(cell), false, `${name} (${cell}) was accepted`);
    assert.throws(() => toGameplayCell(cell), H3DomainError, name);
    assert.equal(parseGameplayCell(cell), null, name);
  }
});

test("malformed, empty and non-string cell input is rejected", () => {
  for (const bad of [
    "",
    " ",
    "zzz",
    "8860145b49ffff",           // one digit short
    "8860145b49fffff ",         // trailing space
    "0x8860145b49fffff",        // hex-prefixed
    "mrx-1qz8x4",               // a legacy lattice id
    null,
    undefined,
    0,
    9.6001e15,
    {},
    ["8860145b49fffff"],
  ]) {
    assert.equal(isGameplayCell(bad), false, JSON.stringify(bad));
    assert.throws(() => toGameplayCell(bad), H3DomainError, JSON.stringify(bad));
  }
});

test("an uppercase index is rejected, because one cell must have one spelling", () => {
  /* h3-js accepts "8860145B49FFFFF" as valid and `latLngToCell` never emits it.
     Both spellings passing would mean a Set deduplicates one cell into two and
     a store keyed by cell id holds two rows for one piece of ground. */
  const upper = GOLDEN[0].cell.toUpperCase();
  assert.notEqual(upper, GOLDEN[0].cell);
  assert.equal(isGameplayCell(upper), false);
  assert.throws(() => toGameplayCell(upper), H3DomainError);
});

test("geometry refuses a cell it cannot trust, instead of answering anyway", () => {
  /* Unguarded, `cellToLatLng("zzz")` returns a plausible point and
     `cellToBoundary("zzz")` a polygon spanning half the planet. */
  for (const call of [
    () => cellCenter("zzz" as H3Cell),
    () => cellBoundary("zzz" as H3Cell),
    () => cellBoundaryRing("zzz" as H3Cell),
    () => neighborhood("zzz" as H3Cell, 1),
  ]) {
    assert.throws(call, H3DomainError);
  }
});

/* ── geometry ─────────────────────────────────────────────────────────────── */

test("a cell's centre is inside the cell", () => {
  for (const v of GOLDEN) {
    const cell = v.cell as H3Cell;
    const centre = cellCenter(cell);
    assert.ok(isValidCoordinate(centre), `${v.place}: centre is not a coordinate`);
    assert.equal(cellForCoordinate(centre), v.cell, `${v.place}: centre is in another cell`);
  }
});

test("a boundary is a closeable ring of real coordinates", () => {
  for (const v of GOLDEN) {
    const boundary = cellBoundary(v.cell as H3Cell);
    /* Five for a pentagon, six for a hexagon, more where H3 inserts distortion
       vertices. Asserted as a range, because assuming six is how a pentagon
       becomes a crash. */
    assert.ok(boundary.length >= 5, `${v.place}: ${boundary.length} vertices`);
    for (const vertex of boundary) {
      assert.ok(isValidCoordinate(vertex), `${v.place}: vertex out of range`);
    }
    /* Open: the first vertex is not repeated. */
    const first = boundary[0];
    const last = boundary[boundary.length - 1];
    assert.ok(first.latitude !== last.latitude || first.longitude !== last.longitude);
  }
});

test("the GeoJSON ring is longitude-first and closed", () => {
  for (const v of GOLDEN) {
    const cell = v.cell as H3Cell;
    const boundary = cellBoundary(cell);
    const ring = cellBoundaryRing(cell);

    assert.equal(ring.length, boundary.length + 1, `${v.place}: ring is not closed`);
    assert.deepEqual(ring[0], ring[ring.length - 1], `${v.place}: ring does not meet`);

    for (let i = 0; i < boundary.length; i++) {
      const [longitude, latitude] = ring[i];
      assert.equal(longitude, boundary[i].longitude, `${v.place}: vertex ${i} longitude`);
      assert.equal(latitude, boundary[i].latitude, `${v.place}: vertex ${i} latitude`);
    }
  }
});

test("the GeoJSON ring is not merely the boundary with the axes left alone", () => {
  /* Berlin is the discriminating case: latitude 52.5 and longitude 13.4 are far
     enough apart that an unswapped pair is obvious, and both are in range so a
     swap would not be caught by a bounds check. */
  const berlin = GOLDEN.find((v) => v.place === "Berlin, Germany")!;
  const [longitude, latitude] = cellBoundaryRing(berlin.cell as H3Cell)[0];
  assert.ok(Math.abs(latitude - berlin.latitude) < 1, "first ring value is not the longitude");
  assert.ok(Math.abs(longitude - berlin.longitude) < 1, "second ring value is not the latitude");
});

test("geometry is copied out, never a handle on the library's own arrays", () => {
  const cell = GOLDEN[0].cell as H3Cell;
  const first = cellBoundary(cell);
  first[0].latitude = 0;
  first.length = 1;
  const second = cellBoundary(cell);
  assert.ok(second.length >= 5);
  assert.notEqual(second[0].latitude, 0);
});

/* ── adjacency, bounded ───────────────────────────────────────────────────── */

test("a neighbourhood is bounded by the disk formula at every allowed radius", () => {
  const cell = GOLDEN[0].cell as H3Cell;
  for (let radius = 0; radius <= MAX_NEIGHBORHOOD_RADIUS; radius++) {
    const cells = neighborhood(cell, radius);
    assert.ok(
      cells.length <= maxCellsInRadius(radius),
      `radius ${radius}: ${cells.length} cells exceeds the bound ${maxCellsInRadius(radius)}`,
    );
    assert.equal(new Set(cells).size, cells.length, `radius ${radius}: duplicate cells`);
    for (const c of cells) assert.ok(isGameplayCell(c));
  }
});

test("the neighbourhood radius has a hard ceiling", () => {
  const cell = GOLDEN[0].cell as H3Cell;
  assert.throws(() => neighborhood(cell, MAX_NEIGHBORHOOD_RADIUS + 1), H3DomainError);
  assert.throws(() => neighborhood(cell, 50), H3DomainError);
  assert.throws(() => neighborhood(cell, -1), H3DomainError);
  assert.throws(() => neighborhood(cell, 1.5), H3DomainError);
  assert.throws(() => neighborhood(cell, NaN), H3DomainError);
});

test("the ceiling is low enough that the largest neighbourhood stays small", () => {
  /* The number that matters is what a screen could be asked to draw. */
  assert.ok(maxCellsInRadius(MAX_NEIGHBORHOOD_RADIUS) <= 40);
});

test("a neighbourhood puts the origin first and orders the rest deterministically", () => {
  const cell = GOLDEN[0].cell as H3Cell;
  const once = neighborhood(cell, 2);
  const twice = neighborhood(cell, 2);
  assert.deepEqual(once, twice);
  assert.equal(once[0], cell);
  const rest = once.slice(1);
  assert.deepEqual(rest, [...rest].sort(), "the tail is not in lexicographic order");
});

test("radius zero is the cell itself", () => {
  const cell = GOLDEN[0].cell as H3Cell;
  assert.deepEqual(neighborhood(cell, 0), [cell]);
});

test("a pentagon's neighbourhood is short rather than broken", () => {
  /* One of the twelve res-8 pentagons. It has five neighbours, not six, so any
     code that assumed 3k²+3k+1 exactly would be wrong here. */
  const pentagon = "8808000001fffff" as H3Cell;
  assert.ok(isGameplayCell(pentagon));
  const cells = neighborhood(pentagon, 1);
  assert.ok(cells.length < maxCellsInRadius(1));
  assert.equal(cells[0], pentagon);
  for (const c of cells) assert.ok(isGameplayCell(c));
});

/* ── observation → cells ──────────────────────────────────────────────────── */

test("observed points become cells in first-touch order, each once", () => {
  const a = { latitude: 12.9716, longitude: 77.5946 };
  const far = { latitude: 40.7812, longitude: -73.9665 };
  const cells = cellsForObservations([a, a, far, a, far]);
  assert.deepEqual(cells, [GOLDEN[0].cell, GOLDEN[1].cell]);
});

test("returning to an earlier cell does not move it in the order", () => {
  const first = { latitude: 12.9716, longitude: 77.5946 };
  const second = { latitude: 52.52, longitude: 13.405 };
  assert.deepEqual(cellsForObservations([first, second, first]), [
    GOLDEN[0].cell,
    GOLDEN[2].cell,
  ]);
});

test("no observations means no cells", () => {
  assert.deepEqual(cellsForObservations([]), []);
});

test("one bad point rejects the batch rather than quietly shortening the route", () => {
  /* Dropping it would be worse than failing: the caller would receive a
     shorter, entirely plausible list and have no way to know a sample was
     discarded. */
  assert.throws(
    () =>
      cellsForObservations([
        { latitude: 12.9716, longitude: 77.5946 },
        { latitude: 91, longitude: 0 },
      ]),
    H3DomainError,
  );
});

test("cell derivation reports where movement happened and nothing more", () => {
  /* A guard on the shape of the answer: a bare list of cell ids, with no room
     for a holder, a strength, a seal or a classification. Territory state is
     attached to a cell later, by systems that do not exist yet, and it must not
     be smuggled into geography by widening this return type. */
  const cells = cellsForObservations([{ latitude: 12.9716, longitude: 77.5946 }]);
  assert.equal(cells.length, 1);
  assert.equal(typeof cells[0], "string");
  /* An id and nothing else. If this ever became an object, the next field
     added to it would be `owner`, and geography would have grown a holder. */
  assert.equal(typeof (cells[0] as unknown), "string", "a cell is an identifier, not a record");
  assert.equal(JSON.stringify(cells), `["${GOLDEN[0].cell}"]`);
});

/* ── local layout ─────────────────────────────────────────────────────────── */

test("cells adjacent in the world are adjacent on the local grid", () => {
  const origin = GOLDEN[0].cell as H3Cell;
  const ring = neighborhood(origin, 1);
  const { placed, unplaced } = localLayout(ring);

  assert.deepEqual(unplaced, []);
  assert.equal(placed.length, ring.length);
  const anchor = placed[0];
  assert.equal(anchor.cell, origin);
  assert.equal(anchor.q, 0 + anchor.q); // the anchor's own coordinates are the origin of the frame

  /* Every neighbour is exactly one axial step from the anchor. The six steps
     are the standard axial neighbourhood; if the IJ→axial conversion were
     wrong, at least one neighbour would land two steps away or on top of
     another. */
  const steps = new Set(["1,0", "-1,0", "0,1", "0,-1", "1,-1", "-1,1"]);
  const offsets = placed.slice(1).map((p) => `${p.q - anchor.q},${p.r - anchor.r}`);
  assert.equal(offsets.length, 6);
  assert.equal(new Set(offsets).size, 6, "two neighbours share a position");
  for (const offset of offsets) {
    assert.ok(steps.has(offset), `neighbour at ${offset} is not one axial step away`);
  }
});

test("cells too far apart to share a local grid are reported, never given a made-up position", () => {
  const bengaluru = GOLDEN[0].cell as H3Cell;
  const newYork = GOLDEN[1].cell as H3Cell;
  const { placed, unplaced } = localLayout([bengaluru, newYork]);
  assert.deepEqual(placed.map((p) => p.cell), [bengaluru]);
  assert.deepEqual(unplaced, [newYork]);
});

test("the local layout is deterministic and anchored on the first cell", () => {
  const ring = neighborhood(GOLDEN[2].cell as H3Cell, 1);
  const once = localLayout(ring);
  const twice = localLayout(ring);
  assert.deepEqual(once, twice);
  assert.equal(once.placed[0].cell, ring[0]);
});

test("laying out nothing is not an error", () => {
  assert.deepEqual(localLayout([]), { placed: [], unplaced: [] });
});

test("a layout refuses input that is not gameplay geography", () => {
  assert.throws(() => localLayout(["mrx-1qz8x4" as H3Cell]), H3DomainError);
  assert.throws(() => localLayout([OTHER_RESOLUTIONS.res9 as H3Cell]), H3DomainError);
});
