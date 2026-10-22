/**
 * B5 pilot cost-driver calculator. Pure and deterministic: same params file, same output bytes.
 *
 * Every number in the params file carries a tier: MEASURED (from the local B5 bench or the cited bench
 * report), PROJECTED (computed here from other numbers) or ASSUMED (a stated assumption, not an
 * observation). Nothing in this file is a hosted measurement.
 */
import { readFileSync } from "node:fs";

export const MIB = 1024 * 1024;

export interface RuleParams {
  label: string;
  resolution: number;
  unitsPerSession: number;
  /** Accepted (ledger) rows per verified session. Refusals are counters, not rows (0011 rev 3). */
  acceptedRowsPerSession: number;
  /** Challenge row versions (insert + delete counted as 1 version each way) written per accepted ledger row. 0 for rule 1001 (immediate flip, no challenges). */
  challengeVersionsPerAcceptedRow: number;
  liveChallengesPerPlayer: number;
  distinctUnitsPerPlayer: number;
  /** Share of accepted rows that rewrite a gameplay_units row. */
  unitUpdatesPerAcceptedRow: number;
  dayStatesPerAcceptedRow: number;
}

export interface Params {
  version: string;
  quota: { nominalMiB: number; operationalReservePct: number; baselineMiB: number };
  grid: { users: number[]; lifetimes: Record<string, number>; abusePct: number[] };
  activity: { activeShare: number; sessionsPerActiveDay: number };
  rules: Record<string, RuleParams>;
  /** bytes per row, split heap / index. */
  rowBytes: Record<string, { heap: number; index: number }>;
  movement: { baseBytes: number; bytesPerCell: number; cellsPerSession: number };
  perDay: { settlementRowBytes: number; dayRulesBytes: number; clubDayBytes: number; districtDayBytes: number; clubsPerPlayer: number; districtsPerDay: number; partitionDayBytes: number };
  retention: Record<string, { rawDays: number | null; proofDays: number | null; summaryDays: number | null }>;
  abuse: { sessionsPerDay: number; unitsPerSession: number; unitBudget: number; acceptedRowsPerAccountDay: number; activeDays: number };
  churn: { tupleBytes: Record<string, number>; indexBytesPerVersion: Record<string, number>; burstShare: { default: number; aggressive: number }; indexBloatFactor: number };
  wal: { bytesPerAcceptedRow: number; bytesPerSession: number; bytesPerChallengeVersion: number; retainedDays: number };
  settlement: { bytesPerEntry: number; workMemMiB: number; msPerThousandEntries: number; sortsPerSettlement: number; maxDaysPerRun: number };
  [k: string]: unknown;
}

export function loadParams(path: string): Params {
  return JSON.parse(readFileSync(path, "utf8")) as Params;
}

