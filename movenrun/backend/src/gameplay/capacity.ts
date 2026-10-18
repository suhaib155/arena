/**
 * Gameplay storage capacity: a projection model and a capacity tripwire
 * (G3/G4 server preparation). PROPOSAL ONLY: nothing imports this from the
 * API, the maintenance loop or the router. Wiring it in is an owner decision
 * listed in docs/G34_STORAGE_CAPACITY.md.
 *
 * Both functions are pure. The per-row byte costs they take are measured by
 * scripts/gameplay-storage-bench.ts on a disposable local PostgreSQL 16 with
 * the proposed migration 0011 applied; the defaults below are those
 * measurements, not guesses, and the bench prints fresh ones whenever the
 * schema changes.
 */

export const MIB = 1024 * 1024;

/** Supabase Free's documented database allowance. The owner must confirm the real figure in the dashboard. */
export const DEFAULT_QUOTA_BYTES = 500 * MIB;

/** Bytes each stored row costs on disk: heap, every index, TOAST and free-space maps, divided by rows. */
export interface RowCosts {
  pushEvent: number;
  unitDayState: number;
  unit: number;
  appliedSession: number;
  creditLine: number;
  daySettlement: number;
  clubDay: number;
  districtDay: number;
  unitDistrict: number;
  /** A movement_verifications row with no traversed cells. */
  movementBase: number;
  /** Each traversed cell kept in movement_verifications.traversed_hex_ids. */
  movementPerCell: number;
  securityAuditEvent: number;
  authSession: number;
  /** A coarse audit proof row per push (event digest, unit, transition), for the retention alternative. */
  coarseProof: number;
  /** A per-player, per-day proof row (event count, digest of event ids and transitions). */
  playerDayProof: number;
  /** gameplay_day_rules: one row per day. */
  dayRules: number;
  /** gameplay_walker_days: one take counter per walker and day pushed. */
  walkerDay: number;
  /** gameplay_unit_challenges: one open challenge (current state, not history). */
  unitChallenge: number;
}

/** What stays in the database for a push once its raw row is gone. */
export type ProofKind = "none" | "per_push" | "per_player_day";

/** How long each data class is kept. `null` keeps it forever (the 0011 behaviour). */
export interface RetentionPolicy {
  /** Raw push ledger rows and applied-session receipts, in days after their day. */
  rawPushDays: number | null;
  /** The in-database proof written for every settled day. */
  proof: ProofKind;
  /** How long proofs are kept, in days after their day. */
  proofDays: number | null;
  /** Superseded unit day states, in days after their day. The latest state of every unit is always kept. */
  snapshotDays: number | null;
  /** Traversed cell lists on verified sessions, in days after the session. The scalars stay. */
  sessionCellDays: number | null;
  /** Routine security audit rows (session_refreshed), in days. */
  routineAuditDays: number | null;
  /**
   * Free space a row-by-row DELETE leaves behind, as a share of what is kept.
   * PostgreSQL reuses freed pages for new rows but does not give them back,
   * so a class under rolling deletes carries this much slack on top of its
   * live rows. It does not accumulate: next cycle's inserts fill it. 0 for
   * dropped partitions.
   */
  deleteBloatFraction: number;
  /** The raw ledger lives in day partitions that are dropped whole: no slack. */
  ledgerPartitioned: boolean;
}

export const KEEP_EVERYTHING: RetentionPolicy = Object.freeze({
  rawPushDays: null,
  proof: "none",
  proofDays: null,
  snapshotDays: null,
  sessionCellDays: null,
  routineAuditDays: null,
  deleteBloatFraction: 0,
  ledgerPartitioned: false,
});

/**
 * A plain TTL on the 0011 tables: raw rows 45 days (a 30-day dispute window
 * plus slack), then a coarse proof per push kept for good; routine audit 30
 * days (the X-25 proposal). Row-by-row deletes.
 */
export const TTL_45_PER_PUSH_PROOF: RetentionPolicy = Object.freeze({
  rawPushDays: 45,
  proof: "per_push",
  proofDays: null,
  snapshotDays: 45,
  sessionCellDays: 45,
  routineAuditDays: 30,
  deleteBloatFraction: 0.15,
  ledgerPartitioned: false,
});

/**
 * The recommendation in docs/G34_STORAGE_CAPACITY.md (a PROPOSAL; nothing
 * deletes anything today): raw ledger 14 days in day partitions that are
 * exported to an owner-held archive and then dropped (no bloat); one proof
 * row per player and day kept for the season plus a 30-day appeal window;
 * superseded snapshots and session cell lists 14 days; routine audit 30 days.
 * Snapshot and cell clean-up are row-level, so they carry slack.
 */
