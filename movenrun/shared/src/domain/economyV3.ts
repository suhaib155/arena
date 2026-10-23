/**
 * Game Economy V3: the day's reward, the toll and the day-close charges, as a
 * pure reference model.
 *
 * Every formula here comes from the V3 source document (revision 2, 31 Aug
 * 2026) and is cited by section. Where the source leaves a step open, the
 * choice made is named in `docs/GAME_ECONOMY_V3.md` as an ASSUMPTION or a
 * DECISION NEEDED, and the comment at that step says so. The worked examples
 * in the source (Meera's Tuesday, Dan's day, the toll table, the upkeep table)
 * are the test vectors.
 *
 * ## What it is not
 *
 * It is not settlement. Nothing here mints, burns, writes a balance or touches
 * a chain. It is the deterministic algorithm a settlement job and an
 * independent reconciler would both run, plus the book-balance check that
 * lets the reconciler halt settlement when the two disagree (section 26).
 *
 * It decides nothing about territory either. Which cells a session crossed,
 * which of them are deeded, and who holds them are inputs. Cells inferred
 * between GPS samples are not evidence of crossing and callers must not pass
 * them in as crossed cells.
 *
 * ## Units
 *
 * Amounts are integer micro-MOVE (1 MOVE = 1,000,000): off-chain credits,
 * not tokens. The books call the day's created credits "minted"; that is the
 * source's word, and nothing here mints on a chain. Every division that
 * produces an amount floors, and every floor's remainder is accounted for:
 * either it stays with the runner (the toll) or it returns to the season pool
 * (the pool split and the ceilings). Nothing is rounded up.
 *
 * Exactness policy: every amount and pool is a non-negative SAFE integer
 * (`Number.isSafeInteger`, not merely finite; above 2^53 − 1 a number no
 * longer names one integer), and anything else is refused with a RangeError.
 * The toll is computed in bigint. The rate factors the source states as
 * decimals or powers (effort, consistency, recharge rate, upkeep's
 * zones^0.25) are applied once to an integer and floored; the books'
 * identities are then checked exactly, in bigint, by `dayBooksProblems`.
 */

import { isMicroAmount } from "./creditUnits";

export { isMicroAmount };

function requireMicro(name: string, value: unknown): void {
  if (!isMicroAmount(value)) throw new RangeError(`${name} must be a non-negative safe integer micro amount`);
}

/* ── rules ────────────────────────────────────────────────────────────────── */

export const MICRO_PER_MOVE = 1_000_000;

/** Land level 1 (Outpost) to 5 (Citadel), section 9. */
export type LandLevel = 1 | 2 | 3 | 4 | 5;
/** Kit level 1 (Starter) to 5 (Veteran), section 10. */
export type KitLevel = 1 | 2 | 3 | 4 | 5;

export interface EconomyRules {
  rulesVersion: number;
  /** Season one's daily pool, section 17. */
  seasonOneDailyPoolMicro: number;
  /** Season one releases 9M; each later season 10% less; floor 2M (section 17). */
  seasonOnePoolMicro: number;
  seasonDecay: number;
  seasonFloorMicro: number;
  seasonDays: number;
  playerAllocationMicro: number;
  /** Section 2: 10 minutes and 750 m. HYPOTHESIS in the limits register. */
  minSessionMinutes: number;
  minSessionMeters: number;
  /** Section 17: √(minutes ÷ 40), floor 0.5, cap 1.0. HYPOTHESIS. */
  effortSaturationMinutes: number;
  effortFloor: number;
  /** Section 17: two scoring sessions a day. FIXED. */
  scoringSessionsPerDay: number;
  /** Section 17: ×1.00 rising to ×1.50 at six active days. FIXED. */
  consistencyMax: number;
  consistencyFullDays: number;
  /** Section 17: 12 per session, 20 per day. HYPOTHESIS. */
  sessionCeilingMicro: number;
  dayCeilingMicro: number;
  /** Section 20: 2.00%, once per session. FIXED, not governable. */
  tollBasisPoints: number;
  /** Section 8: each scoring session burns half the kit's charge. FIXED. */
  chargePerScoringSession: number;
  /** Section 10: recharge rate by kit level. HYPOTHESIS. */
  rechargeRateByKit: Readonly<Record<KitLevel, number>>;
  /** Section 7: 0.03 day-shares × zones^0.25 per unvisited zone. HYPOTHESIS. */
  upkeepBaseDayShares: number;
  upkeepExponent: number;
  /** Section 9: upkeep multiplier by land level. HYPOTHESIS. */
  upkeepMultiplierByLevel: Readonly<Record<LandLevel, number>>;
  /** Section 8: all automatic day-close charges ≤ 60% of the day's reward. FIXED. */
  autoChargeCapBasisPoints: number;
}