export interface Row {
  rule: string; users: number; lifetime: string; days: number; abusePct: number; retention: string;
  accepted_rows_per_day: number;
  table_bytes: number; index_bytes: number;
  bloat_default_bytes: number; bloat_aggressive_bytes: number;
  total_default_bytes: number; total_aggressive_bytes: number;
  wal_per_day_bytes: number; wal_headroom_bytes: number; settlement_temp_bytes: number;
  usable_quota_bytes: number; pct_of_usable_default: number; pct_of_usable_aggressive: number;
  pct_of_nominal_default: number;
  fits_usable_default: 0 | 1;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** One scenario. Day-by-day loop would be exact but every term here is linear in days kept, so closed forms are used. */
export function project(p: Params, rule: string, users: number, lifetime: string, days: number, abusePct: number, retention: string): Row {
  const r = p.rules[rule];
  const ret = p.retention[retention];
  const rb = p.rowBytes;
  const active = users * p.activity.activeShare;
  const sessionsPerDay = active * p.activity.sessionsPerActiveDay;
  const hostileAccounts = users * (abusePct / 100);
  const hostileDays = Math.min(days, p.abuse.activeDays);
  const hostileRowsPerDay = hostileAccounts * p.abuse.acceptedRowsPerAccountDay;
  const hostileSessionsPerDay = hostileAccounts * p.abuse.sessionsPerDay;

  const normalRows = sessionsPerDay * r.acceptedRowsPerSession;
  const rowsPerDay = normalRows; // steady normal load
  const clip = (keep: number | null, d = days) => (keep === null ? d : Math.min(d, keep));
  const rawDays = clip(ret.rawDays);
  const proofDays = clip(ret.proofDays);
  const summaryDays = clip(ret.summaryDays);
  // Abuse is placed in the most recent hostileDays, so a window of w days contains min(w, hostileDays) of them.
  const hostileInWin = (w: number) => Math.min(w, hostileDays);

  const cost = (k: string) => rb[k];
  const acc = { table: 0, index: 0 };
  const add = (rows: number, k: string) => { acc.table += rows * cost(k).heap; acc.index += rows * cost(k).index; };

  const ledgerRows = rowsPerDay * rawDays + hostileRowsPerDay * hostileInWin(rawDays);
  add(ledgerRows, "pushEvent");
  const walkerDays = active * rawDays + hostileAccounts * hostileInWin(rawDays);
  add(walkerDays, "walkerDay");
  const sessionsRaw = sessionsPerDay * rawDays + hostileSessionsPerDay * hostileInWin(rawDays);
  add(sessionsRaw, "appliedSession");
  if (rule === "1002") add(sessionsRaw, "sessionPath");
  // movement_verifications: summary row for summaryDays, route cells only within the raw window
  const sessionsSummary = sessionsPerDay * summaryDays + hostileSessionsPerDay * hostileInWin(summaryDays);
  acc.table += sessionsSummary * p.movement.baseBytes;
  acc.table += sessionsRaw * p.movement.bytesPerCell * p.movement.cellsPerSession;
  // day states: all kept, or after compaction only the latest per unit (plus the raw window)
  const distinctUnits = Math.min(users * r.distinctUnitsPerPlayer, users * r.distinctUnitsPerPlayer * (1 - Math.exp(-days / 30)));
  const dayStatesAll = ledgerRows === 0 ? 0 : (rowsPerDay * days + hostileRowsPerDay * hostileDays) * r.dayStatesPerAcceptedRow;
  const dayStates = ret.rawDays === null ? dayStatesAll : Math.min(dayStatesAll, distinctUnits + (rowsPerDay * rawDays) * r.dayStatesPerAcceptedRow);
  add(dayStates, "unitDayState");
  add(distinctUnits, "unit");
  add(users * r.liveChallengesPerPlayer, "unitChallenge");
  // proofs and credit lines
  add(active * proofDays + hostileAccounts * hostileInWin(proofDays), "playerDayProof");
  add(active * days, "creditLine");
  // per-day fixed rows
  const clubs = users * p.perDay.clubsPerPlayer;
  acc.table += days * (p.perDay.settlementRowBytes + p.perDay.dayRulesBytes + clubs * p.perDay.clubDayBytes + p.perDay.districtsPerDay * p.perDay.districtDayBytes);
  acc.table += rawDays * p.perDay.partitionDayBytes;
  add(users, "player");

  // dead-tuple bloat: high-water mark of dead versions between vacuum passes; never returned without VACUUM FULL
  const totalRowsPerDay = rowsPerDay + hostileRowsPerDay * (hostileDays > 0 ? 1 : 0);
  const chVersionsPerDay = totalRowsPerDay * r.challengeVersionsPerAcceptedRow;
  const unitUpdatesPerDay = totalRowsPerDay * r.unitUpdatesPerAcceptedRow;
  const bloat = (share: number) => {
    const ch = chVersionsPerDay * share * (p.churn.tupleBytes.unitChallenge + p.churn.indexBytesPerVersion.unitChallenge * p.churn.indexBloatFactor);
    const un = unitUpdatesPerDay * share * (p.churn.tupleBytes.unit + p.churn.indexBytesPerVersion.unit * p.churn.indexBloatFactor);
    return ch + un;
  };
  const bloatDefault = bloat(p.churn.burstShare.default);
  const bloatAggr = bloat(p.churn.burstShare.aggressive);

  const baseline = p.quota.baselineMiB * MIB;
  const base = acc.table + acc.index + baseline;
  const nominal = p.quota.nominalMiB * MIB;
  const usable = nominal * (1 - p.quota.operationalReservePct / 100);

  const walPerDay = totalRowsPerDay * p.wal.bytesPerAcceptedRow + (sessionsPerDay + hostileSessionsPerDay) * p.wal.bytesPerSession + chVersionsPerDay * p.wal.bytesPerChallengeVersion;
  // settlement: the day's entries are sorted; a sort larger than work_mem spills to temp
  const entries = totalRowsPerDay;
  const sortBytes = entries * p.settlement.bytesPerEntry;
  const temp = sortBytes > p.settlement.workMemMiB * MIB ? sortBytes * p.settlement.sortsPerSettlement : 0;

  const totD = base + bloatDefault;
  const totA = base + bloatAggr;
  return {
    rule, users, lifetime, days, abusePct, retention,
    accepted_rows_per_day: Math.round(rowsPerDay),
    table_bytes: Math.round(acc.table), index_bytes: Math.round(acc.index),
    bloat_default_bytes: Math.round(bloatDefault), bloat_aggressive_bytes: Math.round(bloatAggr),
    total_default_bytes: Math.round(totD), total_aggressive_bytes: Math.round(totA),
    wal_per_day_bytes: Math.round(walPerDay), wal_headroom_bytes: Math.round(walPerDay * p.wal.retainedDays), settlement_temp_bytes: Math.round(temp),
    usable_quota_bytes: Math.round(usable),
    pct_of_usable_default: round3(totD / usable * 100), pct_of_usable_aggressive: round3(totA / usable * 100),
    pct_of_nominal_default: round3(totD / nominal * 100),
    fits_usable_default: totD <= usable ? 1 : 0,
  };
}
const round3 = (x: number) => Math.round(x * 1000) / 1000;

export function grid(p: Params): Row[] {
  const rows: Row[] = [];
  for (const rule of Object.keys(p.rules)) for (const retention of Object.keys(p.retention))
    for (const users of p.grid.users) for (const [lt, days] of Object.entries(p.grid.lifetimes)) for (const ab of p.grid.abusePct)
      rows.push(project(p, rule, users, lt, days, ab, retention));
  return rows;
}

export function toCsv(rows: Row[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]) as (keyof Row)[];
  return [cols.join(","), ...rows.map((r) => cols.map((c) => String(r[c])).join(","))].join("\n") + "\n";
}