export const PROPOSED_RETENTION: RetentionPolicy = Object.freeze({
  rawPushDays: 14,
  proof: "per_player_day",
  proofDays: 120,
  snapshotDays: 14,
  sessionCellDays: 14,
  routineAuditDays: 30,
  deleteBloatFraction: 0.15,
  ledgerPartitioned: true,
});

/** How long a rotated auth session row lives today: 30-day refresh expiry plus the 7-day prune window. */
export const AUTH_SESSION_LIFETIME_DAYS = 37;

export interface Hostile {
  /** Accounts abusing the push path at once. */
  accounts: number;
  /** Sessions each applies a day (bounded only by the write rate limit today). */
  sessionsPerDay: number;
  /** Units per session (the server cap is 500). */
  unitsPerSession: number;
  /** Days the abuse runs before someone stops it. */
  days: number;
}

export interface LoadProfile {
  players: number;
  /** Share of players who move on a given day. */
  activeShare: number;
  sessionsPerActiveDay: number;
  /** Distinct units one session pushes (measured per resolution and walk). */
  unitsPerSession: number;
  /** New unit day state rows per push: below 1 when several pushes hit one unit on one day. */
  dayStatesPerPush: number;
  /** Rows in gameplay_units: every unit ever pushed, bounded by the play area. */
  distinctUnits: number;
  /** Rows in the district map (every unit of the play area). */
  districtMapUnits: number;
  /** Open challenges at any time (two-day-challenge rule sets; 0 otherwise): current state, not history. */
  openChallenges: number;
  /** Take-counter rows per active player-day (1 when every active walker pushes). */
  walkerDaysPerActiveDay: number;
  clubs: number;
  districts: number;
  /** Routine audit rows per active player-day (one per token refresh). */
  auditRowsPerActiveDay: number;
  /** Days of play (90 per season). */
  days: number;
  hostile?: Hostile;
}

export interface Projection {
  /** Bytes by data class. */
  byClass: Record<string, number>;
  gameplayBytes: number;
  totalBytes: number;
  quotaFraction: number;
}

/** Rows of a class produced at `perDay` that are still stored after `days` with a TTL of `ttl` days. */
function retained(perDay: number, days: number, ttl: number | null): number {
  return perDay * (ttl === null ? days : Math.min(days, ttl));
}

/**
 * Projected database size after `load.days` days of play under `policy`.
 * `baselineBytes` is everything that is not gameplay (today's live database).
 */
