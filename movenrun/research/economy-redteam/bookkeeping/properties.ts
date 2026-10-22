/**
 * Bookkeeping properties for the reference G0 (economyV3.ts) and G3
 * (holdingLedger.ts, holdingSettlement.ts) models. Each property drives the
 * real exported functions with generated cases and reports how many cases ran
 * and the first failure. The same list feeds the test file and the CLI.
 *
 * Off-chain credits only. Nothing here mints, transfers or converts anything;
 * the wei conversion property uses the reference converter in lib/units.ts,
 * which no product code calls.
 */
import {
  dailyPoolMicro,
  dayBooksProblems,
  economyRulesFor,
  effort,
  scoringSessionIndices,
  seasonPoolMicro,
  sessionQualifies,
  sessionToll,
  settleDay,
  type DayInput,
  type DaySettlement,
  type EconomyRules,
  type PlayerDayInput,
} from "@movenrun/shared/economy-v3";
import { newUnit, type UnitState } from "@movenrun/shared/holding";
import { applyLedger, type PushEvent } from "@movenrun/shared/holdingLedger";
import {
  holdingsAtDayClose,
  settleCreditsDay,
  settleCreditsSeason,
  type CreditsDayResult,
  type CreditsPlayerInput,
  type HoldingsAtClose,
} from "@movenrun/shared/holdingSettlement";
import { g0Day, g3Day, HARNESS_HOLDING_RULES, harnessZoneOf, sessionDraw, type G3Case } from "./lib/gen";
import { checkDay, exactSessionToll, isMicro, returnDecomposition } from "./lib/oracle";
import type { Rng } from "./lib/prng";
import {
  ConversionRefused,
  HARD_CAP_MICRO,
  HARD_CAP_WEI,
  microFromNumber,
  microToNumber,
  microToWei,
  microToWeiViaFloat,
  UINT256_MAX,
  weiToMicroExact,
} from "./lib/units";

export const RULES: EconomyRules = economyRulesFor(1)!;

export type Tier = "SOURCE" | "OWNER DECISION" | "PILOT ASSUMPTION" | "VERIFIED CODE" | "SYNTHETIC EXPERIMENT";

export interface PropertyOutcome {
  failures: number;
  firstFailure?: string;
  metrics: Record<string, number | string>;
}

export interface Property {
  id: string;
  /** Invariant ids this property checks (see the report's matrix). */
  invariants: string[];
  title: string;
  /** V3 section(s), cited as "V3 §n". */
  source: string;
  fn: string;
  run(rng: Rng, cases: number): PropertyOutcome;
}

const settledOf = (r: CreditsDayResult) => (r.status === "settled" ? r : null);

class Tally {
  failures = 0;
  firstFailure?: string;
  metrics: Record<string, number | string> = {};
  fail(msg: string) {
    this.failures += 1;
    if (this.firstFailure === undefined) this.firstFailure = msg;
  }
  add(key: string, n = 1) {
    this.metrics[key] = ((this.metrics[key] as number | undefined) ?? 0) + n;
  }
  out(): PropertyOutcome {
    return { failures: this.failures, firstFailure: this.firstFailure, metrics: this.metrics };
  }
}

/* ── G3 helpers ───────────────────────────────────────────────────────────── */

export function closeG3(c: G3Case, zoneOf = harnessZoneOf, holdingRules = HARNESS_HOLDING_RULES): HoldingsAtClose {
  return holdingsAtDayClose({ day: c.day, states: c.states, entries: c.entries, holdingRules, zoneOf, shadeCountsAsHeld: true });
}

/** The settleDay rows exactly as settleCreditsDay builds them, so checkDay can align players. */
export function rowsFor(players: readonly CreditsPlayerInput[], h: HoldingsAtClose): PlayerDayInput[] {
  const zonesOf = new Map(h.holders.map((x) => [x.playerId, x.zones]));
  const rows: CreditsPlayerInput[] = [...players];
  const listed = new Set(rows.map((p) => p.playerId));
  for (const x of h.holders) if (!listed.has(x.playerId)) rows.push({ playerId: x.playerId, sessions: [], activeDaysThisWeek: 1, trustWeight: 0, kitLevel: 1 });
  return rows.map((p) => {
    const zones = zonesOf.get(p.playerId) ?? [];
    return { ...p, zonesHeld: zones.length, unvisitedZoneLevels: zones.filter((z) => !z.visited).map((z) => z.level) };
  });
}

/** Line-level invariants of a settled G3 day. */
export function checkCreditsDay(r: Extract<CreditsDayResult, { status: "settled" }>, players: readonly CreditsPlayerInput[], h: HoldingsAtClose): string[] {
  const out: string[] = [];
  const input: DayInput = { poolMicro: r.poolMicro, players: rowsFor(players, h), deedOwnerByCell: h.deedOwnerByCell };
  out.push(...checkDay(RULES, input, r.settlement).violations);
  if (dayBooksProblems(RULES, r.settlement).length > 0) out.push("settled day fails the reconciler");
  const b = r.settlement.books;
  let net = 0;
  for (const l of r.lines) {
    if (!isMicro(l.netMicro)) out.push(`INV-NEG-01 line ${l.playerId} net ${l.netMicro}`);
    if (l.netMicro !== l.earnedMicro - l.tollPaidMicro - l.rechargeMicro - l.upkeepTakenMicro + l.tollReceivedMicro) out.push(`line ${l.playerId} net does not add up`);
    net += l.netMicro;
  }
  // Every toll recipient must have a line, or a received toll would vanish from the books.
  if (net !== b.mintedMicro - b.burnedMicro) out.push("INV-BURN-01 Σ net lines ≠ minted − burned (a toll recipient has no line?)");
  if (r.poolMicro !== dailyPoolMicro(RULES, r.season)) out.push("INV-POOL-03 day pool is not the season's daily pool");
  return out;
}

function settleG3(c: G3Case, season = 1) {
  const h = closeG3(c);
  return { h, r: settleCreditsDay({ rulesVersion: 1, season, day: c.day, players: c.players, holdings: h }) };
}

