import { test } from "node:test";
import assert from "node:assert/strict";
import { cellToChildren, latLngToCell } from "h3-js";
import { cellToInt8, int8ToCell, isStorableCell } from "./cells.js";

const R10 = latLngToCell(51.5007, -0.1246, 10);

test("a cell round-trips through int8 exactly, at every resolution gameplay uses", () => {
  for (const res of [8, 9, 10, 11]) {
    const cell = latLngToCell(51.5007, -0.1246, res);
    const n = cellToInt8(cell);
    assert.match(n, /^\d+$/);
    assert.ok(BigInt(n) > 0n && BigInt(n) < 2n ** 63n, "fits a signed bigint");
    assert.equal((BigInt(n) >> 59n) & 15n, 1n, "cell mode, as the 0011 CHECK requires");
    assert.equal(int8ToCell(n), cell);
    assert.equal(int8ToCell(BigInt(n)), cell);
  }
  for (const child of cellToChildren(R10, 11)) assert.equal(int8ToCell(cellToInt8(child)), child);
});

test("only canonical lowercase cells are storable", () => {
  assert.equal(isStorableCell(R10), true);
  for (const bad of [R10.toUpperCase(), `${R10}0`, R10.slice(1), "u1", "", 42, null, undefined, "8a194ad3...fff"]) {
    assert.equal(isStorableCell(bad), false, String(bad));
  }
  assert.throws(() => cellToInt8(R10.toUpperCase()));
  assert.throws(() => int8ToCell("0"));
  assert.throws(() => int8ToCell(-5));
});