export function projectStorage(
  load: LoadProfile,
  costs: RowCosts,
  policy: RetentionPolicy = KEEP_EVERYTHING,
  baselineBytes = 0,
  quotaBytes = DEFAULT_QUOTA_BYTES,
): Projection {
  const days = load.days;
  const sessionsPerDay = load.players * load.activeShare * load.sessionsPerActiveDay;
  const pushesPerDay = sessionsPerDay * load.unitsPerSession;
  const h = load.hostile;
  const hostileDays = h ? Math.min(h.days, days) : 0;
  const hostileSessions = h ? h.accounts * h.sessionsPerDay * hostileDays : 0;
  const hostilePushes = h ? hostileSessions * h.unitsPerSession : 0;

  const totalPushes = pushesPerDay * days + hostilePushes;
  const rawPushRows = retained(pushesPerDay, days, policy.rawPushDays)
    + (policy.rawPushDays === null || hostileDays <= policy.rawPushDays ? hostilePushes : 0);
  const activePerDay = load.players * load.activeShare + (h && hostileDays > 0 ? h.accounts : 0);
  const proofRows = policy.proof === "per_push"
    ? Math.max(0, Math.min(totalPushes, retained(pushesPerDay, days, policy.proofDays) + hostilePushes) - rawPushRows)
    : 0;
  const playerDayProofRows = policy.proof === "per_player_day" ? retained(activePerDay, days, policy.proofDays) : 0;
  const appliedRows = retained(load.players * load.activeShare * load.sessionsPerActiveDay, days, policy.rawPushDays)
    + (policy.rawPushDays === null || hostileDays <= policy.rawPushDays ? hostileSessions : 0);

  // Superseded snapshots age out; the latest per unit stays (at most one per unit).
  const dayStatesPerDay = pushesPerDay * load.dayStatesPerPush;
  const hostileDayStates = hostilePushes * load.dayStatesPerPush;
  const dayStateRows = policy.snapshotDays === null
    ? dayStatesPerDay * days + hostileDayStates
    : Math.min(dayStatesPerDay * days + hostileDayStates, retained(dayStatesPerDay, days, policy.snapshotDays) + load.distinctUnits);

  const sessionRows = sessionsPerDay * days + hostileSessions;
  const cellsKept = retained(pushesPerDay, days, policy.sessionCellDays)
    + (policy.sessionCellDays === null || hostileDays <= policy.sessionCellDays ? hostilePushes : 0);

  const activePlayerDays = load.players * load.activeShare * days;
  // Take counters matter only for their own day; they follow the raw ledger's TTL.
  const walkerDaysProduced = activePlayerDays * load.walkerDaysPerActiveDay + (h ? h.accounts * hostileDays : 0);
  const walkerDayRows = policy.rawPushDays === null ? walkerDaysProduced
    : Math.min(walkerDaysProduced, retained(load.players * load.activeShare * load.walkerDaysPerActiveDay, days, policy.rawPushDays) + (h && hostileDays <= policy.rawPushDays ? h.accounts * hostileDays : 0));
  const refreshesPerDay = load.players * load.activeShare * load.auditRowsPerActiveDay;
  const auditRows = retained(refreshesPerDay, days, policy.routineAuditDays);
  // Rotated auth sessions are already pruned 7 days after their 30-day expiry (0000-0010 behaviour).
  const authSessionRows = retained(refreshesPerDay, days, AUTH_SESSION_LIFETIME_DAYS);

  // Slack left by rolling deletes: a share of the kept bytes, only for classes that delete.
  const slack = (stored: number, produced: number, cost: number) => (produced > stored ? policy.deleteBloatFraction * stored * cost : 0);
  const byClass: Record<string, number> = {
    push_ledger: rawPushRows * costs.pushEvent + (policy.ledgerPartitioned ? 0 : slack(rawPushRows, totalPushes, costs.pushEvent)),
    proofs: proofRows * costs.coarseProof + playerDayProofRows * costs.playerDayProof,
    unit_day_states: dayStateRows * costs.unitDayState
      + slack(dayStateRows, dayStatesPerDay * days + hostileDayStates, costs.unitDayState),
    units: load.distinctUnits * costs.unit,
    applied_sessions: appliedRows * costs.appliedSession + slack(appliedRows, sessionRows, costs.appliedSession),
    movement_sessions: sessionRows * costs.movementBase + cellsKept * costs.movementPerCell
      + slack(cellsKept, totalPushes, costs.movementPerCell),
    settlements: days * (costs.daySettlement + costs.dayRules) + activePlayerDays * costs.creditLine
      + days * (load.clubs * costs.clubDay + load.districts * costs.districtDay),
    take_counters: walkerDayRows * costs.walkerDay + slack(walkerDayRows, walkerDaysProduced, costs.walkerDay),
    challenges: load.openChallenges * costs.unitChallenge,
    district_map: load.districtMapUnits * costs.unitDistrict,
    auth_audit: auditRows * costs.securityAuditEvent + slack(auditRows, refreshesPerDay * days, costs.securityAuditEvent)
      + authSessionRows * costs.authSession * (1 + (days > AUTH_SESSION_LIFETIME_DAYS ? policy.deleteBloatFraction : 0)),
  };
  const gameplayBytes = Object.entries(byClass).filter(([k]) => k !== "auth_audit").reduce((a, [, v]) => a + v, 0);
  const totalBytes = baselineBytes + Object.values(byClass).reduce((a, v) => a + v, 0);
  return { byClass, gameplayBytes, totalBytes, quotaFraction: totalBytes / quotaBytes };
}

/* ── capacity tripwire ─────────────────────────────────────────────────── */

export type CapacityLevel = "ok" | "warn" | "backpressure" | "hard_stop";

export interface CapacityThresholds {
  quotaBytes: number;
  /** Alert the owner. */
  warnFraction: number;
  /** Shed optional writes and shrink per-player push budgets. */
  backpressureFraction: number;
  /** Stop accepting pushes; settlement, erasure and reads continue. */
  hardStopFraction: number;
  /** Escalate one level when the next threshold is closer than this many days at the current growth. */
  warnDaysAhead: number;
  /**
   * Bytes held back below the hard stop for the writes that must never be
   * refused: settling the days already played, account erasure, and
   * retention deletes. Measured: about 14 days of settlement at the pilot
   * size plus a margin.
   */
  reserveBytes: number;
}

export const DEFAULT_THRESHOLDS: CapacityThresholds = Object.freeze({
  quotaBytes: DEFAULT_QUOTA_BYTES,
  warnFraction: 0.6,
  backpressureFraction: 0.75,
  hardStopFraction: 0.85,
  warnDaysAhead: 14,
  reserveBytes: 25 * MIB,
});

export interface CapacityInput {
  /** pg_database_size(current_database()), read by the server. */
  usedBytes: number;
  /** Growth over the last day (or a trailing average), bytes per day. */
  dailyGrowthBytes: number;
  thresholds?: CapacityThresholds;
}

