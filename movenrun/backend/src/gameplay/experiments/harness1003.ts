/**
 * SIMULATION ONLY. Experiment 1003 against 1001 and 1002 on identical seeds.
 *
 * Each seed builds one population and one set of verified sessions
 * (`population1003.ts`), and every rule set gets exactly those sessions in
 * server-receipt order: 1001 its resolution 8 stored cells, 1002 and the 1003
 * variants the resolution 10 session path. 1001 and 1002 run through the
 * server's ledger step (`applyServerLedger`) exactly as `fairness.ts` runs
 * them; the 1003 variants through `applySession1003`, which wraps the same
 * step. The server's 300-unit daily capacity guard and day close (midnight +
 * 2 h grace) apply to all. Credits are not simulated: economic reward is a
 * count of credit-eligible events only.
 *
 * Nothing here changes a rule set or its digest. Synthetic players only.
 */
import { cellToParent, getHexagonAreaAvg } from "h3-js";
import { cellsForObservations } from "@movenrun/shared/h3";
import { decayTo, newUnit, stageOf, type UnitState } from "@movenrun/shared/holding";
import type { PushEvent } from "@movenrun/shared/holdingLedger";
import { DEFAULT_UNIT_BUDGET } from "../capacity.js";
import { REVIEW_2PLUS, REVIEW_3PLUS, prng, type ReviewSpec } from "../fairness.js";
import { deriveSessionPath, pushUnitsOf } from "../path.js";
import { applyServerLedger } from "../policy.js";
import { DAY_MS, PILOT_PROPOSAL, SIM_PILOT_2_PROPOSAL, type GameplayRules } from "../rules.js";
import { applySession1003 } from "./ledger1003.js";
import {
  ADVERSARY_1003, COHORTS_1003, DEFAULT_COUNTS_1003, HONEST_1003, population1003,
  type Cohort1003, type Population1003Spec, type Session1003, type Walker1003,
} from "./population1003.js";
import { EXPERIMENTS_1003, SENSITIVITY_1003, type Experiment1003 } from "./rules1003.js";

type Rules = Omit<GameplayRules, "seasonOneStartDay">;
export const DAY0 = 20_000;

export type RunConfig =
  | { label: string; kind: "server"; rules: Rules; gap: boolean }
  | { label: string; kind: "1003"; exp: Experiment1003 };

export const RUNS_1003: readonly RunConfig[] = [
  { label: "1001", kind: "server", rules: PILOT_PROPOSAL, gap: false },
  { label: "1002", kind: "server", rules: SIM_PILOT_2_PROPOSAL, gap: true },
  ...EXPERIMENTS_1003.map((exp) => ({ label: exp.label, kind: "1003" as const, exp })),
];

/** 1002 and the budget-size sensitivity variants, on the same seeds. */
export const SENSITIVITY_RUNS_1003: readonly RunConfig[] = [
  RUNS_1003[1]!, RUNS_1003[3]!,
  ...SENSITIVITY_1003.map((exp) => ({ label: exp.label, kind: "1003" as const, exp })),
];

const rulesOf = (c: RunConfig) => (c.kind === "server" ? c.rules : c.exp.rules);

export interface CohortRow {
  walkers: number;
  sessions: number;
  sessionsDayClosed: number;
  activeWalkerDays: number;
  sessionsWithAccess: number;
  /** Event classes (applied pushes). */
  claims: number;
  defenses: number;
  passThrough: number;
  contested: number;
  flips: number;
  /** Flips that completed the walker's own challenge from an earlier day. */
  flipsDeliberate: number;
  /** Credit-eligible events (claims + confirmed flips). Credits are not simulated. */
  rewardEvents: number;
  /** The owner's one-push rule (`refused_daily_limit`). Never a budget. */
  dailyLimitRefused: number;
  /** Pushes refused by a hard take budget (1002 `takes-v1`, 1003 A/B). */
  budgetHard: number;
  /** Pushes weakened by a soft budget (1003 C). */
  budgetSoft: number;
  /** Pushes on ground another walker held: pass-through + contested + flips + hard refusals. */
  pushesOnOthers: number;
  /** Active walker-days with at least one budget refusal or weakening. */
  walkerDaysBlocked: number;
  unitBudgetRefused: number;
  staleRejected: number;
  /** Units of this cohort lost to anyone's flip. */
  flipsSuffered: number;
  /** Units of this cohort lost to an adversary's flip. */
  flipsSufferedFromAdversary: number;
  heldEndUnits: number;
  walkersWithGround: number;
}