const V1: EconomyRules = {
  rulesVersion: 1,
  seasonOneDailyPoolMicro: 100_000 * MICRO_PER_MOVE,
  seasonOnePoolMicro: 9_000_000 * MICRO_PER_MOVE,
  seasonDecay: 0.9,
  seasonFloorMicro: 2_000_000 * MICRO_PER_MOVE,
  seasonDays: 90,
  playerAllocationMicro: 400_000_000 * MICRO_PER_MOVE,
  minSessionMinutes: 10,
  minSessionMeters: 750,
  effortSaturationMinutes: 40,
  effortFloor: 0.5,
  scoringSessionsPerDay: 2,
  consistencyMax: 1.5,
  consistencyFullDays: 6,
  sessionCeilingMicro: 12 * MICRO_PER_MOVE,
  dayCeilingMicro: 20 * MICRO_PER_MOVE,
  tollBasisPoints: 200,
  chargePerScoringSession: 0.5,
  rechargeRateByKit: { 1: 0.25, 2: 0.23, 3: 0.21, 4: 0.18, 5: 0.15 },
  upkeepBaseDayShares: 0.03,
  upkeepExponent: 0.25,
  upkeepMultiplierByLevel: { 1: 1, 2: 1, 3: 0.95, 4: 0.9, 5: 0.85 },
  autoChargeCapBasisPoints: 6000,
};

function deepFreeze<T>(o: T): T {
  for (const v of Object.values(o as object)) if (v !== null && typeof v === "object") deepFreeze(v);
  return Object.freeze(o);
}

// Frozen: a caller holding the registry's object cannot rewrite a rule in
// place for every later caller (section 30: rules never change retroactively).
const RULES_BY_VERSION: ReadonlyMap<number, EconomyRules> = new Map([[1, deepFreeze(V1)]]);

/**
 * The economy rules for a session's stamped rules version, or null when this
 * build does not know it. Null, never the newest: section 30 promises rules
 * are never changed retroactively, so callers fail closed.
 */
export function economyRulesFor(rulesVersion: number): EconomyRules | null {
  return RULES_BY_VERSION.get(rulesVersion) ?? null;
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  }
  return v;
}

/** The canonical JSON of a version's registry rules, for a pinned digest; null when unknown. */
export function economyRulesCanonicalJson(rulesVersion: number): string | null {
  const r = economyRulesFor(rulesVersion);
  return r ? JSON.stringify(canonical(r)) : null;
}

/**
 * Null when `rules` is exactly the registry's rules for its version, else
 * why not. A reconciler never trusts a rules object it is handed: one that
 * keeps `rulesVersion: 1` but changes a value is refused.
 */
export function pinnedRulesProblem(rules: EconomyRules): string | null {
  const pinned = economyRulesCanonicalJson(rules?.rulesVersion);
  if (pinned === null) return `unknown economy rules version ${String(rules?.rulesVersion)}`;
  if (rules !== economyRulesFor(rules.rulesVersion) && JSON.stringify(canonical(rules)) !== pinned) {
    return `rules object is not the pinned registry rules for version ${rules.rulesVersion}`;
  }
  return null;
}

/* ── seasons ──────────────────────────────────────────────────────────────── */

/**
 * The pool one season releases (1-based), section 17, limited by what is left
 * of the 400M player allocation.
 */
export function seasonPoolMicro(rules: EconomyRules, season: number): number {
  if (!Number.isInteger(season) || season < 1) throw new RangeError("season must be an integer ≥ 1");
  let released = 0;
  let pool = 0;
  for (let n = 1; n <= season; n++) {
    const scheduled = Math.max(
      Math.floor(rules.seasonOnePoolMicro * rules.seasonDecay ** (n - 1)),
      rules.seasonFloorMicro,
    );
    pool = Math.min(scheduled, rules.playerAllocationMicro - released);
    released += pool;
  }
  return pool;
}

