/**
 * Server-authoritative holding, settlement, clubs, districts and leaderboards
 * (G3/G4 server preparation). Off unless MOVENRUN_GAMEPLAY_ENABLED is set; the
 * tables it uses come from the PROPOSED migration
 * drizzle-proposed/0011_gameplay_holdings.sql (revision 2), which is not
 * applied anywhere live.
 *
 * Every rule lives in the shared reference models; this file only loads state,
 * runs them and stores what they return:
 *
 * - `applySession`: a verified movement session becomes one stepped-on push
 *   per traversed unit, run through `applyLedger`. The phone never names a
 *   unit, a push or an outcome; the server derives all of it.
 * - `settleDay`: a closed day through `holdingsAtDayClose`,
 *   `settleCreditsDay`, `clubSnapshot`, `clubContributions` and
 *   `districtControl`. A day with any problem is stored as refused. It also
 *   writes one proof row per walker of the day.
 * - reads: own holdings and credits, club and district aggregates, and a
 *   season board through `seasonLeaderboard`, from settled days only.
 *
 * Storage (revision 2): units are stored as the H3 cell's bigint index,
 * players in the high-volume tables as `gameplay_players.player_no`. Only
 * accepted pushes are ledger rows; a refused push is a counter on the
 * walker's day row (`gameplay_walker_days`), with one refused unit per zone
 * kept so day close sees the same visits. The ledger and the day rows are in
 * day partitions; the server creates them ahead of use.
 *
 * Idempotency: a source is applied once. A movement session is a source
 * (`gameplay_applied_sessions`, keyed by the session and holding its
 * receipt); so is a server batch key. A push's event id is
 * "<source>:<cell>", stored as (source_no, unit, day), the ledger's primary
 * key. Each day is settled once (primary key).
 * Concurrency: pushes lock their unit rows in id order and hold a shared
 * advisory lock on their day; settlement holds the exclusive one and runs
 * SERIALIZABLE. The one-push-per-walker-per-unit-per-day rule is also a
 * unique index, so the database refuses a second push even if this code
 * were wrong.
 *
 * Rule sets (rules.ts): each day is pinned to one holding rules version in
 * `gameplay_day_rules`; pushes, counters, proofs and the settlement of that
 * day carry it. A batch locks its source, the day, then the walkers' day
 * rows, then the units, always in that order. The take budget, the unit
 * budget and the two-day challenge are applied in the same transaction as
 * the pushes, and anything recorded under another or an unknown version
 * fails closed.
 *
 * Capacity: every walker has a daily budget of verified units (default 300,
 * `unitBudget`), counted on the server and spent once per applied push, so
 * a retried session spends nothing. An optional `capacityGuard` is asked
 * before any push is written; when it says stop, or fails, the push is
 * refused with 503 `capacity_hard_stop` and nothing is written. Settlement,
 * erasure and reads never ask it.
 */
import { createHash, randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { decayTo, stageOf, type Ground, type LandLevel, type PushOutcome, type UnitState } from "@movenrun/shared/holding";
import { applyLedger, type LedgerEntry, type PushEvent } from "@movenrun/shared/holdingLedger";
import { holdingsAtDayClose, settleCreditsDay, type CreditsDayResult, type CreditsPlayerInput } from "@movenrun/shared/holdingSettlement";
import {
  clubContributions, clubSnapshot, districtControl, rankRows, seasonLeaderboard,
  type DistrictControlResult, type DistrictStanding, type LeaderboardMetric, type Membership, type SeasonDay,
} from "@movenrun/shared/clubsDistricts";
import { reconcileDay, seasonPoolMicro, type DaySettlement } from "@movenrun/shared/economy-v3";
import {
  claimCellOptionsOf, DAY_MS, dayCloseMs, dayOf, dayStartMs, isUnitUnder, lastClosedDay, receiptCutoffOf, receivedInTime, rulesetConfig, rulesetDigest, rulesetFor, sealProblem, seasonOf,
  territorySealOf,
  UnknownRulesVersionError, zoneOfUnder,
  type GameplayRules,
} from "./rules.js";
import {
  applyServerLedger, challengeKey, isRefused, REFUSED_OUTCOMES, SERVER_OUTCOMES,
  type RefusedOutcome, type SecondPushInput, type ServerEventResult, type ServerLedgerEntry, type ServerOutcome, type ServerRejectReason,
} from "./policy.js";
import { DEFAULT_UNIT_BUDGET, type CapacityGuard } from "./capacity.js";
import { cellToInt8, int8ToCell, isStorableCell } from "./cells.js";
import { bitsToFlags, pushUnitsOf, steppedUnitsOf } from "./path.js";
import { partitionProblems, withPartitionLevels, zonePartitions } from "./zones.js";
import { dayInvariantProblems, exact, pinnedEconomyRules, PinnedRulesError, type BooksRow, type LineRow } from "./invariants.js";

/** Advisory lock namespace ("MRGP"); the second key is the day index. */
export const GAMEPLAY_LOCK_NAMESPACE = 0x4d524750;
/** Advisory lock namespace ("MRGS"); the second key is the season. Taken only to pin a new day. */
export const GAMEPLAY_SEASON_LOCK_NAMESPACE = 0x4d524753;

/** Server receipt time of a movement row, epoch ms, whatever the session time zone. */
const RECEIVED_MS = sql.raw(`(extract(epoch FROM (created_at AT TIME ZONE current_setting('TimeZone'))) * 1000)::float8`);

export class GameplayError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

/** A day whose ledger partition does not exist yet; created outside the push transaction, then retried. */
class MissingPartitionError extends Error {
  constructor(readonly day: number) {
    super(`no gameplay partition for day ${day}`);
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

/** A deadlock (40P01) or serialization failure (40001): the transaction was aborted whole and is safe to rerun. */
function isRetryableContention(err: unknown): boolean {
  const code = pgCode(err);
  return code === "40P01" || code === "40001";
}

function pgConstraint(err: unknown): string | undefined {
  const e = err as { constraint?: unknown; cause?: { constraint?: unknown } } | null;
  const c = e?.constraint ?? e?.cause?.constraint;
  return typeof c === "string" ? c : undefined;
}

const OUTCOMES: readonly ServerOutcome[] = SERVER_OUTCOMES;
const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Ledger outcome codes (0011 revision 2): accepted pushes only. */
const ACCEPTED_CODE: Partial<Record<ServerOutcome, number>> = { claimed: 1, reinforced: 2, eroded: 3, flipped: 4 };
const ACCEPTED_OUTCOME: Record<number, PushOutcome> = { 1: "claimed", 2: "reinforced", 3: "eroded", 4: "flipped" };
/** Columns of gameplay_walker_days that count each refusal. */
const REFUSED_COLUMN: Record<RefusedOutcome, string> = {
  refused_deeded: "refused_deeded", refused_masked: "refused_masked", refused_daily_limit: "refused_daily_limit", refused_take_budget: "refused_take_budget",
};
/** At most this many refused units are kept per walker and day (the column's check). */
const MAX_VISIT_UNITS = 1000;

export interface ApplySummary {
  sessionId: string;
  day: number;
  /** True when this session had already been applied and nothing changed. */
  replayed: boolean;
  applied: number;
  skipped: number;
  rejected: number;
  outcomes: Record<ServerOutcome, number>;
  rejectedByReason: Partial<Record<ServerRejectReason, number>>;
}

export interface BatchResult {
  applied: number;
  skipped: number;
  rejected: number;
  outcomes: Record<ServerOutcome, number>;
  rejectedByReason: Partial<Record<ServerRejectReason, number>>;
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
  unit: string;
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
    unitId: int8ToCell(r.unit),
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

function emptyOutcomes(): Record<ServerOutcome, number> {
  return Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<ServerOutcome, number>;
}

function emptyResult(): BatchResult {
  return { applied: 0, skipped: 0, rejected: 0, outcomes: emptyOutcomes(), rejectedByReason: {} };
}

function count(result: BatchResult, r: ServerEventResult): void {
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

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** The source half of a derived event id "<source>:<cell>", or null when the id is not of that form. */
function sourceKeyOf(e: PushEvent): string | null {
  if (typeof e.eventId !== "string" || typeof e.unitId !== "string" || e.unitId.length === 0) return null;
  const suffix = `:${e.unitId}`;
  if (!e.eventId.endsWith(suffix)) return null;
  const key = e.eventId.slice(0, -suffix.length);
  return key.length >= 1 && key.length <= 200 ? key : null;
}

/** A source this batch may write under: its number, or that it was applied already. */
interface Source { sourceNo: number; applied: boolean }

/** What the capacity guard allows this batch. */
interface Allowance { factor: number }

/**
 * How a push batch rewrites the touched units' open challenges.
 *  - "delete-insert": delete every row of the touched units and insert those left open (the live behaviour).
 *  - "diff": delete the closed rows, insert the new ones, and update a kept row only when first_day,
 *    holding_rules_version or opened_received_at actually differs. The table ends identical to delete-insert.
 */
export type ChallengeWriteMode = "delete-insert" | "diff";
/** Live semantics unless a deployment chooses otherwise. */
export const DEFAULT_CHALLENGE_WRITE_MODE: ChallengeWriteMode = "delete-insert";

export interface GameplayServiceDeps {
  db: Db;
  /** Challenge write strategy (default DEFAULT_CHALLENGE_WRITE_MODE). */
  challengeWrites?: ChallengeWriteMode;
  rules: GameplayRules;
  now?: () => number;
  /**
   * Verified units one walker may push a day, accepted or refused (default
   * 300). A capacity guard, not a game rule; null turns it off (benchmarks).
   */
  unitBudget?: number | null;
  /** Asked before any push is written. Absent: no guard. A stop, or a failure, refuses the push with 503. */
  capacityGuard?: CapacityGuard;
  /** work_mem for the settlement transaction, in kB (default 16 MiB), so the day's sorts stay in memory. */
  settlementWorkMemKb?: number;
  /** How a day close retries a serialization failure or deadlock (default DEFAULT_SETTLEMENT_RETRY). */
  settlementRetry?: Partial<SettlementRetryPolicy>;
  /** Jitter source for the retry backoff, in [0, 1) (default Math.random). */
  retryRandom?: () => number;
  /** Waits between retries (default setTimeout). */
  retrySleep?: (ms: number) => Promise<void>;
  /** Monotonic clock in ms for the retry time cap (default performance.now); not the game clock. */
  retryClock?: () => number;
}

/**
 * Retry policy of one `settleDay` call. A close aborted with 40001 or 40P01
 * wrote nothing (its transaction is rolled back whole) and is run again after
 * a wait of `floor(random * min(maxDelayMs, baseDelayMs * 2^(n-1)))` ms before
 * retry n (capped exponential, full jitter), at most `maxAttempts` attempts in
 * all, and never starting a wait that would end past `maxTotalMs` from the
 * first attempt. When either cap is reached the call fails with
 * SettlementRetryExhaustedError; the day stays unsettled and the next
 * day-close run selects it again.
 */
export interface SettlementRetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  maxTotalMs: number;
}
/** Five attempts, as before, now with a wait between them. */
export const DEFAULT_SETTLEMENT_RETRY: SettlementRetryPolicy = { maxAttempts: 5, baseDelayMs: 50, maxDelayMs: 1_000, maxTotalMs: 10_000 };

/** The wait before retry `retry` (1-based) for a jitter draw `random` in [0, 1). */
export function settlementBackoffMs(policy: SettlementRetryPolicy, retry: number, random: number): number {
  const r = Number.isFinite(random) ? Math.min(Math.max(random, 0), 1) : 0;
  const cap = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, retry - 1));
  return Math.min(Math.floor(r * cap), Math.max(0, cap - 1));
}

/**
 * A day close that kept losing to concurrent transactions (40001 or 40P01)
 * until its retry policy ran out. Nothing of the day was written: every
 * attempt rolled back whole. Transient: it is not a reason to halt
 * settlement, and the day is retried by the next day-close run.
 */
export class SettlementRetryExhaustedError extends GameplayError {
  constructor(readonly day: number, readonly attempts: number, readonly lastCode: string, readonly reason: "attempts" | "time") {
    super(503, "settlement_retry_exhausted");
  }
}

function checkRetryPolicy(p: SettlementRetryPolicy): SettlementRetryPolicy {
  const whole = (v: number, min: number, max: number) => Number.isInteger(v) && v >= min && v <= max;
  if (!whole(p.maxAttempts, 1, 50) || !whole(p.baseDelayMs, 0, 60_000) || !whole(p.maxDelayMs, 0, 600_000) || !whole(p.maxTotalMs, 0, 3_600_000)) {
    throw new Error("settlement retry policy: maxAttempts 1 to 50, delays and maxTotalMs whole milliseconds within bounds");
  }
  return p;
}

export interface OpenChallenge { unit: string; walkerId: string; day: number; openedMs: number }

/**
 * Replace the open challenges of `units` (whose gameplay_units rows the caller holds locked) with `open`,
 * all stamped with rules version `hv`. Both modes leave the table with identical contents; "diff" writes
 * only what differs, so a kept row that is unchanged is neither deleted nor rewritten.
 */
export async function writeChallenges(tx: Exec, mode: ChallengeWriteMode, units: readonly string[], open: readonly OpenChallenge[], hv: number): Promise<void> {
  if (mode === "delete-insert") {
    await tx.execute(sql`DELETE FROM gameplay_unit_challenges WHERE unit = ANY(${arr(units)}::bigint[])`);
    if (open.length > 0) {
      await tx.execute(sql`
        INSERT INTO gameplay_unit_challenges (unit, walker_id, first_day, holding_rules_version, opened_received_at)
        SELECT v.unit, v.walker_id, v.first_day, ${hv}::int, to_timestamp(v.opened_ms / 1000.0)
          FROM unnest(${arr(open.map((c) => c.unit))}::bigint[], ${arr(open.map((c) => c.walkerId))}::text[], ${arr(open.map((c) => c.day))}::int[],
                      ${arr(open.map((c) => c.openedMs))}::float8[])
            AS v(unit, walker_id, first_day, opened_ms)`);
    }
    return;
  }
  const ou = arr(open.map((c) => c.unit)), ow = arr(open.map((c) => c.walkerId)), od = arr(open.map((c) => c.day)), om = arr(open.map((c) => c.openedMs));
  await tx.execute(sql`
    DELETE FROM gameplay_unit_challenges t
     WHERE t.unit = ANY(${arr(units)}::bigint[])
       AND NOT EXISTS (SELECT 1 FROM unnest(${ou}::bigint[], ${ow}::text[]) AS v(unit, walker_id) WHERE v.unit = t.unit AND v.walker_id = t.walker_id)`);
  if (open.length === 0) return;
  // A kept row is written only when first_day, the rules version or the receipt time really differs.
  await tx.execute(sql`
    UPDATE gameplay_unit_challenges t SET first_day = v.first_day, holding_rules_version = ${hv}::int, opened_received_at = to_timestamp(v.opened_ms / 1000.0)
      FROM unnest(${ou}::bigint[], ${ow}::text[], ${od}::int[], ${om}::float8[]) AS v(unit, walker_id, first_day, opened_ms)
     WHERE t.unit = v.unit AND t.walker_id = v.walker_id
       AND (t.first_day IS DISTINCT FROM v.first_day OR t.holding_rules_version IS DISTINCT FROM ${hv}::int
            OR t.opened_received_at IS DISTINCT FROM to_timestamp(v.opened_ms / 1000.0))`);
  await tx.execute(sql`
    INSERT INTO gameplay_unit_challenges (unit, walker_id, first_day, holding_rules_version, opened_received_at)
    SELECT v.unit, v.walker_id, v.first_day, ${hv}::int, to_timestamp(v.opened_ms / 1000.0)
      FROM unnest(${ou}::bigint[], ${ow}::text[], ${od}::int[], ${om}::float8[]) AS v(unit, walker_id, first_day, opened_ms)
     WHERE NOT EXISTS (SELECT 1 FROM gameplay_unit_challenges t WHERE t.unit = v.unit AND t.walker_id = v.walker_id)`);
}

type SettledCredits = Extract<CreditsDayResult, { status: "settled" }>;

/** The books a settled day stores, as exact integers. */
function booksOf(c: SettledCredits): BooksRow {
  const b = c.settlement.books;
  return {
    pool: exact(b.poolMicro), minted: exact(b.mintedMicro), credited: exact(b.creditedMicro), tollPaid: exact(b.tollPaidMicro),
    tollReceived: exact(b.tollReceivedMicro), burned: exact(b.burnedMicro), returned: exact(b.returnedToSeasonPoolMicro), players: BigInt(c.lines.length),
  };
}

/** The credit lines a settled day stores, as exact integers, by player id. */
function linesOf(c: SettledCredits): LineRow[] {
  return [...c.lines].sort((a, b) => byString(a.playerId, b.playerId)).map((l) => ({
    playerId: l.playerId, earned: exact(l.earnedMicro), tollPaid: exact(l.tollPaidMicro), tollReceived: exact(l.tollReceivedMicro),
    recharge: exact(l.rechargeMicro), upkeepTaken: exact(l.upkeepTakenMicro), upkeepInCondition: exact(l.upkeepPaidInConditionMicro), net: exact(l.netMicro),
  }));
}

/** Key-sorted, bigints as text: two rows compare equal exactly when every field does. */
const stringify = (o: object) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => byString(a, b)).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));