export interface ReviewRow {
  /** Linked groups by cohort, and groups flagged. */
  groups: Partial<Record<Cohort1003, number>>;
  flaggedGroups: Partial<Record<Cohort1003, number>>;
  flaggedAccounts: Partial<Record<Cohort1003, number>>;
  /** Seeded draw at the assumed wrong-uphold rate, over flags on honest households and siblings. */
  wronglyUpheld: number;
}

export interface Run1003Row {
  label: string;
  seed: number;
  unitAreaKm2: number;
  cohorts: Record<Cohort1003, CohortRow>;
  heldEndUnits: number;
  /** Share of held units at the end held by the top 10% of accounts by units held. */
  top10Share: number;
  /** Flips by adversaries of ground an honest walker held. */
  adversaryFlipsOnHonest: number;
  honestFlipsOnHonest: number;
  /** Load proxies: ledger rows written (applied and refused entries), unit rows, open challenge marks at the end. */
  ledgerRows: number;
  unitRows: number;
  challengeMarksEnd: number;
  acceptedSessions: number;
  review2: ReviewRow;
  review3: ReviewRow;
}

const emptyRow = (walkers: number): CohortRow => ({
  walkers, sessions: 0, sessionsDayClosed: 0, activeWalkerDays: 0, sessionsWithAccess: 0, claims: 0, defenses: 0, passThrough: 0, contested: 0,
  flips: 0, flipsDeliberate: 0, rewardEvents: 0, dailyLimitRefused: 0, budgetHard: 0, budgetSoft: 0, pushesOnOthers: 0, walkerDaysBlocked: 0,
  unitBudgetRefused: 0, staleRejected: 0, flipsSuffered: 0, flipsSufferedFromAdversary: 0, heldEndUnits: 0, walkersWithGround: 0,
});

export interface Experiment1003Spec extends Population1003Spec {
  unitBudget: number | null;
}

export const DEFAULT_1003: Readonly<Omit<Experiment1003Spec, "seed">> = Object.freeze({
  days: 90, counts: DEFAULT_COUNTS_1003, origin: { latitude: 51.52, longitude: -0.1 }, unitBudget: DEFAULT_UNIT_BUDGET,
});

interface Prepared { walkers: Walker1003[]; sessions: Session1003[]; units8: string[][]; units10: string[][] }

/** The population, sessions and both unit sets of every session, computed once per seed. */
export function prepare1003(spec: Experiment1003Spec): Prepared {
  const { walkers, sessions } = population1003(spec, DAY0);
  const rule = SIM_PILOT_2_PROPOSAL.units.source!.rule;
  return {
    walkers, sessions,
    units8: sessions.map((s) => [...new Set(cellsForObservations(s.fixes.map((f) => ({ latitude: f.lat, longitude: f.lng }))))].sort()),
    units10: sessions.map((s) => pushUnitsOf(deriveSessionPath(s.fixes, [], rule), rule)),
  };
}