/**
 * A season's daily pool. ASSUMPTION: the season pool spread evenly over its
 * days; the source states only season one's figure (9M ÷ 90 = 100,000).
 */
export function dailyPoolMicro(rules: EconomyRules, season: number): number {
  return Math.floor(seasonPoolMicro(rules, season) / rules.seasonDays);
}

/* ── scoring ──────────────────────────────────────────────────────────────── */

/** Section 2: below 10 minutes and 750 m a session does not score at all. */
export function sessionQualifies(rules: EconomyRules, minutes: number, meters: number): boolean {
  return minutes >= rules.minSessionMinutes && meters >= rules.minSessionMeters;
}

/** Section 17: √(minutes ÷ 40), floored at 0.5, capped at 1.0. */
export function effort(rules: EconomyRules, minutes: number): number {
  if (!Number.isFinite(minutes) || minutes < 0) throw new RangeError("minutes must be finite and ≥ 0");
  const raw = Math.sqrt(minutes / rules.effortSaturationMinutes);
  return Math.min(1, Math.max(rules.effortFloor, raw));
}

/**
 * Section 17: ×1.00 rising to ×1.50 at six active days; a seventh adds
 * nothing. ASSUMPTION: linear, +0.10 per day. The source fixes only the two
 * ends, and Meera's fifth day at ×1.40 (section 18) fits the line.
 */
export function consistencyMultiplier(rules: EconomyRules, activeDays: number): number {
  if (!Number.isInteger(activeDays) || activeDays < 1 || activeDays > 7) {
    throw new RangeError("activeDays must be an integer from 1 to 7");
  }
  const days = Math.min(activeDays, rules.consistencyFullDays);
  const step = (rules.consistencyMax - 1) / (rules.consistencyFullDays - 1);
  return 1 + step * (days - 1);
}

export interface SessionInput {
  minutes: number;
  meters: number;
  /** Marked unscored before it started (section 8): no charge, no tokens. */
  unscored?: boolean;
  /** Distinct cells the verified route stepped on. Never interpolated cells. */
  crossedCells?: readonly string[];
}

/**
 * Which sessions score, by index. Section 17 says "your two best qualifying
 * sessions"; section 8 lets a player keep a session out by marking it
 * unscored. ASSUMPTION: best two by effort among qualifying sessions not
 * marked unscored, ties to the earlier session.
 */
export function scoringSessionIndices(rules: EconomyRules, sessions: readonly SessionInput[]): number[] {
  return sessions
    .map((s, i) => ({ i, s }))
    .filter(({ s }) => !s.unscored && sessionQualifies(rules, s.minutes, s.meters))
    .sort((a, b) => effort(rules, b.s.minutes) - effort(rules, a.s.minutes) || a.i - b.i)
    .slice(0, rules.scoringSessionsPerDay)
    .map(({ i }) => i)
    .sort((a, b) => a - b);
}

/* ── the toll ─────────────────────────────────────────────────────────────── */

export interface TollResult {
  /** What the runner actually pays: the sum of the owners' shares. */
  paidMicro: number;
  /** Per owner. Own and linked land never appears. */
  toOwners: ReadonlyMap<string, number>;
}

/**
 * Section 20: toll = session reward × 2% × the share of the route on other
 * people's deeds; each owner gets the toll × their cells ÷ all deeded cells
 * crossed. Laps count once (distinct cells). The runner's own land and any
 * linked account's land is free and counts as undeeded. Rounding remainders
 * stay with the runner, so the toll never exceeds what was disclosed.
 */