export interface CapacityDecision {
  level: CapacityLevel;
  usedFraction: number;
  /** Days until the hard stop at the current growth; null when not growing. */
  daysToHardStop: number | null;
  /** Whether the push path (applySession) may write. */
  acceptPushes: boolean;
  /** Multiplier for each player's daily unit budget: 1 normal, below 1 under backpressure, 0 at the hard stop. */
  pushBudgetFactor: number;
  reasons: string[];
}

const ORDER: readonly CapacityLevel[] = ["ok", "warn", "backpressure", "hard_stop"];
const raise = (a: CapacityLevel, b: CapacityLevel): CapacityLevel => (ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b);

function validThresholds(t: CapacityThresholds): boolean {
  return Number.isFinite(t.quotaBytes) && t.quotaBytes > 0
    && t.warnFraction > 0 && t.warnFraction < t.backpressureFraction
    && t.backpressureFraction < t.hardStopFraction && t.hardStopFraction <= 1
    && t.warnDaysAhead >= 0 && t.reserveBytes >= 0 && t.reserveBytes < t.quotaBytes;
}

/**
 * Where the database stands against its quota, and what the push path should
 * do about it. Fails closed: an unreadable size or a bad configuration is a
 * hard stop, never "ok".
 */
export function capacityTripwire(input: CapacityInput): CapacityDecision {
  const t = input.thresholds ?? DEFAULT_THRESHOLDS;
  if (!validThresholds(t)) {
    return { level: "hard_stop", usedFraction: NaN, daysToHardStop: null, acceptPushes: false, pushBudgetFactor: 0, reasons: ["invalid_thresholds"] };
  }
  const used = input.usedBytes;
  if (!Number.isFinite(used) || used < 0) {
    return { level: "hard_stop", usedFraction: NaN, daysToHardStop: null, acceptPushes: false, pushBudgetFactor: 0, reasons: ["size_unreadable"] };
  }
  const growth = Number.isFinite(input.dailyGrowthBytes) ? Math.max(0, input.dailyGrowthBytes) : 0;
  const hardStopAt = Math.min(t.hardStopFraction * t.quotaBytes, t.quotaBytes - t.reserveBytes);
  const at = { warn: t.warnFraction * t.quotaBytes, backpressure: t.backpressureFraction * t.quotaBytes, hard_stop: hardStopAt };
  const usedFraction = used / t.quotaBytes;
  const reasons: string[] = [];

  let level: CapacityLevel = "ok";
  if (used >= at.hard_stop) {
    level = "hard_stop";
    reasons.push("over_hard_stop");
  } else if (used >= at.backpressure) {
    level = "backpressure";
    reasons.push("over_backpressure");
  } else if (used >= at.warn) {
    level = "warn";
    reasons.push("over_warn");
  }
  if (!Number.isFinite(input.dailyGrowthBytes)) reasons.push("growth_unknown");

  const daysTo = (bytes: number) => (growth > 0 ? Math.max(0, (bytes - used) / growth) : null);
  const daysToHardStop = level === "hard_stop" ? 0 : daysTo(at.hard_stop);
  // Escalate one step when the next line is near at today's growth.
  if (level === "ok") {
    const d = daysTo(at.warn);
    if (d !== null && d < t.warnDaysAhead) { level = "warn"; reasons.push("warn_within_days"); }
  } else if (level === "warn") {
    const d = daysTo(at.backpressure);
    if (d !== null && d < t.warnDaysAhead) { level = raise(level, "backpressure"); reasons.push("backpressure_within_days"); }
  } else if (level === "backpressure") {
    const d = daysTo(at.hard_stop);
    if (d !== null && d < t.warnDaysAhead / 2) { level = "hard_stop"; reasons.push("hard_stop_within_days"); }
  }

  let pushBudgetFactor = 1;
  if (level === "backpressure") {
    // Linear from 1 at the backpressure line to 0.25 at the hard stop.
    const span = at.hard_stop - at.backpressure;
    const into = span > 0 ? Math.min(1, Math.max(0, (used - at.backpressure) / span)) : 1;
    pushBudgetFactor = 1 - 0.75 * into;
  }
  if (level === "hard_stop") pushBudgetFactor = 0;
  return { level, usedFraction, daysToHardStop, acceptPushes: level !== "hard_stop", pushBudgetFactor, reasons };
}

/**
 * Units a player may still push today: the base daily budget scaled by the
 * tripwire, minus what they already pushed. Never negative. PROPOSAL: no such
 * budget exists in 0011 or the service today.
 */
export function remainingPushBudget(baseUnitsPerDay: number, pushedToday: number, decision: Pick<CapacityDecision, "pushBudgetFactor" | "acceptPushes">): number {
  if (!decision.acceptPushes || !(baseUnitsPerDay > 0)) return 0;
  const budget = Math.floor(baseUnitsPerDay * decision.pushBudgetFactor);
  return Math.max(0, budget - Math.max(0, Math.floor(pushedToday)));
}
