/**
 * Server-authoritative holding, settlement, clubs, districts and leaderboards
 * (G3/G4 server preparation). Off unless MOVENRUN_GAMEPLAY_ENABLED is set; the
 * tables it uses come from the PROPOSED migration
 * drizzle-proposed/0011_gameplay_holdings.sql, which is not applied anywhere
 * live.
 *
 * Every rule lives in the shared reference models; this file only loads state,
 * runs them and stores what they return:
 *
 * - `applySession`: a verified movement session becomes one stepped-on push
 *   per traversed unit, run through `applyLedger`. The phone never names a
 *   unit, a push or an outcome; the server derives all of it.
 * - `settleDay`: a closed day through `holdingsAtDayClose`,
 *   `settleCreditsDay`, `clubSnapshot`, `clubContributions` and
 *   `districtControl`. A day with any problem is stored as refused.
 * - reads: own holdings and credits, club and district aggregates, and a
 *   season board through `seasonLeaderboard`, from settled days only.
 *
 * Idempotency: a session is applied once (`gameplay_applied_sessions`), each
 * push event id once (primary key), each day settled once (primary key).
 * Concurrency: pushes lock their unit rows in id order and hold a shared
 * advisory lock on their day; settlement holds the exclusive one and runs
 * SERIALIZABLE. The one-push-per-walker-per-unit-per-day rule is also a
 * unique index, so the database refuses a second push even if this code
 * were wrong.
 */
import { createHash, randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { decayTo, stageOf, type Ground, type LandLevel, type PushOutcome, type UnitState } from "@movenrun/shared/holding";
import { applyLedger, type LedgerEntry, type PushEvent, type RejectReason } from "@movenrun/shared/holdingLedger";
import { holdingsAtDayClose, settleCreditsDay, type CreditsDayResult, type CreditsPlayerInput } from "@movenrun/shared/holdingSettlement";
import {
  clubContributions, clubSnapshot, districtControl, seasonLeaderboard,
  type DistrictControlResult, type DistrictStanding, type LeaderboardMetric, type Membership, type SeasonDay,
} from "@movenrun/shared/clubsDistricts";
import type { DaySettlement } from "@movenrun/shared/economy-v3";
import { dayOf, dayStartMs, lastClosedDay, seasonOf, type GameplayRules } from "./rules.js";

/** Advisory lock namespace ("MRGP"); the second key is the day index. */
export const GAMEPLAY_LOCK_NAMESPACE = 0x4d524750;

export class GameplayError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Exec = Db | Tx;

/** A whole array as one parameter (drizzle would otherwise spread it into a list). */
const arr = (values: readonly unknown[]) => sql.param(values);

async function rows<T = Record<string, unknown>>(exec: Exec, query: SQL): Promise<T[]> {
  const result = await exec.execute(query);
  return result.rows as T[];
}

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === "string" ? code : undefined;
}

function pgConstraint(err: unknown): string | undefined {
  const e = err as { constraint?: unknown; cause?: { constraint?: unknown } } | null;
  const c = e?.constraint ?? e?.cause?.constraint;
  return typeof c === "string" ? c : undefined;
}

const OUTCOMES: readonly PushOutcome[] = ["claimed", "reinforced", "eroded", "flipped", "refused_deeded", "refused_masked", "refused_daily_limit"];
const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface ApplySummary {
  sessionId: string;
  day: number;
  /** True when this session had already been applied and nothing changed. */
  replayed: boolean;
  applied: number;
  skipped: number;
  rejected: number;
  outcomes: Record<PushOutcome, number>;
  rejectedByReason: Partial<Record<RejectReason, number>>;
}

export interface BatchResult {
  applied: number;
  skipped: number;
  rejected: number;
  outcomes: Record<PushOutcome, number>;
  rejectedByReason: Partial<Record<RejectReason, number>>;
}

export interface DaySummary {
  day: number;
  season: number;
  status: "settled" | "refused";
  clubsStatus: "settled" | "refused" | "skipped";
  players: number;
  poolMicro: number;
  mintedMicro: number;
  creditedMicro: number;
  burnedMicro: number;
  returnedMicro: number;
  /** True when this call settled the day; false when it already was. */
  created: boolean;
}

interface UnitRow {
  unit_id: string;
  holder_id: string | null;
  strength: number;
  ground: Ground;
  deeded: boolean;
  masked: boolean;
  level: number;
  fortified: boolean;
  as_of_day: number;
}

function toState(r: UnitRow, asOfDay = Number(r.as_of_day)): UnitState {
  return {
    unitId: r.unit_id,
    holderId: r.holder_id,
    strength: Number(r.strength),
    ground: r.ground,
    deeded: r.deeded,
    masked: r.masked,
    level: Number(r.level) as LandLevel,
    fortified: r.fortified,
    asOfDay,
  };
}