export function sessionToll(
  rules: EconomyRules,
  sessionRewardMicro: number,
  crossedCells: readonly string[],
  deedOwnerByCell: ReadonlyMap<string, string>,
  runnerAndLinked: ReadonlySet<string>,
): TollResult {
  if (!Number.isSafeInteger(sessionRewardMicro)) throw new RangeError("sessionRewardMicro must be a safe integer");
  const distinct = [...new Set(crossedCells)];
  const cellsByOwner = new Map<string, number>();
  for (const cell of distinct) {
    const owner = deedOwnerByCell.get(cell);
    if (owner === undefined || runnerAndLinked.has(owner)) continue;
    cellsByOwner.set(owner, (cellsByOwner.get(owner) ?? 0) + 1);
  }
  const tolled = [...cellsByOwner.values()].reduce((a, b) => a + b, 0);
  const toOwners = new Map<string, number>();
  if (tolled === 0 || sessionRewardMicro <= 0) return { paidMicro: 0, toOwners };
  // Each share is floor(reward × bp × cells ÷ (10,000 × distinct)), exactly:
  // the toll × cells ÷ tolled, without a fractional toll in between.
  const numerator = BigInt(sessionRewardMicro) * BigInt(rules.tollBasisPoints);
  const denominator = 10_000n * BigInt(distinct.length);
  let paid = 0;
  for (const [owner, cells] of [...cellsByOwner].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const share = Number((numerator * BigInt(cells)) / denominator);
    if (share > 0) toOwners.set(owner, share);
    paid += share;
  }
  return { paidMicro: paid, toOwners };
}

/* ── the day-close charges ────────────────────────────────────────────────── */

/**
 * Section 7: 0.03 day-shares × zones^0.25 for each unvisited zone, times the
 * zone's level multiplier (section 9). Zero on a day covered by away
 * protection.
 */
export function upkeepOwedDayShares(
  rules: EconomyRules,
  zonesHeld: number,
  unvisitedZoneLevels: readonly LandLevel[],
  awayProtected = false,
): number {
  if (!Number.isSafeInteger(zonesHeld) || zonesHeld < 0) throw new RangeError("zonesHeld must be a safe integer ≥ 0");
  if (unvisitedZoneLevels.length > zonesHeld) throw new RangeError("more unvisited zones than zones held");
  if (awayProtected || zonesHeld === 0) return 0;
  const perZone = rules.upkeepBaseDayShares * zonesHeld ** rules.upkeepExponent;
  return unvisitedZoneLevels.reduce((sum, level) => sum + perZone * rules.upkeepMultiplierByLevel[level], 0);
}

export interface DayCloseInput {
  /** The day's reward after both ceilings and trust weight, before the toll. */
  dayRewardMicro: number;
  scoringSessions: number;
  kitLevel: KitLevel;
  dayShareMicro: number;
  zonesHeld: number;
  unvisitedZoneLevels: readonly LandLevel[];
  awayProtected?: boolean;
}

export interface DayCloseResult {
  rechargeMicro: number;
  upkeepOwedMicro: number;
  upkeepTakenMicro: number;
  /** Owed but not taken: paid in condition (the zones decay that day). */
  upkeepPaidInConditionMicro: number;
}

/**
 * Section 8: recharge = charge used × kit rate × the day's reward. Section 7
 * and 8: recharge plus upkeep together never take more than 60% of the day's
 * reward; the rest of the upkeep is paid in condition. Never negative, never
 * debt. The toll is not one of these charges: Meera's 60% check (section 18)
 * leaves it out.
 */
export function dayCloseCharges(rules: EconomyRules, input: DayCloseInput): DayCloseResult {
  if (!Number.isSafeInteger(input.dayRewardMicro)) throw new RangeError("dayRewardMicro must be a safe integer");
  requireMicro("dayShareMicro", input.dayShareMicro);
  if (!Number.isSafeInteger(input.scoringSessions) || input.scoringSessions < 0) throw new RangeError("scoringSessions must be a safe integer ≥ 0");
  if (!(input.kitLevel in rules.rechargeRateByKit)) throw new RangeError(`unknown kit level ${String(input.kitLevel)}`);
  for (const level of input.unvisitedZoneLevels) {
    if (!(level in rules.upkeepMultiplierByLevel)) throw new RangeError(`unknown land level ${String(level)}`);
  }
  const chargeUsed = Math.min(1, input.scoringSessions * rules.chargePerScoringSession);
  const reward = Math.max(0, input.dayRewardMicro);
  const recharge = Math.floor(chargeUsed * rules.rechargeRateByKit[input.kitLevel] * reward);
  const owed = Math.floor(
    upkeepOwedDayShares(rules, input.zonesHeld, input.unvisitedZoneLevels, input.awayProtected) * input.dayShareMicro,
  );
  const cap = Math.floor((reward * rules.autoChargeCapBasisPoints) / 10_000);
  const taken = Math.max(0, Math.min(owed, cap - recharge));
  for (const [name, v] of [["recharge", recharge], ["upkeep owed", owed], ["upkeep taken", taken]] as const) requireMicro(name, v);
  return {
    rechargeMicro: recharge,
    upkeepOwedMicro: owed,
    upkeepTakenMicro: taken,
    upkeepPaidInConditionMicro: owed - taken,
  };
}