/**
 * Each walker's day proof from the day's accepted ledger rows (seq order) and
 * day rows. Proof encoding 2: a ledger row is hashed as source, unit,
 * outcome, strengths and shade only, never another player's number, so
 * erasing a previous or new holder (their numbers become NULL) leaves every
 * other walker's proof unchanged. The outcome already says whose ground it
 * was (claimed: nobody's, reinforced: the walker's, eroded or flipped:
 * someone else's).
 */
function proofsOf(
  entryRows: readonly { walker_no: number; holding_rules_version: number; source_no: number; unit: string; outcome: number; strength_before: number; strength_after: number; shade_strength: number }[],
  refusalRows: readonly ({ walker_no: number; holding_rules_version: number; units_used: number; visit_units: string[] | null } & Record<RefusedOutcome, number>)[],
): [number, { accepted: number; takes: number; refused: number; unitsUsed: number; hv: number; sha: string }][] {
  const proofs = new Map<number, { accepted: number; takes: number; refused: number; unitsUsed: number; lines: string[]; hv: number }>();
  const proofOf = (walkerNo: number, hv: number) => {
    let p = proofs.get(walkerNo);
    if (!p) { p = { accepted: 0, takes: 0, refused: 0, unitsUsed: 0, lines: [], hv }; proofs.set(walkerNo, p); }
    return p;
  };
  for (const e of entryRows) {
    const p = proofOf(Number(e.walker_no), Number(e.holding_rules_version));
    p.accepted += 1;
    if (Number(e.outcome) === 3 || Number(e.outcome) === 4) p.takes += 1;
    p.lines.push([e.source_no, e.unit, e.outcome, `${e.strength_before}>${e.strength_after}`, e.shade_strength].join(":"));
  }
  for (const r of refusalRows) {
    const p = proofOf(Number(r.walker_no), Number(r.holding_rules_version));
    p.refused = REFUSED_OUTCOMES.reduce((a, o) => a + Number(r[o]), 0);
    p.unitsUsed = Number(r.units_used);
    p.lines.push(["refused", ...REFUSED_OUTCOMES.map((o) => Number(r[o])), (r.visit_units ?? []).join(",")].join(":"));
  }
  return [...proofs.entries()].filter(([, p]) => p.accepted + p.refused > 0).sort((a, b) => a[0] - b[0])
    .map(([n, p]) => [n, { accepted: p.accepted, takes: p.takes, refused: p.refused, unitsUsed: p.unitsUsed, hv: p.hv, sha: createHash("sha256").update(p.lines.join("\n")).digest("hex") }]);
}

/** Codes on which the reconciler halts settlement. */
const RECONCILER_HALT_CODES = new Set(["closed_day_replay_mismatch", "closed_day_books_invalid", "closed_day_erasure_invalid", "closed_day_proof_mismatch"]);

function checkActor(actor: unknown): void {
  if (typeof actor !== "string" || !/^[a-z0-9][a-z0-9_.:-]{0,63}$/.test(actor)) throw new GameplayError(400, "invalid_actor");
}

function checkReason(reason: unknown): void {
  if (typeof reason !== "string" || reason.length < 1 || reason.length > 500) throw new GameplayError(400, "invalid_reason");
}

/** The transaction type erasure runs in (account deletion's). */
export type GameplayTx = Tx;

/** What the first erasure phase saw, per settled day it may change. Holds no identity beyond the call. */
export interface ErasurePlan {
  userId: string;
  days: { day: number; season: number; head: string; verified: boolean }[];
}

export class GameplayService {
  private readonly db: Db;
  readonly rules: GameplayRules;
  private readonly now: () => number;
  private readonly unitBudget: number | null;
  private readonly capacityGuard: CapacityGuard | undefined;
  private readonly settlementWorkMemKb: number;
  private readonly challengeWrites: ChallengeWriteMode;
  private readonly settlementRetry: SettlementRetryPolicy;
  private readonly retryRandom: () => number;
  private readonly retrySleep: (ms: number) => Promise<void>;
  private readonly retryClock: () => number;

  constructor(deps: GameplayServiceDeps) {
    this.db = deps.db;
    this.rules = deps.rules;
    this.now = deps.now ?? Date.now;
    this.unitBudget = deps.unitBudget === undefined ? DEFAULT_UNIT_BUDGET : deps.unitBudget;
    if (this.unitBudget !== null && !(Number.isInteger(this.unitBudget) && this.unitBudget >= 1)) throw new Error("unitBudget must be a whole number, 1 or more, or null");
    this.capacityGuard = deps.capacityGuard;
    this.challengeWrites = deps.challengeWrites ?? DEFAULT_CHALLENGE_WRITE_MODE;
    if (this.challengeWrites !== "delete-insert" && this.challengeWrites !== "diff") throw new Error("challengeWrites must be delete-insert or diff");
    this.settlementWorkMemKb = deps.settlementWorkMemKb ?? 16_384;
    if (!(Number.isInteger(this.settlementWorkMemKb) && this.settlementWorkMemKb >= 64 && this.settlementWorkMemKb <= 1_048_576)) throw new Error("settlementWorkMemKb must be 64 to 1048576");
    this.settlementRetry = checkRetryPolicy({ ...DEFAULT_SETTLEMENT_RETRY, ...deps.settlementRetry });
    this.retryRandom = deps.retryRandom ?? Math.random;
    this.retrySleep = deps.retrySleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.retryClock = deps.retryClock ?? (() => performance.now());
  }

  today(): number {
    return dayOf(this.rules, this.now());
  }

  /* ── partitions ──────────────────────────────────────────────────────── */

  /**
   * Create the ledger and day-row partitions for `fromDay` to `toDay` that do
   * not exist yet. Its own short transaction, never inside a push. Run by the
   * maintenance loop for the coming days, and by the push path for a day
   * that has none.
   */
  async ensurePartitions(fromDay: number, toDay: number): Promise<number> {
    const [r] = await rows<{ made: number }>(this.db, sql`SELECT public.gameplay_ensure_day_partitions(${fromDay}::int, ${toDay}::int) AS made`);
    return Number(r?.made ?? 0);
  }