function emptyOutcomes(): Record<PushOutcome, number> {
  return Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<PushOutcome, number>;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export interface GameplayServiceDeps {
  db: Db;
  rules: GameplayRules;
  now?: () => number;
}

export class GameplayService {
  private readonly db: Db;
  readonly rules: GameplayRules;
  private readonly now: () => number;

  constructor(deps: GameplayServiceDeps) {
    this.db = deps.db;
    this.rules = deps.rules;
    this.now = deps.now ?? Date.now;
  }

  today(): number {
    return dayOf(this.rules, this.now());
  }

  /* ── pushes ──────────────────────────────────────────────────────────── */

  /**
   * Turn one of the caller's verified movement sessions into pushes. Keyed by
   * the authenticated user and the client's own session id, so a retry (or a
   * guess at someone else's id) can never apply anything twice or for anyone
   * else. Every traversed unit is a stepped-on push: the traversed cells are
   * the cells that contain a verified fix (assumption A1), never cells
   * inferred between fixes. Shade needs D2 and is not derived here.
   */
  async applySession(userId: string, clientSessionId: string): Promise<ApplySummary> {
    const now = this.now();
    try {
      return await this.db.transaction(async (tx) => {
        const [mv] = await rows<{ id: string; status: string; end_time: string; traversed_hex_ids: string[] | null }>(tx, sql`
          SELECT id, status, end_time, traversed_hex_ids FROM movement_verifications
           WHERE user_id = ${userId} AND client_session_id = ${clientSessionId}
           FOR UPDATE`);
        if (!mv) throw new GameplayError(404, "session_not_found");
        const [done] = await rows<{ day: number; applied: number; skipped: number; rejected: number; outcomes: { byOutcome: Record<PushOutcome, number>; rejectedByReason: Partial<Record<RejectReason, number>> } }>(tx, sql`
          SELECT day, applied, skipped, rejected, outcomes FROM gameplay_applied_sessions WHERE movement_verification_id = ${mv.id}`);
        if (done) {
          return {
            sessionId: clientSessionId, day: Number(done.day), replayed: true,
            applied: done.applied, skipped: done.skipped, rejected: done.rejected,
            outcomes: { ...emptyOutcomes(), ...done.outcomes.byOutcome }, rejectedByReason: done.outcomes.rejectedByReason,
          };
        }
        if (mv.status !== "verified") throw new GameplayError(409, "session_not_verified");
        const day = dayOf(this.rules, Number(mv.end_time));
        if (day > dayOf(this.rules, now)) throw new GameplayError(409, "session_in_future");
        if (seasonOf(this.rules, day) === null) throw new GameplayError(409, "season_not_started");
        const unitIds = [...new Set(mv.traversed_hex_ids ?? [])].sort(byString);
        if (unitIds.length > this.rules.maxUnitsPerSession) throw new GameplayError(422, "too_many_units");
        const events: PushEvent[] = unitIds.map((unitId) => ({
          eventId: `mv:${mv.id}:${unitId}`, unitId, walkerId: userId, push: { kind: "solid" }, day,
        }));
        const result = await this.applyBatch(tx, events, day, mv.id, now);
        await tx.execute(sql`
          INSERT INTO gameplay_applied_sessions (movement_verification_id, user_id, day, applied, skipped, rejected, outcomes, holding_rules_version)
          VALUES (${mv.id}, ${userId}, ${day}, ${result.applied}, ${result.skipped}, ${result.rejected},
                  ${JSON.stringify({ byOutcome: result.outcomes, rejectedByReason: result.rejectedByReason })}::jsonb, ${this.rules.holding.rulesVersion})`);
        return { sessionId: clientSessionId, day, replayed: false, ...result };
      });
    } catch (err) {
      throw this.mapPushError(err);
    }
  }

  /**
   * Apply a batch of pushes, all for one day, in its own transaction. The
   * server-side entry for pushes that do not come from one movement session
   * (for example shade, once D2 exists). Not reachable over HTTP.
   */
  async applyPushes(events: readonly PushEvent[]): Promise<BatchResult> {
    const days = [...new Set(events.map((e) => e.day))];
    if (days.length !== 1) throw new GameplayError(400, "one_day_per_batch");
    const now = this.now();
    try {
      return await this.db.transaction((tx) => this.applyBatch(tx, events, days[0]!, null, now));
    } catch (err) {
      throw this.mapPushError(err);
    }
  }

  private mapPushError(err: unknown): unknown {
    if (err instanceof GameplayError) return err;
    // The one-push index, or a concurrent writer of the same event id: the
    // whole batch rolled back and a retry will re-read the winner's rows.
    if (pgCode(err) === "23505") return new GameplayError(409, "concurrent_push_retry");
    return err;
  }

  private async applyBatch(tx: Tx, events: readonly PushEvent[], day: number, sourceSessionId: string | null, now: number): Promise<BatchResult> {
    const hv = this.rules.holding.rulesVersion;
    // Pushes share the day; its settlement takes the exclusive lock, so a day
    // is never settled while a push for it is in flight.
    await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(${GAMEPLAY_LOCK_NAMESPACE}::int, ${day}::int)`);
    const [closed] = await rows(tx, sql`SELECT 1 FROM gameplay_day_settlements WHERE day = ${day}`);
    if (closed || day <= lastClosedDay(this.rules, now)) throw new GameplayError(409, "day_closed");

    const result: BatchResult = { applied: 0, skipped: 0, rejected: 0, outcomes: emptyOutcomes(), rejectedByReason: {} };
    const unitIds = [...new Set(events.map((e) => e.unitId).filter((u) => typeof u === "string" && u.length > 0 && u.length <= 64))].sort(byString);
    if (unitIds.length === 0) {
      // Nothing to lock: the model rejects every event on its own.
      for (const r of applyLedger({ states: new Map(), events, rules: this.rules.holding }).results) {
        if (r.status !== "rejected") continue;
        result.rejected += 1;
        result.rejectedByReason[r.reason] = (result.rejectedByReason[r.reason] ?? 0) + 1;
      }
      return result;
    }

    // A unit row must exist to be locked: create the missing ones unheld, as
    // the model's newUnit() would. Sorted, so concurrent batches insert and
    // lock in the same order and cannot deadlock.
    await tx.execute(sql`
      INSERT INTO gameplay_units (unit_id, as_of_day, holding_rules_version)
      SELECT u, ${day}::int, ${hv}::int FROM unnest(${arr(unitIds)}::text[]) WITH ORDINALITY AS t(u, n) ORDER BY n
      ON CONFLICT (unit_id) DO NOTHING`);
    const locked = await rows<UnitRow>(tx, sql`
      SELECT unit_id, holder_id, strength, ground, deeded, masked, level, fortified, as_of_day
        FROM gameplay_units WHERE unit_id = ANY(${arr(unitIds)}::text[]) ORDER BY unit_id FOR UPDATE`);
    // Read after the locks, so pushes committed by a batch we waited for are seen.
    const pushedToday = await rows<{ unit_id: string; walker_id: string }>(tx, sql`
      SELECT unit_id, walker_id FROM gameplay_push_events
       WHERE unit_id = ANY(${arr(unitIds)}::text[]) AND day = ${day} AND outcome IN ('eroded', 'flipped')
       ORDER BY unit_id, walker_id`);
    const eventIds = events.map((e) => e.eventId).filter((id): id is string => typeof id === "string");
    const already = await rows<{ event_id: string }>(tx, sql`
      SELECT event_id FROM gameplay_push_events WHERE event_id = ANY(${arr(eventIds)}::text[])`);

    const pushers = new Map<string, string[]>();
    for (const p of pushedToday) pushers.set(p.unit_id, [...(pushers.get(p.unit_id) ?? []), p.walker_id]);
    const states = new Map<string, UnitState>();
    for (const r of locked) {
      const state = toState(r);
      const walkers = pushers.get(r.unit_id);
      if (walkers && state.asOfDay === day) state.pushedBy = { day, walkerIds: walkers };
      states.set(r.unit_id, state);
    }

    const ledger = applyLedger({ states, events, rules: this.rules.holding, appliedEventIds: already.map((a) => a.event_id) });
    for (const r of ledger.results) {
      if (r.status === "applied") {
        result.applied += 1;
        result.outcomes[r.outcome] += 1;
      } else if (r.status === "skipped") {
        result.skipped += 1;
      } else {
        result.rejected += 1;
        result.rejectedByReason[r.reason] = (result.rejectedByReason[r.reason] ?? 0) + 1;
      }
    }
    if (ledger.entries.length === 0) return result;

    const touched = [...new Set(ledger.entries.map((e) => e.unitId))].sort(byString);
    const next = touched.map((u) => ledger.states.get(u)!);
    const cols = {
      unitId: next.map((s) => s.unitId),
      holder: next.map((s) => s.holderId),
      strength: next.map((s) => s.strength),
      ground: next.map((s) => s.ground),
      deeded: next.map((s) => s.deeded),
      masked: next.map((s) => s.masked),
      level: next.map((s) => s.level),
      fortified: next.map((s) => s.fortified),
      asOf: next.map((s) => s.asOfDay),
    };
    await tx.execute(sql`
      UPDATE gameplay_units u SET
        holder_id = v.holder_id, strength = v.strength, ground = v.ground, deeded = v.deeded, masked = v.masked,
        level = v.level, fortified = v.fortified, as_of_day = v.as_of_day, holding_rules_version = ${hv}::int,
        version = u.version + 1, updated_at = now()
      FROM unnest(${arr(cols.unitId)}::text[], ${arr(cols.holder)}::text[], ${arr(cols.strength)}::int[], ${arr(cols.ground)}::text[],
                  ${arr(cols.deeded)}::boolean[], ${arr(cols.masked)}::boolean[], ${arr(cols.level)}::int[], ${arr(cols.fortified)}::boolean[], ${arr(cols.asOf)}::int[])
        AS v(unit_id, holder_id, strength, ground, deeded, masked, level, fortified, as_of_day)
      WHERE u.unit_id = v.unit_id`);
    await tx.execute(sql`
      INSERT INTO gameplay_unit_day_states (unit_id, day, holder_id, strength, ground, deeded, masked, level, fortified, holding_rules_version)
      SELECT v.unit_id, v.as_of_day, v.holder_id, v.strength, v.ground, v.deeded, v.masked, v.level, v.fortified, ${hv}::int
        FROM unnest(${arr(cols.unitId)}::text[], ${arr(cols.holder)}::text[], ${arr(cols.strength)}::int[], ${arr(cols.ground)}::text[],
                    ${arr(cols.deeded)}::boolean[], ${arr(cols.masked)}::boolean[], ${arr(cols.level)}::int[], ${arr(cols.fortified)}::boolean[], ${arr(cols.asOf)}::int[])
          AS v(unit_id, holder_id, strength, ground, deeded, masked, level, fortified, as_of_day)
      ON CONFLICT (unit_id, day) DO UPDATE SET
        holder_id = EXCLUDED.holder_id, strength = EXCLUDED.strength, ground = EXCLUDED.ground, deeded = EXCLUDED.deeded,
        masked = EXCLUDED.masked, level = EXCLUDED.level, fortified = EXCLUDED.fortified, holding_rules_version = EXCLUDED.holding_rules_version`);

    const byId = new Map(events.map((e) => [e.eventId, e]));
    const shade = ledger.entries.map((e) => {
      const push = byId.get(e.eventId)?.push;
      return push?.kind === "shade" ? Math.floor(push.strength) : null;
    });
    const en = ledger.entries;
    await tx.execute(sql`
      INSERT INTO gameplay_push_events (event_id, unit_id, walker_id, day, push_kind, shade_strength, outcome,
        previous_holder_id, new_holder_id, strength_before, strength_after, holding_rules_version, source_session_id)
      SELECT v.event_id, v.unit_id, v.walker_id, v.day, v.push_kind, v.shade_strength, v.outcome,
             v.previous_holder_id, v.new_holder_id, v.strength_before, v.strength_after, v.rules_version, ${sourceSessionId}::text
        FROM unnest(${arr(en.map((e) => e.eventId))}::text[], ${arr(en.map((e) => e.unitId))}::text[], ${arr(en.map((e) => e.walkerId))}::text[],
                    ${arr(en.map((e) => e.day))}::int[], ${arr(en.map((e) => e.pushKind))}::text[], ${arr(shade)}::int[], ${arr(en.map((e) => e.outcome))}::text[],
                    ${arr(en.map((e) => e.previousHolderId))}::text[], ${arr(en.map((e) => e.newHolderId))}::text[],
                    ${arr(en.map((e) => e.strengthBefore))}::int[], ${arr(en.map((e) => e.strengthAfter))}::int[], ${arr(en.map((e) => e.rulesVersion))}::int[])
          AS v(event_id, unit_id, walker_id, day, push_kind, shade_strength, outcome, previous_holder_id, new_holder_id,
               strength_before, strength_after, rules_version)`);
    return result;
  }

  /* ── day close ───────────────────────────────────────────────────────── */

  /**
   * Settle every closed day not yet settled, oldest first, at most
   * `maxDaysPerRun` per call. Run from the API's maintenance loop, so a free
   * instance that slept catches up when it wakes; no paid scheduler.
   */
  async settleDueDays(): Promise<number> {
    const last = lastClosedDay(this.rules, this.now());
    if (last < this.rules.seasonOneStartDay) return 0;
    // Every unsettled closed day since season 1 began, including one whose
    // refused header an operator removed so it can be settled again.
    const due = await rows<{ d: number }>(this.db, sql`
      SELECT d FROM generate_series(${this.rules.seasonOneStartDay}::int, ${last}::int) AS d
       WHERE NOT EXISTS (SELECT 1 FROM gameplay_day_settlements s WHERE s.day = d)
       ORDER BY d LIMIT ${this.rules.maxDaysPerRun}`);
    for (const { d } of due) await this.settleDay(Number(d));
    return due.length;
  }

  /** Settle one closed day. Idempotent: a settled (or refused) day is returned as stored. */
  async settleDay(day: number): Promise<DaySummary> {
    if (!Number.isInteger(day) || day < 0) throw new GameplayError(400, "invalid_day");
    if (day > lastClosedDay(this.rules, this.now())) throw new GameplayError(409, "day_not_closed");
    const season = seasonOf(this.rules, day);
    if (season === null) throw new GameplayError(409, "season_not_started");
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.transaction((tx) => this.settleInTx(tx, day, season), { isolationLevel: "serializable" });
      } catch (err) {
        const code = pgCode(err);
        if ((code === "40001" || code === "40P01") && attempt < 4) continue;
        throw err;
      }
    }
  }

  private async settleInTx(tx: Tx, day: number, season: number): Promise<DaySummary> {
    const rules = this.rules;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${GAMEPLAY_LOCK_NAMESPACE}::int, ${day}::int)`);
    const existing = await this.daySummary(tx, day);
    if (existing) return { ...existing, created: false };

    // Each unit as it stood at the end of its last change on or before the day.
    const stateRows = await rows<UnitRow & { day: number }>(tx, sql`
      SELECT * FROM (
        SELECT DISTINCT ON (unit_id) unit_id, day, holder_id, strength, ground, deeded, masked, level, fortified
          FROM gameplay_unit_day_states WHERE day <= ${day} ORDER BY unit_id, day DESC
      ) latest WHERE holder_id IS NOT NULL ORDER BY unit_id`);
    const states = new Map(stateRows.map((r) => [r.unit_id, toState(r, Number(r.day))]));
    const entryRows = await rows<{
      event_id: string; unit_id: string; walker_id: string; day: number; push_kind: "solid" | "shade"; outcome: PushOutcome;
      previous_holder_id: string | null; new_holder_id: string | null; strength_before: number; strength_after: number; holding_rules_version: number;
    }>(tx, sql`
      SELECT event_id, unit_id, walker_id, day, push_kind, outcome, previous_holder_id, new_holder_id, strength_before, strength_after, holding_rules_version
        FROM gameplay_push_events WHERE day = ${day} ORDER BY event_id`);
    const entries: LedgerEntry[] = entryRows.map((e) => ({
      eventId: e.event_id, unitId: e.unit_id, walkerId: e.walker_id, day: Number(e.day), pushKind: e.push_kind, outcome: e.outcome,
      previousHolderId: e.previous_holder_id, newHolderId: e.new_holder_id, strengthBefore: Number(e.strength_before),
      strengthAfter: Number(e.strength_after), rulesVersion: Number(e.holding_rules_version),
    }));

    // Players who moved: verified sessions whose last fix falls on the day (D1),
    // and the week before it for consistency (section 17).
    const sessionRows = await rows<{ user_id: string; end_time: string; duration_seconds: number | null; distance_meters: number | null; traversed_hex_ids: string[] | null }>(tx, sql`
      SELECT user_id, end_time, duration_seconds, distance_meters, traversed_hex_ids FROM movement_verifications
       WHERE status = 'verified' AND end_time >= ${dayStartMs(rules, day - 6)} AND end_time < ${dayStartMs(rules, day + 1)}
       ORDER BY user_id, end_time, id`);
    const activeDays = new Map<string, Set<number>>();
    const sessions = new Map<string, CreditsPlayerInput["sessions"][number][]>();
    for (const s of sessionRows) {
      if (s.duration_seconds === null || s.distance_meters === null) continue;
      const d = dayOf(rules, Number(s.end_time));
      activeDays.set(s.user_id, (activeDays.get(s.user_id) ?? new Set()).add(d));
      if (d !== day) continue;
      const list = sessions.get(s.user_id) ?? [];
      sessions.set(s.user_id, list);
      list.push({ minutes: s.duration_seconds / 60, meters: s.distance_meters, crossedCells: [...new Set(s.traversed_hex_ids ?? [])].sort(byString) });
    }
    const players: CreditsPlayerInput[] = [...sessions.keys()].sort(byString).map((playerId) => ({
      playerId,
      sessions: sessions.get(playerId)!,
      // Rolling seven days ending on the day (D1 pilot reading of "this week").
      activeDaysThisWeek: Math.min(7, Math.max(1, activeDays.get(playerId)!.size)),
      trustWeight: rules.trustWeight,
      kitLevel: rules.kitLevel,
    }));

    const holdings = holdingsAtDayClose({
      day, states, entries, holdingRules: rules.holding,
      // D5 PILOT PROPOSAL: a unit is its own zone.
      zoneOf: (unitId) => unitId,
      shadeCountsAsHeld: rules.shadeCountsAsHeld,
    });
    const credits = settleCreditsDay({ rulesVersion: rules.economyRulesVersion, season, day, players, holdings });

    const membershipRows = await rows<{ walker_id: string; club_id: string; from_day: number; to_day: number | null }>(tx, sql`
      SELECT walker_id, club_id, from_day, to_day FROM gameplay_club_memberships
       WHERE from_day <= ${day} AND (to_day IS NULL OR to_day > ${day}) ORDER BY walker_id, club_id, from_day`);
    const memberships: Membership[] = membershipRows.map((m) => ({ walkerId: m.walker_id, clubId: m.club_id, fromDay: Number(m.from_day), toDay: m.to_day === null ? null : Number(m.to_day) }));
    const heldIds = [...holdings.states.values()].filter((s) => s.holderId !== null).map((s) => s.unitId);
    const districtRows = heldIds.length === 0 ? [] : await rows<{ unit_id: string; district_id: string; districts_version: string }>(tx, sql`
      SELECT unit_id, district_id, districts_version FROM gameplay_unit_districts WHERE unit_id = ANY(${arr(heldIds)}::text[]) ORDER BY unit_id`);
    const districtOfUnit = new Map(districtRows.map((d) => [d.unit_id, d.district_id]));

    let clubsStatus: "settled" | "refused" | "skipped" = "skipped";
    let clubsProblems: string[] = [];
    let contributions: ReturnType<typeof clubContributions> | null = null;
    let control: DistrictControlResult | null = null;
    const snapshot = clubSnapshot(memberships, day);
    if (credits.status === "settled") {
      contributions = clubContributions({ day, entries, snapshot, holdingRulesVersion: rules.holding.rulesVersion });
      control = districtControl({
        holdings, snapshot, rule: rules.districtControl,
        districtOf: (unitId) => {
          const d = districtOfUnit.get(unitId);
          if (d === undefined) throw new Error("not in the district map (D20)");
          return d;
        },
      });
      clubsProblems = [...new Set([...contributions.problems, ...control.problems])];
      clubsStatus = clubsProblems.length === 0 ? "settled" : "refused";
    }

    const inputDigest = digest({
      ruleset: rules.ruleset, economy: rules.economyRulesVersion, holding: rules.holding, day, season,
      states: stateRows.map((r) => [r.unit_id, Number(r.day), r.holder_id, Number(r.strength), r.ground, r.deeded, r.masked, Number(r.level), r.fortified]),
      entries: entries.map((e) => [e.eventId, e.outcome, e.walkerId, e.previousHolderId, e.newHolderId]),
      players, memberships, districts: districtRows.map((d) => [d.unit_id, d.district_id, d.districts_version]),
    });

    if (credits.status === "refused") {
      await tx.execute(sql`
        INSERT INTO gameplay_day_settlements (day, season, status, ruleset, economy_rules_version, holding_rules_version, problems, clubs_status, input_digest)
        VALUES (${day}, ${season}, 'refused', ${rules.ruleset}, ${rules.economyRulesVersion}, ${rules.holding.rulesVersion},
                ${JSON.stringify(credits.problems)}::jsonb, 'skipped', ${inputDigest})`);
    } else {
      const b = credits.settlement.books;
      await tx.execute(sql`
        INSERT INTO gameplay_day_settlements (day, season, status, ruleset, economy_rules_version, holding_rules_version,
          pool_micro, minted_micro, credited_micro, toll_paid_micro, toll_received_micro, burned_micro, returned_micro,
          day_share_micro, players, clubs_status, clubs_problems, input_digest)
        VALUES (${day}, ${season}, 'settled', ${rules.ruleset}, ${rules.economyRulesVersion}, ${rules.holding.rulesVersion},
          ${b.poolMicro}, ${b.mintedMicro}, ${b.creditedMicro}, ${b.tollPaidMicro}, ${b.tollReceivedMicro}, ${b.burnedMicro},
          ${b.returnedToSeasonPoolMicro}, ${credits.settlement.dayShareMicro}, ${credits.lines.length}, ${clubsStatus},
          ${JSON.stringify(clubsProblems)}::jsonb, ${inputDigest})`);
      const l = credits.lines;
      if (l.length > 0) {
        await tx.execute(sql`
          INSERT INTO gameplay_credit_lines (day, player_id, earned_micro, toll_paid_micro, toll_received_micro, recharge_micro,
            upkeep_taken_micro, upkeep_in_condition_micro, zones_held, net_micro)
          SELECT ${day}::int, v.* FROM unnest(${arr(l.map((x) => x.playerId))}::text[], ${arr(l.map((x) => x.earnedMicro))}::bigint[],
            ${arr(l.map((x) => x.tollPaidMicro))}::bigint[], ${arr(l.map((x) => x.tollReceivedMicro))}::bigint[], ${arr(l.map((x) => x.rechargeMicro))}::bigint[],
            ${arr(l.map((x) => x.upkeepTakenMicro))}::bigint[], ${arr(l.map((x) => x.upkeepPaidInConditionMicro))}::bigint[],
            ${arr(l.map((x) => x.zonesHeld))}::int[], ${arr(l.map((x) => x.netMicro))}::bigint[]) AS v`);
      }
      if (clubsStatus === "settled" && contributions && control) {
        const netOf = new Map(l.map((x) => [x.playerId, x.netMicro]));
        const clubs = contributions.clubs;
        if (clubs.length > 0) {
          const credit = clubs.map((c) => c.members.reduce((a, m) => a + (netOf.get(m.walkerId) ?? 0), 0));
          await tx.execute(sql`
            INSERT INTO gameplay_club_days (day, club_id, members, contributions, credits_micro)
            SELECT ${day}::int, v.club_id, v.members, v.contributions::jsonb, v.credits
              FROM unnest(${arr(clubs.map((c) => c.clubId))}::text[], ${arr(clubs.map((c) => c.members.length))}::int[],
                          ${arr(clubs.map((c) => JSON.stringify(c.totals)))}::text[], ${arr(credit)}::bigint[]) AS v(club_id, members, contributions, credits)`);
        }
        const ds = control.districts;
        if (ds.length > 0) {
          await tx.execute(sql`
            INSERT INTO gameplay_district_days (day, district_id, status, controller_club_id, held_weight, standings)
            SELECT ${day}::int, v.district_id, v.status, v.controller, v.weight, v.standings::jsonb
              FROM unnest(${arr(ds.map((d) => d.districtId))}::text[], ${arr(ds.map((d) => d.status))}::text[], ${arr(ds.map((d) => d.controllerClubId))}::text[],
                          ${arr(ds.map((d) => d.held.weight))}::bigint[],
                          ${arr(ds.map((d) => JSON.stringify({ held: d.held, clubs: d.clubs, unclubbed: d.unclubbed })))}::text[])
                AS v(district_id, status, controller, weight, standings)`);
        }
      }
    }
    const summary = await this.daySummary(tx, day);
    return { ...summary!, created: true };
  }

  private async daySummary(exec: Exec, day: number): Promise<Omit<DaySummary, "created"> | null> {
    const [r] = await rows<{ day: number; season: number; status: "settled" | "refused"; clubs_status: DaySummary["clubsStatus"]; players: number;
      pool_micro: string; minted_micro: string; credited_micro: string; burned_micro: string; returned_micro: string }>(exec, sql`
      SELECT day, season, status, clubs_status, players, pool_micro, minted_micro, credited_micro, burned_micro, returned_micro
        FROM gameplay_day_settlements WHERE day = ${day}`);
    if (!r) return null;
    return {
      day: Number(r.day), season: Number(r.season), status: r.status, clubsStatus: r.clubs_status, players: Number(r.players),
      poolMicro: Number(r.pool_micro), mintedMicro: Number(r.minted_micro), creditedMicro: Number(r.credited_micro),
      burnedMicro: Number(r.burned_micro), returnedMicro: Number(r.returned_micro),
    };
  }

  /* ── clubs ───────────────────────────────────────────────────────────── */

  /** Create a club under a client-chosen id and join it. Repeating the same request is a no-op. */
  async createClub(userId: string, clubId: string, name: string): Promise<{ clubId: string; name: string; created: boolean; fromDay: number }> {
    try {
      return await this.db.transaction(async (tx) => {
        const inserted = await rows(tx, sql`
          INSERT INTO gameplay_clubs (club_id, name, created_by) VALUES (${clubId}, ${name}, ${userId})
          ON CONFLICT (club_id) DO NOTHING RETURNING club_id`);
        if (inserted.length === 0) {
          const [club] = await rows<{ name: string; created_by: string | null }>(tx, sql`SELECT name, created_by FROM gameplay_clubs WHERE club_id = ${clubId}`);
          if (!club || club.created_by !== userId || club.name !== name) throw new GameplayError(409, "club_id_taken");
        }
        const joined = await this.joinInTx(tx, userId, clubId);
        return { clubId, name, created: inserted.length > 0, fromDay: joined.fromDay };
      });
    } catch (err) {
      if (pgCode(err) === "23505" && pgConstraint(err) === "gameplay_clubs_name_unique") throw new GameplayError(409, "club_name_taken");
      if (pgCode(err) === "23505" && pgConstraint(err) === "gameplay_club_memberships_one_open") throw new GameplayError(409, "already_in_club");
      throw err;
    }
  }

  async joinClub(userId: string, clubId: string): Promise<{ clubId: string; fromDay: number; changed: boolean }> {
    try {
      return await this.db.transaction(async (tx) => {
        const [club] = await rows(tx, sql`SELECT 1 FROM gameplay_clubs WHERE club_id = ${clubId}`);
        if (!club) throw new GameplayError(404, "club_not_found");
        return { clubId, ...(await this.joinInTx(tx, userId, clubId)) };
      });
    } catch (err) {
      if (pgCode(err) === "23505" && pgConstraint(err) === "gameplay_club_memberships_one_open") throw new GameplayError(409, "already_in_club");
      if (pgCode(err) === "23503") throw new GameplayError(404, "club_not_found");
      throw err;
    }
  }

  private async joinInTx(tx: Tx, userId: string, clubId: string): Promise<{ fromDay: number; changed: boolean }> {
    const [open] = await rows<{ club_id: string; from_day: number }>(tx, sql`
      SELECT club_id, from_day FROM gameplay_club_memberships WHERE walker_id = ${userId} AND to_day IS NULL FOR UPDATE`);
    if (open) {
      if (open.club_id === clubId) return { fromDay: Number(open.from_day), changed: false };
      throw new GameplayError(409, "already_in_club");
    }
    // D18 PILOT PROPOSAL: effective the next day. A club left today stays
    // counted until tomorrow, so the spans never overlap.
    const fromDay = this.today() + this.rules.clubChangeDelayDays;
    await tx.execute(sql`
      INSERT INTO gameplay_club_memberships (id, club_id, walker_id, from_day) VALUES (${randomUUID()}, ${clubId}, ${userId}, ${fromDay})`);
    return { fromDay, changed: true };
  }

  /** Leave the current club. Idempotent: leaving with no club succeeds and changes nothing. */
  async leaveClub(userId: string): Promise<{ left: boolean; toDay: number | null }> {
    return this.db.transaction(async (tx) => {
      const [open] = await rows<{ id: string; from_day: number }>(tx, sql`
        SELECT id, from_day FROM gameplay_club_memberships WHERE walker_id = ${userId} AND to_day IS NULL FOR UPDATE`);
      if (!open) return { left: false, toDay: null };
      const toDay = this.today() + this.rules.clubChangeDelayDays;
      if (toDay <= Number(open.from_day)) {
        // Never took effect: remove it rather than store an empty span.
        await tx.execute(sql`DELETE FROM gameplay_club_memberships WHERE id = ${open.id}`);
      } else {
        await tx.execute(sql`UPDATE gameplay_club_memberships SET to_day = ${toDay} WHERE id = ${open.id}`);
      }
      return { left: true, toDay };
    });
  }

  /* ── reads ───────────────────────────────────────────────────────────── */

  /** The caller's own ground today, as counts by stage. No unit ids: the map comes from the region endpoint (G1). */
  async myHoldings(userId: string): Promise<{ day: number; unitsHeld: number; solid: number; shade: number; byStage: Record<"held" | "at_risk" | "contested" | "dormant", number> }> {
    const today = this.today();
    const held = await rows<UnitRow>(this.db, sql`
      SELECT unit_id, holder_id, strength, ground, deeded, masked, level, fortified, as_of_day FROM gameplay_units WHERE holder_id = ${userId}`);
    const byStage = { held: 0, at_risk: 0, contested: 0, dormant: 0 };
    let solid = 0;
    let shade = 0;
    for (const r of held) {
      const s = decayTo(toState(r), Math.max(today, Number(r.as_of_day)), this.rules.holding);
      const stage = stageOf(s, this.rules.holding);
      if (stage === "unheld") continue;
      byStage[stage] += 1;
      if (s.ground === "solid") solid += 1;
      else shade += 1;
    }
    return { day: today, unitsHeld: solid + shade, solid, shade, byStage };
  }

  /** The caller's own credit lines for a season, settled days only. */
  async myCredits(userId: string, season: number) {
    const lines = await rows<{ day: number; earned_micro: string; toll_paid_micro: string; toll_received_micro: string; recharge_micro: string;
      upkeep_taken_micro: string; upkeep_in_condition_micro: string; zones_held: number; net_micro: string }>(this.db, sql`
      SELECT l.day, l.earned_micro, l.toll_paid_micro, l.toll_received_micro, l.recharge_micro, l.upkeep_taken_micro,
             l.upkeep_in_condition_micro, l.zones_held, l.net_micro
        FROM gameplay_credit_lines l JOIN gameplay_day_settlements s ON s.day = l.day
       WHERE l.player_id = ${userId} AND s.season = ${season} AND s.status = 'settled' ORDER BY l.day`);
    const days = lines.map((r) => ({
      day: Number(r.day), earnedMicro: Number(r.earned_micro), tollPaidMicro: Number(r.toll_paid_micro), tollReceivedMicro: Number(r.toll_received_micro),
      rechargeMicro: Number(r.recharge_micro), upkeepTakenMicro: Number(r.upkeep_taken_micro), upkeepInConditionMicro: Number(r.upkeep_in_condition_micro),
      zonesHeld: Number(r.zones_held), netMicro: Number(r.net_micro),
    }));
    return { season, kind: "off_chain_credits" as const, days, netMicro: days.reduce((a, d) => a + d.netMicro, 0) };
  }

  /** A club's aggregate for one settled day: members counted, contributions totalled, never listed per member. */
  async clubDay(clubId: string, day: number) {
    const [r] = await rows<{ name: string; members: number; contributions: unknown; credits_micro: string }>(this.db, sql`
      SELECT c.name, d.members, d.contributions, d.credits_micro
        FROM gameplay_club_days d JOIN gameplay_clubs c ON c.club_id = d.club_id
       WHERE d.club_id = ${clubId} AND d.day = ${day}`);
    if (!r) throw new GameplayError(404, "not_found");
    return { clubId, name: r.name, day, members: Number(r.members), contributions: r.contributions, creditsMicro: Number(r.credits_micro) };
  }

  /** District standings for one settled day. */
  async districtsDay(day: number) {
    const [header] = await rows<{ status: string; clubs_status: string }>(this.db, sql`SELECT status, clubs_status FROM gameplay_day_settlements WHERE day = ${day}`);
    if (!header || header.status !== "settled") throw new GameplayError(404, "not_found");
    if (header.clubs_status !== "settled") return { day, status: header.clubs_status, districts: [] };
    const ds = await rows<{ district_id: string; status: string; controller_club_id: string | null; held_weight: string; standings: unknown }>(this.db, sql`
      SELECT district_id, status, controller_club_id, held_weight, standings FROM gameplay_district_days WHERE day = ${day} ORDER BY district_id`);
    return {
      day, status: "settled",
      districts: ds.map((d) => ({ districtId: d.district_id, status: d.status, controllerClubId: d.controller_club_id, heldWeight: Number(d.held_weight), standings: d.standings })),
    };
  }

  /**
   * A season board from settled days only, through `seasonLeaderboard`. Any
   * refused day refuses the board. Player rows carry no ids: only a rank, a
   * score and whether the row is the caller's.
   */
  async leaderboard(userId: string, season: number, metric: LeaderboardMetric) {
    const rules = this.rules;
    const headers = await rows<{ day: number; status: "settled" | "refused"; economy_rules_version: number; pool_micro: string; minted_micro: string;
      credited_micro: string; toll_paid_micro: string; toll_received_micro: string; burned_micro: string; returned_micro: string; day_share_micro: string;
      clubs_status: string }>(this.db, sql`
      SELECT day, status, economy_rules_version, pool_micro, minted_micro, credited_micro, toll_paid_micro, toll_received_micro,
             burned_micro, returned_micro, day_share_micro, clubs_status
        FROM gameplay_day_settlements WHERE season = ${season} ORDER BY day`);
    const dayList = headers.map((h) => Number(h.day));
    const lineRows = dayList.length === 0 ? [] : await rows<{ day: number; player_id: string; net_micro: string; earned_micro: string; toll_paid_micro: string;
      toll_received_micro: string; recharge_micro: string; upkeep_taken_micro: string; upkeep_in_condition_micro: string; zones_held: number }>(this.db, sql`
      SELECT day, player_id, net_micro, earned_micro, toll_paid_micro, toll_received_micro, recharge_micro, upkeep_taken_micro, upkeep_in_condition_micro, zones_held
        FROM gameplay_credit_lines WHERE day = ANY(${arr(dayList)}::int[]) ORDER BY day, player_id`);
    const memberships = metric === "player_credits" ? [] : (await rows<{ walker_id: string; club_id: string; from_day: number; to_day: number | null }>(this.db, sql`
      SELECT walker_id, club_id, from_day, to_day FROM gameplay_club_memberships ORDER BY walker_id, club_id, from_day`))
      .map((m): Membership => ({ walkerId: m.walker_id, clubId: m.club_id, fromDay: Number(m.from_day), toDay: m.to_day === null ? null : Number(m.to_day) }));
    const districtRows = metric !== "club_district_days" || dayList.length === 0 ? [] : await rows<{ day: number; district_id: string; status: string; controller_club_id: string | null }>(this.db, sql`
      SELECT day, district_id, status, controller_club_id FROM gameplay_district_days WHERE day = ANY(${arr(dayList)}::int[]) ORDER BY day, district_id`);

    const days: SeasonDay[] = headers.map((h) => {
      const day = Number(h.day);
      if (h.status !== "settled") {
        return { credits: { status: "refused", rulesVersion: Number(h.economy_rules_version), season, day, problems: ["day was refused"] } };
      }
      const lines = lineRows.filter((l) => Number(l.day) === day).map((l) => ({
        playerId: l.player_id, earnedMicro: Number(l.earned_micro), tollPaidMicro: Number(l.toll_paid_micro), tollReceivedMicro: Number(l.toll_received_micro),
        rechargeMicro: Number(l.recharge_micro), upkeepTakenMicro: Number(l.upkeep_taken_micro), upkeepPaidInConditionMicro: Number(l.upkeep_in_condition_micro),
        zonesHeld: Number(l.zones_held), unvisitedZoneIds: [], netMicro: Number(l.net_micro),
      }));
      const settlement: DaySettlement = {
        totalPoints: 0, dayShareMicro: Number(h.day_share_micro), players: [],
        books: {
          poolMicro: Number(h.pool_micro), mintedMicro: Number(h.minted_micro), creditedMicro: Number(h.credited_micro), tollPaidMicro: Number(h.toll_paid_micro),
          tollReceivedMicro: Number(h.toll_received_micro), burnedMicro: Number(h.burned_micro), returnedToSeasonPoolMicro: Number(h.returned_micro),
        },
      };
      const credits: CreditsDayResult = { status: "settled", rulesVersion: Number(h.economy_rules_version), season, day, poolMicro: Number(h.pool_micro), settlement, lines };
      if (metric === "player_credits") return { credits };
      const snapshot = clubSnapshot(memberships, day);
      if (metric === "club_credits") return { credits, snapshot };
      const districts: DistrictControlResult = h.clubs_status === "settled"
        ? {
          day, problems: [],
          districts: districtRows.filter((d) => Number(d.day) === day).map((d) => ({
            districtId: d.district_id, status: d.status as DistrictStanding["status"], controllerClubId: d.controller_club_id,
            held: { solidUnits: 0, shadeUnits: 0, weight: 0 }, clubs: [], unclubbed: { solidUnits: 0, shadeUnits: 0, weight: 0 },
          })),
        }
        : { day, districts: [], problems: [`club and district day was ${h.clubs_status}`] };
      return { credits, snapshot, districts };
    });

    const board = seasonLeaderboard({ rulesVersion: rules.economyRulesVersion, season, days, metric });
    if (board.status !== "settled") {
      // Problem text can name players; only the count leaves the server.
      return { status: "refused" as const, season, metric, problemCount: board.problems.length };
    }
    const base = { status: "settled" as const, basis: board.basis, season, metric, daysSettled: board.daysSettled, throughDay: board.throughDay, seasonComplete: board.seasonComplete };
    if (metric === "player_credits") {
      return { ...base, rows: board.rows.map((r) => ({ rank: r.rank, score: r.score, self: r.id === userId })) };
    }
    const ids = board.rows.map((r) => r.id);
    const names = ids.length === 0 ? [] : await rows<{ club_id: string; name: string }>(this.db, sql`SELECT club_id, name FROM gameplay_clubs WHERE club_id = ANY(${arr(ids)}::text[])`);
    const nameOf = new Map(names.map((n) => [n.club_id, n.name]));
    return { ...base, rows: board.rows.map((r) => ({ rank: r.rank, clubId: r.id, name: nameOf.get(r.id) ?? null, score: r.score })) };
  }
}