/* ── one day, everybody ───────────────────────────────────────────────────── */

export interface PlayerDayInput {
  playerId: string;
  /** Accounts linked to this player (risk graph). Their land is free to cross. */
  linkedPlayerIds?: readonly string[];
  sessions: readonly SessionInput[];
  /** Active days this week including today, 1–7. */
  activeDaysThisWeek: number;
  /** Section 17: 0 to 1. */
  trustWeight: number;
  kitLevel: KitLevel;
  zonesHeld: number;
  unvisitedZoneLevels: readonly LandLevel[];
  awayProtected?: boolean;
}

export interface PlayerDayResult {
  playerId: string;
  scoringSessions: number;
  dayPoints: number;
  /** Reward per scoring session after trust and both ceilings. */
  sessionRewardsMicro: number[];
  dayRewardMicro: number;
  tollPaidMicro: number;
  tollReceivedMicro: number;
  charges: DayCloseResult;
  /** Own reward kept: day reward − toll paid − recharge − upkeep taken. */
  creditedMicro: number;
}

export interface DayBooks {
  poolMicro: number;
  /** Day rewards actually created: credited + toll moved + burned. */
  mintedMicro: number;
  creditedMicro: number;
  tollPaidMicro: number;
  tollReceivedMicro: number;
  burnedMicro: number;
  /** Trimmed by ceilings, withheld by trust, and rounding: back to the season pool. */
  returnedToSeasonPoolMicro: number;
}

export interface DaySettlement {
  totalPoints: number;
  dayShareMicro: number;
  players: PlayerDayResult[];
  books: DayBooks;
}

export interface DayInput {
  poolMicro: number;
  players: readonly PlayerDayInput[];
  /** Deed holder per cell. Solid deeded cells only; shade is never deeded. */
  deedOwnerByCell: ReadonlyMap<string, string>;
}

/**
 * Settles one day, section 17 to 20, in this order: points, the pool split,
 * trust weight, the session ceiling, the day ceiling, the day-share, the toll
 * per session, then the day-close charges.
 */
