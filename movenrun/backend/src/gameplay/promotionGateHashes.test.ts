/**
 * The 0011 promotion gate names the reviewed sha256 of the proposed up and
 * down files (docs/G34_PROMOTION_GATE.md, "Reference values"). The owner
 * compares those values at promotion time, so they must be the hashes of the
 * files on this branch: a change to either file fails here until the gate is
 * updated in the same change, which is the signal that it needs a new review.
 *
 * Also pinned: 0011 is still only proposed (not in the drizzle journal, not
 * in CHECKSUMS.sha256, no file under drizzle/).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

const backend = new URL("../../", import.meta.url);
const gate = readFileSync(new URL("../docs/G34_PROMOTION_GATE.md", backend), "utf8");
const sha = (rel: string) => createHash("sha256").update(readFileSync(new URL(rel, backend))).digest("hex");

function gateValue(file: string): string {
  const row = gate.split("\n").find((l) => l.startsWith("|") && l.includes(`\`backend/drizzle-proposed/${file}\``));
  assert.ok(row, `the gate has a reference row for ${file}`);
  const m = /sha256 `([0-9a-f]{64})`/.exec(row!);
  assert.ok(m, `the ${file} row carries a full sha256`);
  return m![1]!;
}

test("promotion gate: the reviewed sha256 values are those of the proposed 0011 up and down files on this branch", () => {
  for (const f of ["0011_gameplay_holdings.sql", "0011_gameplay_holdings.down.sql"]) {
    assert.equal(gateValue(f), sha(`drizzle-proposed/${f}`), `${f}: update docs/G34_PROMOTION_GATE.md (and get the change reviewed) when the file changes`);
  }
  // Row 2 abbreviates the same values; they must not drift either.
  const up = sha("drizzle-proposed/0011_gameplay_holdings.sql");
  const down = sha("drizzle-proposed/0011_gameplay_holdings.down.sql");
  const row2 = gate.split("\n").find((l) => l.startsWith("| 2 |"));
  assert.ok(row2?.includes(`\`${up.slice(0, 8)}…${up.slice(-4)}\``), "gate row 2 names the current up hash");
  assert.ok(row2?.includes(`\`${down.slice(0, 8)}…${down.slice(-4)}\``), "gate row 2 names the current down hash");
});

test("0011 is still proposed: not in the journal, not in CHECKSUMS.sha256, no file under drizzle/", () => {
  const journal = JSON.parse(readFileSync(new URL("drizzle/meta/_journal.json", backend), "utf8")) as { entries: { tag: string }[] };
  assert.deepEqual(journal.entries.map((e) => e.tag.slice(0, 4)), ["0000", "0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009", "0010"]);
  const sums = readFileSync(new URL("drizzle/CHECKSUMS.sha256", backend), "utf8").trim().split("\n");
  assert.equal(sums.length, 11);
  assert.ok(sums.every((l) => !l.includes("0011")));
  assert.ok(readdirSync(new URL("drizzle/", backend)).every((f) => !f.startsWith("0011")));
});