function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The linked-account review candidate on linked groups of any size (a candidate only; no sanction exists or is approved). */
export function review1003(seed: number, days: number, R: ReviewSpec, walkers: Walker1003[], accepted: { s: Session1003; day: number; zones: Set<string> }[]): ReviewRow {
  const groups = new Map<string, Walker1003[]>();
  for (const w of walkers) if (w.group) (groups.get(w.group) ?? groups.set(w.group, []).get(w.group)!).push(w);
  const byWalkerDay = new Map<string, typeof accepted>();
  for (const a of accepted) {
    const k = `${a.s.walker}:${a.day}`;
    (byWalkerDay.get(k) ?? byWalkerDay.set(k, []).get(k)!).push(a);
  }
  const jaccard = (x: Set<string>, y: Set<string>) => {
    let inter = 0;
    for (const z of x) if (y.has(z)) inter += 1;
    const union = x.size + y.size - inter;
    return union === 0 ? 0 : inter / union;
  };
  const out: ReviewRow = { groups: {}, flaggedGroups: {}, flaggedAccounts: {}, wronglyUpheld: 0 };
  for (const [gid, members] of groups) {
    const cohort = members[0]!.cohort;
    out.groups[cohort] = (out.groups[cohort] ?? 0) + 1;
    const hits: number[] = [];
    let lastFlag: number | null = null;
    for (let d = 0; d < days; d++) {
      const day = DAY0 + d;
      const ss = members.map((m) => byWalkerDay.get(`${m.id}:${day}`) ?? []);
      // Largest set of members connected by "walked together" (starts within the window and similar zone sets).
      const parent = members.map((_, i) => i);
      const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
      for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
        if (ss[i]!.some((x) => ss[j]!.some((y) => Math.abs(x.s.startMs - y.s.startMs) <= R.startWithinMs && jaccard(x.zones, y.zones) >= R.similarity))) parent[find(i)] = find(j);
      }
      const sizes = new Map<number, number>();
      for (let i = 0; i < members.length; i++) sizes.set(find(i), (sizes.get(find(i)) ?? 0) + 1);
      const together = Math.max(...sizes.values());
      if (together >= 2 && together > R.flagAboveAccounts) hits.push(d);
      const recent = hits.filter((h) => d - h < R.windowDays);
      const exempt = lastFlag !== null && d - lastFlag < Math.max(R.windowDays, R.clearedExemptDays);
      if (!exempt && recent.length >= R.flagDays) {
        lastFlag = d;
        out.flaggedGroups[cohort] = (out.flaggedGroups[cohort] ?? 0) + 1;
        out.flaggedAccounts[cohort] = (out.flaggedAccounts[cohort] ?? 0) + members.length;
        if (cohort !== "duplicate" && prng(hash32(`${seed}:${gid}:${d}`))() < R.wrongUpholdRate) out.wronglyUpheld += 1;
      }
    }
  }
  return out;
}

