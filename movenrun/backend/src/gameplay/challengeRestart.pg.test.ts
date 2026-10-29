/**
 * A restarted challenge takes its own receipt time (opened_received_at), in both challenge write modes.
 *
 * Rule set 1002 measures the 20-hour gap from when the server received the session that opened the challenge
 * (docs/G34_SERVER_ARCHITECTURE.md, "The rule" and "Challenge opening time"). A challenge that lapsed out of the
 * 3-day window and is restarted is a new challenge: it is stamped with the restart's receipt time. A challenge that
 * stays open keeps its receipt time across later pushes.
 *
 * Runs the real HTTP route on PostgreSQL 16. Skipped, loudly, without MOVENRUN_TEST_DATABASE_URL. Synthetic ids only.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import express from "express";
import { cellToChildren, gridDisk, latLngToCell } from "h3-js";
import { IdentityError } from "../identity/domain/errors.js";
import { cellToInt8 } from "./path.js";
import { DAY_MS, SIM_PILOT_2_PROPOSAL, type GameplayRules } from "./rules.js";
import { GameplayService, type ChallengeWriteMode } from "./service.js";
import { SEALED_LOOP, SEAL_COLUMNS, sealLiteral } from "./sealFixtures.js";
import { createGameplayRouter } from "./router.js";
import { createTestDb, type TestDb } from "./pgTestDb.js";

const DATABASE_URL = process.env.MOVENRUN_TEST_DATABASE_URL;
const SKIP = DATABASE_URL ? false : "MOVENRUN_TEST_DATABASE_URL is not set — the challenge write path over HTTP was NOT verified";

const D = Math.floor(Date.UTC(2026, 9, 1) / DAY_MS);
const H = 3_600_000;
const RULES: GameplayRules = { ...SIM_PILOT_2_PROPOSAL, holding: { ...SIM_PILOT_2_PROPOSAL.holding }, seasonOneStartDay: D };
const at = (day: number, hour: number) => day * DAY_MS + Math.round(hour * H);
const ZONES = gridDisk(latLngToCell(51.52, -0.1, 9), 7).sort();
const U = ZONES.flatMap((z) => cellToChildren(z, 10).sort());
const ROUNDS = 6;

const MODES: ChallengeWriteMode[] = ["delete-insert", "diff"];
type Dump = Record<string, unknown>;
const dumps = new Map<ChallengeWriteMode, { step: string; dump: Dump }[]>();
const evidence = new Map<ChallengeWriteMode, Record<string, unknown>>();

interface Harness {
  t: TestDb;
  server: Server;
  clock: { now: number };
  api: (user: string, sid: string) => Promise<{ status: number; body: any }>;
  q: (text: string, params?: unknown[]) => Promise<any[]>;
  user: (id: string) => Promise<string>;
  session: (userId: string, sid: string, endMs: number, units: string[]) => Promise<void>;
  service: GameplayService;
}

async function harness(mode: ChallengeWriteMode): Promise<Harness> {
  const t = await createTestDb(DATABASE_URL!, `restart_rt_${mode === "diff" ? "d" : "i"}`, { gameplay: true });
  const clock = { now: at(D, 9) };
  const service = new GameplayService({ db: t.db, rules: RULES, now: () => clock.now, challengeWrites: mode });
  const app = express();
  app.use(express.json({ limit: "8kb" }));
  app.use("/gameplay", createGameplayRouter({
    service,
    verifyBearer: async (token) => {
      if (token.startsWith("tok-")) return { userId: token.slice(4) };
      throw new IdentityError("session_invalid");
    },
  }));
  // A failure the route does not map is a 500 with no body: keep the test output free of stack traces.
  app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(500).json({ error: "internal" }); });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/gameplay`;
  const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
  return {
    t, server, clock, service, q,
    api: async (user, sid) => {
      const res = await fetch(`${base}/sessions/sid-${sid}/apply`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer tok-${user}` }, body: "{}" });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    user: async (id) => { await t.pool.query("INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING", [id]); return id; },
    session: async (userId, sid, endMs, units) => {
      await t.pool.query(
        `INSERT INTO movement_verifications (id, user_id, client_session_id, status, distance_meters, duration_seconds, traversed_hex_ids, start_time, end_time, created_at, ${SEAL_COLUMNS})
         VALUES ($1, $2, $3, 'verified', 3000, 1800, $4, $5, $6, (to_timestamp($7::float8 / 1000) AT TIME ZONE current_setting('TimeZone')), ${sealLiteral(SEALED_LOOP, units)})`,
        [`mv-${sid}`, userId, `sid-${sid}`, [], endMs - 1_800_000, endMs, clock.now]);
      await t.pool.query(
        `INSERT INTO gameplay_session_paths (movement_verification_id, path_version, resolution, unit_ids, interpolated, skipped_segments, truncated)
         VALUES ($1, 1, 10, $2::bigint[], $3::varbit, 0, false)`,
        [`mv-${sid}`, units.map(cellToInt8), units.map(() => "0").join("")]);
    },
  };
}


const rcv = async (h: Harness) => (await h.q(`SELECT first_day, (extract(epoch FROM opened_received_at) * 1000)::float8 AS ms FROM gameplay_unit_challenges ORDER BY walker_id, first_day`)).map((r) => ({ firstDay: Number(r.first_day), ms: Math.round(Number(r.ms)) }));

for (const mode of MODES) {
  test(`restart at D+4 23:50 is stamped with its own receipt time and does not flip at D+5 00:20 (${mode})`, { skip: SKIP }, async () => {
    const h = await harness(mode);
    try {
      const [ana, ben] = await Promise.all(["ana", "ben"].map(h.user));
      const unit = U[0]!;
      h.clock.now = at(D, 9); await h.session(ana, "rs-ana", at(D, 8.5), [unit]);
      assert.equal((await h.api(ana, "rs-ana")).status, 201);
      h.clock.now = at(D, 12); await h.session(ben, "rs-ben-1", at(D, 11.5), [unit]);
      assert.equal((await h.api(ben, "rs-ben-1")).body.outcomes.eroded, 1);
      assert.deepEqual(await rcv(h), [{ firstDay: D, ms: at(D, 12) }]);
      // Day D+4: the 3-day window has lapsed, so this is a fresh first push (a restart).
      h.clock.now = at(D + 4, 23 + 50 / 60); await h.session(ben, "rs-ben-2", at(D + 4, 23.8), [unit]);
      assert.equal((await h.api(ben, "rs-ben-2")).body.outcomes.eroded, 1);
      const restartedAt = h.clock.now;
      // 30 minutes later, after midnight: the 20-hour gap cannot have passed.
      h.clock.now = at(D + 5, 20 / 60); await h.session(ben, "rs-ben-3", at(D + 5, 0.3), [unit]);
      const r3 = await h.api(ben, "rs-ben-3");
      assert.equal(r3.body.outcomes.flipped, 0, "flipped 30 minutes after the restart");
      assert.equal(r3.body.outcomes.eroded, 1, "the push is applied as an erosion, not refused");
      assert.deepEqual(await rcv(h), [{ firstDay: D + 4, ms: restartedAt }], "the restart is stamped with its own receipt time, and a too-early push keeps it");
      // The next day, more than 20 hours after the restart (one push a day on a unit), inside the window: flips.
      h.clock.now = at(D + 6, 1); await h.session(ben, "rs-ben-4", at(D + 6, 0.9), [unit]);
      assert.equal((await h.api(ben, "rs-ben-4")).body.outcomes.flipped, 1, "flips once 20 hours have passed since the restart");
    } finally { h.server.close(); await h.t.drop(); }
  });

  test(`control: a fresh challenge at D+4 23:50 erodes at D+5 00:20 (${mode})`, { skip: SKIP }, async () => {
    const h = await harness(mode);
    try {
      const [ana, ben] = await Promise.all(["ana", "ben"].map(h.user));
      const unit = U[0]!;
      h.clock.now = at(D, 9); await h.session(ana, "ct-ana", at(D, 8.5), [unit]); await h.api(ana, "ct-ana");
      h.clock.now = at(D + 4, 23 + 50 / 60); await h.session(ben, "ct-ben-2", at(D + 4, 23.8), [unit]);
      assert.equal((await h.api(ben, "ct-ben-2")).body.outcomes.eroded, 1);
      assert.deepEqual(await rcv(h), [{ firstDay: D + 4, ms: h.clock.now }]);
      h.clock.now = at(D + 5, 20 / 60); await h.session(ben, "ct-ben-3", at(D + 5, 0.3), [unit]);
      const c3 = (await h.api(ben, "ct-ben-3")).body.outcomes;
      assert.equal(c3.eroded, 1); assert.equal(c3.flipped, 0);
    } finally { h.server.close(); await h.t.drop(); }
  });

  test(`an open challenge keeps its receipt time across pushes, and the 20-hour gap runs from it (${mode})`, { skip: SKIP }, async () => {
    const h = await harness(mode);
    try {
      const [ana, ben] = await Promise.all(["ana", "ben"].map(h.user));
      const unit = U[0]!;
      h.clock.now = at(D, 9); await h.session(ana, "ko-ana", at(D, 8.5), [unit]); await h.api(ana, "ko-ana");
      h.clock.now = at(D, 12); await h.session(ben, "ko-ben-1", at(D, 11.5), [unit]);
      assert.equal((await h.api(ben, "ko-ben-1")).body.outcomes.eroded, 1);
      // Next morning, 19 h after the opening: too early, so it erodes and keeps the same challenge and receipt time.
      h.clock.now = at(D + 1, 7); await h.session(ben, "ko-ben-2", at(D + 1, 6.9), [unit]);
      const early = (await h.api(ben, "ko-ben-2")).body.outcomes;
      assert.equal(early.eroded, 1); assert.equal(early.flipped, 0);
      assert.deepEqual(await rcv(h), [{ firstDay: D, ms: at(D, 12) }], "an early push keeps the receipt time");
      // The day after, 25 h after the opening and inside the window: flips.
      h.clock.now = at(D + 2, 13); await h.session(ben, "ko-ben-3", at(D + 2, 12.9), [unit]);
      assert.equal((await h.api(ben, "ko-ben-3")).body.outcomes.flipped, 1);
    } finally { h.server.close(); await h.t.drop(); }
  });
}
