/**
 * Resume after a settlement halt (directive 28 Oct, section 5 item 5): no
 * operator can resume alone. A resume needs a fresh reconciliation proof of
 * every closed day, recorded with the request, and two approvals by actors
 * distinct from each other and from the requester, each re-running the proof
 * and seeing the same result. The database refuses a resume row without
 * that. Role labels only; no real accounts.
 *
 * Skipped, loudly, without MOVENRUN_TEST_DATABASE_URL.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { gridDisk, latLngToCell } from "h3-js";
import { DAY_MS, PILOT_PROPOSAL, dayCloseMs, type GameplayRules } from "./rules.js";
import { GameplayError, GameplayService } from "./service.js";
import { SEALED_LOOP, SEAL_COLUMNS, sealLiteral } from "./sealFixtures.js";
import { createTestDb } from "./pgTestDb.js";
import { createDrizzleAccountDeletionStore } from "../identity/accountDeletion.js";

const DATABASE_URL = process.env.MOVENRUN_TEST_DATABASE_URL;
const SKIP = DATABASE_URL ? false : "MOVENRUN_TEST_DATABASE_URL is not set — dual-review resume on PostgreSQL was NOT verified";

const D = Math.floor(Date.UTC(2026, 9, 1) / DAY_MS);
const RULES: GameplayRules = { ...PILOT_PROPOSAL, holding: { ...PILOT_PROPOSAL.holding }, seasonOneStartDay: D };
const at = (day: number, hour: number) => day * DAY_MS + Math.round(hour * 3_600_000);
const C = gridDisk(latLngToCell(51.5007, -0.1246, 8), 1).sort();

async function code(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    if (err instanceof GameplayError) return err.code;
    return (err as { code?: string }).code;
  }
}

/** One settled day with two walkers, then a halt. */
async function haltedWorld(prefix: string) {
  const t = await createTestDb(DATABASE_URL!, prefix, { gameplay: true });
  let clock = at(D, 9);
  const svc = new GameplayService({ db: t.db, rules: RULES, now: () => clock });
  for (const [u, cell] of [["walker-r1", C[0]!], ["walker-r2", C[1]!]] as const) {
    await t.pool.query("INSERT INTO users (id) VALUES ($1)", [u]);
    await t.pool.query(
      `INSERT INTO movement_verifications (id, user_id, client_session_id, status, distance_meters, duration_seconds, traversed_hex_ids, start_time, end_time, created_at, ${SEAL_COLUMNS})
       VALUES ($1, $2, 's1', 'verified', 3000, 1800, $3, $4, $5, (to_timestamp($6::float8 / 1000) AT TIME ZONE current_setting('TimeZone')), ${sealLiteral(SEALED_LOOP, [cell])})`,
      [randomUUID(), u, [cell], at(D, 8) - 1_800_000, at(D, 8), at(D, 8.5)]);
    await svc.applySession(u, "s1");
  }
  clock = dayCloseMs(RULES, D) + 60_000;
  await svc.settleDay(D);
  await svc.haltSettlement({ actor: "ops-oncall", reason: "books under review" });
  const halted = async () => (await svc.settlementStatus()).halted;
  return { t, svc, halted };
}

test("no single-operator resume: the old call, a raw resume row, and a request with one approval all leave settlement halted", { skip: SKIP }, async () => {
  const { t, svc, halted } = await haltedWorld("resume_single");
  try {
    assert.equal(await code(svc.resumeSettlement({ actor: "ops-oncall", reason: "looks fine" })), "dual_review_required");
    assert.equal(await code(t.pool.query("INSERT INTO gameplay_settlement_halts (action, actor, reason) VALUES ('resume', 'ops-oncall', 'raw')")), "42501", "a resume row must name an approved request");
    assert.equal(await code(t.pool.query("ALTER TABLE gameplay_settlement_halts DISABLE TRIGGER gameplay_settlement_halts_append_only")
      .then(() => t.pool.query("INSERT INTO gameplay_settlement_halts (action, actor, reason) VALUES ('resume', 'ops-oncall', 'raw')"))
      .finally(() => t.pool.query("ALTER TABLE gameplay_settlement_halts ENABLE TRIGGER gameplay_settlement_halts_append_only"))), "23514", "and the CHECK holds even past the trigger");
    const { requestId } = await svc.requestResume({ actor: "ops-oncall", reason: "reviewed" });
    assert.equal(await code(t.pool.query("INSERT INTO gameplay_settlement_halts (action, actor, reason, resume_request_id) VALUES ('resume', 'ops-oncall', 'raw', $1)", [requestId])), "42501", "no approvals yet");
    assert.equal(await code(svc.approveResume({ requestId, approver: "ops-oncall" })), "approver_is_requester");
    assert.equal(await code(t.pool.query("INSERT INTO gameplay_resume_approvals (request_id, approver, proof_sha256) SELECT id, requested_by, proof_sha256 FROM gameplay_resume_requests")), "42501", "the database refuses it too");
    assert.deepEqual(await svc.approveResume({ requestId, approver: "ops-review-a" }), { resumed: false, approvals: 1 });
    assert.equal(await code(svc.approveResume({ requestId, approver: "ops-review-a" })), "already_approved", "the same approver twice is one approval");
    assert.equal(await code(t.pool.query("INSERT INTO gameplay_settlement_halts (action, actor, reason, resume_request_id) VALUES ('resume', 'ops-oncall', 'raw', $1)", [requestId])), "42501", "one approval is not enough");
    assert.equal(await halted(), true);
  } finally {
    await t.drop();
  }
});