/** One rule set over one prepared seed. */
export function run1003(spec: Experiment1003Spec, prep: Prepared, cfg: RunConfig): Run1003Row {
  const rules = rulesOf(cfg);
  const fine = rules.units.source?.kind === "session-path";
  const area = getHexagonAreaAvg(fine ? 10 : 8, "km2");
  const cohortOf = new Map(prep.walkers.map((w) => [w.id, w.cohort]));
  const isHonest = (id: string | null) => id !== null && HONEST_1003.includes(cohortOf.get(id)!);
  const isAdv = (id: string | null) => id !== null && ADVERSARY_1003.includes(cohortOf.get(id)!);
  const rows = Object.fromEntries(COHORTS_1003.map((c) => [c, emptyRow(spec.counts[c])])) as Record<Cohort1003, CohortRow>;
  const tk = rules.takeover;
  const windowDays = tk.name === "two-day-challenge" ? tk.windowDays : 0;
  const states = new Map<string, UnitState>();
  let opened = new Map<string, number>();
  const used = new Map<string, number>();
  const unitsSpent = new Map<string, number>();
  const active = new Set<string>();
  const blockedDays = new Set<string>();
  const accepted: { s: Session1003; day: number; zones: Set<string> }[] = [];
  let ledgerRows = 0, advOnHonest = 0, honestOnHonest = 0;

  prep.sessions.forEach((s, n) => {
    const st = rows[s.cohort];
    const day = Math.floor(s.endMs / DAY_MS);
    if (s.receivedMs >= (day + 1) * DAY_MS + rules.dayCloseGraceMs) {
      st.sessionsDayClosed += 1;
      return;
    }
    const unitIds = fine ? prep.units10[n]! : prep.units8[n]!;
    accepted.push({ s, day, zones: new Set(fine ? unitIds.map((u) => cellToParent(u, 9)) : unitIds) });
    st.sessions += 1;
    const wd = `${s.walker}:${day}`;
    if (!active.has(wd)) {
      active.add(wd);
      st.activeWalkerDays += 1;
    }
    const events: PushEvent[] = unitIds.map((u) => ({ eventId: `s${n}:${u}`, unitId: u, walkerId: s.walker, day, push: { kind: "solid" } }));
    for (const u of unitIds) if (!states.has(u)) states.set(u, newUnit(u, day));
    const remaining = spec.unitBudget === null ? null : Math.max(0, spec.unitBudget - (unitsSpent.get(wd) ?? 0));
    // Normalised entries: class, deliberate, previous holder, blocked.
    const out: { cls: string | null; deliberate: boolean; prev: string | null; blocked: "hard" | "soft" | null; outcome: string }[] = [];
    let rejected: string[] = [];
    if (cfg.kind === "server") {
      const pre = new Map(unitIds.map((u) => [u, states.get(u)!]));
      const r = applyServerLedger({
        states: pre, events, holding: rules.holding, budget: rules.takeBudget, takesUsed: new Map([[s.walker, used.get(wd) ?? 0]]),
        unitsRemaining: remaining === null ? undefined : new Map([[s.walker, remaining]]),
        walkOrder: new Map(events.map((e, i) => [e.eventId, i])),
        secondPush: cfg.gap && tk.name === "two-day-challenge" && tk.policyVersion === 2
          ? { minElapsedMs: tk.secondPush.minElapsedMs, windowDays: tk.windowDays, eventReceivedMs: new Map(events.map((e) => [e.eventId, s.receivedMs])), challengeOpenedMs: opened }
          : undefined,
      });
      for (const [u, v] of r.states) states.set(u, v);
      opened = r.challengeOpenedMs;
      used.set(wd, r.takesUsed.get(s.walker) ?? 0);
      unitsSpent.set(wd, (unitsSpent.get(wd) ?? 0) + (r.unitsUsed.get(s.walker) ?? 0));
      rejected = r.results.flatMap((x) => (x.status === "rejected" ? [x.reason] : []));
      for (const e of r.entries) {
        const before = pre.get(e.unitId)!;
        const decayed = e.day >= before.asOfDay ? decayTo(before, e.day, rules.holding) : before;
        const deliberate = decayed.holderId !== null && decayed.holderId !== s.walker
          && (decayed.challenges ?? []).some((c) => c.walkerId === s.walker && c.day < day && day - c.day <= windowDays);
        const cls = e.outcome === "claimed" ? "claim" : e.outcome === "reinforced" ? "defense" : e.outcome === "flipped" ? "flip"
          : e.outcome === "eroded" ? (deliberate ? "contested" : "pass_through") : e.outcome === "refused_take_budget" ? "refused" : null;
        out.push({ cls, deliberate, prev: e.previousHolderId, blocked: e.outcome === "refused_take_budget" ? "hard" : null, outcome: e.outcome });
      }
    } else {
      const r = applySession1003({ states, events, exp: cfg.exp, used: used.get(wd) ?? 0, unitsRemaining: remaining, receivedMs: s.receivedMs, opened, gap: true });
      used.set(wd, r.used);
      unitsSpent.set(wd, (unitsSpent.get(wd) ?? 0) + r.unitsUsed);
      rejected = r.rejected;
      for (const e of r.entries) out.push({ cls: e.blocked === "hard" ? "refused" : e.cls, deliberate: e.deliberate, prev: e.previousHolderId, blocked: e.blocked, outcome: e.outcome });
    }
    for (const reason of rejected) {
      if (reason === "unit_budget") st.unitBudgetRefused += 1;
      else if (reason === "stale_day") st.staleRejected += 1;
    }
    ledgerRows += out.length;
    let access = false, blocked = false;
    for (const e of out) {
      if (e.outcome === "refused_daily_limit") st.dailyLimitRefused += 1;
      if (e.blocked === "hard") st.budgetHard += 1;
      if (e.blocked === "soft") st.budgetSoft += 1;
      if (e.blocked) blocked = true;
      switch (e.cls) {
        case "claim": st.claims += 1; st.rewardEvents += 1; access = true; break;
        case "defense": st.defenses += 1; access = true; break;
        case "pass_through": st.passThrough += 1; st.pushesOnOthers += 1; break;
        case "contested": st.contested += 1; st.pushesOnOthers += 1; break;
        case "refused": st.pushesOnOthers += 1; break;
        case "flip": {
          st.flips += 1; st.rewardEvents += 1; st.pushesOnOthers += 1;
          if (e.deliberate) st.flipsDeliberate += 1;
          if (e.prev !== null) {
            const lost = rows[cohortOf.get(e.prev)!];
            lost.flipsSuffered += 1;
            if (isAdv(s.walker)) lost.flipsSufferedFromAdversary += 1;
            if (isHonest(e.prev) && isAdv(s.walker)) advOnHonest += 1;
            if (isHonest(e.prev) && isHonest(s.walker)) honestOnHonest += 1;
          }
          break;
        }
      }
    }
    if (access) st.sessionsWithAccess += 1;
    if (blocked && !blockedDays.has(wd)) {
      blockedDays.add(wd);
      st.walkerDaysBlocked += 1;
    }
  });

  const lastDay = DAY0 + spec.days;
  const held = new Map<string, number>();
  let total = 0, marks = 0;
  for (const u of states.values()) {
    const d = decayTo(u, Math.max(lastDay, u.asOfDay), rules.holding);
    if (d.holderId !== null) marks += (d.challenges ?? []).filter((c) => lastDay - c.day <= windowDays).length;
    if (d.holderId === null || stageOf(d, rules.holding) === "unheld") continue;
    rows[cohortOf.get(d.holderId)!].heldEndUnits += 1;
    held.set(d.holderId, (held.get(d.holderId) ?? 0) + 1);
    total += 1;
  }
  for (const id of held.keys()) rows[cohortOf.get(id)!].walkersWithGround += 1;
  const sorted = [...prep.walkers.map((w) => held.get(w.id) ?? 0)].sort((a, b) => b - a);
  const top = sorted.slice(0, Math.max(1, Math.round(sorted.length / 10))).reduce((a, b) => a + b, 0);
  return {
    label: cfg.label, seed: spec.seed, unitAreaKm2: area, cohorts: rows, heldEndUnits: total, top10Share: total === 0 ? 0 : top / total,
    adversaryFlipsOnHonest: advOnHonest, honestFlipsOnHonest: honestOnHonest, ledgerRows, unitRows: states.size, challengeMarksEnd: marks,
    acceptedSessions: accepted.length,
    review2: review1003(spec.seed, spec.days, REVIEW_2PLUS, prep.walkers, accepted),
    review3: review1003(spec.seed, spec.days, REVIEW_3PLUS, prep.walkers, accepted),
  };
}

/** Every rule set on one seed, on identical sessions. */
export function experiment1003Seed(seed: number, over: Partial<Omit<Experiment1003Spec, "seed">> = {}, runs: readonly RunConfig[] = RUNS_1003): Run1003Row[] {
  const spec: Experiment1003Spec = { ...DEFAULT_1003, ...over, seed };
  const prep = prepare1003(spec);
  return runs.map((cfg) => run1003(spec, prep, cfg));
}
