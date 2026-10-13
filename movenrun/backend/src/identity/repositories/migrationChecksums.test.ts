/**
 * Committed migrations are append-only. drizzle-kit records only which
 * migrations ran, not their content, so an edit to one that a database has
 * already applied would never reach that database and would silently split
 * it from a fresh one. `drizzle/CHECKSUMS.sha256` pins every migration's
 * SHA-256 and this test fails on any edit, rename, removal or unlisted file.
 *
 * Adding migration N: create it with drizzle-kit, then append its line with
 * `sha256sum 00NN_name.sql >> CHECKSUMS.sha256` (run inside drizzle/).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("../../../drizzle/", import.meta.url);

test("every committed migration matches its pinned checksum, and the journal lists exactly those files in order", () => {
  const pinned = readFileSync(new URL("CHECKSUMS.sha256", dir), "utf8").trim().split("\n").map((line) => {
    const m = /^([0-9a-f]{64}) {2}(\d{4}_[a-z0-9_]+\.sql)$/.exec(line);
    assert.ok(m, `malformed checksum line: ${line}`);
    return { sha: m[1], file: m[2] };
  });
  const onDisk = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  assert.deepEqual(pinned.map((p) => p.file), onDisk, "CHECKSUMS.sha256 must list every .sql migration, in order");
  for (const { sha, file } of pinned) {
    const actual = createHash("sha256").update(readFileSync(new URL(file, dir))).digest("hex");
    assert.equal(actual, sha, `${file} changed after it was committed; add a new migration instead`);
  }
  const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", dir), "utf8")) as { entries: { idx: number; tag: string }[] };
  assert.deepEqual(journal.entries.map((e) => `${e.tag}.sql`), onDisk);
  assert.deepEqual(journal.entries.map((e) => e.idx), onDisk.map((_, i) => i));
});