/** A G3 day that settles (regenerates until one does; the generator keeps zones consistent, so this is quick). */
export function settledG3Day(rng: Rng, day: number, season = 1) {
  for (let tries = 0; tries < 50; tries++) {
    const c = g3Day(rng, day);
    const { h, r } = settleG3(c, season);
    const s = settledOf(r);
    if (s) return { c, h, r: s };
  }
  throw new Error("generator could not produce a settling day");
}

/* ── properties ───────────────────────────────────────────────────────────── */

export const PROPERTIES: Property[] = [
  {
    id: "P01",
    invariants: ["INV-POOL-01", "INV-POOL-02", "INV-MINT-01", "INV-TOLL-01", "INV-TOLL-02", "INV-TOLL-03", "INV-TOLL-04", "INV-CEIL-01", "INV-CEIL-02", "INV-SESS-01", "INV-COST-01", "INV-COST-02", "INV-NEG-01", "INV-BURN-01"],
    title: "G0 day books close under random days (rules pool and small binding pools)",
    source: "V3 §17, §20, §8, §22, §26; rules 4, 5, 6, 10",
    fn: "economyV3.settleDay + dayBooksProblems",
    run(rng, cases) {
      const t = new Tally();
      for (let i = 0; i < cases; i++) {
        const input = g0Day(rng, RULES, { maxPlayers: rng.chance(0.1) ? 60 : 12, pool: "mixed" });
        const s = settleDay(RULES, input);
        const chk = checkDay(RULES, input, s);
        const rec = dayBooksProblems(RULES, s);
        if (chk.violations.length > 0) t.fail(`case ${i}: ${chk.violations[0]}`);
        if (rec.length > 0) t.fail(`case ${i}: reconciler refused a generated day: ${rec[0]}`);
        t.add("tollShareDivergences", chk.tollShareDivergences);
        t.add("players", input.players.length);
        if (s.books.mintedMicro < s.books.poolMicro) t.add("daysWithReturn");
      }
      return t.out();
    },
  },
  {
    id: "P02",
    invariants: ["INV-POOL-02", "INV-RET-01"],
    title: "Rounding dust and trimmed amounts return to the season pool, part by part",
    source: "V3 §17 (trimmed amounts return to the season pool; trust difference stays in the pool)",
    fn: "economyV3.settleDay",
    run(rng, cases) {
      const t = new Tally();
      let maxDust = 0;
      for (let i = 0; i < cases; i++) {
        const input = g0Day(rng, RULES, { maxPlayers: 40, pool: "small" });
        const s = settleDay(RULES, input);
        const d = returnDecomposition(RULES, input, s);
        const sessions = s.players.reduce((a, r) => a + r.scoringSessions, 0);
        if (d.sum !== s.books.returnedToSeasonPoolMicro) t.fail(`case ${i}: parts ${d.sum} ≠ returned ${s.books.returnedToSeasonPoolMicro}`);
        if (d.dust < 0 || d.trust < 0 || d.sessionTrim < 0 || d.dayTrim < 0) t.fail(`case ${i}: a negative part ${JSON.stringify(d)}`);
        // Each floor loses less than one micro; plus at most one per session from float points.
        if (d.dust > sessions + 1) t.fail(`case ${i}: split dust ${d.dust} above ${sessions + 1}`);
        maxDust = Math.max(maxDust, d.dust);
        t.add("returnedMicro", s.books.returnedToSeasonPoolMicro);
      }
      t.metrics.maxSplitDustMicro = maxDust;
      return t.out();
    },
  },
  {
    id: "P03",
    invariants: ["INV-TOLL-02", "INV-TOLL-03", "INV-DUST-01"],
    title: "Toll shares equal the exact rational floor; the remainder stays with the runner",
    source: "V3 §20 (rounding remainders go back to the runner; never more than disclosed)",
    fn: "economyV3.sessionToll",
    run(rng, cases) {
      const t = new Tally();
      let under = 0;
      let over = 0;
      for (let i = 0; i < cases; i++) {
        const distinct = rng.pick([1, 2, 3, 7, 12, 99, 1000, rng.int(1, 3000)]);
        const cells = Array.from({ length: distinct }, (_, k) => `c${k}`);
        const nOwners = rng.int(1, Math.min(distinct, 60));
        const deeds = new Map<string, string>();
        for (const c of cells) if (rng.chance(rng.next())) deeds.set(c, `o${rng.int(0, nOwners - 1)}`);
        const R = rng.pick([1, 49, 50, 51, 99, 100, rng.int(0, 12_000_000), 12_000_000, rng.int(1, 1_000)]);
        const got = sessionToll(RULES, R, cells, deeds, new Set(["runner"]));
        const ex = exactSessionToll(RULES, R, cells, deeds, new Set(["runner"]));
        const sum = [...got.toOwners.values()].reduce((a, b) => a + b, 0);
        if (sum !== got.paidMicro) t.fail(`case ${i}: shares ${sum} ≠ paid ${got.paidMicro}`);
        if (BigInt(got.paidMicro) * 10_000n > BigInt(R) * 200n) t.fail(`case ${i}: paid above 2%`);
        if (ex.denominator > 0n && BigInt(got.paidMicro) * ex.denominator > ex.exactNumerator) t.fail(`case ${i}: paid above the exact toll`);
        for (const [o, x] of ex.toOwners) {
          const g = BigInt(got.toOwners.get(o) ?? 0);
          if (g < x) under += 1;
          if (g > x) over += 1;
        }
        for (const [o, g] of got.toOwners) if (!ex.toOwners.has(o) && g > 0) over += 1;
      }
      t.metrics.sharesBelowExactFloor = under;
      t.metrics.sharesAboveExactFloor = over;
      if (over > 0) t.fail(`${over} owner shares above the exact floor`);
      return t.out();
    },
  },
  {
    id: "P04",
    invariants: ["INV-PATH-01"],
    title: "Path uniqueness: laps, repeats and order never change the toll (ten laps pay once)",
    source: "V3 §20 (ten laps of the same cell pay one toll); rule 4",
    fn: "economyV3.sessionToll",
    run(rng, cases) {
      const t = new Tally();
      for (let i = 0; i < cases; i++) {
        const cells = Array.from({ length: rng.int(1, 40) }, (_, k) => `c${k}`);
        const deeds = new Map<string, string>();
        for (const c of cells) if (rng.chance(0.4)) deeds.set(c, `o${rng.int(0, 5)}`);
        const R = rng.int(0, 12_000_000);
        const base = sessionToll(RULES, R, cells, deeds, new Set(["r"]));
        const laps = [...cells];
        const lapCell = rng.pick(cells);
        for (let k = 0; k < 9; k++) laps.push(lapCell); // ten laps of one cell
        for (let k = rng.int(0, 30); k > 0; k--) laps.push(rng.pick(cells));
        const shuffled = rng.shuffle(laps);
        const again = sessionToll(RULES, R, shuffled, deeds, new Set(["r"]));
        if (again.paidMicro !== base.paidMicro) t.fail(`case ${i}: laps changed the toll ${base.paidMicro} → ${again.paidMicro}`);
        if (JSON.stringify([...again.toOwners].sort()) !== JSON.stringify([...base.toOwners].sort())) t.fail(`case ${i}: laps changed the split`);
      }
      return t.out();
    },
  },
  {
    id: "P05",
    invariants: ["INV-TOLL-02", "INV-TOLL-05"],
    title: "Many deed holders (1, 2, 50, 51, 1000): 2% of one session total, never multiplied by owner count",
    source: "V3 §20 table (20 owners cost the same as one); rule 4",
    fn: "economyV3.sessionToll",
    run(rng, cases) {
      const t = new Tally();
      const counts = [1, 2, 50, 51, 1000];
      let maxGap = 0;
      for (let i = 0; i < cases; i++) {
        const n = counts[i % counts.length]!;
        const perOwner = rng.int(1, 3);
        const undeeded = rng.int(0, 200);
        const cells: string[] = [];
        const many = new Map<string, string>();
        const one = new Map<string, string>();
        for (let o = 0; o < n; o++) for (let k = 0; k < perOwner; k++) {
          const c = `d${o}_${k}`;
          cells.push(c);
          many.set(c, `o${o}`);
          one.set(c, "solo");
        }
        for (let k = 0; k < undeeded; k++) cells.push(`u${k}`);
        const R = rng.pick([rng.int(0, 12_000_000), 12_000_000, rng.int(1, 5_000)]);
        const a = sessionToll(RULES, R, cells, many, new Set(["r"]));
        const b = sessionToll(RULES, R, cells, one, new Set(["r"]));
        const cap = Math.floor((R * RULES.tollBasisPoints) / 10_000);
        if (a.paidMicro > cap) t.fail(`case ${i}: ${n} owners paid ${a.paidMicro} > 2% cap ${cap}`);
        if (a.paidMicro > b.paidMicro) t.fail(`case ${i}: ${n} owners paid more than one owner of the same cells`);
        if (b.paidMicro - a.paidMicro >= n) t.fail(`case ${i}: rounding gap ${b.paidMicro - a.paidMicro} ≥ owner count ${n}`);
        if (a.toOwners.size > n) t.fail(`case ${i}: more recipients than owners`);
        maxGap = Math.max(maxGap, b.paidMicro - a.paidMicro);
        t.add(`cases_n${n}`);
      }
      t.metrics.maxRoundingGapMicro = maxGap;
      return t.out();
    },
  },
  {
    id: "P06",
    invariants: ["INV-TOLL-04"],
    title: "Owner = walker and linked owners pay nothing and are treated as undeeded",
    source: "V3 §20 (own land and linked accounts are free; you cannot pay yourself)",
    fn: "economyV3.sessionToll, settleDay",
    run(rng, cases) {
      const t = new Tally();
      for (let i = 0; i < cases; i++) {
        const cells = Array.from({ length: rng.int(1, 30) }, (_, k) => `c${k}`);
        const linked = Array.from({ length: rng.int(0, 4) }, (_, k) => `l${k}`);
        const self = new Set(["runner", ...linked]);
        const others = Array.from({ length: rng.int(0, 4) }, (_, k) => `o${k}`);
        const pool = [...self, ...others];
        const deeds = new Map<string, string>();
        for (const c of cells) if (rng.chance(0.7)) deeds.set(c, rng.pick(pool));
        const R = rng.int(0, 12_000_000);
        const got = sessionToll(RULES, R, cells, deeds, self);
        for (const o of got.toOwners.keys()) if (self.has(o)) t.fail(`case ${i}: paid own/linked owner ${o}`);
        // Removing own/linked deeds entirely must give the same toll (they count as undeeded).
        const stripped = new Map([...deeds].filter(([, o]) => !self.has(o)));
        const same = sessionToll(RULES, R, cells, stripped, self);
        if (same.paidMicro !== got.paidMicro) t.fail(`case ${i}: own land is not treated as undeeded`);
        if ([...deeds.values()].every((o) => self.has(o)) && got.paidMicro !== 0) t.fail(`case ${i}: all-own route paid a toll`);
        // Through settleDay: a runner whose only crossed deeds are their own receives nothing from themself.
        const day = settleDay(RULES, {
          poolMicro: 1_000_000_000,
          players: [{ playerId: "runner", linkedPlayerIds: linked, sessions: [{ minutes: 40, meters: 4000, crossedCells: cells }], activeDaysThisWeek: 3, trustWeight: 1, kitLevel: 1, zonesHeld: 0, unvisitedZoneLevels: [] }],
          deedOwnerByCell: stripped.size === deeds.size ? new Map([...deeds].filter(([, o]) => self.has(o))) : new Map([...deeds].filter(([, o]) => self.has(o))),
        });
        if (day.players[0]!.tollPaidMicro !== 0 || day.players[0]!.tollReceivedMicro !== 0) t.fail(`case ${i}: self-toll moved through settleDay`);
      }
      return t.out();
    },
  },
  {
    id: "P07",
    invariants: ["INV-SESS-01", "INV-SESS-03"],
    title: "Two best sessions: at most two, qualifying, not unscored, highest effort, ties to the earlier",
    source: "V3 §17 (two best qualifying sessions; a third feeds the map only); §2; §8 unscored",
    fn: "economyV3.scoringSessionIndices, settleDay",
    run(rng, cases) {
      const t = new Tally();
      for (let i = 0; i < cases; i++) {
        const sessions = Array.from({ length: rng.int(0, 7) }, () => sessionDraw(rng, ["a"]));
        const idx = scoringSessionIndices(RULES, sessions);
        if (idx.length > 2) t.fail(`case ${i}: ${idx.length} scoring sessions`);
        const eligible = sessions.map((s, k) => ({ s, k })).filter(({ s }) => !s.unscored && sessionQualifies(RULES, s.minutes, s.meters));
        if (idx.length !== Math.min(2, eligible.length)) t.fail(`case ${i}: picked ${idx.length} of ${eligible.length} eligible`);
        for (const k of idx) {
          const s = sessions[k]!;
          if (s.unscored || !sessionQualifies(RULES, s.minutes, s.meters)) t.fail(`case ${i}: picked an ineligible session`);
        }
        const picked = new Set(idx);
        const minPicked = Math.min(...idx.map((k) => effort(RULES, sessions[k]!.minutes)));
        for (const { s, k } of eligible) {
          if (picked.has(k)) continue;
          const e = effort(RULES, s.minutes);
          if (e > minPicked) t.fail(`case ${i}: skipped a better session`);
          if (e === minPicked && idx.some((p) => p > k && effort(RULES, sessions[p]!.minutes) === e)) t.fail(`case ${i}: tie not given to the earlier session`);
        }
        // Adding a worse third session never changes the day reward.
        if (idx.length === 2) {
          const base = { playerId: "a", activeDaysThisWeek: 3, trustWeight: 1, kitLevel: 1 as const, zonesHeld: 0, unvisitedZoneLevels: [] };
          const one = settleDay(RULES, { poolMicro: 5_000_000, players: [{ ...base, sessions }], deedOwnerByCell: new Map() });
          const two = settleDay(RULES, { poolMicro: 5_000_000, players: [{ ...base, sessions: [...sessions, { minutes: 10, meters: 750 }] }], deedOwnerByCell: new Map() });
          if (minPicked >= effort(RULES, 10) && one.players[0]!.dayRewardMicro !== two.players[0]!.dayRewardMicro) t.fail(`case ${i}: a worse third session changed the reward`);
        }
      }
      return t.out();
    },
  },
  {
    id: "P08",
    invariants: ["INV-ZERO-01", "INV-COST-02", "INV-NEG-01"],
    title: "Zero rewards: nobody scores or trust is zero; nothing minted, nothing burned, upkeep paid in condition",
    source: "V3 §19 (60% of nothing is nothing); §7, §8; rule 10",
    fn: "economyV3.settleDay",
    run(rng, cases) {
      const t = new Tally();
      for (let i = 0; i < cases; i++) {
        const input = g0Day(rng, RULES, { maxPlayers: 15, pool: "mixed" });
        const mode = rng.int(0, 2);
        const players = input.players.map((p) =>
          mode === 0 ? { ...p, trustWeight: 0 } : mode === 1 ? { ...p, sessions: p.sessions.map((s) => ({ ...s, unscored: true })) } : { ...p, sessions: [] },
        );
        const s = settleDay(RULES, { ...input, players });
        if (s.books.mintedMicro !== 0 || s.books.burnedMicro !== 0 || s.books.tollPaidMicro !== 0) t.fail(`case ${i}: something moved on a zero day`);
        if (s.books.returnedToSeasonPoolMicro !== input.poolMicro) t.fail(`case ${i}: pool not returned whole`);
        for (const r of s.players) {
          if (r.creditedMicro !== 0) t.fail(`case ${i}: credited ${r.creditedMicro}`);
          if (r.charges.upkeepPaidInConditionMicro !== r.charges.upkeepOwedMicro) t.fail(`case ${i}: upkeep taken from a zero reward`);
        }
        if (dayBooksProblems(RULES, s).length > 0) t.fail(`case ${i}: reconciler refused a zero day`);
      }
      return t.out();
    },
  },
  {
    id: "P09",
    invariants: ["INV-CAP-01", "INV-CAP-02", "INV-POOL-03", "INV-ONCE-02"],
    title: "Cap crossing: the 400M allocation is released exactly once, daily pools never exceed their season, the season sum refuses overruns",
    source: "V3 §17 (400M player allocation; 9M, −10%, floor 2M); rule 2 (1bn)",
    fn: "economyV3.seasonPoolMicro, dailyPoolMicro; holdingSettlement.settleCreditsSeason",
    run(rng, cases) {
      const t = new Tally();
      let total = 0;
      let last = 0;
      for (let s = 1; s <= 400; s++) {
        const p = seasonPoolMicro(RULES, s);
        total += p;
        if (p > 0) last = s;
        if (dailyPoolMicro(RULES, s) * RULES.seasonDays > p) t.fail(`season ${s}: 90 daily pools exceed the season pool`);
      }
      if (total !== RULES.playerAllocationMicro) t.fail(`allocation released ${total}, not ${RULES.playerAllocationMicro}`);
      if (BigInt(total) > HARD_CAP_MICRO) t.fail("player allocation above the hard cap");
      t.metrics.lastSeasonWithPool = last;
      t.metrics.undistributedByDailyFloorMicro = Array.from({ length: last }, (_, k) => seasonPoolMicro(RULES, k + 1) - dailyPoolMicro(RULES, k + 1) * 90).reduce((a, b) => a + b, 0);
      for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        try {
          seasonPoolMicro(RULES, bad);
          t.fail(`season ${bad} accepted`);
        } catch {
          t.add("badSeasonsRefused");
        }
      }
      // Random seasons around and past exhaustion: pools are 0 after the allocation runs out.
      for (let i = 0; i < cases; i++) {
        const s = rng.int(last - 3, last + 50);
        const p = seasonPoolMicro(RULES, s);
        if (s > last && p !== 0) t.fail(`season ${s} after exhaustion has pool ${p}`);
      }
      // Season sum: 91 settled days in one season are refused, not trimmed.
      const days: CreditsDayResult[] = [];
      const one = settledG3Day(rng, 1);
      for (let d = 0; d < 91; d++) days.push({ ...one.r, day: d });
      const over = settleCreditsSeason(1, 1, days);
      if (over.status !== "refused") t.fail("91 days in a 90-day season were accepted");
      const ok = settleCreditsSeason(1, 1, days.slice(0, 90));
      if (ok.status !== "settled") t.fail("90 days were refused");
      // A season past exhaustion settles days with zero issuance.
      const late = settleCreditsDay({ rulesVersion: 1, season: last + 1, day: 1, players: one.c.players, holdings: one.h });
      if (late.status === "settled" && late.settlement.books.mintedMicro !== 0) t.fail("issued after the allocation ran out");
      return t.out();
    },
  },
  {
    id: "P10",
    invariants: ["INV-REFUSE-01", "INV-NEG-01", "INV-BURN-01", "INV-POOL-03"],
    title: "G3 credits day: settled days satisfy every invariant; any injected fault refuses the whole day",
    source: "V3 §26 (halts settlement if the books do not balance); §7, §17, §20",
    fn: "holdingSettlement.holdingsAtDayClose + settleCreditsDay",
    run(rng, cases) {
      const t = new Tally();
      const faults = ["none", "mixed_level", "entry_rules_version", "unit_no_zone", "unknown_economy_version", "holdings_day_mismatch", "bad_kit", "trust_above_one", "duplicate_player", "season_zero", "unit_wrong_key", "unit_future_asof", "bad_active_days"] as const;
      for (let i = 0; i < cases; i++) {
        const c = g3Day(rng, 10);
        const fault = rng.chance(0.5) ? "none" : rng.pick(faults.slice(1));
        let zoneOf = harnessZoneOf;
        let rulesVersion = 1;
        let season = 1;
        let day = c.day;
        const players = [...c.players];
        const states = new Map(c.states);
        const entries = [...c.entries];
        const needPlayer = () => {
          if (players.length === 0) players.push({ playerId: "pz", sessions: [], activeDaysThisWeek: 2, trustWeight: 1, kitLevel: 1 });
          return 0;
        };
        switch (fault) {
          case "mixed_level":
            states.set("zm/a", { ...newUnit("zm/a", 10), holderId: "pm", strength: 90, level: 2 });
            states.set("zm/b", { ...newUnit("zm/b", 10), holderId: "pm", strength: 90, level: 3 });
            break;
          case "entry_rules_version":
            entries.push({ eventId: "ev", unitId: "zq/a", walkerId: "w", day: 10, pushKind: "solid", outcome: "claimed", previousHolderId: null, newHolderId: "w", strengthBefore: 0, strengthAfter: 100, rulesVersion: HARNESS_HOLDING_RULES.rulesVersion + 1 });
            break;
          case "unit_no_zone":
            states.set("orphan", { ...newUnit("orphan", 10), holderId: "pm", strength: 90 });
            zoneOf = (u: string) => {
              if (u === "orphan") throw new Error("no zone");
              return harnessZoneOf(u);
            };
            break;
          case "unknown_economy_version":
            rulesVersion = rng.pick([0, 2, 3, -1, 1.5, 1001, 1002]);
            break;
          case "holdings_day_mismatch":
            day = c.day + rng.pick([-1, 1]);
            break;
          case "bad_kit":
            players[needPlayer()] = { ...players[0]!, kitLevel: rng.pick([0, 6, 2.5]) as 1 };
            break;
          case "trust_above_one":
            players[needPlayer()] = { ...players[0]!, trustWeight: rng.pick([1.0001, 2, -0.1, Number.NaN]) };
            break;
          case "duplicate_player":
            needPlayer();
            players.push({ ...players[0]! });
            break;
          case "season_zero":
            season = rng.pick([0, -1, 1.5]);
            break;
          case "unit_wrong_key":
            states.set("zw/a", { ...newUnit("zw/b", 10), holderId: "pm", strength: 50 });
            break;
          case "unit_future_asof":
            states.set("zf/a", { ...newUnit("zf/a", 11), holderId: "pm", strength: 50 });
            break;
          case "bad_active_days":
            players[needPlayer()] = { ...players[0]!, activeDaysThisWeek: rng.pick([0, 8, 2.5]), sessions: [{ minutes: 30, meters: 3000 }] };
            break;
        }
        const h = holdingsAtDayClose({ day: c.day, states, entries, holdingRules: HARNESS_HOLDING_RULES, zoneOf, shadeCountsAsHeld: true });
        const r = settleCreditsDay({ rulesVersion, season, day, players, holdings: h });
        t.add(`${fault}:${r.status}`);
        if (fault !== "none") {
          if (r.status !== "refused") t.fail(`case ${i}: fault ${fault} was settled`);
          else if (r.problems.length === 0 || "lines" in r || "settlement" in r) t.fail(`case ${i}: refusal carries partial books`);
          continue;
        }
        if (r.status === "refused") {
          t.fail(`case ${i}: clean day refused: ${r.problems[0]}`);
          continue;
        }
        const v = checkCreditsDay(r, players, h);
        if (v.length > 0) t.fail(`case ${i}: ${v[0]}`);
      }
      return t.out();
    },
  },
  {
    id: "P11",
    invariants: ["INV-REFUSE-01", "INV-INT-01"],
    title: "Negative, fractional, NaN, Infinity and unsafe-integer inputs: refused, or settled with balanced books",
    source: "V3 §26; §8 (never negative, never debt)",
    fn: "economyV3.settleDay + dayBooksProblems (as a reconciler would run them)",
    run(rng, cases) {
      const t = new Tally();
      const hostile = [-1, -1e9, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 2 ** 53, 2 ** 60, Number.MAX_VALUE];
      const fields = ["poolMicro", "minutes", "meters", "trustWeight", "activeDaysThisWeek", "zonesHeld", "kitLevel"] as const;
      for (let i = 0; i < cases; i++) {
        const input = g0Day(rng, RULES, { maxPlayers: 6, pool: "small" });
        if (input.players.length === 0) input.players = [{ playerId: "p0", sessions: [{ minutes: 30, meters: 3000 }], activeDaysThisWeek: 2, trustWeight: 1, kitLevel: 1, zonesHeld: 0, unvisitedZoneLevels: [] }];
        const field = fields[i % fields.length]!;
        const val = rng.pick(hostile);
        const players = input.players.map((p) => ({ ...p, sessions: p.sessions.map((s) => ({ ...s })) }));
        const target = players[0]!;
        let poolMicro = input.poolMicro;
        if (field === "poolMicro") poolMicro = val;
        else if (field === "minutes" || field === "meters") {
          if (target.sessions.length === 0) target.sessions.push({ minutes: 30, meters: 3000 });
          (target.sessions[0] as Record<string, unknown>)[field] = val;
        } else (target as Record<string, unknown>)[field] = val;
        let outcome: string;
        try {
          const s = settleDay(RULES, { poolMicro, players, deedOwnerByCell: input.deedOwnerByCell });
          const rec = dayBooksProblems(RULES, s);
          if (rec.length > 0) outcome = "refused_by_reconciler";
          else {
            const chk = checkDay(RULES, { poolMicro, players, deedOwnerByCell: input.deedOwnerByCell }, s);
            const allSafe = Object.values(s.books).every((x) => Number.isSafeInteger(x));
            if (chk.violations.length > 0 || !allSafe) {
              outcome = "ACCEPTED_UNBALANCED";
              t.fail(`case ${i}: ${field}=${val} passed the reconciler with ${chk.violations[0] ?? "unsafe book totals"}`);
            } else outcome = "accepted_balanced";
          }
        } catch {
          outcome = "thrown";
        }
        t.add(`${field}=${String(val)}:${outcome}`);
      }
      return t.out();
    },
  },
  {
    id: "P12",
    invariants: ["INV-VER-01"],
    title: "Rule-version drift: unknown economy versions, holding-rule mismatches and mixed-version seasons are refused",
    source: "V3 §30 (every session records its rules version; never changed retroactively); §26",
    fn: "economyV3.economyRulesFor; holdingSettlement.settleCreditsDay, holdingsAtDayClose, settleCreditsSeason",
    run(rng, cases) {
      const t = new Tally();
      for (let i = 0; i < cases; i++) {
        const v = rng.pick([0, 2, -1, 1.000001, Number.NaN, 1001, 1002, rng.int(2, 1e6)]);
        if (economyRulesFor(v) !== null) t.fail(`version ${v} resolved`);
        const one = settledG3Day(rng, 10);
        const r = settleCreditsDay({ rulesVersion: v, season: 1, day: 10, players: one.c.players, holdings: one.h });
        if (r.status !== "refused") t.fail(`case ${i}: settled under unknown version ${v}`);
        // Holding ledger entries stamped under another holding rules version.
        if (one.c.entries.length > 0) {
          const drift = one.c.entries.map((e, k) => (k === 0 ? { ...e, rulesVersion: e.rulesVersion + rng.int(1, 5) } : e));
          const h = holdingsAtDayClose({ day: 10, states: one.c.states, entries: drift, holdingRules: HARNESS_HOLDING_RULES, zoneOf: harnessZoneOf, shadeCountsAsHeld: true });
          const r2 = settleCreditsDay({ rulesVersion: 1, season: 1, day: 10, players: one.c.players, holdings: h });
          if (r2.status !== "refused") t.fail(`case ${i}: holding-rule drift settled`);
          else t.add("holdingDriftRefused");
        }
        const season = settleCreditsSeason(1, 1, [{ ...one.r, rulesVersion: 2 }]);
        if (season.status !== "refused") t.fail(`case ${i}: a day under another version was summed`);
      }
      return t.out();
    },
  },
  {
    id: "P13",
    invariants: ["INV-ONCE-01", "INV-ONCE-02", "INV-DET-01"],
    title: "Concurrent and duplicate settlement: deterministic, order-free, idempotent; a day summed twice is refused",
    source: "V3 §1 rule 7 (rewards settle once a day); §26 (deterministic, versioned)",
    fn: "settleCreditsDay, settleCreditsSeason, holdingLedger.applyLedger",
    run(rng, cases) {
      const t = new Tally();
      for (let i = 0; i < cases; i++) {
        const one = settledG3Day(rng, 10);
        // Two settlement workers on the same inputs, players in different orders.
        const again = settleCreditsDay({ rulesVersion: 1, season: 1, day: 10, players: rng.shuffle(one.c.players), holdings: closeG3({ ...one.c, entries: rng.shuffle(one.c.entries) }) });
        const a = settledOf(again);
        if (!a) t.fail(`case ${i}: a reordered copy was refused`);
        else if (JSON.stringify(a.lines) !== JSON.stringify(one.r.lines) || JSON.stringify(a.settlement.books) !== JSON.stringify(one.r.settlement.books)) t.fail(`case ${i}: input order changed the books`);
        // Both copies summed: refused, never doubled.
        const both = settleCreditsSeason(1, 1, rng.shuffle([one.r, a ?? one.r]));
        if (both.status !== "refused") t.fail(`case ${i}: the same day was summed twice`);
        // The ledger: a retried batch and in-batch duplicates apply once.
        const states = new Map<string, UnitState>([["z0/a", newUnit("z0/a", 5)], ["z0/b", newUnit("z0/b", 5)]]);
        const events: PushEvent[] = Array.from({ length: rng.int(1, 12) }, (_, k) => ({ eventId: `e${rng.int(0, 5)}`, unitId: rng.pick(["z0/a", "z0/b"]), walkerId: `w${k % 3}`, push: { kind: "solid" }, day: 6 }));
        const first = applyLedger({ states, events, rules: HARNESS_HOLDING_RULES });
        const retry = applyLedger({ states: first.states, events: rng.shuffle(events), rules: HARNESS_HOLDING_RULES, appliedEventIds: first.appliedEventIds });
        if (retry.entries.length !== 0) t.fail(`case ${i}: a retried batch wrote ${retry.entries.length} entries`);
        if (JSON.stringify([...retry.states]) !== JSON.stringify([...first.states])) t.fail(`case ${i}: a retried batch changed state`);
        const ids = new Set(first.entries.map((e) => e.eventId));
        if (ids.size !== first.entries.length) t.fail(`case ${i}: one event id applied twice in a batch`);
        const shuffled = applyLedger({ states, events: rng.shuffle(events), rules: HARNESS_HOLDING_RULES });
        if (JSON.stringify(shuffled.entries) !== JSON.stringify(first.entries)) t.fail(`case ${i}: arrival order changed the ledger`);
      }
      return t.out();
    },
  },
  {
    id: "P14",
    invariants: ["INV-MISS-01", "INV-BURN-01", "INV-CAP-02"],
    title: "Missing-day settlement: a season with gaps sums exactly the days settled and nothing else",
    source: "V3 §17 (trimmed amounts never cross a season); §26",
    fn: "holdingSettlement.settleCreditsSeason",
    run(rng, cases) {
      const t = new Tally();
      let unreported = 0;
      for (let i = 0; i < cases; i++) {
        const n = rng.int(1, 8);
        const days = Array.from({ length: n }, (_, k) => settledG3Day(rng, 10 + k).r);
        const kept = rng.shuffle(days).filter(() => rng.chance(0.7));
        const s = settleCreditsSeason(1, 1, kept);
        if (s.status !== "settled") {
          t.fail(`case ${i}: a gapped season was refused: ${s.problems[0]}`);
          continue;
        }
        const issued = kept.reduce((a, d) => a + d.settlement.books.mintedMicro, 0);
        const burned = kept.reduce((a, d) => a + d.settlement.books.burnedMicro, 0);
        const pool = kept.reduce((a, d) => a + d.settlement.books.poolMicro, 0);
        if (s.issuedMicro !== issued || s.burnedMicro !== burned || s.poolMicro !== pool) t.fail(`case ${i}: season totals differ from the days`);
        if (s.issuedMicro + s.returnedMicro !== s.poolMicro) t.fail(`case ${i}: season pool not conserved`);
        const net = s.byPlayer.reduce((a, x) => a + x.netMicro, 0);
        if (net !== issued - burned) t.fail(`case ${i}: Σ net ${net} ≠ issued − burned ${issued - burned}`);
        if (s.byPlayer.some((x) => x.netMicro < 0)) t.fail(`case ${i}: a negative season balance`);
        unreported += (n - kept.length) * dailyPoolMicro(RULES, 1);
      }
      t.metrics.unsettledDayPoolsNotReportedMicro = unreported;
      return t.out();
    },
  },
  {
    id: "P15",
    invariants: ["INV-LATE-01"],
    title: "Expired late submission: stale pushes are rejected; a settled day is never re-opened by a late push",
    source: "V3 §1 rule 7; §26; §28 (pending stays reversible until final)",
    fn: "holdingLedger.applyLedger, settleCreditsDay, settleCreditsSeason",
    run(rng, cases) {
      const t = new Tally();
      let lateAcceptedForClosedDay = 0;
      for (let i = 0; i < cases; i++) {
        const d = rng.int(5, 50);
        const unit: UnitState = { ...newUnit("z0/a", d), holderId: "h", strength: 100 };
        // A push dated before the unit's last change is rejected and writes nothing.
        const stale = applyLedger({ states: new Map([["z0/a", unit]]), events: [{ eventId: "late", unitId: "z0/a", walkerId: "w", push: { kind: "solid" }, day: d - rng.int(1, 4) }], rules: HARNESS_HOLDING_RULES });
        if (stale.entries.length !== 0 || stale.results[0]!.status !== "rejected") t.fail(`case ${i}: a stale push was applied`);
        // A push dated a day already settled, on a unit untouched since, is accepted: the ledger has no close watermark.
        const closed = applyLedger({ states: new Map([["z0/a", unit]]), events: [{ eventId: "late2", unitId: "z0/a", walkerId: "w", push: { kind: "solid" }, day: d }], rules: HARNESS_HOLDING_RULES });
        if (closed.entries.length === 1) lateAcceptedForClosedDay += 1;
        // Whatever the ledger does, re-settling day d gives a second result the season refuses.
        const one = settledG3Day(rng, d);
        const redo = settleCreditsDay({ rulesVersion: 1, season: 1, day: d, players: one.c.players.slice(1), holdings: one.h });
        if (redo.status === "settled") {
          const s = settleCreditsSeason(1, 1, [one.r, redo]);
          if (s.status !== "refused") t.fail(`case ${i}: a re-settled day was summed`);
        }
      }
      t.metrics.latePushForClosedDayAccepted = lateAcceptedForClosedDay;
      return t.out();
    },
  },
  {
    id: "P16",
    invariants: ["INV-HALT-01", "INV-REFUSE-01"],
    title: "Emergency halt (as modelled: a refused day) stops the whole season sum; no partial totals",
    source: "V3 §26 (halts settlement if the books do not balance)",
    fn: "holdingSettlement.settleCreditsSeason",
    run(rng, cases) {
      const t = new Tally();
      for (let i = 0; i < cases; i++) {
        const n = rng.int(1, 6);
        const days: CreditsDayResult[] = Array.from({ length: n }, (_, k) => settledG3Day(rng, 10 + k).r);
        const at = rng.int(0, n);
        days.splice(at, 0, { status: "refused", rulesVersion: 1, season: 1, day: 100 + i, problems: ["halted"] });
        const s = settleCreditsSeason(1, 1, rng.shuffle(days));
        if (s.status !== "refused") t.fail(`case ${i}: a season with a halted day was summed`);
        else if ("issuedMicro" in s || "byPlayer" in s) t.fail(`case ${i}: refusal carries partial totals`);
      }
      return t.out();
    },
  },
  {
    id: "P17",
    invariants: ["INV-WEI-01", "INV-WEI-02", "INV-CAP-03"],
    title: "18-decimal conversion: exact micro↔wei, dust and unsafe numbers refused, day books still balance in wei",
    source: "V3 §17 / rule 2 (1bn cap in the contract); §26 (books balance)",
    fn: "lib/units.ts reference converter over settleDay books (no product converter exists)",
    run(rng, cases) {
      const t = new Tally();
      if (microToWei(HARD_CAP_MICRO) !== HARD_CAP_WEI) t.fail("cap in micro and wei disagree");
      if (HARD_CAP_WEI > UINT256_MAX) t.fail("cap above uint256");
      if (HARD_CAP_MICRO > BigInt(Number.MAX_SAFE_INTEGER)) t.fail("1bn in micro is not a safe JS integer");
      t.metrics.safeIntegerHeadroomOverCap = Number(BigInt(Number.MAX_SAFE_INTEGER) / HARD_CAP_MICRO);
      let floatPathErrors = 0;
      for (let i = 0; i < cases; i++) {
        const micro = rng.pick([0, 1, 999_999, 1_000_000, rng.int(0, 2 ** 31), Math.floor(rng.next() * Number(HARD_CAP_MICRO)), Number(HARD_CAP_MICRO), Number.MAX_SAFE_INTEGER]);
        const wei = microToWei(microFromNumber(micro));
        if (weiToMicroExact(wei) !== BigInt(micro)) t.fail(`case ${i}: round trip lost ${micro}`);
        if (microToNumber(weiToMicroExact(wei)) !== micro) t.fail(`case ${i}: back to number lost ${micro}`);
        if (microToWeiViaFloat(micro) !== wei) floatPathErrors += 1;
        const dust = BigInt(rng.int(1, 999_999)) * BigInt(rng.int(1, 999_999)) % 1_000_000_000_000n || 1n;
        try {
          weiToMicroExact(wei + dust);
          t.fail(`case ${i}: dust ${dust} accepted`);
        } catch (e) {
          if (!(e instanceof ConversionRefused)) throw e;
        }
        for (const bad of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, -0.0000001]) {
          try {
            microFromNumber(bad);
            t.fail(`case ${i}: ${bad} accepted as micro`);
          } catch (e) {
            if (!(e instanceof ConversionRefused)) throw e;
          }
        }
        // A settled day's books in wei: the same identities hold exactly.
        if (i % 10 === 0) {
          const input = g0Day(rng, RULES, { maxPlayers: 10, pool: "mixed" });
          const s = settleDay(RULES, input);
          const w = (x: number) => microToWei(microFromNumber(x));
          const b = s.books;
          if (w(b.mintedMicro) + w(b.returnedToSeasonPoolMicro) !== w(b.poolMicro)) t.fail(`case ${i}: pool identity fails in wei`);
          if (w(b.creditedMicro) + w(b.tollPaidMicro) + w(b.burnedMicro) !== w(b.mintedMicro)) t.fail(`case ${i}: mint identity fails in wei`);
          if (s.players.reduce((a, r) => a + w(r.tollPaidMicro), 0n) !== w(b.tollReceivedMicro)) t.fail(`case ${i}: toll identity fails in wei`);
        }
      }
      t.metrics.floatPathConversionErrors = floatPathErrors;
      return t.out();
    },
  },
  {
    id: "P18",
    invariants: ["INV-GPS-01", "INV-LOCK-01"],
    title: "No route data in the books; credits carry no transferable or liquid state",
    source: "V3 §1 rule 12, §26–27 (route never on chain); rule 11, §21 (locked)",
    fn: "settleCreditsDay result shape",
    run(rng, cases) {
      const t = new Tally();
      let linesWithZoneIds = 0;
      const forbidden = /liquid|transfer|wallet|address|token/i;
      for (let i = 0; i < cases; i++) {
        const one = settledG3Day(rng, 10);
        const ids = new Set<string>([...one.c.states.keys(), ...one.c.players.flatMap((p) => p.sessions.flatMap((s) => s.crossedCells ?? []))]);
        const zones = new Set([...ids].map(harnessZoneOf));
        const booksJson = JSON.stringify(one.r.settlement.books);
        const amountsJson = JSON.stringify(one.r.settlement.players.map((p) => ({ ...p })));
        for (const id of [...ids, ...zones]) {
          if (booksJson.includes(`"${id}"`) || amountsJson.includes(`"${id}"`)) t.fail(`case ${i}: location id ${id} in the books`);
        }
        if (one.r.lines.some((l) => l.unvisitedZoneIds.length > 0)) linesWithZoneIds += 1;
        for (const l of one.r.lines) for (const k of Object.keys(l)) if (forbidden.test(k)) t.fail(`case ${i}: credit line field ${k}`);
      }
      t.metrics.creditLinesCarryingZoneIds = linesWithZoneIds;
      return t.out();
    },
  },
];

/** Runs one property with its manifest seed. */
export function runProperty(p: Property, seed: number, cases: number, rngFactory: (seed: number) => Rng) {
  const started = Date.now();
  const out = p.run(rngFactory(seed), cases);
  return { id: p.id, title: p.title, invariants: p.invariants, source: p.source, fn: p.fn, seed, cases, ...out, result: out.failures === 0 ? "pass" : "FAIL", ms: Date.now() - started };
}

export type PropertyReport = ReturnType<typeof runProperty>;

/** Exposed for fixtures: settle a single G0 day with the V1 rules. */
export const settleV1 = (input: DayInput): DaySettlement => settleDay(RULES, input);
