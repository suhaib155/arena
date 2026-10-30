/**
 * Player day proofs are append-only (settlement invariants, item 5): once a
 * day closes, a proof row is never changed, and is removed only with its
 * player (account erasure cascades from users through gameplay_players). No
 * proof outlives the person it belongs to; see docs/G34_SERVER_ARCHITECTURE.md,
 * "Player day proofs: immutability and erasure", for the trade-off.
 *
 * Skipped, loudly, without MOVENRUN_TEST_DATABASE_URL.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { gridDisk, latLngToCell } from "h3-js";
import { DAY_MS, PILOT_PROPOSAL, dayCloseMs, type GameplayRules } from "./rules.js";
import { GameplayService } from "./service.js";
import { SEALED_LOOP, SEAL_COLUMNS, sealLiteral } from "./sealFixtures.js";
import { createTestDb } from "./pgTestDb.js";
import { createDrizzleAccountDeletionStore } from "../identity/accountDeletion.js";

const DATABASE_URL = process.env.MOVENRUN_TEST_DATABASE_URL;
const SKIP = DATABASE_URL ? false : "MOVENRUN_TEST_DATABASE_URL is not set — proof immutability on PostgreSQL was NOT verified";

const D = Math.floor(Date.UTC(2026, 9, 1) / DAY_MS);
const RULES: GameplayRules = { ...PILOT_PROPOSAL, holding: { ...PILOT_PROPOSAL.holding }, seasonOneStartDay: D };
const at = (day: number, hour: number) => day * DAY_MS + Math.round(hour * 3_600_000);
const C = gridDisk(latLngToCell(51.5007, -0.1246, 8), 1).sort();

async function code(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code;
  }
}

test("a day proof cannot be updated or deleted while its player exists; erasure still removes it", { skip: SKIP }, async () => {
  const t = await createTestDb(DATABASE_URL!, "proof_immutable", { gameplay: true });
  let clock = at(D, 9);
  const svc = new GameplayService({ db: t.db, rules: RULES, now: () => clock });
  try {
    for (const u of ["ana", "ben"]) {
      await t.pool.query("INSERT INTO users (id) VALUES ($1)", [u]);
      await t.pool.query(
        `INSERT INTO movement_verifications (id, user_id, client_session_id, status, distance_meters, duration_seconds, traversed_hex_ids, start_time, end_time, created_at, ${SEAL_COLUMNS})
         VALUES ($1, $2, $3, 'verified', 3000, 1800, $4, $5, $6, (to_timestamp($7::float8 / 1000) AT TIME ZONE current_setting('TimeZone')), ${sealLiteral(SEALED_LOOP, u === "ana" ? [C[0]!, C[1]!] : [C[2]!])})`,
        [randomUUID(), u, `${u}-1`, u === "ana" ? [C[0]!, C[1]!] : [C[2]!], at(D, 8) - 1_800_000, at(D, 8), at(D, 8.5)]);
      clock = at(D, 9);
      await svc.applySession(u, `${u}-1`);
    }
    clock = dayCloseMs(RULES, D) + 60_000;
    await svc.settleDay(D);
    const proofs = async () => (await t.pool.query("SELECT player_no, day, accepted FROM gameplay_player_day_proofs ORDER BY player_no")).rows;
    const stored = await proofs();
    assert.equal(stored.length, 2);

    assert.equal(await code(t.pool.query("UPDATE gameplay_player_day_proofs SET accepted = accepted + 1")), "23001", "no update");
    assert.equal(await code(t.pool.query("UPDATE gameplay_player_day_proofs SET events_sha256 = events_sha256")), "23001", "not even a no-op rewrite");
    assert.equal(await code(t.pool.query("DELETE FROM gameplay_player_day_proofs")), "23001", "no delete while the player exists");
    assert.deepEqual(await proofs(), stored);

    // Account erasure: the user row goes, gameplay_players cascades, and so do the proofs.
    await createDrizzleAccountDeletionStore(t.db).erase("ana");
    const left = await proofs();
    assert.equal(left.length, 1);
    const benNo = (await t.pool.query("SELECT player_no FROM gameplay_players WHERE user_id = 'ben'")).rows[0].player_no;
    assert.equal(left[0].player_no, benNo, "only the erased player's proof left");
  } finally {
    await t.drop();
  }
});
