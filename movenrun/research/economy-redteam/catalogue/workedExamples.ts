/**
 * Source worked-example checks for the V3 economy catalogue (Track B, B1).
 *
 * Two kinds of rows:
 *
 * - `source`: the arithmetic the V3 source prints (revision 2), recomputed
 *   here from its own stated inputs. A row agrees when the exact value,
 *   rounded to the precision the source prints, equals the printed figure
 *   (tolerance = half of the last printed digit). Rows that disagree are
 *   source rounding or internal inconsistencies, not code defects.
 * - `implementation`: the same inputs run through the repository's own
 *   reference model at base cb27318 (`@movenrun/shared/economy-v3` and
 *   `@movenrun/shared/holdingSettlement`), read-only. Each row records the
 *   value the code produces next to the source's printed value and says
 *   whether they agree at the source's printed precision.
 *
 * Nothing here is random, mints anything or touches a chain. Amounts in the
 * reference model are integer micro-units of off-chain credits in the pilot;
 * the source prices them in $MOVE. The labels are kept apart in the output.
 *
 * Hypotheses stated before the results were computed (see the gap matrix):
 *   H1 every source table row reproduces at printed precision;
 *   H2 the code reproduces Meera's and Dan's printed figures at printed
 *      precision under the source's literal inputs.
 */
import {
  consistencyMultiplier,
  dailyPoolMicro,
  dayBooksProblems,
  dayCloseCharges,
  economyRulesFor,
  effort,
  seasonPoolMicro,
  sessionToll,
  settleDay,
  type EconomyRules,
  type PlayerDayInput,
} from "@movenrun/shared/economy-v3";
import { holdingsAtDayClose, settleCreditsDay, type CreditsPlayerInput } from "@movenrun/shared/holdingSettlement";
import { applyPush, newUnit, type HoldingRules, type LandLevel, type UnitState } from "@movenrun/shared/holding";
import type { LedgerEntry } from "@movenrun/shared/holdingLedger";

export const MICRO = 1_000_000;