export function settleDay(rules: EconomyRules, input: DayInput): DaySettlement {
  requireMicro("poolMicro", input.poolMicro);
  const ids = new Set<string>();
  for (const p of input.players) {
    if (ids.has(p.playerId)) throw new RangeError(`duplicate player ${p.playerId}`);
    ids.add(p.playerId);
    if (!(p.trustWeight >= 0 && p.trustWeight <= 1)) throw new RangeError("trustWeight must be from 0 to 1");
  }

  // Points. Section 17: the two best qualifying sessions × consistency.
  const scored = input.players.map((p) => {
    const idx = scoringSessionIndices(rules, p.sessions);
    const c = idx.length > 0 ? consistencyMultiplier(rules, p.activeDaysThisWeek) : 0;
    const sessionPoints = idx.map((i) => effort(rules, p.sessions[i]!.minutes) * c);
    return { p, idx, sessionPoints, dayPoints: sessionPoints.reduce((a, b) => a + b, 0) };
  });
  const totalPoints = scored.reduce((a, s) => a + s.dayPoints, 0);

  // Pool split, then trust, then the two ceilings. ASSUMPTION: trust scales the
  // reward after the split, so withheld weight returns to the pool instead of
  // raising everyone else's rate ("the difference stays in the pool").
  const rewards = scored.map((s) => {
    const unweighted = s.sessionPoints.map((pts) =>
      totalPoints > 0 ? Math.floor((input.poolMicro * pts) / totalPoints) : 0,
    );
    const capped = unweighted.map((u) => Math.min(Math.floor(u * s.p.trustWeight), rules.sessionCeilingMicro));
    const sum = capped.reduce((a, b) => a + b, 0);
    // ASSUMPTION: the day ceiling trims scoring sessions in proportion.
    const final =
      sum <= rules.dayCeilingMicro ? capped : capped.map((v) => Math.floor((v * rules.dayCeilingMicro) / sum));
    return final;
  });

  // Day-share. ASSUMPTION: the median day reward (after ceilings, before
  // charges) among players with at least one scoring session; an even count
  // takes the lower middle.
  const active = rewards
    .filter((_, i) => scored[i]!.idx.length > 0)
    .map((r) => r.reduce((a, b) => a + b, 0))
    .sort((a, b) => a - b);
  const dayShareMicro = active.length === 0 ? 0 : active[Math.floor((active.length - 1) / 2)]!;

  const received = new Map<string, number>();
  const players: PlayerDayResult[] = scored.map((s, k) => {
    const sessionRewards = rewards[k]!;
    const dayReward = sessionRewards.reduce((a, b) => a + b, 0);
    const runnerAndLinked = new Set([s.p.playerId, ...(s.p.linkedPlayerIds ?? [])]);
    let tollPaid = 0;
    s.idx.forEach((sessionIndex, j) => {
      const toll = sessionToll(
        rules,
        sessionRewards[j]!,
        s.p.sessions[sessionIndex]!.crossedCells ?? [],
        input.deedOwnerByCell,
        runnerAndLinked,
      );
      tollPaid += toll.paidMicro;
      for (const [owner, amount] of toll.toOwners) received.set(owner, (received.get(owner) ?? 0) + amount);
    });
    const charges = dayCloseCharges(rules, {
      dayRewardMicro: dayReward,
      scoringSessions: s.idx.length,
      kitLevel: s.p.kitLevel,
      dayShareMicro,
      zonesHeld: s.p.zonesHeld,
      unvisitedZoneLevels: s.p.unvisitedZoneLevels,
      awayProtected: s.p.awayProtected,
    });
    return {
      playerId: s.p.playerId,
      scoringSessions: s.idx.length,
      dayPoints: s.dayPoints,
      sessionRewardsMicro: sessionRewards,
      dayRewardMicro: dayReward,
      tollPaidMicro: tollPaid,
      tollReceivedMicro: 0,
      charges,
      creditedMicro: dayReward - tollPaid - charges.rechargeMicro - charges.upkeepTakenMicro,
    };
  });
  for (const r of players) r.tollReceivedMicro = received.get(r.playerId) ?? 0;

  const sum = (f: (r: PlayerDayResult) => number) => players.reduce((a, r) => a + f(r), 0);
  const minted = sum((r) => r.dayRewardMicro);
  const tollReceivedMicro = [...received.values()].reduce((a, b) => a + b, 0);
  const books: DayBooks = {
    poolMicro: input.poolMicro,
    mintedMicro: minted,
    creditedMicro: sum((r) => r.creditedMicro),
    tollPaidMicro: sum((r) => r.tollPaidMicro),
    tollReceivedMicro,
    burnedMicro: sum((r) => r.charges.rechargeMicro + r.charges.upkeepTakenMicro),
    returnedToSeasonPoolMicro: input.poolMicro - minted,
  };
  return { totalPoints, dayShareMicro, players, books };
}

/**
 * The reconciler's check (section 26): every problem with a day's books, or an
 * empty list. Settlement halts on any entry.
 */