test("dual review: a fresh proof and two distinct approvers resume; the request cannot be reused, and the next halt needs a new one", { skip: SKIP }, async () => {
  const { t, svc, halted } = await haltedWorld("resume_dual");
  try {
    const req = await svc.requestResume({ actor: "ops-oncall", reason: "reviewed" });
    assert.equal(req.proofDays, 1);
    assert.match(req.proofSha256, /^[0-9a-f]{64}$/);
    await svc.approveResume({ requestId: req.requestId, approver: "ops-review-a" });
    assert.deepEqual(await svc.approveResume({ requestId: req.requestId, approver: "ops-review-b" }), { resumed: true, approvals: 2 });
    assert.equal(await halted(), false);
    const log = (await t.pool.query("SELECT action, resume_request_id FROM gameplay_settlement_halts ORDER BY id")).rows;
    assert.deepEqual(log.map((r) => [r.action, r.resume_request_id === null ? null : Number(r.resume_request_id)]), [["halt", null], ["resume", req.requestId]]);
    assert.equal(await code(svc.requestResume({ actor: "ops-oncall", reason: "again" })), "not_halted");
    await svc.haltSettlement({ actor: "reconciler", reason: "drill", day: D });
    assert.equal(await code(svc.approveResume({ requestId: req.requestId, approver: "ops-review-c" })), "resume_request_invalid", "a request belongs to one halt");
    assert.equal(await code(t.pool.query("INSERT INTO gameplay_settlement_halts (action, actor, reason, resume_request_id) VALUES ('resume', 'ops-oncall', 'reuse', $1)", [req.requestId])), "42501", "a used request does not resume a later halt");
    assert.equal(await halted(), true);
    for (const sql of ["UPDATE gameplay_resume_requests SET reason = 'x'", "DELETE FROM gameplay_resume_approvals", "UPDATE gameplay_settlement_halts SET reason = 'x'"]) {
      assert.equal(await code(t.pool.query(sql)), "23001", sql);
    }
  } finally {
    await t.drop();
  }
});

test("stale or failing proof: a change after the request, a failing day, or an expired request refuses the resume", { skip: SKIP }, async () => {
  const { t, svc, halted } = await haltedWorld("resume_stale");
  try {
    const req = await svc.requestResume({ actor: "ops-oncall", reason: "reviewed" });
    await svc.approveResume({ requestId: req.requestId, approver: "ops-review-a" });
    // An erasure after the request moves the day's digest chain: the proof the approvers see is not the one requested.
    await createDrizzleAccountDeletionStore(t.db).erase("walker-r1");
    assert.equal(await code(svc.approveResume({ requestId: req.requestId, approver: "ops-review-b" })), "resume_proof_stale");
    assert.equal(await halted(), true);
    // A fresh request covers the erasure (the day still reconciles through its record).
    const fresh = await svc.requestResume({ actor: "ops-oncall", reason: "after erasure" });
    assert.notEqual(fresh.proofSha256, req.proofSha256);
    // A day that no longer reconciles refuses any new proof.
    await t.pool.query("UPDATE movement_verifications SET distance_meters = 9000 WHERE user_id = 'walker-r2'");
    assert.equal(await code(svc.requestResume({ actor: "ops-oncall", reason: "x" })), "resume_proof_failed");
    assert.equal(await code(svc.approveResume({ requestId: fresh.requestId, approver: "ops-review-a" })), "resume_proof_failed");
    await t.pool.query("UPDATE movement_verifications SET distance_meters = 3000 WHERE user_id = 'walker-r2'");
    // Expired: older than 24 hours.
    const [old] = (await t.pool.query(`INSERT INTO gameplay_resume_requests (halt_id, requested_by, reason, proof_sha256, proof_days, created_at)
      SELECT halt_id, requested_by, reason, proof_sha256, proof_days, now() - interval '25 hours' FROM gameplay_resume_requests WHERE id = $1 RETURNING id`, [fresh.requestId])).rows;
    await t.pool.query("INSERT INTO gameplay_resume_approvals (request_id, approver, proof_sha256) SELECT $1, a, proof_sha256 FROM gameplay_resume_requests, unnest(ARRAY['ops-review-a','ops-review-b']) a WHERE id = $1", [old.id]);
    assert.equal(await code(svc.approveResume({ requestId: Number(old.id), approver: "ops-review-c" })), "resume_request_invalid");
    assert.equal(await code(t.pool.query("INSERT INTO gameplay_settlement_halts (action, actor, reason, resume_request_id) VALUES ('resume', 'ops-oncall', 'late', $1)", [old.id])), "42501");
    assert.equal(await halted(), true);
    // The fresh, unexpired request still works.
    await svc.approveResume({ requestId: fresh.requestId, approver: "ops-review-a" });
    assert.equal((await svc.approveResume({ requestId: fresh.requestId, approver: "ops-review-b" })).resumed, true);
  } finally {
    await t.drop();
  }
});