export interface CheckRow {
  id: string;
  kind: "source" | "implementation";
  section: string;
  what: string;
  /** Value printed in the source (null when the source prints none). */
  printed: number | null;
  /** Decimal places the source prints for this figure. */
  printedDecimals: number | null;
  /** Exact recomputation (source rows) or the code's result in whole units (implementation rows). */
  value: number;
  agrees: boolean | null;
  note: string;
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Agreement at the source's printed precision: |value − printed| ≤ half a unit of the last printed digit (plus float slack). */
export function agreesAtPrinted(value: number, printed: number, decimals: number): boolean {
  return Math.abs(value - printed) <= 0.5 * 10 ** -decimals + 1e-9;
}

function row(
  kind: CheckRow["kind"], id: string, section: string, what: string,
  value: number, printed: number | null, decimals: number | null, note = "",
): CheckRow {
  const agrees = printed === null || decimals === null ? null : agreesAtPrinted(value, printed, decimals);
  return { id, kind, section, what, printed, printedDecimals: decimals, value: r6(value), agrees, note };
}

/* ── source arithmetic ───────────────────────────────────────────────────── */

/** Exact §18 chain from the source's stated inputs (no intermediate rounding). */
export function meeraExact() {
  const rate = 100_000 / 60_000;
  const e = Math.sqrt(25 / 40);
  const points = 2 * e;
  const dayPoints = points * 1.4;
  const gross = rate * dayPoints;
  const perSession = gross / 2;
  const dayShare = 2.5;
  const tollDayBasis = gross * 0.02 * (3 / 12);
  const tollSessionBasis12 = perSession * 0.02 * (3 / 12);
  const recharge = 0.25 * gross;
  const upkeepDs = 4 * 0.03 * 6 ** 0.25;
  const upkeep = upkeepDs * dayShare;
  return { rate, e, points, dayPoints, gross, perSession, tollDayBasis, tollSessionBasis12, recharge, upkeepDs, upkeep, dayShare };
}

/** The §17 season schedule: seasons until 400M is released, with the last season partial. */
export function seasonSchedule() {
  let released = 0;
  let n = 0;
  let aboveFloor = 0;
  let lastFraction = 1;
  while (released < 400e6 - 1e-6) {
    n += 1;
    const scheduled = Math.max(9e6 * 0.9 ** (n - 1), 2e6);
    if (9e6 * 0.9 ** (n - 1) > 2e6) aboveFloor += 1;
    const pool = Math.min(scheduled, 400e6 - released);
    lastFraction = pool / scheduled;
    released += pool;
  }
  const fractionalSeasons = n - 1 + lastFraction;
  return { seasons: n, fractionalSeasons, aboveFloor, released, years: (fractionalSeasons * 90) / 365.25 };
}

export function sourceChecks(): CheckRow[] {
  const S = (id: string, section: string, what: string, value: number, printed: number | null, decimals: number | null, note = "") =>
    row("source", id, section, what, value, printed, decimals, note);
  const m = meeraExact();
  const rows: CheckRow[] = [];

  // §18 Meera, step by step: each step from the source's own printed previous figure, and the exact chain.
  rows.push(S("S18-RATE", "V3 §18", "rate = 100,000 ÷ 60,000", m.rate, 1.667, 3));
  rows.push(S("S18-EFFORT", "V3 §18 step 1", "effort √(25÷40)", m.e, 0.79, 2));
  rows.push(S("S18-POINTS", "V3 §18 step 2", "0.79 + 0.79 (printed inputs)", 0.79 + 0.79, 1.58, 2));
  rows.push(S("S18-DAYPOINTS", "V3 §18 step 3", "1.58 × 1.40 (printed inputs)", 1.58 * 1.4, 2.21, 2));
  rows.push(S("S18-DAYPOINTS-EXACT", "V3 §18 step 3", "exact 2 × √0.625 × 1.40", m.dayPoints, 2.21, 2));
  rows.push(S("S18-GROSS", "V3 §18 step 4", "1.667 × 2.21 (printed inputs)", 1.667 * 2.21, 3.68, 2));
  rows.push(S("S18-GROSS-EXACT", "V3 §18 step 4", "exact (100,000 ÷ 60,000) × 2.2136", m.gross, 3.68, 2,
    "Exact gross is 3.689; the printed 3.68 comes from multiplying rounded intermediates."));
  rows.push(S("S18-PER-SESSION", "V3 §18 step 5", "per-session reward 3.68 ÷ 2", 3.68 / 2, 1.84, 2));
  rows.push(S("S18-CEILINGS", "V3 §18 step 5", "1.84 ≤ 12 and 3.68 ≤ 20 (1 = both clear)", 1.84 <= 12 && 3.68 <= 20 ? 1 : 0, 1, 0));
  rows.push(S("S18-TOLL-DAY-BASIS", "V3 §18 step 6", "toll as printed: 3.68 × 2% × 0.25 (day reward basis)", 3.68 * 0.02 * 0.25, 0.02, 2,
    "Printed working applies the toll to the whole day's reward (0.0184)."));
  rows.push(S("S18-TOLL-SESSION-BASIS", "V3 §20 applied to §18", "§20 per-session basis, evening session alone, 3 of 12 cells: 1.84 × 2% × 0.25", 1.84 * 0.02 * 0.25, 0.02, 2,
    "0.0092: half the printed toll. Rounds to 0.01, not the printed 0.02. Source internal inconsistency (spec D10)."));
  rows.push(S("S18-RAVI", "V3 §18 step 7", "Ravi 2 of 3 tolled cells of 0.0184", 0.0184 * 2 / 3, 0.012, 3));
  rows.push(S("S18-SAM", "V3 §18 step 7", "Sam 1 of 3 tolled cells of 0.0184", 0.0184 / 3, 0.006, 3));
  rows.push(S("S18-RECHARGE", "V3 §18 step 8", "25% of 3.68 (gross, before toll)", 0.25 * 3.68, 0.92, 2));
  rows.push(S("S18-UPKEEP-DS", "V3 §18 step 9", "4 × 0.03 × 6^0.25 day-shares", m.upkeepDs, 0.19, 2));
  rows.push(S("S18-UPKEEP", "V3 §18 step 9", "0.1878 day-shares × 2.50", m.upkeep, 0.47, 2));
  rows.push(S("S18-CAP60", "V3 §18 step 10", "(0.92 + 0.47) ÷ 3.68, toll excluded", (0.92 + 0.47) / 3.68, 0.38, 2));
  rows.push(S("S18-CREDITED", "V3 §18 step 11", "3.68 − 0.02 − 0.92 − 0.47 (printed inputs)", 3.68 - 0.02 - 0.92 - 0.47, 2.27, 2));
  rows.push(S("S18-CREDITED-EXACT-DAYTOLL", "V3 §18 step 11", "exact chain, day-basis toll", m.gross - m.tollDayBasis - 0.25 * m.gross - m.upkeep, 2.27, 2,
    "Exact chain gives 2.279 (rounds to 2.28): the printed 2.27 rests on rounded intermediates."));
  rows.push(S("S18-CREDITED-EXACT-SESSIONTOLL", "V3 §18 step 11", "exact chain, §20 per-session toll (3 of 12)", m.gross - m.gross / 2 * 0.02 * 0.25 - 0.25 * m.gross - m.upkeep, 2.27, 2,
    "2.288 under the §20 per-session reading."));
  rows.push(S("S18-DESTROYED", "V3 §18", "destroyed = 0.92 + 0.47", 0.92 + 0.47, 1.39, 2));

  // §19 Dan.
  const danDs = 40 * 0.03 * 40 ** 0.25;
  rows.push(S("S19-UPKEEP-DS", "V3 §19", "40 × 0.03 × 40^0.25 day-shares", danDs, 3.02, 2));
  rows.push(S("S19-UPKEEP-OWED-PRINTED-INPUT", "V3 §19", "3.02 × 2.50 (printed input)", 3.02 * 2.5, 7.55, 2));
  rows.push(S("S19-UPKEEP-OWED-EXACT", "V3 §19", "exact 3.0179 × 2.50", danDs * 2.5, 7.55, 2,
    "Exact is 7.5446, which rounds to 7.54; the printed 7.55 multiplies the rounded 3.02."));
  rows.push(S("S19-TAKEN", "V3 §19", "60% of a zero day", 0.6 * 0, 0, 0));

  // §7 upkeep table: per zone, all unvisited, per week.
  const table: Array<[number, number, number, number, number]> = [
    // zones, per-zone printed (3dp), all printed, all decimals, week printed (and its decimals below)
    [1, 0.03, 0.03, 2, 0.2],
    [6, 0.047, 0.28, 2, 2.0],
    [16, 0.06, 1.0, 2, 7.0],
    [30, 0.07, 2.11, 2, 14.8],
    [100, 0.095, 9.49, 2, 66],
    [250, 0.119, 29.8, 1, 209],
  ];
  for (const [n, perPrinted, allPrinted, allDec, weekPrinted] of table) {
    const per = 0.03 * n ** 0.25;
    rows.push(S(`S7-ROW${n}-PER`, "V3 §7", `${n} zones: 0.03 × ${n}^0.25 per zone`, per, perPrinted, 3));
    rows.push(S(`S7-ROW${n}-ALL`, "V3 §7", `${n} zones all unvisited: ${n} × per zone`, n * per, allPrinted, allDec,
      n === 16 ? "16 × 0.03 × 16^0.25 = 0.96, printed 1.00: the row is the rounded break-even, not the formula." : ""));
    const weekDec = n >= 100 ? 0 : 1;
    rows.push(S(`S7-ROW${n}-WEEK`, "V3 §7", `${n} zones all unvisited, per week (× 7)`, 7 * n * per, weekPrinted, weekDec,
      n === 16 ? "Exact 6.72, printed 7.0." : n === 30 ? "Exact 14.74 (rounds to 14.7); printed 14.8 is 7 × the rounded 2.11." : ""));
  }

  // §20 toll table (a 20.00 session).
  rows.push(S("S20-NONE", "V3 §20", "no deeded ground: keep", 20 - 0, 20.0, 2));
  rows.push(S("S20-4OF6-RATE", "V3 §20", "four of six deeded: toll rate % = 2 × 4/6", 2 * 4 / 6, 1.33, 2));
  rows.push(S("S20-4OF6-KEEP", "V3 §20", "four of six deeded: keep", 20 - 20 * 0.02 * 4 / 6, 19.73, 2));
  rows.push(S("S20-4OF6-OWNERS", "V3 §20", "four of six deeded: owners receive", 20 * 0.02 * 4 / 6, 0.27, 2));
  for (const owners of [4, 8, 20]) {
    rows.push(S(`S20-ALL-${owners}-KEEP`, "V3 §20", `every cell deeded, ${owners} owners: keep`, 20 - 0.4, 19.6, 2));
    rows.push(S(`S20-ALL-${owners}-EACH`, "V3 §20", `every cell deeded, ${owners} owners: each`, 0.4 / owners, owners === 20 ? null : 0.4 / owners, owners === 20 ? null : 2));
  }
  rows.push(S("S20-TABLE-VS-SESSION-CEIL", "V3 §20 vs §17", "table's 20.00 session reward within the 12 per-session ceiling (1 = yes)", 20 <= 12 ? 1 : 0, 1, 0,
    "The toll table illustrates a 20.00 session, which the §17 per-session ceiling of 12 cannot produce. Illustrative only; the 2% arithmetic is unaffected."));
  rows.push(S("S20-SEASON1-TOLL-BOUND", "V3 §20", "season-one toll bound 9,000,000 × 2%", 9e6 * 0.02, 180_000, 0,
    "Bound assumes the whole season pool is issued; actual issued is lower when ceilings trim."));
  rows.push(S("S20-RAVI-DAY", "V3 §20", "Ravi: 140 crossers × 0.008", 140 * 0.008, 1.12, 2));
  rows.push(S("S20-RAVI-DS", "V3 §20", "Ravi: 1.12 ÷ 2.50 day-shares", 1.12 / 2.5, 0.45, 2));
  for (const [crossers, printed] of [[12, 6], [45, 22], [140, 70]] as const) {
    rows.push(S(`S20-REL-${crossers}`, "V3 §20", `relative earnings ${crossers} ÷ 2 crossers`, crossers / 2, printed, 0,
      crossers === 45 ? "45 ÷ 2 = 22.5, printed 22×." : ""));
  }
  const ravi3 = 3 * 0.03 * 3 ** 0.25;
  rows.push(S("S20-RAVI-10X-ALL3", "V3 §20", "Ravi's 0.45 day-shares > 10 × upkeep if all three zones unvisited (1 = yes)", 0.45 > 10 * ravi3 ? 1 : 0, 1, 0,
    `Upkeep on three unvisited zones is ${ravi3.toFixed(4)} day-shares; 0.45 is ${(0.45 / ravi3).toFixed(1)}×, not more than 10×. The claim holds only if at most one of the three is unvisited (${(0.45 / (0.03 * 3 ** 0.25)).toFixed(1)}×).`));

  // §17.
  const walker = 2 * Math.sqrt(25 / 40) * 1.5;
  rows.push(S("S17-WALKER", "V3 §17", "two 25-minute walks on the sixth active day", walker, 2.37, 2));
  rows.push(S("S17-RUNNER", "V3 §17", "one three-hour run, first active day", Math.min(1, Math.sqrt(180 / 40)) * 1.0, 1.0, 2));
  let week = 0;
  for (let d = 1; d <= 6; d++) week += 2 * Math.sqrt(25 / 40) * (1 + 0.1 * (d - 1));
  rows.push(S("S17-WEEKLY-RATIO", "V3 §17", "weekly points ratio walker ÷ runner under linear consistency (A4)", week / 1, null, null,
    "2.37 vs 1.00 compares one day at the sixth active day with one run; over a week the ratio is about 11.9 under A4. 'Well over a factor of two' holds either way."));
  rows.push(S("S17-CEIL-RATIO", "V3 §17", "12 ÷ 20", 12 / 20, 0.6, 1));
  rows.push(S("S17-DAY-LT-2SESSIONS", "V3 §1 rule 6", "20 < 2 × 12 (1 = yes)", 20 < 24 ? 1 : 0, 1, 0));
  rows.push(S("S17-5000", "V3 §17", "players at which an even pro-rata share equals the day ceiling: 100,000 ÷ 20", 100_000 / 20, 5000, 0));
  rows.push(S("S17-100K", "V3 §17", "average at 100,000 players", 100_000 / 100_000, 1, 0));
  rows.push(S("S17-100", "V3 §17", "uncapped pro-rata at 100 players", 100_000 / 100, 1000, 0));
  rows.push(S("S6-3000", "V3 §6", "pro-rata at 3,000 players exceeds the 20 ceiling (1 = yes)", 100_000 / 3000 > 20 ? 1 : 0, 1, 0));
  const sched = seasonSchedule();
  rows.push(S("S17-SCHED-TOTAL", "V3 §17", "schedule releases (M)", sched.released / 1e6, 400, 0));
  rows.push(S("S17-SCHED-SEASONS", "V3 §17", "seasons to release 400M (fractional)", sched.fractionalSeasons, 180, null,
    `About ${sched.fractionalSeasons.toFixed(2)} seasons (${sched.seasons} with the last partial); ${sched.aboveFloor} seasons sit above the 2M floor.`));
  rows.push(S("S17-SCHED-YEARS", "V3 §17", "years at 90-day seasons", sched.years, 44, 0));
  rows.push(S("S17-DAILY-S1", "V3 §17", "9,000,000 ÷ 90", 9e6 / 90, 100_000, 0));

  // §8, §10, §26, §6.
  rows.push(S("S8-ONE-STARTER", "V3 §8", "50% × 25%", 0.5 * 25, 12.5, 1));
  rows.push(S("S8-ONE-VETERAN", "V3 §8", "50% × 15%", 0.5 * 15, 7.5, 1));
  rows.push(S("S8-FLAT4", "V3 §8", "a flat 4-token recharge on a 1-token day, %", (4 / 1) * 100, 400, 0));
  rows.push(S("S10-LAND", "V3 §10", "land levels 2+6+18+45 day-shares", 2 + 6 + 18 + 45, 71, 0));
  rows.push(S("S10-KIT", "V3 §10", "kit levels 3+9+22+50 day-shares", 3 + 9 + 22 + 50, 84, 0));
  rows.push(S("S26-TX-YEAR", "V3 §26", "100,000 × 5 × 365 transactions a year (M)", (100_000 * 5 * 365) / 1e6, 182, 0,
    "182.5 M; printed 182 million."));
  return rows;
}

/* ── implementation runs ─────────────────────────────────────────────────── */

const rulesOrThrow = (): EconomyRules => {
  const r = economyRulesFor(1);
  if (!r) throw new Error("economy rules version 1 missing");
  return r;
};

/** The source's population: 40,000 players with 60,000 points and a day-share of 2.50 (the crowd is the median). */
function crowd(rules: EconomyRules, meeraPoints: number): CreditsPlayerInput[] {
  const n = 39_998;
  const players: CreditsPlayerInput[] = [];
  for (let i = 0; i < n; i++) {
    players.push({ playerId: `crowd${String(i).padStart(5, "0")}`, sessions: [{ minutes: 40, meters: 4000 }], activeDaysThisWeek: 6, trustWeight: 1, kitLevel: 1 });
  }
  const fillerEffort = 60_000 - n * 1.5 - meeraPoints;
  if (!(fillerEffort >= rules.effortFloor && fillerEffort <= 1)) throw new Error("filler effort out of range");
  players.push({ playerId: "filler", sessions: [{ minutes: 40 * fillerEffort ** 2, meters: 4000 }], activeDaysThisWeek: 1, trustWeight: 1, kitLevel: 1 });
  return players;
}

/** Pilot holding numbers (rule set 1001, PILOT ASSUMPTION; backend/src/gameplay/rules.ts:227-232). Only used so day close can decay to the same day. */
export const PILOT_1001_HOLDING: HoldingRules = { rulesVersion: 1001, solidDecayPerDay: 3, shadeDecayMultiplier: 3, stageFloors: { held: 60, atRisk: 30, contested: 10 } };

const unit = (unitId: string, holderId: string, level: LandLevel, day: number, deeded = false): UnitState =>
  ({ unitId, holderId, strength: 100, ground: "solid", deeded, masked: false, level, fortified: false, asOfDay: day });

/**
 * Meera's and Dan's day through `settleCreditsDay`: Meera holds six Camp zones
 * and visits two; Ravi holds two deeded cells and Sam one; Dan holds forty
 * Camp zones and did not go out. `eveningCells` is how many distinct cells
 * Meera's evening session crossed (3 of them deeded).
 */
export function runCreditsDay(eveningCells: number) {
  const rules = rulesOrThrow();
  const day = 100;
  const meeraPoints = 2 * effort(rules, 25) * consistencyMultiplier(rules, 5);
  const states: Record<string, UnitState> = {};
  for (let i = 1; i <= 6; i++) states[`mz${i}`] = unit(`mz${i}`, "meera", 2, day);
  states.rv1 = unit("rv1", "ravi", 4, day, true);
  states.rv2 = unit("rv2", "ravi", 4, day, true);
  states.sm1 = unit("sm1", "sam", 4, day, true);
  for (let i = 1; i <= 40; i++) states[`dz${String(i).padStart(2, "0")}`] = unit(`dz${String(i).padStart(2, "0")}`, "dan", 2, day);
  const entries: LedgerEntry[] = ["mz1", "mz2"].map((u) => ({
    eventId: `visit:${u}`, unitId: u, walkerId: "meera", day, pushKind: "solid", outcome: "reinforced",
    previousHolderId: "meera", newHolderId: "meera", strengthBefore: 100, strengthAfter: 100, rulesVersion: PILOT_1001_HOLDING.rulesVersion,
  }));
  const holdings = holdingsAtDayClose({ day, states, entries, holdingRules: PILOT_1001_HOLDING, zoneOf: (u) => u, shadeCountsAsHeld: false });
  const plain = Array.from({ length: eveningCells - 4 }, (_, i) => `ev${i}`);
  const meera: CreditsPlayerInput = {
    playerId: "meera",
    sessions: [
      { minutes: 25, meters: 2500, crossedCells: ["mz1", "mo1", "mo2", "mo3", "mo4", "mo5"] },
      { minutes: 25, meters: 2500, crossedCells: ["mz2", ...plain, "rv1", "rv2", "sm1"] },
    ],
    activeDaysThisWeek: 5, trustWeight: 1, kitLevel: 1,
  };
  const result = settleCreditsDay({ rulesVersion: 1, season: 1, day, players: [meera, ...crowd(rules, meeraPoints)], holdings });
  if (result.status !== "settled") throw new Error(`refused: ${result.problems.join("; ")}`);
  const line = (id: string) => {
    const l = result.lines.find((x) => x.playerId === id);
    if (!l) throw new Error(`no line for ${id}`);
    return l;
  };
  const m = result.settlement.players.find((p) => p.playerId === "meera")!;
  return { result, meera: line("meera"), meeraRaw: m, dan: line("dan"), ravi: line("ravi"), sam: line("sam"), dayShareMicro: result.settlement.dayShareMicro };
}

/** Per-session ceiling then proportional day trim (code, A7) versus day trim then per-session ceiling (the other reading). */
export function ceilingOrder() {
  const rules = rulesOrThrow();
  const p: PlayerDayInput = {
    playerId: "solo", sessions: [{ minutes: 40, meters: 4000 }, { minutes: 10, meters: 1000 }],
    activeDaysThisWeek: 6, trustWeight: 1, kitLevel: 1, zonesHeld: 0, unvisitedZoneLevels: [],
  };
  const s = settleDay(rules, { poolMicro: dailyPoolMicro(rules, 1), players: [p], deedOwnerByCell: new Map() });
  const raw = [1.5, 0.75].map((pts) => (100_000 * pts) / 2.25);
  const k = Math.min(1, 20 / raw.reduce((a, b) => a + b, 0));
  const dayFirst = raw.map((v) => Math.min(12, v * k));
  return { codeSessions: s.players[0]!.sessionRewardsMicro.map((v) => v / MICRO), dayFirst, books: dayBooksProblems(rules, s) };
}

/** One push per walker, unit and day under 1001's immediate flip: a flip does not grant a second hostile push that day. */
export function onePushAfterFlip() {
  const rules = PILOT_1001_HOLDING;
  const day = 5;
  let st: UnitState = { ...newUnit("u", day), holderId: "holder", strength: 100 };
  const a1 = applyPush({ state: st, walkerId: "alice", push: { kind: "solid" }, day, rules });
  st = a1.state;
  const b1 = applyPush({ state: st, walkerId: "bob", push: { kind: "solid" }, day, rules });
  st = b1.state;
  const a2 = applyPush({ state: st, walkerId: "alice", push: { kind: "solid" }, day, rules });
  return { first: a1.outcome, second: b1.outcome, third: a2.outcome, holderAfter: a2.state.holderId };
}

export function implementationChecks(): CheckRow[] {
  const rules = rulesOrThrow();
  const I = (id: string, section: string, what: string, value: number, printed: number | null, decimals: number | null, note = "") =>
    row("implementation", id, section, what, value, printed, decimals, note);
  const rows: CheckRow[] = [];

  // Variant B: §20 literal (evening session crossed 12 cells, 3 deeded).
  const b = runCreditsDay(12);
  const mm = b.meera;
  rows.push(I("IMPL-S18-DAYSHARE", "V3 §18", "day-share from settleCreditsDay (median)", b.dayShareMicro / MICRO, 2.5, 2));
  rows.push(I("IMPL-S18-GROSS", "V3 §18 step 4", "Meera's day reward", mm.earnedMicro / MICRO, 3.68, 2,
    "Code computes the exact 3.689 and therefore disagrees with the printed 3.68 at printed precision."));
  rows.push(I("IMPL-S18-SESSION", "V3 §18 step 5", "Meera's evening session reward", b.meeraRaw.sessionRewardsMicro[1]! / MICRO, 1.84, 2));
  rows.push(I("IMPL-S18-TOLL-12", "V3 §18 step 6", "toll, evening session crossed 12 cells (3 deeded), per-session basis", mm.tollPaidMicro / MICRO, 0.02, 2,
    "Code applies §20 per session: 0.0092, half the printed 0.0184. Spec D10 open."));
  rows.push(I("IMPL-S18-RAVI-12", "V3 §18 step 7", "Ravi receives", b.ravi.tollReceivedMicro / MICRO, 0.012, 3));
  rows.push(I("IMPL-S18-SAM-12", "V3 §18 step 7", "Sam receives", b.sam.tollReceivedMicro / MICRO, 0.006, 3));
  rows.push(I("IMPL-S18-RECHARGE", "V3 §18 step 8", "recharge (on gross, before toll)", mm.rechargeMicro / MICRO, 0.92, 2));
  rows.push(I("IMPL-S18-UPKEEP", "V3 §18 step 9", "upkeep taken (4 unvisited Camp zones of 6)", mm.upkeepTakenMicro / MICRO, 0.47, 2));
  rows.push(I("IMPL-S18-CAP60", "V3 §18 step 10", "(recharge + upkeep) ÷ gross", (mm.rechargeMicro + mm.upkeepTakenMicro) / mm.earnedMicro, 0.38, 2));
  rows.push(I("IMPL-S18-CREDITED-12", "V3 §18 step 11", "credited to Meera (earned − toll − recharge − upkeep)", (mm.netMicro - mm.tollReceivedMicro) / MICRO, 2.27, 2,
    "Code gives the exact-arithmetic value; printed 2.27 rests on rounded intermediates."));
  rows.push(I("IMPL-S19-OWED", "V3 §19", "Dan: upkeep owed", (b.dan.upkeepTakenMicro + b.dan.upkeepPaidInConditionMicro) / MICRO, 7.55, 2,
    "Code floors 3.0179 × day-share: 7.544, not the printed 7.55 (which multiplies the rounded 3.02)."));
  rows.push(I("IMPL-S19-TAKEN", "V3 §19", "Dan: upkeep taken", b.dan.upkeepTakenMicro / MICRO, 0, 2));
  rows.push(I("IMPL-S19-ZONES", "V3 §19", "Dan: zones charged", b.dan.unvisitedZoneIds.length, 40, 0));

  // Variant C: the repository's own fixture split (evening session crossed 6 cells, 3 deeded).
  const c = runCreditsDay(6);
  rows.push(I("IMPL-S18-TOLL-6", "V3 §18 step 6", "toll if the evening session crossed only 6 cells (3 deeded)", c.meera.tollPaidMicro / MICRO, 0.02, 2,
    "Per-session code reproduces 0.0184 only when the tolled session's coverage is twice the day's (D10)."));
  rows.push(I("IMPL-S18-CREDITED-6", "V3 §18 step 11", "credited, 6-cell evening", (c.meera.netMicro - c.meera.tollReceivedMicro) / MICRO, 2.27, 2));

  // Rounding remainder stays with the runner.
  const odd = sessionToll(rules, 1_000_001, ["a", "b", "c"], new Map([["a", "p"], ["b", "q"], ["c", "r"]]), new Set(["runner"]));
  rows.push(I("IMPL-S20-REMAINDER", "V3 §20", "micro-units kept by the runner when 20,000.02 splits three ways", (1_000_001 * 0.02) - odd.paidMicro, null, null,
    `Paid ${odd.paidMicro} micro of a disclosed 20,000.02; the remainder stays with the runner (floors per owner).`));

  // Toll table through the code.
  const six = ["a", "b", "c", "d", "e", "f"];
  const fourOfSix = sessionToll(rules, 20 * MICRO, six, new Map(six.slice(0, 4).map((x) => [x, "o"])), new Set(["me"]));
  rows.push(I("IMPL-S20-4OF6", "V3 §20", "four of six deeded on a 20.00 session: paid", fourOfSix.paidMicro / MICRO, 0.27, 2));
  for (const owners of [4, 8, 20]) {
    const cells = Array.from({ length: owners }, (_, i) => `c${i}`);
    const t = sessionToll(rules, 20 * MICRO, cells, new Map(cells.map((x, i) => [x, `o${i}`])), new Set(["me"]));
    rows.push(I(`IMPL-S20-ALL-${owners}`, "V3 §20", `every cell deeded, ${owners} owners: paid`, t.paidMicro / MICRO, 0.4, 2));
  }

  // Upkeep table via dayCloseCharges at a day-share of 1 (owed in day-shares).
  for (const n of [1, 6, 16, 30, 100, 250]) {
    const owed = dayCloseCharges(rules, { dayRewardMicro: 0, scoringSessions: 0, kitLevel: 1, dayShareMicro: MICRO, zonesHeld: n, unvisitedZoneLevels: Array.from({ length: n }, () => 2 as const) }).upkeepOwedMicro;
    const printed = { 1: 0.03, 6: 0.28, 16: 1.0, 30: 2.11, 100: 9.49, 250: 29.8 }[n]!;
    rows.push(I(`IMPL-S7-${n}`, "V3 §7", `${n} zones all unvisited, day-shares owed`, owed / MICRO, printed, n === 250 ? 1 : 2,
      n === 16 ? "Code computes the formula (0.96); the printed row says 1.00." : ""));
  }

  // Season schedule and pool.
  let total = 0;
  let seasons = 0;
  while (seasonPoolMicro(rules, seasons + 1) > 0 && seasons < 400) total += seasonPoolMicro(rules, ++seasons);
  rows.push(I("IMPL-S17-SCHED-TOTAL", "V3 §17", "code releases (M)", total / MICRO / 1e6, 400, 0));
  rows.push(I("IMPL-S17-SCHED-SEASONS", "V3 §17", "code seasons with a non-zero pool", seasons, 180, 0));
  rows.push(I("IMPL-S17-DAILY-S1", "V3 §17", "code daily pool, season 1", dailyPoolMicro(rules, 1) / MICRO, 100_000, 0));
  rows.push(I("IMPL-S17-DAILY-S2", "V3 §17 (A3)", "code daily pool, season 2 (season ÷ 90)", dailyPoolMicro(rules, 2) / MICRO, null, null,
    "The source prints no later-season daily pool; trimmed amounts are not re-spread into later days (see SRC-TRIM-RETURN)."));

  // Ceiling ordering.
  const co = ceilingOrder();
  rows.push(I("IMPL-S17-CEIL-ORDER-CODE", "V3 §17 (A7)", "code day total, sessions of effort 1.0 and 0.5 alone in the pool", co.codeSessions.reduce((a, b) => a + b, 0), null, null,
    `Code: per-session ceiling first, then proportional day trim → [${co.codeSessions.join(", ")}].`));
  rows.push(I("IMPL-S17-CEIL-ORDER-ALT", "V3 §17 (A7)", "same raw shares, day trim first then per-session ceiling", co.dayFirst.reduce((a, b) => a + b, 0), null, null,
    `Day-first gives [${co.dayFirst.map((v) => v.toFixed(2)).join(", ")}] = ${co.dayFirst.reduce((a, b) => a + b, 0).toFixed(2)}. The order changes the day total and the per-session split (and so the per-session toll).`));

  // One push per walker/unit/day survives a flip.
  const op = onePushAfterFlip();
  rows.push(I("IMPL-A9-ONE-PUSH", "owner decision A9 (17 Oct)", "alice flips, bob flips back, alice pushes again the same day (1 = refused)", op.third === "refused_daily_limit" ? 1 : 0, 1, 0,
    `Outcomes ${op.first} / ${op.second} / ${op.third}; holder after: ${op.holderAfter}.`));
  return rows;
}

export function allChecks() {
  return { base: "cb27318", source: "V3 revision 2 (31 Aug 2026)", units: "source rows in $MOVE as printed; implementation rows in whole off-chain credit units (micro ÷ 1,000,000)", rows: [...sourceChecks(), ...implementationChecks()] };
}