  /**
   * Run a push transaction, creating a missing day partition first when it
   * asks for one. Creating a partition is DDL: it locks the partitioned
   * parent and the tables its foreign keys reference, so it can deadlock
   * with pushes already in flight (PostgreSQL then aborts one side with
   * 40P01; a serialization failure is 40001). Both sides are whole transactions and the aborted one wrote
   * nothing, so the victim is retried, a bounded number of times. When the
   * retries run out the push is refused with 409 `concurrent_push_retry`
   * (the transaction is already rolled back) instead of a raw driver error.
   */
  private async withPartitions<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const last = attempt >= 4;
        if (err instanceof MissingPartitionError && !last) {
          await this.ensurePartitionsRetrying(err.day, err.day + 1);
          continue;
        }
        if (isRetryableContention(err)) {
          if (!last) continue;
          // Retries exhausted: every attempt rolled back whole, so the client may simply push again.
          throw new GameplayError(409, "concurrent_push_retry");
        }
        throw err;
      }
    }
  }

  private async ensurePartitionsRetrying(fromDay: number, toDay: number): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.ensurePartitions(fromDay, toDay);
        return;
      } catch (err) {
        if (!isRetryableContention(err)) throw err;
        if (attempt >= 4) throw new GameplayError(409, "concurrent_push_retry");
      }
    }
  }

  private async requirePartitions(tx: Tx, day: number): Promise<void> {
    const [p] = await rows<{ ok: boolean }>(tx, sql`
      SELECT to_regclass(${`gameplay_partitions.gameplay_push_events_d${day}`}) IS NOT NULL
         AND to_regclass(${`gameplay_partitions.gameplay_walker_days_d${day}`}) IS NOT NULL AS ok`);
    if (!p?.ok) throw new MissingPartitionError(day);
  }

  /* ── capacity ────────────────────────────────────────────────────────── */

  private async allowance(): Promise<Allowance> {
    if (!this.capacityGuard) return { factor: 1 };
    let decision;
    try {
      decision = await this.capacityGuard();
    } catch {
      throw new GameplayError(503, "capacity_hard_stop");
    }
    const factor = Number(decision?.pushBudgetFactor);
    if (!decision || decision.acceptPushes !== true || !(factor > 0 && factor <= 1)) throw new GameplayError(503, "capacity_hard_stop");
    return { factor };
  }

  /* ── players ─────────────────────────────────────────────────────────── */

  /** Player numbers for these users, created for the ones that have none. */
  private async playerNos(tx: Tx, userIds: readonly string[]): Promise<Map<string, number>> {
    const ids = [...new Set(userIds)].sort(byString);
    const out = new Map<string, number>();
    if (ids.length === 0) return out;
    const read = async () => {
      for (const r of await rows<{ player_no: number; user_id: string }>(tx, sql`
        SELECT player_no, user_id FROM gameplay_players WHERE user_id = ANY(${arr(ids)}::text[])`)) out.set(r.user_id, Number(r.player_no));
    };
    await read();
    const missing = ids.filter((u) => !out.has(u));
    if (missing.length > 0) {
      await tx.execute(sql`
        INSERT INTO gameplay_players (user_id) SELECT u FROM unnest(${arr(missing)}::text[]) WITH ORDINALITY AS t(u, n) ORDER BY n
        ON CONFLICT (user_id) DO NOTHING`);
      await read();
    }
    return out;
  }

  /* ── pushes ──────────────────────────────────────────────────────────── */

  /**
   * Turn one of the caller's verified, server-sealed movement sessions into
   * pushes (V3 rule 3: unsealed sessions claim nothing). Keyed by
   * the authenticated user and the client's own session id, so a retry (or a
   * guess at someone else's id) can never apply anything twice or for anyone
   * else. Every traversed unit is a stepped-on push: the traversed cells are
   * the cells that contain a verified fix (assumption A1), never cells
   * inferred between fixes. Shade needs D2 and is not derived here.
   */
  async applySession(userId: string, clientSessionId: string): Promise<ApplySummary> {
    const now = this.now();
    try {
      return await this.withPartitions(() => this.db.transaction(async (tx) => {
        const [mv] = await rows<{ id: string; status: string; end_time: string; traversed_hex_ids: string[] | null; received_ms: number;
          sealed: boolean | null; seal_methods: string[] | null; seal_event_count: number | null; rules_version: number | null;
          territory_seal_version: number | null; territory_sealed: boolean | null; territory_seal_reason: string | null;
          territory_claim_units: string[] | null; territory_claim_resolution: number | null }>(tx, sql`
          SELECT id, status, end_time, traversed_hex_ids, ${RECEIVED_MS} AS received_ms, sealed, seal_methods, seal_event_count, rules_version,
                 territory_seal_version, territory_sealed, territory_seal_reason,
                 territory_claim_units::text[] AS territory_claim_units, territory_claim_resolution
            FROM movement_verifications
           WHERE user_id = ${userId} AND client_session_id = ${clientSessionId}
           FOR UPDATE`);
        if (!mv) throw new GameplayError(404, "session_not_found");
        const [done] = await rows<{ day: number; applied: number; skipped: number; rejected: number; outcome_counts: number[]; rejected_by_reason: Partial<Record<ServerRejectReason, number>> | null }>(tx, sql`
          SELECT day, applied, skipped, rejected, outcome_counts, rejected_by_reason FROM gameplay_applied_sessions WHERE movement_verification_id = ${mv.id}`);
        if (done) {
          const outcomes = emptyOutcomes();
          OUTCOMES.forEach((o, i) => { outcomes[o] = Number(done.outcome_counts[i] ?? 0); });
          return {
            sessionId: clientSessionId, day: Number(done.day), replayed: true,
            applied: done.applied, skipped: done.skipped, rejected: done.rejected,
            outcomes, rejectedByReason: done.rejected_by_reason ?? {},
          };
        }
        if (mv.status !== "verified") throw new GameplayError(409, "session_not_verified");
        const day = dayOf(this.rules, Number(mv.end_time));
        if (day > dayOf(this.rules, now)) throw new GameplayError(409, "session_in_future");
        // Received (by the database's clock) at or after its day's close: late,
        // whatever this instance's clock says. It changes nothing on that day.
        if (!receivedInTime(this.rules, day, Number(mv.received_ms))) throw new GameplayError(409, "day_closed");
        if (seasonOf(this.rules, day) === null) throw new GameplayError(409, "season_not_started");
        // V3 rule 3: no holding is created or changed without the server's own
        // seal of this route under a listed sealing rules version (and, under
        // sealing v2, its own finding that the route enclosed ground). Nothing
        // is written; the route and its verification are untouched.
        const claimCells = mv.territory_claim_units === null ? null : mv.territory_claim_units.map(int8ToCell);
        const unsealed = sealProblem(this.rules, { ...mv, territory_claim_units: claimCells });
        if (unsealed) throw new GameplayError(409, unsealed);
        // 1001: the stored cells, in unit id order. 1002: the canonical path the
        // server derived from the verified fixes, in walk order.
        const source = this.rules.units.source;
        const sessionUnits = source ? await this.sessionPathUnits(tx, mv.id) : [...new Set(mv.traversed_hex_ids ?? [])].sort(byString);
        // D5: a session whose cells are not units under the running rule set
        // (for example resolution 8 cells under resolution 10 units) is refused
        // whole, as is anything that is not a canonical H3 cell (the store's unit).
        if (sessionUnits.some((u) => !isUnitUnder(this.rules.units, u) || !isStorableCell(u))) throw new GameplayError(422, "unit_resolution_mismatch");
        // Sealing v2 claim scope `loop-units`: only the session's units on or
        // inside a qualifying loop claim (the server's claimable cells, at this
        // rule set's unit resolution); the stick and anything across a gap
        // claim nothing. Order (walk order or unit id order) is kept.
        const seal = territorySealOf(this.rules);
        let unitIds = sessionUnits;
        if (seal.rule === "server-enclosed-loop" && seal.claim === "loop-units") {
          if (Number(mv.territory_claim_resolution) !== claimCellOptionsOf(this.rules).resolution) throw new GameplayError(409, "territory_claim_resolution_mismatch");
          const claimable = new Set(claimCells ?? []);
          unitIds = sessionUnits.filter((u) => claimable.has(u));
        }
        if (unitIds.length > this.rules.maxUnitsPerSession) throw new GameplayError(422, "too_many_units");
        const allowance = await this.allowance();
        const [{ n: sourceNo }] = await rows<{ n: number }>(tx, sql`SELECT nextval('gameplay_source_no_seq')::int AS n`) as [{ n: number }];
        const key = `mv:${mv.id}`;
        const events: PushEvent[] = unitIds.map((unitId) => ({ eventId: `${key}:${unitId}`, unitId, walkerId: userId, push: { kind: "solid" }, day }));
        // 1002 orders the session's pushes by walk position and times its
        // day-boundary guard by the server's receipt of the session row.
        const walkOrder = source ? new Map(events.map((e, i) => [e.eventId, i])) : undefined;
        const { result } = await this.applyBatch(tx, events, day, new Map([[key, { sourceNo: Number(sourceNo), applied: false }]]), now, allowance,
          { walkOrder, receivedMs: Number(mv.received_ms) });
        await tx.execute(sql`
          INSERT INTO gameplay_applied_sessions (source_no, movement_verification_id, user_id, day, applied, skipped, rejected, outcome_counts, rejected_by_reason, holding_rules_version)
          VALUES (${Number(sourceNo)}, ${mv.id}, ${userId}, ${day}, ${result.applied}, ${result.skipped}, ${result.rejected},
                  ${arr(OUTCOMES.map((o) => result.outcomes[o]))}::int[],
                  ${Object.keys(result.rejectedByReason).length === 0 ? null : JSON.stringify(result.rejectedByReason)}::jsonb, ${this.rules.holding.rulesVersion})`);
        return { sessionId: clientSessionId, day, replayed: false, ...result };
      }));
    } catch (err) {
      throw this.mapPushError(err);
    }
  }

  /**
   * Apply a batch of pushes, all for one day, in its own transaction. The
   * server-side entry for pushes that do not come from one movement session
   * (for example shade, once D2 exists). Not reachable over HTTP.
   *
   * Every event id must be "<source key>:<unitId>". Each source key is
   * applied once: a later batch under the same key is skipped whole. A key
   * of a movement session ("mv:<id>") is skipped once that session is
   * applied and otherwise refused, so a session is only ever applied by
   * `applySession`.
   */
  async applyPushes(events: readonly PushEvent[]): Promise<BatchResult> {
    // Server batches have no session: their receipt time is now.
    const days = [...new Set(events.map((e) => e.day))];
    if (days.length !== 1) throw new GameplayError(400, "one_day_per_batch");
    const day = days[0]!;
    const now = this.now();
    try {
      return await this.withPartitions(() => this.db.transaction(async (tx) => {
        const allowance = await this.allowance();
        const keys = [...new Set(events.map(sourceKeyOf).filter((k): k is string => k !== null))].sort(byString);
        const sources = new Map<string, Source>();
        const sessionKeys = keys.filter((k) => k.startsWith("mv:"));
        if (sessionKeys.length > 0) {
          for (const r of await rows<{ movement_verification_id: string; source_no: number }>(tx, sql`
            SELECT movement_verification_id, source_no FROM gameplay_applied_sessions
             WHERE movement_verification_id = ANY(${arr(sessionKeys.map((k) => k.slice(3)))}::text[])`)) {
            sources.set(`mv:${r.movement_verification_id}`, { sourceNo: Number(r.source_no), applied: true });
          }
        }
        // A new key's receipt row is written first, so a concurrent batch
        // under the same key waits for this one and then finds it applied.
        const batchKeys = keys.filter((k) => !k.startsWith("mv:"));
        const owned = new Map<string, number>();
        if (batchKeys.length > 0) {
          const hv = this.rules.holding.rulesVersion;
          for (const r of await rows<{ batch_key: string; source_no: number }>(tx, sql`
            INSERT INTO gameplay_applied_sessions (batch_key, day, applied, skipped, rejected, outcome_counts, holding_rules_version)
            SELECT k, ${day}::int, 0, 0, 0, '{0,0,0,0,0,0,0,0}'::int[], ${hv}::int FROM unnest(${arr(batchKeys)}::text[]) WITH ORDINALITY AS t(k, n) ORDER BY n
            ON CONFLICT (batch_key) DO NOTHING RETURNING batch_key, source_no`)) owned.set(r.batch_key, Number(r.source_no));
          for (const k of batchKeys) {
            sources.set(k, owned.has(k) ? { sourceNo: owned.get(k)!, applied: false } : { sourceNo: 0, applied: true });
          }
        }
        const { result, perEvent } = await this.applyBatch(tx, events, day, sources, now, allowance);
        // Each new key's receipt: what its own events did.
        for (const [k, sourceNo] of owned) {
          const mine = emptyResult();
          for (const r of perEvent) if (r.key === k) count(mine, r.result);
          await tx.execute(sql`
            UPDATE gameplay_applied_sessions SET applied = ${mine.applied}, skipped = ${mine.skipped}, rejected = ${mine.rejected},
              outcome_counts = ${arr(OUTCOMES.map((o) => mine.outcomes[o]))}::int[],
              rejected_by_reason = ${Object.keys(mine.rejectedByReason).length === 0 ? null : JSON.stringify(mine.rejectedByReason)}::jsonb
             WHERE source_no = ${sourceNo}`);
        }
        return result;
      }));
    } catch (err) {
      throw this.mapPushError(err);
    }
  }

  /**
   * The units of a session's stored path (1002), in walk order. Fails closed:
   * a session verified without a path (before the path existed, or while
   * gameplay was off) or under another path rule is never guessed at.
   */
  private async sessionPathUnits(tx: Tx, movementId: string): Promise<string[]> {
    const rule = this.rules.units.source!.rule;
    const [path] = await rows<{ path_version: number; resolution: number; unit_ids: string[]; interpolated: string }>(tx, sql`
      SELECT path_version, resolution, unit_ids::text[] AS unit_ids, interpolated::text AS interpolated
        FROM gameplay_session_paths WHERE movement_verification_id = ${movementId}`);
    if (!path) throw new GameplayError(409, "session_path_unavailable");
    if (Number(path.path_version) !== rule.version || Number(path.resolution) !== rule.resolution) throw new GameplayError(409, "session_path_version_mismatch");
    const units = path.unit_ids.map(int8ToCell);
    return pushUnitsOf({ units, interpolated: bitsToFlags(path.interpolated, units.length) }, rule);
  }

  private mapPushError(err: unknown): unknown {
    if (err instanceof GameplayError) return err;
    // The one-push index, or a concurrent writer of the same event id: the
    // whole batch rolled back and a retry will re-read the winner's rows.
    if (pgCode(err) === "23505") return new GameplayError(409, "concurrent_push_retry");
    return err;
  }

  private async applyBatch(
    tx: Tx, events: readonly PushEvent[], day: number, sources: ReadonlyMap<string, Source>, now: number, allowance: Allowance,
    opts: { walkOrder?: ReadonlyMap<string, number>; receivedMs?: number } = {},
  ): Promise<{ result: BatchResult; perEvent: { key: string | null; result: ServerEventResult }[] }> {
    const rules = this.rules;
    const hv = rules.holding.rulesVersion;
    // Pushes share the day; its settlement takes the exclusive lock, so a day
    // is never settled while a push for it is in flight.
    await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(${GAMEPLAY_LOCK_NAMESPACE}::int, ${day}::int)`);
    const [closed] = await rows(tx, sql`SELECT 1 FROM gameplay_day_settlements WHERE day = ${day}`);
    if (closed || day <= lastClosedDay(this.rules, now)) throw new GameplayError(409, "day_closed");
    await this.requirePartitions(tx, day);
    // The day runs under exactly one rule set, pinned by its first write.
    await this.pinDayRules(tx, day);

    const result = emptyResult();
    const perEvent: { key: string | null; result: ServerEventResult }[] = [];
    const record = (key: string | null, r: ServerEventResult) => {
      perEvent.push({ key, result: r });
      count(result, r);
    };
    // Sources first: an event of an applied source is skipped, one with no
    // usable source is the model's invalid event.
    const live: PushEvent[] = [];
    const keyOf = new Map<PushEvent, string>();
    for (const e of events) {
      const key = sourceKeyOf(e);
      const source = key === null ? undefined : sources.get(key);
      if (key === null || !source) {
        record(key, { eventId: String(e.eventId), unitId: String(e.unitId), status: "rejected", reason: "invalid_event", detail: "event id is not <source>:<unit>" });
      } else if (source.applied) {
        record(key, { eventId: e.eventId, unitId: e.unitId, status: "skipped", reason: "already_applied" });
      } else {
        live.push(e);
        keyOf.set(e, key);
      }
    }

    const unitIds = [...new Set(live.map((e) => e.unitId).filter((u) => typeof u === "string" && u.length > 0 && u.length <= 64))].sort(byString);
    if (unitIds.length === 0) {
      // Nothing to lock: the model rejects every event on its own.
      for (const r of applyLedger({ states: new Map(), events: live, rules: this.rules.holding }).results) {
        if (r.status === "rejected") record(null, r);
      }
      return { result, perEvent };
    }
    if (unitIds.some((u) => !isUnitUnder(rules.units, u) || !isStorableCell(u))) throw new GameplayError(422, "unit_resolution_mismatch");
    const unitInts = unitIds.map(cellToInt8);

    // Lock order, the same for every batch so none can deadlock: the day
    // (shared), then walker day rows by player number, then units by unit.
    const walkers = [...new Set(live.map((e) => e.walkerId).filter((w) => typeof w === "string" && w.length > 0))].sort(byString);
    const playerNo = await this.playerNos(tx, walkers);
    const walkerNos = walkers.map((w) => playerNo.get(w)!).sort((a, b) => a - b);
    if (walkerNos.length > 0) {
      await tx.execute(sql`
        INSERT INTO gameplay_walker_days (walker_no, day, holding_rules_version)
        SELECT w, ${day}::int, ${hv}::int FROM unnest(${arr(walkerNos)}::int[]) WITH ORDINALITY AS t(w, n) ORDER BY n
        ON CONFLICT (walker_no, day) DO NOTHING`);
    }
    // The day's take budget is the pinned rule set's (gameplay_day_rules.take_budget);
    // the database checks the take counters against it at commit.
    const counters = walkerNos.length === 0 ? [] : await rows<{ walker_no: number; takes_used: number; units_used: number; visit_units: string[] }>(tx, sql`
      SELECT walker_no, takes_used, units_used, visit_units::text[] AS visit_units FROM gameplay_walker_days
       WHERE day = ${day} AND walker_no = ANY(${arr(walkerNos)}::int[]) ORDER BY walker_no FOR UPDATE`);
    const userOf = new Map([...playerNo].map(([u, n]) => [n, u]));
    const takesUsed = new Map(counters.map((c) => [userOf.get(Number(c.walker_no))!, Number(c.takes_used)]));
    const unitsUsedBefore = new Map(counters.map((c) => [userOf.get(Number(c.walker_no))!, Number(c.units_used)]));
    const visitsBefore = new Map(counters.map((c) => [userOf.get(Number(c.walker_no))!, (c.visit_units ?? []).map(String)]));
    // Server-side unit budget, scaled by the capacity guard; spent once per applied push.
    const unitsRemaining = this.unitBudget === null ? undefined : new Map(walkers.map((w) => {
      const budget = Math.floor(this.unitBudget! * allowance.factor);
      return [w, Math.max(0, budget - (unitsUsedBefore.get(w) ?? 0))] as const;
    }));

    // A unit row must exist to be locked: create the missing ones unheld, as
    // the model's newUnit() would. Sorted, so concurrent batches insert and
    // lock in the same order and cannot deadlock.
    await tx.execute(sql`
      INSERT INTO gameplay_units (unit, as_of_day, holding_rules_version)
      SELECT u, ${day}::int, ${hv}::int FROM unnest(${arr(unitInts)}::bigint[]) WITH ORDINALITY AS t(u, n) ORDER BY n
      ON CONFLICT (unit) DO NOTHING`);
    const locked = await rows<UnitRow & { holding_rules_version: number }>(tx, sql`
      SELECT unit::text AS unit, holder_id, strength, ground, deeded, masked, level, fortified, as_of_day, holding_rules_version
        FROM gameplay_units WHERE unit = ANY(${arr(unitInts)}::bigint[]) ORDER BY unit FOR UPDATE`);
    // No silent migration: held ground written under another rule set is
    // never re-read under this one. Unheld ground carries no rule-dependent
    // state and is adopted.
    if (locked.some((r) => r.holder_id !== null && Number(r.holding_rules_version) !== hv)) throw new GameplayError(409, "unit_rules_version_mismatch");
    // Read after the locks, so pushes committed by a batch we waited for are seen.
    const pushedToday = await rows<{ unit: string; walker_id: string }>(tx, sql`
      SELECT e.unit::text AS unit, p.user_id AS walker_id FROM gameplay_push_events e JOIN gameplay_players p ON p.player_no = e.walker_no
       WHERE e.day = ${day} AND e.unit = ANY(${arr(unitInts)}::bigint[]) AND e.outcome IN (3, 4)
       ORDER BY e.unit, p.user_id`);
    // opened_received_at: the server's receipt time of the push that opened
    // the challenge (never a client clock).
    const challengeRows = await rows<{ unit: string; walker_id: string; first_day: number; opened_ms: number }>(tx, sql`
      SELECT unit::text AS unit, walker_id, first_day, (extract(epoch FROM opened_received_at) * 1000)::float8 AS opened_ms
        FROM gameplay_unit_challenges
       WHERE unit = ANY(${arr(unitInts)}::bigint[]) ORDER BY unit, walker_id`);
    const openedBefore = new Map(challengeRows.map((c) => [challengeKey(int8ToCell(c.unit), c.walker_id), Number(c.opened_ms)]));
    const firstDayBefore = new Map(challengeRows.map((c) => [challengeKey(int8ToCell(c.unit), c.walker_id), Number(c.first_day)]));
    const receivedAt = opts.receivedMs ?? now;

    // 1002's day-boundary guard: when the server received the session that opened each open challenge.
    const takeover = rules.takeover;
    let secondPush: SecondPushInput | undefined;
    if (takeover.name === "two-day-challenge" && takeover.policyVersion === 2) {
      secondPush = {
        minElapsedMs: takeover.secondPush.minElapsedMs,
        windowDays: takeover.windowDays,
        eventReceivedMs: new Map(live.map((e) => [e.eventId, receivedAt])),
        challengeOpenedMs: new Map(openedBefore),
      };
    }

    const pushers = new Map<string, string[]>();
    for (const p of pushedToday) {
      const u = int8ToCell(p.unit);
      pushers.set(u, [...(pushers.get(u) ?? []), p.walker_id]);
    }
    const challenges = new Map<string, { walkerId: string; day: number }[]>();
    for (const c of challengeRows) {
      const u = int8ToCell(c.unit);
      challenges.set(u, [...(challenges.get(u) ?? []), { walkerId: c.walker_id, day: Number(c.first_day) }]);
    }
    const states = new Map<string, UnitState>();
    for (const r of locked) {
      const state = toState(r);
      const walkersToday = pushers.get(state.unitId);
      if (walkersToday && state.asOfDay === day) state.pushedBy = { day, walkerIds: walkersToday };
      const open = challenges.get(state.unitId);
      if (open) state.challenges = open;
      states.set(state.unitId, state);
    }

    const ledger = applyServerLedger({
      states, events: live, holding: rules.holding, takesUsed, budget: rules.takeBudget, unitsRemaining,
      walkOrder: opts.walkOrder, secondPush,
    });
    const keyOfId = new Map(live.map((e) => [e.eventId, keyOf.get(e)!]));
    for (const r of ledger.results) record(keyOfId.get(r.eventId) ?? null, r);
    if (ledger.entries.length === 0) return { result, perEvent };

    // Everyone the rows below name gets a player number.
    const named = ledger.entries.flatMap((e) => [e.previousHolderId, e.newHolderId]).filter((x): x is string => typeof x === "string");
    const touchedHolders = [...ledger.states.values()].map((s) => s.holderId).filter((x): x is string => typeof x === "string");
    for (const [u, n] of await this.playerNos(tx, [...named, ...touchedHolders].filter((x) => !playerNo.has(x)))) playerNo.set(u, n);
    const no = (u: string | null) => (u === null ? null : playerNo.get(u)!);

    const changed = ledger.entries.filter((e) => e.outcome !== "refused_take_budget");
    const touched = [...new Set(changed.map((e) => e.unitId))].sort(byString);
    const next = touched.map((u) => ledger.states.get(u)!);
    if (next.length > 0) {
      const cols = {
        unit: next.map((s) => cellToInt8(s.unitId)),
        holder: next.map((s) => s.holderId),
        holderNo: next.map((s) => no(s.holderId)),
        strength: next.map((s) => s.strength),
        ground: next.map((s) => s.ground),
        shade: next.map((s) => s.ground === "shade"),
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
        FROM unnest(${arr(cols.unit)}::bigint[], ${arr(cols.holder)}::text[], ${arr(cols.strength)}::int[], ${arr(cols.ground)}::text[],
                    ${arr(cols.deeded)}::boolean[], ${arr(cols.masked)}::boolean[], ${arr(cols.level)}::int[], ${arr(cols.fortified)}::boolean[], ${arr(cols.asOf)}::int[])
          AS v(unit, holder_id, strength, ground, deeded, masked, level, fortified, as_of_day)
        WHERE u.unit = v.unit`);
      await tx.execute(sql`
        INSERT INTO gameplay_unit_day_states (unit, day, holder_no, holding_rules_version, strength, level, shade, deeded, masked, fortified)
        SELECT v.unit, v.as_of_day, v.holder_no, ${hv}::int, v.strength, v.level, v.shade, v.deeded, v.masked, v.fortified
          FROM unnest(${arr(cols.unit)}::bigint[], ${arr(cols.holderNo)}::int[], ${arr(cols.strength)}::int[], ${arr(cols.shade)}::boolean[],
                      ${arr(cols.deeded)}::boolean[], ${arr(cols.masked)}::boolean[], ${arr(cols.level)}::int[], ${arr(cols.fortified)}::boolean[], ${arr(cols.asOf)}::int[])
            AS v(unit, holder_no, strength, shade, deeded, masked, level, fortified, as_of_day)
        ON CONFLICT (unit, day) DO UPDATE SET
          holder_no = EXCLUDED.holder_no, strength = EXCLUDED.strength, shade = EXCLUDED.shade, deeded = EXCLUDED.deeded,
          masked = EXCLUDED.masked, level = EXCLUDED.level, fortified = EXCLUDED.fortified, holding_rules_version = EXCLUDED.holding_rules_version`);
      // The touched units' open challenges, replaced as the model left them.
      // A stored receipt time is kept only for a challenge that was already
      // open with the same first day; a new or restarted challenge takes a
      // new receipt time (this batch's server receipt time).
      const openedAt = (unitId: string, walkerId: string, day: number): number => {
        const k = challengeKey(unitId, walkerId);
        if (openedBefore.has(k) && firstDayBefore.get(k) === day) return openedBefore.get(k)!;
        return ledger.challengeOpenedMs.get(k) ?? receivedAt;
      };
      const open = next.flatMap((s) => (s.challenges ?? []).map((c) => ({
        unit: cellToInt8(s.unitId), walkerId: c.walkerId, day: c.day, openedMs: openedAt(s.unitId, c.walkerId, c.day),
      })));
      await writeChallenges(tx, this.challengeWrites, cols.unit, open, hv);
    }

    // Accepted pushes are ledger rows; WITH ORDINALITY … ORDER BY: seq follows the order they were applied.
    const accepted = ledger.entries.filter((e) => ACCEPTED_CODE[e.outcome] !== undefined);
    if (accepted.length > 0) {
      const src = (e: ServerLedgerEntry) => sources.get(keyOfId.get(e.eventId)!)!.sourceNo;
      await tx.execute(sql`
        INSERT INTO gameplay_push_events (unit, day, source_no, walker_no, previous_holder_no, new_holder_no, holding_rules_version,
          strength_before, strength_after, outcome, shade_strength)
        SELECT v.unit, v.day, v.source_no, v.walker_no, v.previous_holder_no, v.new_holder_no, v.rules_version,
               v.strength_before, v.strength_after, v.outcome, v.shade_strength
          FROM unnest(${arr(accepted.map((e) => cellToInt8(e.unitId)))}::bigint[], ${arr(accepted.map((e) => e.day))}::int[], ${arr(accepted.map(src))}::int[],
                      ${arr(accepted.map((e) => no(e.walkerId)))}::int[], ${arr(accepted.map((e) => no(e.previousHolderId)))}::int[], ${arr(accepted.map((e) => no(e.newHolderId)))}::int[],
                      ${arr(accepted.map((e) => e.rulesVersion))}::int[], ${arr(accepted.map((e) => e.strengthBefore))}::int[], ${arr(accepted.map((e) => e.strengthAfter))}::int[],
                      ${arr(accepted.map((e) => ACCEPTED_CODE[e.outcome]!))}::int[], ${arr(accepted.map((e) => e.shadeStrength ?? 0))}::int[])
            WITH ORDINALITY AS v(unit, day, source_no, walker_no, previous_holder_no, new_holder_no, rules_version, strength_before, strength_after, outcome, shade_strength, n)
         ORDER BY v.n`);
    }

    // Refusals change nothing: they are counted on the walker's day row, with
    // the first refused stepped-on unit of each zone kept for day close's visits.
    const zoneOf = zoneOfUnder(rules.units);
    const zoneOrNull = (cell: string) => {
      try {
        return zoneOf(cell);
      } catch {
        return null;
      }
    };
    const refusedBy = new Map<string, Record<RefusedOutcome, number>>();
    const visits = new Map<string, string[]>();
    for (const e of ledger.entries) {
      if (!isRefused(e.outcome)) continue;
      const c = refusedBy.get(e.walkerId) ?? Object.fromEntries(REFUSED_OUTCOMES.map((o) => [o, 0])) as Record<RefusedOutcome, number>;
      c[e.outcome] += 1;
      refusedBy.set(e.walkerId, c);
      if (e.pushKind !== "solid") continue;
      let list = visits.get(e.walkerId);
      if (!list) {
        list = [...(visitsBefore.get(e.walkerId) ?? [])];
        visits.set(e.walkerId, list);
      }
      const zone = zoneOrNull(e.unitId);
      if (zone === null || list.length >= MAX_VISIT_UNITS) continue;
      if (list.some((v) => zoneOrNull(int8ToCell(v)) === zone)) continue;
      list.push(cellToInt8(e.unitId));
    }

    // Day counters, in the same transaction as the pushes they count.
    const usedNow = walkers.filter((w) => (ledger.takesUsed.get(w) ?? 0) !== (takesUsed.get(w) ?? 0)
      || (ledger.unitsUsed.get(w) ?? 0) > 0 || refusedBy.has(w) || visits.has(w));
    if (usedNow.length > 0) {
      const z = (w: string, o: RefusedOutcome) => refusedBy.get(w)?.[o] ?? 0;
      await tx.execute(sql`
        UPDATE gameplay_walker_days d SET
          takes_used = v.takes, units_used = d.units_used + v.units,
          ${sql.raw(REFUSED_OUTCOMES.map((o) => `${REFUSED_COLUMN[o]} = d.${REFUSED_COLUMN[o]} + v.${o}`).join(", "))},
          visit_units = CASE WHEN v.has_visits THEN string_to_array(v.visits, ',')::bigint[] ELSE d.visit_units END
          FROM unnest(${arr(usedNow.map((w) => playerNo.get(w)!))}::int[], ${arr(usedNow.map((w) => ledger.takesUsed.get(w) ?? takesUsed.get(w) ?? 0))}::int[],
                      ${arr(usedNow.map((w) => ledger.unitsUsed.get(w) ?? 0))}::int[],
                      ${arr(usedNow.map((w) => z(w, "refused_deeded")))}::int[], ${arr(usedNow.map((w) => z(w, "refused_masked")))}::int[],
                      ${arr(usedNow.map((w) => z(w, "refused_daily_limit")))}::int[], ${arr(usedNow.map((w) => z(w, "refused_take_budget")))}::int[],
                      ${arr(usedNow.map((w) => visits.has(w)))}::boolean[], ${arr(usedNow.map((w) => (visits.get(w) ?? []).join(",")))}::text[])
            AS v(walker_no, takes, units, refused_deeded, refused_masked, refused_daily_limit, refused_take_budget, has_visits, visits)
         WHERE d.walker_no = v.walker_no AND d.day = ${day}`);
    }
    return { result, perEvent };
  }

  /**
   * Pin the rule set a day runs under, once, by its first write (a push or
   * its settlement). A day already pinned to another version or config
   * fails closed: no push is applied and nothing is settled under a rule set
   * other than the one recorded.
   */
  private async pinDayRules(tx: Tx, day: number): Promise<void> {
    const rules = this.rules;
    const digest = rulesetDigest(rules);
    const season = seasonOf(rules, day);
    if (season === null) throw new GameplayError(409, "season_not_started");
    const [already] = await rows<{ holding_rules_version: number; config_digest: string }>(tx, sql`
      SELECT holding_rules_version, config_digest FROM gameplay_day_rules WHERE day = ${day}`);
    if (already) {
      if (Number(already.holding_rules_version) !== rules.holding.rulesVersion || already.config_digest !== digest) throw new GameplayError(409, "rules_version_mismatch");
      return;
    }
    // A new day: the season keeps one rule set. Serialised per season, so two
    // instances running different rule sets cannot pin two days of one season
    // at once. Taken after the day's lock and before any counter or unit lock,
    // and nothing waits on a day lock while holding it, so it adds no cycle.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${GAMEPLAY_SEASON_LOCK_NAMESPACE}::int, ${season}::int)`);
    const [other] = await rows<{ day: number }>(tx, sql`
      SELECT day FROM gameplay_day_rules
       WHERE season = ${season} AND day <> ${day} AND (holding_rules_version <> ${rules.holding.rulesVersion} OR config_digest <> ${digest})
       ORDER BY day LIMIT 1`);
    if (other) throw new GameplayError(409, "season_rules_changed");
    await tx.execute(sql`
      INSERT INTO gameplay_day_rules (day, season, ruleset, holding_rules_version, takeover_policy, take_budget, unit_zone_rule, config, config_digest)
      VALUES (${day}, ${season}, ${rules.ruleset}, ${rules.holding.rulesVersion}, ${rules.takeover.name}, ${rules.takeBudget?.perWalkerPerDay ?? null},
              ${`${rules.units.zone.kind}/${rules.units.mixedHolderZone}`}, ${JSON.stringify(rulesetConfig(rules))}::jsonb, ${digest})
      ON CONFLICT (day) DO NOTHING`);
    const [pinned] = await rows<{ holding_rules_version: number; config_digest: string }>(tx, sql`
      SELECT holding_rules_version, config_digest FROM gameplay_day_rules WHERE day = ${day}`);
    if (!pinned || Number(pinned.holding_rules_version) !== rules.holding.rulesVersion || pinned.config_digest !== digest) {
      throw new GameplayError(409, "rules_version_mismatch");
    }
  }

  /* ── day close ───────────────────────────────────────────────────────── */

  /**
   * Settle every closed day not yet settled, oldest first, at most
   * `maxDaysPerRun` per call, after making sure today's and the next two
   * days' partitions exist. Run from the API's maintenance loop, so a free
   * instance that slept catches up when it wakes; no paid scheduler.
   */
  async settleDueDays(): Promise<number> {
    // An operator or reconciler halt: settle nothing, quietly (the loop keeps running).
    if ((await this.settlementStatus()).halted) return 0;
    const today = this.today();
    if (today + 2 >= this.rules.seasonOneStartDay) await this.ensurePartitions(Math.max(this.rules.seasonOneStartDay, today), today + 2);
    const last = lastClosedDay(this.rules, this.now());
    if (last < this.rules.seasonOneStartDay) return 0;
    // Every unsettled closed day since season 1 began, including one whose
    // refused header an operator removed so it can be settled again.
    const due = await rows<{ d: number }>(this.db, sql`
      SELECT d FROM generate_series(${this.rules.seasonOneStartDay}::int, ${last}::int) AS d
       WHERE NOT EXISTS (SELECT 1 FROM gameplay_day_settlements s WHERE s.day = d)
       ORDER BY d LIMIT ${this.rules.maxDaysPerRun}`);
    // Oldest first. A day whose close exhausted its retries
    // (SettlementRetryExhaustedError) ends this run with that error; it
    // wrote nothing and stays due, so the next run tries it again first.
    for (const { d } of due) await this.settleDay(Number(d));
    return due.length;
  }

  /**
   * Settle one closed day. Idempotent: a settled (or refused) day is returned
   * as stored. A close aborted by a serialization failure or deadlock is
   * retried under the retry policy (bounded, jittered backoff); when that
   * runs out it fails with SettlementRetryExhaustedError and nothing of the
   * day is written. Any other error is raised at once.
   */
  async settleDay(day: number): Promise<DaySummary> {
    if (!Number.isInteger(day) || day < 0) throw new GameplayError(400, "invalid_day");
    if (day > lastClosedDay(this.rules, this.now())) throw new GameplayError(409, "day_not_closed");
    const season = seasonOf(this.rules, day);
    if (season === null) throw new GameplayError(409, "season_not_started");
    const policy = this.settlementRetry;
    const started = this.retryClock();
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.db.transaction((tx) => this.settleInTx(tx, day, season), { isolationLevel: "serializable" });
      } catch (err) {
        if (!isRetryableContention(err)) throw err;
        const code = pgCode(err)!;
        if (attempt >= policy.maxAttempts) throw new SettlementRetryExhaustedError(day, attempt, code, "attempts");
        const wait = settlementBackoffMs(policy, attempt, this.retryRandom());
        if (this.retryClock() - started + wait > policy.maxTotalMs) throw new SettlementRetryExhaustedError(day, attempt, code, "time");
        await this.retrySleep(wait);
      }
    }
  }

  private async settleInTx(tx: Tx, day: number, season: number): Promise<DaySummary> {
    // The erasure fence, first, before the transaction has a snapshot. LOCK
    // TABLE is not a query, so this SERIALIZABLE transaction's snapshot is
    // taken by the next statement, after the lock is granted. SHARE conflicts
    // with the ROW EXCLUSIVE lock an erasure's UPDATE of the fence takes, and
    // not with another close's SHARE. So an erasure in flight makes this close
    // wait and is then visible in its snapshot, and no erasure can commit
    // until the close ends. A day never settles from inputs an erasure is
    // changing, and the close is not aborted (40001) by each erasure that
    // commits while it waits, as it was when the snapshot was taken before
    // the wait (the 29 Oct erasure benchmark exhausted its retries that way).
    // Fence before the day lock, as an erasure takes the fence before the day
    // locks of its replays.
    await tx.execute(sql`LOCK TABLE gameplay_erasure_fence IN SHARE MODE`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${GAMEPLAY_LOCK_NAMESPACE}::int, ${day}::int)`);
    const existing = await this.daySummary(tx, day);
    if (existing) return { ...existing, created: false };
    // The fence row too, as before; with the table lock held no erasure can
    // have changed it since this snapshot.
    await tx.execute(sql`SELECT 1 FROM gameplay_erasure_fence FOR SHARE`);
    // Halted: nothing is written; the day stays unsettled until a resume.
    if (await this.haltedIn(tx)) throw new GameplayError(503, "settlement_halted");
    // The day's sorts (entries, the session week, the latest unit states) in memory, not on disk.
    await tx.execute(sql.raw(`SET LOCAL work_mem = '${this.settlementWorkMemKb}kB'`));

    // The day settles under the rule set it was pinned to, whatever this
    // instance runs now. A version this build does not know, or whose config
    // differs from the one recorded, fails closed: nothing is written and the
    // day stays unsettled.
    const [already] = await rows(tx, sql`SELECT 1 FROM gameplay_day_rules WHERE day = ${day}`);
    if (!already) await this.pinDayRules(tx, day);
    const rules = await this.pinnedRules(tx, day);
    const { cutoff, entryRows, refusalRows, credits, clubsStatus, clubsProblems, contributions, control, inputDigest } = await this.dayInputs(tx, day, season, rules);
    if (credits.status === "refused") {
      await tx.execute(sql`
        INSERT INTO gameplay_day_settlements (day, season, status, ruleset, economy_rules_version, holding_rules_version, problems, clubs_status, input_digest, receipt_cutoff_at)
        VALUES (${day}, ${season}, 'refused', ${rules.ruleset}, ${rules.economyRulesVersion}, ${rules.holding.rulesVersion},
                ${JSON.stringify(credits.problems)}::jsonb, 'skipped', ${inputDigest}, to_timestamp(${cutoff.closeMs}::float8 / 1000))`);
    } else {
      const b = credits.settlement.books;
      await tx.execute(sql`
        INSERT INTO gameplay_day_settlements (day, season, status, ruleset, economy_rules_version, holding_rules_version,
          pool_micro, minted_micro, credited_micro, toll_paid_micro, toll_received_micro, burned_micro, returned_micro,
          day_share_micro, players, clubs_status, clubs_problems, input_digest, receipt_cutoff_at)
        VALUES (${day}, ${season}, 'settled', ${rules.ruleset}, ${rules.economyRulesVersion}, ${rules.holding.rulesVersion},
          ${b.poolMicro}, ${b.mintedMicro}, ${b.creditedMicro}, ${b.tollPaidMicro}, ${b.tollReceivedMicro}, ${b.burnedMicro},
          ${b.returnedToSeasonPoolMicro}, ${credits.settlement.dayShareMicro}, ${credits.lines.length}, ${clubsStatus},
          ${JSON.stringify(clubsProblems)}::jsonb, ${inputDigest}, to_timestamp(${cutoff.closeMs}::float8 / 1000))`);
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

    // One proof per walker of the day, whatever the books said: counts and the
    // sha256 of their accepted rows (seq order) and refusal counters. Player
    // numbers only; it outlives the raw partitions (retention, owner decision).
    const proofList = proofsOf(entryRows, refusalRows);
    if (proofList.length > 0) {
      await tx.execute(sql`
        INSERT INTO gameplay_player_day_proofs (player_no, day, holding_rules_version, accepted, takes, refused, units_used, events_sha256)
        SELECT v.player_no, ${day}::int, v.hv, v.accepted, v.takes, v.refused, v.units_used, decode(v.sha, 'hex')
          FROM unnest(${arr(proofList.map(([n]) => n))}::int[], ${arr(proofList.map(([, p]) => p.hv))}::int[], ${arr(proofList.map(([, p]) => p.accepted))}::int[],
                      ${arr(proofList.map(([, p]) => p.takes))}::int[], ${arr(proofList.map(([, p]) => p.refused))}::int[], ${arr(proofList.map(([, p]) => p.unitsUsed))}::int[],
                      ${arr(proofList.map(([, p]) => p.sha))}::text[])
            AS v(player_no, hv, accepted, takes, refused, units_used, sha)
        ON CONFLICT (player_no, day) DO NOTHING`);
    }
    const summary = await this.daySummary(tx, day);
    return { ...summary!, created: true };
  }

  /**
   * Replay a closed day against its stored settlement, writing nothing. The
   * inputs are read again exactly as settlement reads them (receipt cutoff
   * included) and their digest compared with the one stored. A match means
   * the closed books still follow from the record. A mismatch fails closed
   * with 409 `closed_day_replay_mismatch`: nothing is rewritten, re-settled
   * or paid, and repairing the day is an operator incident that needs its own
   * authorization. An account erasure after the day changes its inputs and
   * is accepted only through its erasure records (verifyDayIn).
   */
  async verifyDay(day: number): Promise<{ day: number; inputDigest: string }> {
    if (!Number.isInteger(day) || day < 0) throw new GameplayError(400, "invalid_day");
    return this.db.transaction((tx) => this.verifyDayIn(tx, day), { isolationLevel: "repeatable read", accessMode: "read only" });
  }

  /**
   * `verifyDay` inside a caller's transaction. A day an erasure changed
   * (docs/G34_ERASURE_TOMBSTONES.md) is accepted only through its erasure
   * state (gameplay_erasure_days): based on the stored input digest, with a
   * head equal to the digest of the inputs as they are now, every erasure
   * made while the day still verified, and one tombstoned line per counted
   * tombstone.
   * Its stored books and lines (tombstoned lines included) must still pass
   * every invariant, and every stored proof must recompute from the ledger.
   * The fresh-settlement comparison is not possible once a person's inputs
   * are gone, and is not attempted for such a day.
   */
  private async verifyDayIn(tx: Tx, day: number): Promise<{ day: number; inputDigest: string }> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${GAMEPLAY_LOCK_NAMESPACE}::int, ${day}::int)`);
    const [stored] = await rows<{ season: number; input_digest: string; status: "settled" | "refused"; problems: unknown; economy_rules_version: number;
      pool_micro: string; minted_micro: string; credited_micro: string; toll_paid_micro: string; toll_received_micro: string; burned_micro: string;
      returned_micro: string; players: number }>(tx, sql`
      SELECT season, input_digest, status, problems, economy_rules_version, pool_micro::text, minted_micro::text, credited_micro::text,
             toll_paid_micro::text, toll_received_micro::text, burned_micro::text, returned_micro::text, players
        FROM gameplay_day_settlements WHERE day = ${day}`);
    if (!stored) throw new GameplayError(404, "day_not_settled");
    const rules = await this.pinnedRules(tx, day);
    const season = Number(stored.season);
    const { inputDigest, credits, entryRows, refusalRows } = await this.dayInputs(tx, day, season, rules);
    const [erased] = await rows<{ base_digest: string; head_digest: string; tombstones: number; all_pre_verified: boolean }>(tx, sql`
      SELECT base_digest, head_digest, tombstones, all_pre_verified FROM gameplay_erasure_days WHERE day = ${day}`);
    if (erased && (erased.base_digest !== stored.input_digest || erased.all_pre_verified !== true)) throw new GameplayError(409, "closed_day_erasure_invalid");
    const head = erased ? erased.head_digest : stored.input_digest;
    if (inputDigest !== head) throw new GameplayError(409, "closed_day_replay_mismatch");
    if (Number(stored.economy_rules_version) !== rules.economyRulesVersion) throw new GameplayError(409, "closed_day_replay_mismatch");

    // Every stored proof recomputes from the day's ledger and day rows (while
    // its partitions exist; retention may drop them, and then the proof is
    // what remains).
    const [parts] = await rows<{ ok: boolean }>(tx, sql`
      SELECT to_regclass(${`gameplay_partitions.gameplay_push_events_d${day}`}) IS NOT NULL
         AND to_regclass(${`gameplay_partitions.gameplay_walker_days_d${day}`}) IS NOT NULL AS ok`);
    if (parts?.ok) {
      const storedProofs = await rows<{ player_no: number; sha: string }>(tx, sql`
        SELECT player_no, encode(events_sha256, 'hex') AS sha FROM gameplay_player_day_proofs WHERE day = ${day} ORDER BY player_no`);
      const fresh = proofsOf(entryRows, refusalRows).map(([n, p]) => `${n}:${p.sha}`);
      if (JSON.stringify(fresh) !== JSON.stringify(storedProofs.map((p) => `${Number(p.player_no)}:${p.sha}`))) throw new GameplayError(409, "closed_day_proof_mismatch");
    }

    const lineRows = await rows<Record<string, string> & { erased: boolean }>(tx, sql`
      SELECT line_key AS player_id, player_id IS NULL AS erased, earned_micro::text, toll_paid_micro::text, toll_received_micro::text, recharge_micro::text,
             upkeep_taken_micro::text, upkeep_in_condition_micro::text, zones_held::text, net_micro::text
        FROM gameplay_credit_lines WHERE day = ${day} ORDER BY line_key`);
    if (lineRows.filter((l) => l.erased).length !== (erased ? Number(erased.tombstones) : 0)) throw new GameplayError(409, "closed_day_erasure_invalid");

    // The books as STORED, checked on their own (invariants.ts), then
    // against a fresh settlement of the same inputs under the pinned rules.
    if (stored.status === "refused") {
      if (lineRows.length > 0) throw new GameplayError(409, "closed_day_books_invalid");
      if (erased) return { day, inputDigest };
      if (credits.status !== "refused" || JSON.stringify(stored.problems) !== JSON.stringify(credits.problems)) throw new GameplayError(409, "closed_day_replay_mismatch");
      return { day, inputDigest };
    }
    if (!erased && credits.status !== "settled") throw new GameplayError(409, "closed_day_replay_mismatch");
    let books: BooksRow;
    let lines: (LineRow & { zonesHeld: bigint })[];
    try {
      books = {
        pool: exact(stored.pool_micro), minted: exact(stored.minted_micro), credited: exact(stored.credited_micro), tollPaid: exact(stored.toll_paid_micro),
        tollReceived: exact(stored.toll_received_micro), burned: exact(stored.burned_micro), returned: exact(stored.returned_micro), players: exact(String(stored.players)),
      };
      lines = lineRows.map((l) => ({
        playerId: l.player_id!, earned: exact(l.earned_micro), tollPaid: exact(l.toll_paid_micro), tollReceived: exact(l.toll_received_micro),
        recharge: exact(l.recharge_micro), upkeepTaken: exact(l.upkeep_taken_micro), upkeepInCondition: exact(l.upkeep_in_condition_micro),
        zonesHeld: exact(l.zones_held), net: exact(l.net_micro),
      }));
    } catch {
      throw new GameplayError(409, "closed_day_books_invalid");
    }
    if (dayInvariantProblems({ economyRulesVersion: rules.economyRulesVersion, season, books, lines }).length > 0) {
      throw new GameplayError(409, "closed_day_books_invalid");
    }
    if (erased || credits.status !== "settled") return { day, inputDigest };
    const fresh = booksOf(credits);
    const freshLines = linesOf(credits).map((l) => ({ ...l, zonesHeld: 0n }));
    const zones = new Map(credits.lines.map((l) => [l.playerId, BigInt(l.zonesHeld)]));
    for (const l of freshLines) l.zonesHeld = zones.get(l.playerId)!;
    const same = JSON.stringify(stringify(fresh)) === JSON.stringify(stringify(books))
      && JSON.stringify(freshLines.map(stringify)) === JSON.stringify(lines.map(stringify));
    if (!same) throw new GameplayError(409, "closed_day_replay_mismatch");
    return { day, inputDigest };
  }

  /**
   * Re-verify a whole season, read-only: every closed day of it must have a
   * settled header that passes `verifyDay` (input digest, stored invariants
   * and a fresh settlement under its pinned rules). A missing, refused or
   * corrupted day refuses the roll-up, with no totals (fail closed). One
   * economy rules version per season; the rule sets the days are pinned to
   * are reported, never re-read under another.
   */
  async verifySeason(season: number): Promise<
    | { season: number; status: "verified"; days: number; throughDay: number; rulesets: { ruleset: string; economyRulesVersion: number; holdingRulesVersion: number }[];
        poolMicro: string; mintedMicro: string; creditedMicro: string; burnedMicro: string; returnedMicro: string; seasonPoolMicro: string }
    | { season: number; status: "refused"; problems: string[] }
  > {
    if (!Number.isSafeInteger(season) || season < 1) throw new GameplayError(400, "invalid_season");
    let economy;
    try {
      economy = pinnedEconomyRules(this.rules.economyRulesVersion);
    } catch (err) {
      if (err instanceof PinnedRulesError) throw new GameplayError(409, "economy_rules_not_pinned");
      throw err;
    }
    const first = this.rules.seasonOneStartDay + (season - 1) * economy.seasonDays;
    const last = Math.min(first + economy.seasonDays - 1, lastClosedDay(this.rules, this.now()));
    const refuse = (problems: string[]) => ({ season, status: "refused" as const, problems });
    if (last < first) return refuse([`season ${season} has no closed day`]);
    const headers = await rows<{ day: number; status: string; ruleset: string; economy_rules_version: number; holding_rules_version: number;
      pool_micro: string; minted_micro: string; credited_micro: string; burned_micro: string; returned_micro: string }>(this.db, sql`
      SELECT day, status, ruleset, economy_rules_version, holding_rules_version, pool_micro::text, minted_micro::text, credited_micro::text,
             burned_micro::text, returned_micro::text
        FROM gameplay_day_settlements WHERE season = ${season} ORDER BY day`);
    const byDay = new Map(headers.map((h) => [Number(h.day), h]));
    const problems: string[] = [];
    for (const h of headers) {
      const d = Number(h.day);
      if (d < first || d > first + economy.seasonDays - 1) problems.push(`day ${d} is stored in season ${season} but lies outside it`);
    }
    const total = { pool: 0n, minted: 0n, credited: 0n, burned: 0n, returned: 0n };
    for (let d = first; d <= last; d++) {
      const h = byDay.get(d);
      if (!h) {
        problems.push(`day ${d} missing: closed but not settled`);
        continue;
      }
      if (h.status !== "settled") {
        problems.push(`day ${d} refused`);
        continue;
      }
      try {
        await this.verifyDay(d);
      } catch (err) {
        if (err instanceof GameplayError) {
          problems.push(`day ${d}: ${err.code}`);
          continue;
        }
        throw err;
      }
      total.pool += BigInt(h.pool_micro);
      total.minted += BigInt(h.minted_micro);
      total.credited += BigInt(h.credited_micro);
      total.burned += BigInt(h.burned_micro);
      total.returned += BigInt(h.returned_micro);
    }
    const rulesets = [...new Map(headers.filter((h) => byDay.has(Number(h.day)))
      .map((h) => [`${h.ruleset}|${h.economy_rules_version}|${h.holding_rules_version}`,
        { ruleset: h.ruleset, economyRulesVersion: Number(h.economy_rules_version), holdingRulesVersion: Number(h.holding_rules_version) }])).values()];
    if (new Set(rulesets.map((r) => r.economyRulesVersion)).size > 1) problems.push("days under more than one economy rules version");
    const seasonPool = BigInt(seasonPoolMicro(economy, season));
    if (total.minted > seasonPool) problems.push("credits issued exceed the season pool");
    if (total.pool > seasonPool) problems.push("day pools exceed the season pool");
    if (problems.length > 0) return refuse(problems);
    return {
      season, status: "verified", days: last - first + 1, throughDay: last, rulesets,
      poolMicro: String(total.pool), mintedMicro: String(total.minted), creditedMicro: String(total.credited), burnedMicro: String(total.burned),
      returnedMicro: String(total.returned), seasonPoolMicro: String(seasonPool),
    };
  }

  /* ── operator halt (halt-only) ──────────────────────────────────────── */

  private async haltedIn(exec: Exec): Promise<boolean> {
    const [r] = await rows<{ action: string }>(exec, sql`SELECT action FROM gameplay_settlement_halts ORDER BY id DESC LIMIT 1`);
    return r?.action === "halt";
  }

  /** The current halt status: the latest audited halt or resume, if any. */
  async settlementStatus(): Promise<{ halted: boolean; actor: string | null; reason: string | null; day: number | null; sinceMs: number | null }> {
    const [r] = await rows<{ action: string; actor: string; reason: string; day: number | null; at_ms: number }>(this.db, sql`
      SELECT action, actor, reason, day, (extract(epoch FROM created_at) * 1000)::float8 AS at_ms FROM gameplay_settlement_halts ORDER BY id DESC LIMIT 1`);
    if (!r) return { halted: false, actor: null, reason: null, day: null, sinceMs: null };
    return { halted: r.action === "halt", actor: r.actor, reason: r.reason, day: r.day === null ? null : Number(r.day), sinceMs: Number(r.at_ms) };
  }

  /**
   * Halt settlement: no day closes until a resume. Halt-only by design: it
   * stores one audit row and nothing else; it cannot settle, re-settle,
   * repair, credit or override anything, and it does not bypass any other
   * authorization. A day already being settled when the halt commits
   * completes under the normal rules. Halting while halted changes nothing.
   */
  async haltSettlement(input: { actor: string; reason: string; day?: number }): Promise<{ halted: true; changed: boolean }> {
    return { halted: true, changed: await this.recordHalt("halt", input) };
  }

  /**
   * A single operator cannot resume settlement: refused with 403
   * `dual_review_required`. Use `requestResume` and two `approveResume`
   * calls by distinct actors (docs/G34_ERASURE_TOMBSTONES.md, "Resume").
   */
  async resumeSettlement(_input: { actor: string; reason: string }): Promise<never> {
    throw new GameplayError(403, "dual_review_required");
  }

  private async recordHalt(action: "halt", input: { actor: string; reason: string; day?: number }): Promise<boolean> {
    checkActor(input.actor);
    checkReason(input.reason);
    if (input.day !== undefined && !(Number.isSafeInteger(input.day) && input.day >= 0)) throw new GameplayError(400, "invalid_day");
    return this.db.transaction(async (tx) => {
      // One writer at a time, so two operators never interleave halt and resume.
      await tx.execute(sql`LOCK TABLE gameplay_settlement_halts IN SHARE ROW EXCLUSIVE MODE`);
      if (await this.haltedIn(tx)) return false;
      await tx.execute(sql`INSERT INTO gameplay_settlement_halts (action, actor, reason, day) VALUES (${action}, ${input.actor}, ${input.reason}, ${input.day ?? null})`);
      return true;
    });
  }

  /**
   * A fresh reconciliation proof: every stored day header re-verified
   * (`verifyDayIn`: input digest or erasure chain, stored invariants, proofs,
   * and a fresh settlement where no erasure intervened), in one snapshot.
   * Any failing day refuses the proof (409 `resume_proof_failed`, the failing
   * days and codes in `problems`). The sha256 binds the halt it is for.
   */
  private async reconciliationProof(tx: Tx, haltId: number): Promise<{ sha256: string; days: number }> {
    const headers = await rows<{ day: number; status: string }>(tx, sql`SELECT day, status FROM gameplay_day_settlements ORDER BY day`);
    const verified: [number, string, string][] = [];
    const problems: string[] = [];
    for (const h of headers) {
      try {
        const v = await this.verifyDayIn(tx, Number(h.day));
        verified.push([Number(h.day), h.status, v.inputDigest]);
      } catch (err) {
        if (err instanceof GameplayError) problems.push(`day ${h.day}: ${err.code}`);
        else throw err;
      }
    }
    if (problems.length > 0) throw Object.assign(new GameplayError(409, "resume_proof_failed"), { problems });
    return { sha256: digest({ proof: "reconciliation-v1", haltId, days: verified }), days: verified.length };
  }

  private async currentHalt(tx: Tx): Promise<{ id: number; action: string } | null> {
    const [r] = await rows<{ id: string; action: string }>(tx, sql`SELECT id::text AS id, action FROM gameplay_settlement_halts ORDER BY id DESC LIMIT 1`);
    return r ? { id: Number(r.id), action: r.action } : null;
  }

  /**
   * Step 1 of a resume: while halted, run a fresh reconciliation proof of
   * every closed day and record a request carrying its sha256. Writes no
   * resume; refused (409 `resume_proof_failed`) if any day fails, and
   * (409 `not_halted`) when settlement is running.
   */
  async requestResume(input: { actor: string; reason: string }): Promise<{ requestId: number; proofSha256: string; proofDays: number }> {
    checkActor(input.actor);
    checkReason(input.reason);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`LOCK TABLE gameplay_settlement_halts IN SHARE ROW EXCLUSIVE MODE`);
      const halt = await this.currentHalt(tx);
      if (!halt || halt.action !== "halt") throw new GameplayError(409, "not_halted");
      const proof = await this.reconciliationProof(tx, halt.id);
      const [r] = await rows<{ id: string }>(tx, sql`
        INSERT INTO gameplay_resume_requests (halt_id, requested_by, reason, proof_sha256, proof_days)
        VALUES (${halt.id}, ${input.actor}, ${input.reason}, ${proof.sha256}, ${proof.days}) RETURNING id::text AS id`);
      return { requestId: Number(r!.id), proofSha256: proof.sha256, proofDays: proof.days };
    }, { isolationLevel: "repeatable read" });
  }

  /**
   * Step 2: an approval by an actor who is not the requester. It re-runs the
   * reconciliation proof and must get the request's sha256 (409
   * `resume_proof_stale` otherwise: something changed since). The second
   * distinct approval writes the resume row, in the same transaction; the
   * database refuses a resume row without it. Expired (24 h), superseded or
   * used requests are refused with 409 `resume_request_invalid`.
   */
  async approveResume(input: { requestId: number; approver: string }): Promise<{ resumed: boolean; approvals: number }> {
    checkActor(input.approver);
    if (!Number.isSafeInteger(input.requestId) || input.requestId < 1) throw new GameplayError(400, "invalid_request");
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`LOCK TABLE gameplay_settlement_halts IN SHARE ROW EXCLUSIVE MODE`);
      const [req] = await rows<{ halt_id: string; requested_by: string; reason: string; proof_sha256: string; expired: boolean; used: boolean }>(tx, sql`
        SELECT halt_id::text AS halt_id, requested_by, reason, proof_sha256, created_at < now() - interval '24 hours' AS expired,
               EXISTS (SELECT 1 FROM gameplay_settlement_halts h WHERE h.resume_request_id = r.id) AS used
          FROM gameplay_resume_requests r WHERE id = ${input.requestId}`);
      if (!req) throw new GameplayError(404, "resume_request_not_found");
      const halt = await this.currentHalt(tx);
      if (req.used || req.expired || !halt || halt.action !== "halt" || halt.id !== Number(req.halt_id)) throw new GameplayError(409, "resume_request_invalid");
      if (req.requested_by === input.approver) throw new GameplayError(403, "approver_is_requester");
      const [dup] = await rows(tx, sql`SELECT 1 FROM gameplay_resume_approvals WHERE request_id = ${input.requestId} AND approver = ${input.approver}`);
      if (dup) throw new GameplayError(409, "already_approved");
      const proof = await this.reconciliationProof(tx, halt.id);
      if (proof.sha256 !== req.proof_sha256) throw new GameplayError(409, "resume_proof_stale");
      await tx.execute(sql`INSERT INTO gameplay_resume_approvals (request_id, approver, proof_sha256) VALUES (${input.requestId}, ${input.approver}, ${proof.sha256})`);
      const [n] = await rows<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM gameplay_resume_approvals WHERE request_id = ${input.requestId}`);
      const approvals = Number(n!.n);
      if (approvals < 2) return { resumed: false, approvals };
      await tx.execute(sql`
        INSERT INTO gameplay_settlement_halts (action, actor, reason, resume_request_id)
        VALUES ('resume', ${req.requested_by}, ${req.reason}, ${input.requestId})`);
      return { resumed: true, approvals };
    }, { isolationLevel: "repeatable read" });
  }

  /* ── account erasure (docs/G34_ERASURE_TOMBSTONES.md) ───────────────── */

  /**
   * The erasure fence, taken first in the account deletion transaction, before
   * the user row is locked. A day close takes the fence before anything else
   * too, so the two always lock in the same order and cannot deadlock (a close
   * holding the fence and then needing a key-share lock on rows the deletion
   * had already locked was a 40P01 cycle).
   */
  async takeErasureFence(tx: Tx): Promise<void> {
    await tx.execute(sql`UPDATE gameplay_erasure_fence SET erasures = erasures + 1`);
  }

  /**
   * Erasure phase 1, in the account deletion transaction after the user row
   * is locked and before anything is deleted, with the fence already held (no
   * day closes until this transaction ends). It finds the settled days the person's
   * data can reach (from the first day any of it touches), and runs the
   * reconciler's full check on each, so a record can only chain from a day
   * that verified.
   */
  async eraseBegin(tx: Tx, userId: string): Promise<ErasurePlan> {
    const [first] = await rows<{ d: number | null }>(tx, sql`
      SELECT least(
        (SELECT min(day) FROM gameplay_credit_lines WHERE player_id = ${userId}),
        (SELECT min(from_day) FROM gameplay_club_memberships WHERE walker_id = ${userId}),
        (SELECT (floor(min(end_time)::float8 / ${DAY_MS}))::int - 1 FROM movement_verifications WHERE user_id = ${userId}),
        (SELECT min(w.day) FROM gameplay_walker_days w JOIN gameplay_players p ON p.player_no = w.walker_no WHERE p.user_id = ${userId}),
        (SELECT min(e.day) FROM gameplay_push_events e JOIN gameplay_players p ON p.player_no IN (e.walker_no, e.previous_holder_no, e.new_holder_no) WHERE p.user_id = ${userId}),
        (SELECT min(s.day) FROM gameplay_unit_day_states s JOIN gameplay_players p ON p.player_no = s.holder_no WHERE p.user_id = ${userId}),
        (SELECT min(x.day) FROM gameplay_player_day_proofs x JOIN gameplay_players p ON p.player_no = x.player_no WHERE p.user_id = ${userId})
      ) AS d`);
    const plan: ErasurePlan = { userId, days: [] };
    if (first?.d === null || first?.d === undefined) return plan;
    const headers = await rows<{ day: number; season: number; input_digest: string }>(tx, sql`
      SELECT day, season, input_digest FROM gameplay_day_settlements WHERE day >= ${Number(first.d)} ORDER BY day`);
    for (const h of headers) {
      const day = Number(h.day);
      const [state] = await rows<{ head_digest: string }>(tx, sql`SELECT head_digest FROM gameplay_erasure_days WHERE day = ${day}`);
      let verified = true;
      try {
        await this.verifyDayIn(tx, day);
      } catch (err) {
        if (!(err instanceof GameplayError)) throw err;
        verified = false;
      }
      plan.days.push({ day, season: Number(h.season), head: state?.head_digest ?? h.input_digest, verified });
    }
    return plan;
  }

  /**
   * Erasure phase 2, after the person's movement sessions are deleted and
   * before the user row is. Deletes every gameplay row naming them, then, for
   * each settled day whose inputs changed (or that holds their line or names
   * them in a problem), advances that day's single erasure state from the
   * old digest to the new one, replaces their credit line with a random
   * tombstone made for that line alone, and rewrites their id out of the
   * day's problem texts. Nothing per erasure is stored, and the units they
   * held keep only the day of their last change. Nobody else's line, proof
   * or balance is touched. Returns the days advanced.
   */
  async eraseComplete(tx: Tx, plan: ErasurePlan): Promise<number> {
    const u = plan.userId;
    await tx.execute(sql`DELETE FROM gameplay_unit_challenges WHERE walker_id = ${u} OR unit IN (SELECT unit FROM gameplay_units WHERE holder_id = ${u})`);
    await tx.execute(sql`
      UPDATE gameplay_units SET holder_id = NULL, strength = 0, ground = 'solid', level = 1, fortified = false, deeded = false, version = version + 1,
             updated_at = date_trunc('day', updated_at)
       WHERE holder_id = ${u}`);
    await tx.execute(sql`DELETE FROM gameplay_club_memberships WHERE walker_id = ${u}`);
    await tx.execute(sql`DELETE FROM gameplay_applied_sessions WHERE user_id = ${u}`);
    await tx.execute(sql`UPDATE gameplay_clubs SET created_by = NULL WHERE created_by = ${u}`);
    // Cascades the ledger rows they walked, their day rows and proofs; nulls
    // them as previous or new holder (the append-only trigger allows exactly
    // that) and resets the unit day states they held (0011 triggers).
    await tx.execute(sql`DELETE FROM gameplay_players WHERE user_id = ${u}`);

    let written = 0;
    for (const d of plan.days) {
      const rules = await this.pinnedRules(tx, d.day);
      const { inputDigest: post } = await this.dayInputs(tx, d.day, d.season, rules);
      const [line] = await rows(tx, sql`SELECT 1 FROM gameplay_credit_lines WHERE day = ${d.day} AND player_id = ${u}`);
      const [header] = await rows<{ problems: string[]; clubs_problems: string[] }>(tx, sql`
        SELECT problems, clubs_problems FROM gameplay_day_settlements WHERE day = ${d.day}`);
      const named = (list: unknown) => Array.isArray(list) && list.some((p) => typeof p === "string" && p.includes(u));
      const mentions = named(header?.problems) || named(header?.clubs_problems);
      if (post === d.head && !line && !mentions) continue;
      const tomb = line ? 1 : 0;
      // The day's one erasure state advances (the fence serialises erasures);
      // no per-erasure row, so nothing groups this person's days.
      const [advanced] = await rows(tx, sql`
        UPDATE gameplay_erasure_days SET head_digest = ${post}, erasures = erasures + 1, tombstones = tombstones + ${tomb},
               all_pre_verified = all_pre_verified AND ${d.verified}
         WHERE day = ${d.day} AND head_digest = ${d.head} RETURNING day`);
      if (!advanced) {
        await tx.execute(sql`
          INSERT INTO gameplay_erasure_days (day, base_digest, head_digest, erasures, tombstones, all_pre_verified)
          VALUES (${d.day}, ${d.head}, ${post}, 1, ${tomb}, ${d.verified})`);
      }
      const tombstoneId = randomUUID();
      if (line) {
        await tx.execute(sql`UPDATE gameplay_credit_lines SET player_id = NULL, tombstone_id = ${tombstoneId}::uuid WHERE day = ${d.day} AND player_id = ${u}`);
      }
      if (mentions) {
        const scrub = (list: unknown) => JSON.stringify((list as unknown[]).map((p) => (typeof p === "string" ? p.split(u).join(`erased:${tombstoneId}`) : p)));
        await tx.execute(sql`
          UPDATE gameplay_day_settlements SET problems = ${scrub(header!.problems)}::jsonb, clubs_problems = ${scrub(header!.clubs_problems)}::jsonb
           WHERE day = ${d.day}`);
      }
      written += 1;
    }
    return written;
  }

  /**
   * The reconciler's check of a closed day (`verifyDay`); on a replay
   * mismatch or invalid stored books it halts settlement (actor
   * "reconciler", the day recorded) and rethrows. It never repairs the day.
   */
  async verifyDayOrHalt(day: number): Promise<{ day: number; inputDigest: string }> {
    try {
      return await this.verifyDay(day);
    } catch (err) {
      if (err instanceof GameplayError && RECONCILER_HALT_CODES.has(err.code)) {
        await this.haltSettlement({ actor: "reconciler", reason: `${err.code} on day ${day}`, day });
      }
      throw err;
    }
  }

  /** The rule set a pinned day settles under. Unknown or changed fails closed. */
  private async pinnedRules(tx: Tx, day: number): Promise<GameplayRules> {
    const [pinned] = await rows<{ holding_rules_version: number; config_digest: string }>(tx, sql`
      SELECT holding_rules_version, config_digest FROM gameplay_day_rules WHERE day = ${day}`);
    if (!pinned) throw new GameplayError(409, "day_rules_not_pinned");
    let dayRules;
    try {
      dayRules = rulesetFor(Number(pinned.holding_rules_version));
    } catch (err) {
      if (err instanceof UnknownRulesVersionError) throw new GameplayError(409, "unknown_rules_version");
      throw err;
    }
    if (rulesetDigest(dayRules) !== pinned.config_digest) throw new GameplayError(409, "rules_config_mismatch");
    try {
      pinnedEconomyRules(dayRules.economyRulesVersion);
    } catch (err) {
      if (err instanceof PinnedRulesError) throw new GameplayError(409, "economy_rules_not_pinned");
      throw err;
    }
    return { ...dayRules, seasonOneStartDay: this.rules.seasonOneStartDay };
  }

  /**
   * Everything a day's settlement reads and computes, without writing:
   * shared by settlement and by `verifyDay`'s replay, so both see exactly the
   * same inputs and the same digest.
   */
  private async dayInputs(tx: Tx, day: number, season: number, rules: GameplayRules) {
    // Each unit as it stood at the end of its last change on or before the day.
    const stateRows = await rows<{ unit: string; day: number; holder_id: string; strength: number; shade: boolean; deeded: boolean; masked: boolean;
      level: number; fortified: boolean; holding_rules_version: number }>(tx, sql`
      SELECT latest.unit::text AS unit, latest.day, p.user_id AS holder_id, latest.strength, latest.shade, latest.deeded, latest.masked,
             latest.level, latest.fortified, latest.holding_rules_version
        FROM (
          SELECT DISTINCT ON (unit) unit, day, holder_no, strength, shade, deeded, masked, level, fortified, holding_rules_version
            FROM gameplay_unit_day_states WHERE day <= ${day} ORDER BY unit, day DESC
        ) latest JOIN gameplay_players p ON p.player_no = latest.holder_no
       ORDER BY latest.unit`);
    const states = new Map(stateRows.map((r) => {
      const s = toState({ unit: r.unit, holder_id: r.holder_id, strength: r.strength, ground: r.shade ? "shade" : "solid", deeded: r.deeded, masked: r.masked,
        level: r.level, fortified: r.fortified, as_of_day: r.day }, Number(r.day));
      return [s.unitId, s] as const;
    }));
    // No silent migration: held ground recorded under another rule set refuses the day.
    const versionProblems = stateRows
      .filter((r) => Number(r.holding_rules_version) !== rules.holding.rulesVersion)
      .map((r) => `unit ${int8ToCell(r.unit)}: held under holding rules version ${r.holding_rules_version}, settling under ${rules.holding.rulesVersion}`);

    // The day's accepted pushes (the ledger) and its refusals (the walkers' day rows).
    const entryRows = await rows<{
      source_no: number; unit: string; walker_no: number; walker_id: string; previous_holder_no: number | null; previous_holder_id: string | null;
      new_holder_no: number | null; new_holder_id: string | null; outcome: number; strength_before: number; strength_after: number; shade_strength: number;
      holding_rules_version: number;
    }>(tx, sql`
      SELECT e.source_no, e.unit::text AS unit, e.walker_no, w.user_id AS walker_id, e.previous_holder_no, ph.user_id AS previous_holder_id,
             e.new_holder_no, nh.user_id AS new_holder_id, e.outcome, e.strength_before, e.strength_after, e.shade_strength, e.holding_rules_version
        FROM gameplay_push_events e JOIN gameplay_players w ON w.player_no = e.walker_no
        LEFT JOIN gameplay_players ph ON ph.player_no = e.previous_holder_no
        LEFT JOIN gameplay_players nh ON nh.player_no = e.new_holder_no
       WHERE e.day = ${day} ORDER BY e.seq`);
    const refusalRows = await rows<{ walker_no: number; walker_id: string; units_used: number; visit_units: string[]; holding_rules_version: number }
      & Record<RefusedOutcome, number>>(tx, sql`
      SELECT d.walker_no, p.user_id AS walker_id, d.units_used, d.refused_deeded, d.refused_masked, d.refused_daily_limit, d.refused_take_budget,
             d.visit_units::text[] AS visit_units, d.holding_rules_version
        FROM gameplay_walker_days d JOIN gameplay_players p ON p.player_no = d.walker_no
       WHERE d.day = ${day} ORDER BY p.user_id`);
    const accepted: LedgerEntry[] = entryRows.map((e) => ({
      eventId: `${e.source_no}:${int8ToCell(e.unit)}`, unitId: int8ToCell(e.unit), walkerId: e.walker_id, day,
      pushKind: Number(e.shade_strength) > 0 ? "shade" : "solid", outcome: ACCEPTED_OUTCOME[Number(e.outcome)]!,
      previousHolderId: e.previous_holder_id, newHolderId: e.new_holder_id, strengthBefore: Number(e.strength_before),
      strengthAfter: Number(e.strength_after), rulesVersion: Number(e.holding_rules_version),
    }));
    // A refused stepped-on push is still a visit (as the model's own refusals
    // are): one kept unit per zone gives day close the same visits. Budget
    // refusals are not model outcomes, so the club count leaves them out.
    const visitEntries: LedgerEntry[] = refusalRows.flatMap((r) => (r.visit_units ?? []).map((v, i) => ({
      eventId: `visit:${r.walker_no}:${i}`, unitId: int8ToCell(v), walkerId: r.walker_id, day, pushKind: "solid" as const,
      outcome: "refused_daily_limit" as const, previousHolderId: null, newHolderId: null, strengthBefore: 0, strengthAfter: 0,
      rulesVersion: Number(r.holding_rules_version),
    })));
    const refusalEntries: LedgerEntry[] = refusalRows.flatMap((r) => (["refused_deeded", "refused_masked", "refused_daily_limit"] as const)
      .flatMap((o) => Array.from({ length: Number(r[o]) }, (_, i) => ({
        eventId: `${o}:${r.walker_no}:${i}`, unitId: "", walkerId: r.walker_id, day, pushKind: "solid" as const, outcome: o,
        previousHolderId: null, newHolderId: null, strengthBefore: 0, strengthAfter: 0, rulesVersion: Number(r.holding_rules_version),
      }))));

    // Players who moved: verified sessions whose last fix falls on the day (D1),
    // and the week before it for consistency (section 17). A session counts
    // only if the server received it before its own day closed (the receipt
    // cutoff, rules.ts): one that arrived later earns nothing for any day, so
    // the result does not depend on when this runs.
    const cutoff = receiptCutoffOf(rules, day);
    const sessionRows = (await rows<{ id: string; user_id: string; end_time: string; duration_seconds: number | null; distance_meters: number | null;
      traversed_hex_ids: string[] | null; received_ms: number }>(tx, sql`
      SELECT id, user_id, end_time, duration_seconds, distance_meters, traversed_hex_ids, ${RECEIVED_MS} AS received_ms FROM movement_verifications
       WHERE status = 'verified' AND end_time >= ${dayStartMs(rules, day - 6)} AND end_time < ${dayStartMs(rules, day + 1)}
         AND ${RECEIVED_MS} < ${dayCloseMs(rules, day)}::float8
       ORDER BY user_id, end_time, id`))
      .filter((s) => receivedInTime(rules, dayOf(rules, Number(s.end_time)), Number(s.received_ms)));
    // 1002: a session's crossed cells (the toll's input, economy V3 §20) are the
    // stepped units of its stored path, never interpolated ones and never the
    // resolution 8 cells. A session without a path crosses nothing here.
    const steppedBySession = new Map<string, string[]>();
    if (rules.units.source) {
      const ids = sessionRows.filter((s) => dayOf(rules, Number(s.end_time)) === day).map((s) => s.id);
      const paths = ids.length === 0 ? [] : await rows<{ movement_verification_id: string; unit_ids: string[]; interpolated: string }>(tx, sql`
        SELECT movement_verification_id, unit_ids::text[] AS unit_ids, interpolated::text AS interpolated
          FROM gameplay_session_paths WHERE movement_verification_id = ANY(${arr(ids)}::text[])
           AND path_version = ${rules.units.source.rule.version} AND resolution = ${rules.units.source.rule.resolution}
         ORDER BY movement_verification_id`);
      for (const p of paths) {
        const units = p.unit_ids.map(int8ToCell);
        steppedBySession.set(p.movement_verification_id, steppedUnitsOf({ units, interpolated: bitsToFlags(p.interpolated, units.length) }));
      }
    }
    const activeDays = new Map<string, Set<number>>();
    const sessions = new Map<string, CreditsPlayerInput["sessions"][number][]>();
    for (const s of sessionRows) {
      if (s.duration_seconds === null || s.distance_meters === null) continue;
      const d = dayOf(rules, Number(s.end_time));
      activeDays.set(s.user_id, (activeDays.get(s.user_id) ?? new Set()).add(d));
      if (d !== day) continue;
      const list = sessions.get(s.user_id) ?? [];
      sessions.set(s.user_id, list);
      const crossed = rules.units.source ? steppedBySession.get(s.id) ?? [] : s.traversed_hex_ids ?? [];
      list.push({ minutes: s.duration_seconds / 60, meters: s.distance_meters, crossedCells: [...new Set(crossed)].sort(byString) });
    }
    const players: CreditsPlayerInput[] = [...sessions.keys()].sort(byString).map((playerId) => ({
      playerId,
      sessions: sessions.get(playerId)!,
      // Rolling seven days ending on the day (D1 pilot reading of "this week").
      activeDaysThisWeek: Math.min(7, Math.max(1, activeDays.get(playerId)!.size)),
      trustWeight: rules.trustWeight,
      kitLevel: rules.kitLevel,
    }));

    // D5: 1001 makes a unit its own zone; 1002 maps resolution 10 units to
    // their resolution 9 parent, split into one partition per holder (zones.ts).
    const zoneOf = zoneOfUnder(rules.units);
    let partitions: ReturnType<typeof zonePartitions> | null = null;
    const partitionErrors: string[] = [];
    if (rules.units.partition) {
      try {
        partitions = zonePartitions({ day, states, holding: rules.holding, zoneOf, shadeCountsAsHeld: rules.shadeCountsAsHeld });
      } catch (err) {
        partitionErrors.push(`zone partitions: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const holdings = holdingsAtDayClose({
      day, states: partitions ? withPartitionLevels(states, partitions) : states, entries: [...accepted, ...visitEntries], holdingRules: rules.holding, zoneOf,
      shadeCountsAsHeld: rules.shadeCountsAsHeld,
    });
    holdings.problems.push(...versionProblems, ...partitionErrors);
    if (partitions && holdings.problems.length === 0) holdings.problems.push(...partitionProblems({ partitions, holdings }));
    let credits = settleCreditsDay({ rulesVersion: rules.economyRulesVersion, season, day, players, holdings });
    if (partitions && credits.status === "settled") {
      const lineProblems = partitionProblems({ partitions, holdings, lines: credits.lines });
      if (lineProblems.length > 0) credits = { status: "refused", rulesVersion: credits.rulesVersion, season, day, problems: lineProblems };
    }
    // Day-close invariants (invariants.ts), asserted on exactly what would be
    // stored, against the pinned rules: any violation refuses the whole day.
    if (credits.status === "settled") {
      const inv = [
        ...reconcileDay(rules.economyRulesVersion, credits.settlement, { season }),
        ...dayInvariantProblems({ economyRulesVersion: rules.economyRulesVersion, season, books: booksOf(credits), lines: linesOf(credits) }),
      ];
      if (inv.length > 0) credits = { status: "refused", rulesVersion: credits.rulesVersion, season, day, problems: [...new Set(inv)].map((p) => `invariant: ${p}`) };
    }

    const membershipRows = await rows<{ walker_id: string; club_id: string; from_day: number; to_day: number | null }>(tx, sql`
      SELECT walker_id, club_id, from_day, to_day FROM gameplay_club_memberships
       WHERE from_day <= ${day} AND (to_day IS NULL OR to_day > ${day}) ORDER BY walker_id, club_id, from_day`);
    const memberships: Membership[] = membershipRows.map((m) => ({ walkerId: m.walker_id, clubId: m.club_id, fromDay: Number(m.from_day), toDay: m.to_day === null ? null : Number(m.to_day) }));
    const heldIds = [...holdings.states.values()].filter((s) => s.holderId !== null).map((s) => s.unitId);
    const districtRows = heldIds.length === 0 ? [] : await rows<{ unit: string; district_id: string; districts_version: string }>(tx, sql`
      SELECT unit::text AS unit, district_id, districts_version FROM gameplay_unit_districts WHERE unit = ANY(${arr(heldIds.map(cellToInt8))}::bigint[]) ORDER BY unit`);
    const districtOfUnit = new Map(districtRows.map((d) => [int8ToCell(d.unit), d.district_id]));

    let clubsStatus: "settled" | "refused" | "skipped" = "skipped";
    let clubsProblems: string[] = [];
    let contributions: ReturnType<typeof clubContributions> | null = null;
    let control: DistrictControlResult | null = null;
    const snapshot = clubSnapshot(memberships, day);
    if (credits.status === "settled") {
      contributions = clubContributions({ day, entries: [...accepted, ...refusalEntries], snapshot, holdingRulesVersion: rules.holding.rulesVersion });
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
      ruleset: rules.ruleset, economy: rules.economyRulesVersion, holding: rules.holding, config: rulesetDigest(rules), day, season,
      states: stateRows.map((r) => [int8ToCell(r.unit), Number(r.day), r.holder_id, Number(r.strength), r.shade ? "shade" : "solid", r.deeded, r.masked, Number(r.level), r.fortified]),
      entries: accepted.map((e) => [e.eventId, e.outcome, e.walkerId, e.previousHolderId, e.newHolderId]),
      refusals: refusalRows.map((r) => [r.walker_id, ...REFUSED_OUTCOMES.map((o) => Number(r[o])), (r.visit_units ?? []).map(String)]),
      players, memberships, districts: districtRows.map((d) => [int8ToCell(d.unit), d.district_id, d.districts_version]),
      receiptCutoff: cutoff,
    });
    return { cutoff, entryRows, refusalRows, credits, clubsStatus, clubsProblems, contributions, control, inputDigest };
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
      SELECT unit::text AS unit, holder_id, strength, ground, deeded, masked, level, fortified, as_of_day FROM gameplay_units WHERE holder_id = ${userId}`);
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
    // Tombstoned lines (erased players) still count in the books the board
    // re-verifies, under their line key, but never appear as a row.
    const lineRows = dayList.length === 0 ? [] : await rows<{ day: number; player_id: string; erased: boolean; net_micro: string; earned_micro: string; toll_paid_micro: string;
      toll_received_micro: string; recharge_micro: string; upkeep_taken_micro: string; upkeep_in_condition_micro: string; zones_held: number }>(this.db, sql`
      SELECT day, line_key AS player_id, player_id IS NULL AS erased, net_micro, earned_micro, toll_paid_micro, toll_received_micro, recharge_micro, upkeep_taken_micro, upkeep_in_condition_micro, zones_held
        FROM gameplay_credit_lines WHERE day = ANY(${arr(dayList)}::int[]) ORDER BY day, line_key`);
    const erasedKeys = new Set(lineRows.filter((l) => l.erased).map((l) => l.player_id));
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
      // Player rows rebuilt from the stored lines (no per-session split is
      // stored), so the season roll-up can re-verify each day's books and
      // lines instead of trusting the header.
      const players = lines.map((l) => ({
        playerId: l.playerId, scoringSessions: 0, dayPoints: 0, sessionRewardsMicro: [], dayRewardMicro: l.earnedMicro, tollPaidMicro: l.tollPaidMicro,
        tollReceivedMicro: l.tollReceivedMicro, creditedMicro: l.earnedMicro - l.tollPaidMicro - l.rechargeMicro - l.upkeepTakenMicro,
        charges: { rechargeMicro: l.rechargeMicro, upkeepOwedMicro: l.upkeepTakenMicro + l.upkeepPaidInConditionMicro, upkeepTakenMicro: l.upkeepTakenMicro,
          upkeepPaidInConditionMicro: l.upkeepPaidInConditionMicro },
      }));
      const settlement: DaySettlement = {
        totalPoints: 0, dayShareMicro: Number(h.day_share_micro), players,
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
      // An erased player has left the board: their tombstoned lines are not
      // a player, so the remaining rows are ranked again among themselves.
      const kept = new Map(board.rows.filter((r) => !erasedKeys.has(r.id)).map((r) => [r.id, r.score]));
      return { ...base, rows: rankRows(kept).map((r) => ({ rank: r.rank, score: r.score, self: r.id === userId })) };
    }
    const ids = board.rows.map((r) => r.id);
    const names = ids.length === 0 ? [] : await rows<{ club_id: string; name: string }>(this.db, sql`SELECT club_id, name FROM gameplay_clubs WHERE club_id = ANY(${arr(ids)}::text[])`);
    const nameOf = new Map(names.map((n) => [n.club_id, n.name]));
    return { ...base, rows: board.rows.map((r) => ({ rank: r.rank, clubId: r.id, name: nameOf.get(r.id) ?? null, score: r.score })) };
  }
}