export interface BacklogRow { rule: string; users: number; sleepDays: number; runs_needed: number; days_per_run: number; settle_seconds_per_run: number; settle_seconds_total: number; entries_per_day: number; temp_bytes_per_settlement: number; wal_bytes_total: number }

/**
 * A sleeping instance (Render Free spins down after idle; the exact idle limit and cold-start time are
 * ASSUMED and must be checked on the provider's page) misses day closes. On wake, settlement catches up
 * at most maxDaysPerRun days per run (backend/src/gameplay/rules.ts), so backlog beyond that needs more runs.
 */
export function backlog(p: Params, rule: string, users: number, sleepDays: number): BacklogRow {
  const r = p.rules[rule];
  const active = users * p.activity.activeShare;
  const entries = active * p.activity.sessionsPerActiveDay * r.acceptedRowsPerSession;
  const msPerDay = (entries / 1000) * p.settlement.msPerThousandEntries;
  const perRun = Math.min(sleepDays, p.settlement.maxDaysPerRun);
  const sortBytes = entries * p.settlement.bytesPerEntry;
  return {
    rule, users, sleepDays, runs_needed: Math.ceil(sleepDays / p.settlement.maxDaysPerRun), days_per_run: perRun,
    settle_seconds_per_run: round3(perRun * msPerDay / 1000), settle_seconds_total: round3(sleepDays * msPerDay / 1000),
    entries_per_day: Math.round(entries),
    temp_bytes_per_settlement: sortBytes > p.settlement.workMemMiB * MIB ? Math.round(sortBytes * p.settlement.sortsPerSettlement) : 0,
    wal_bytes_total: Math.round(sleepDays * (entries * (p.wal.bytesPerAcceptedRow + r.challengeVersionsPerAcceptedRow * p.wal.bytesPerChallengeVersion))),
  };
}

export function backlogGrid(p: Params, sleepDays = [1, 3, 7, 14, 31, 45]): BacklogRow[] {
  const out: BacklogRow[] = [];
  for (const rule of Object.keys(p.rules)) for (const u of p.grid.users) for (const d of sleepDays) out.push(backlog(p, rule, u, d));
  return out;
}

export function backlogCsv(rows: BacklogRow[]): string {
  const cols = Object.keys(rows[0]) as (keyof BacklogRow)[];
  return [cols.join(","), ...rows.map((r) => cols.map((c) => String(r[c])).join(","))].join("\n") + "\n";
}