export function dayBooksProblems(rules: EconomyRules, s: DaySettlement): string[] {
  const forged = pinnedRulesProblem(rules);
  if (forged) return [forged];
  const b = s.books;
  const problems: string[] = [];
  // Every amount a non-negative safe integer first; the identities are then
  // exact in bigint, so float rounding can neither hide nor invent a gap.
  const unsafe = (where: string, fields: Record<string, unknown>) => {
    let bad = false;
    for (const [name, v] of Object.entries(fields)) {
      if (!isMicroAmount(v)) {
        problems.push(`${where}${name} is not a non-negative safe integer`);
        bad = true;
      }
    }
    return bad;
  };
  const booksBad = unsafe("books: ", { ...b });
  const playersBad = s.players.map((r) => unsafe(`player ${r.playerId}: `, {
    dayRewardMicro: r.dayRewardMicro, creditedMicro: r.creditedMicro, tollPaidMicro: r.tollPaidMicro, tollReceivedMicro: r.tollReceivedMicro,
    rechargeMicro: r.charges.rechargeMicro, upkeepTakenMicro: r.charges.upkeepTakenMicro, upkeepOwedMicro: r.charges.upkeepOwedMicro,
    upkeepPaidInConditionMicro: r.charges.upkeepPaidInConditionMicro,
    ...Object.fromEntries(r.sessionRewardsMicro.map((v, i) => [`sessionRewardsMicro[${i}]`, v])),
  }));
  if (booksBad || playersBad.some(Boolean)) return problems;

  const n = (v: number) => BigInt(v);
  if (n(b.mintedMicro) > n(b.poolMicro)) problems.push("minted more than the daily pool");
  if (n(b.mintedMicro) + n(b.returnedToSeasonPoolMicro) !== n(b.poolMicro)) problems.push("pool not fully accounted for");
  if (b.tollPaidMicro !== b.tollReceivedMicro) problems.push("tolls paid and received differ");
  if (n(b.creditedMicro) + n(b.tollPaidMicro) + n(b.burnedMicro) !== n(b.mintedMicro)) problems.push("minted not fully accounted for");
  const sum = (f: (r: PlayerDayResult) => number) => s.players.reduce((a, r) => a + n(f(r)), 0n);
  if (sum((r) => r.dayRewardMicro) !== n(b.mintedMicro)) problems.push("player rewards do not add up to minted");
  if (sum((r) => r.creditedMicro) !== n(b.creditedMicro)) problems.push("player credits do not add up to credited");
  if (sum((r) => r.tollPaidMicro) !== n(b.tollPaidMicro)) problems.push("player tolls paid do not add up to the books");
  // Tolls received are not summed over players: an owner paid a toll need not
  // have moved that day (settleCreditsDay adds every holder as a row).
  if (sum((r) => r.charges.rechargeMicro + r.charges.upkeepTakenMicro) !== n(b.burnedMicro)) problems.push("player charges do not add up to burned");
  for (const r of s.players) {
    const where = `player ${r.playerId}`;
    if (r.dayRewardMicro > rules.dayCeilingMicro) problems.push(`${where}: over the day ceiling`);
    if (r.sessionRewardsMicro.some((v) => v > rules.sessionCeilingMicro)) problems.push(`${where}: over the session ceiling`);
    // A day rebuilt from stored credit lines has no per-session split (empty);
    // the day ceiling, toll and charge caps still bind it.
    if (r.sessionRewardsMicro.length > 0 && r.sessionRewardsMicro.reduce((a, v) => a + n(v), 0n) !== n(r.dayRewardMicro)) {
      problems.push(`${where}: session rewards do not add up to the day reward`);
    }
    if (n(r.tollPaidMicro) * 10_000n > n(r.dayRewardMicro) * n(rules.tollBasisPoints)) problems.push(`${where}: toll above 2%`);
    const auto = n(r.charges.rechargeMicro) + n(r.charges.upkeepTakenMicro);
    if (auto * 10_000n > n(r.dayRewardMicro) * n(rules.autoChargeCapBasisPoints)) problems.push(`${where}: charges above 60%`);
    if (n(r.charges.upkeepTakenMicro) + n(r.charges.upkeepPaidInConditionMicro) !== n(r.charges.upkeepOwedMicro)) problems.push(`${where}: upkeep not fully accounted for`);
    if (n(r.dayRewardMicro) - n(r.tollPaidMicro) - auto !== n(r.creditedMicro)) problems.push(`${where}: credited does not follow from reward, toll and charges`);
  }
  return problems;
}

/**
 * The independent reconciler's entry point: checks a day's books against the
 * registry's rules for `rulesVersion`, loaded here, never passed in. With a
 * season, the day's pool must also be that season's daily pool.
 */
export function reconcileDay(rulesVersion: number, s: DaySettlement, opts: { season?: number } = {}): string[] {
  const rules = economyRulesFor(rulesVersion);
  if (!rules) return [`unknown economy rules version ${rulesVersion}`];
  const problems = dayBooksProblems(rules, s);
  if (opts.season !== undefined) {
    let pool: number;
    try {
      pool = dailyPoolMicro(rules, opts.season);
    } catch (err) {
      return [...problems, err instanceof Error ? err.message : String(err)];
    }
    if (s.books.poolMicro !== pool) problems.push(`pool ${s.books.poolMicro} is not season ${opts.season}'s daily pool ${pool}`);
  }
  return problems;
}
