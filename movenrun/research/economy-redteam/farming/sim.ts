/**
 * Deterministic synthetic study of a linked-account review rule (B6).
 *
 * Accounts are pseudonymous synthetic ids. Nothing here reads a real wallet, device, residence or route.
 * The rule under test is the one the #123 study proposed: two or more LINKED accounts walking together on
 * `threshold` of the trailing 14 days opens an appealable review. Proximity between accounts that are not
 * linked is never evidence; a proximity-only counterfactual is computed solely to show what that would cost.
 * No review changes credits, XP or standing here: the output is a list of cases and who is in them.
 */
import { readFileSync } from "node:fs";
import { mulberry32, summarise, type Summary } from "./stats.ts";

export const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8")) as {
  seeds: number[];
  populations: number[];
  horizonDays: number;
  windowDays: number;
  coWalkStartToleranceMinutes: number;
  mix: Record<string, number>;
  ringShareOfPopulation: Record<string, number>;
  linkProbabilityPerPair: Record<string, number>;
  traceTightProbability: Record<string, number>;
  reviewer: { upholdTrueRing: number; upholdHonest: number };
  variants: Variant[];
  staffMinutes: {
    firstReviewPerCase: Record<"low" | "mid" | "high", number>;
    appealPerCase: Record<"low" | "mid" | "high", number>;
    appealShareOfUpheld: Record<"low" | "mid" | "high", number>;
  };
};
export interface Variant { name: string; threshold: number; needTight: boolean; honestTightScale: number }

export const HONEST_COHORTS = ["solo", "commute_corridor", "night_shift", "dense_park", "public_transit", "gps_drift_neighbours", "siblings", "shared_household", "guide_trainees", "organised_walk", "group_event"] as const;
export const RING_COHORTS = ["ring_linked", "ring_unlinked", "ring_linked_staggered", "ring_linked_spaced"] as const;
export const STRANGER_COHORTS = ["solo", "commute_corridor", "night_shift", "dense_park", "public_transit", "gps_drift_neighbours"] as const;
export const LINKED_COHORTS = ["siblings", "shared_household", "guide_trainees", "organised_walk", "group_event"] as const;
export type Cohort = (typeof HONEST_COHORTS)[number] | (typeof RING_COHORTS)[number];

interface Acc { id: string; cohort: Cohort; group: number }
interface Presence { route: number; start: number }
interface Edge { a: number; b: number; relation: string; truth: "honest" | "ring"; coDays: { day: number; uTight: number }[]; uReview: number }

export interface World {
  seed: number;
  n: number;
  accounts: Acc[];
  presence: (Presence | null)[][];
  edges: Edge[];
}

const uni = (r: () => number, lo: number, hi: number) => lo + (hi - lo) * r();

export function buildWorld(seed: number, nominal: number): World {
  const m = manifest;
  const r = mulberry32(seed * 7919 + nominal);
  const H = m.horizonDays;
  const ringCounts = Object.fromEntries(RING_COHORTS.map((c) => [c, Math.max(3, Math.floor((m.ringShareOfPopulation[c]! * nominal) / 3) * 3)])) as Record<(typeof RING_COHORTS)[number], number>;
  const ringTotal = RING_COHORTS.reduce((a, c) => a + ringCounts[c], 0);
  const honestN = nominal - ringTotal;
  const accounts: Acc[] = [];
  const add = (cohort: Cohort, group: number) => accounts.push({ id: `a${String(accounts.length + 1).padStart(4, "0")}`, cohort, group });
  const sizes: Record<string, number> = { siblings: 2, shared_household: 3, guide_trainees: 5, organised_walk: 25, group_event: 30 };
  let groupCounter = 0;
  let used = 0;
  for (const c of HONEST_COHORTS) {
    if (c === "solo") continue;
    const target = Math.round(m.mix[c]! * honestN);
    let left = target;
    const unit = sizes[c];
    if (unit) {
      while (left > 0) {
        const k = Math.min(unit, left);
        if (k < 2) break;
        const g = groupCounter++;
        for (let i = 0; i < k; i++) add(c, g);
        left -= k; used += k;
      }
      // remainder that cannot form a group falls through to solo below
    } else {
      const g0 = groupCounter;
      const groups = c === "commute_corridor" ? Math.max(2, Math.round(honestN / 40)) : c === "night_shift" ? Math.max(1, Math.round(honestN / 120)) : c === "dense_park" ? Math.max(1, Math.round(honestN / 30)) : c === "public_transit" ? Math.max(1, Math.round(honestN / 50)) : Math.max(1, Math.ceil(target / 5));
      groupCounter += groups;
      for (let i = 0; i < target; i++) add(c, g0 + (i % groups));
      used += target;
    }
  }
  while (used < honestN) { add("solo", groupCounter++); used++; }
  for (const c of RING_COHORTS) {
    for (let i = 0; i < ringCounts[c]; i++) {
      add(c, groupCounter);
      if (i % 3 === 2) groupCounter++;
    }
  }
  const n = accounts.length;

  // Index members by group.
  const members = new Map<number, number[]>();
  accounts.forEach((a, i) => { const l = members.get(a.group) ?? []; members.set(a.group, l); l.push(i); });

  // Presence.
  const presence: (Presence | null)[][] = accounts.map(() => new Array<Presence | null>(H).fill(null));
  const weekday = (d: number) => d % 7 < 5;
  const baseOf = (g: number, salt: number) => 360 + ((g * 37 + salt * 11) % 300);
  for (const [g, list] of members) {
    const first = accounts[list[0]!]!;
    const c = first.cohort;
    const eventDay = Math.floor(uni(r, 20, 80));
    for (let d = 0; d < H; d++) {
      const own = (i: number, p: number) => { if (r() < p) presence[i]![d] = { route: 10_000 + i * 8 + Math.floor(r() * (r() < 0.8 ? 1 : 5)), start: Math.floor(uni(r, 360, 1200)) }; };
      switch (c) {
        case "solo": for (const i of list) own(i, 0.6); break;
        case "commute_corridor": case "night_shift": case "public_transit": {
          const night = c === "night_shift";
          const p = c === "public_transit" ? 0.8 : 0.75;
          const base = night ? 21 * 60 + (g % 4) * 10 : baseOf(g, c === "public_transit" ? 5 : 1);
          const route = (c === "public_transit" ? 4_000_000 : c === "night_shift" ? 6_000_000 : 2_000_000) + g;
          const spread = c === "public_transit" ? 5 : 8;
          for (const i of list) if (weekday(d) && r() < p) presence[i]![d] = { route, start: Math.floor(base + uni(r, -spread, spread)) };
          break;
        }
        case "dense_park": for (const i of list) if (r() < 0.5) presence[i]![d] = { route: 3_000_000 + g * 8 + Math.floor(r() * 8), start: Math.floor(uni(r, 360, 1200)) }; break;
        case "gps_drift_neighbours": for (const i of list) if (r() < 0.55) presence[i]![d] = { route: r() < 0.15 ? 5_000_000 + g : 10_000 + i * 8, start: Math.floor(uni(r, 400, 1200)) }; break;
        case "siblings": case "shared_household": case "guide_trainees": {
          const tau = c === "siblings" ? 0.45 : c === "shared_household" ? 0.4 : 0.3;
          if (r() < tau) {
            const route = 7_000_000 + g * 8 + Math.floor(r() * 3), base = Math.floor(uni(r, 360, 1200));
            for (const i of list) if (c !== "guide_trainees" || i === list[0] || r() < 0.85) presence[i]![d] = { route, start: Math.floor(base + uni(r, -3, 3)) };
          } else for (const i of list) own(i, 0.4);
          break;
        }
        case "organised_walk": {
          if (d % 7 === 2 || d % 7 === 5) { for (const i of list) if (r() < 0.7) presence[i]![d] = { route: 8_000_000 + g, start: Math.floor(1080 + uni(r, -5, 5)) }; }
          else for (const i of list) own(i, 0.3);
          break;
        }
        case "group_event": {
          if (d === eventDay) { for (const i of list) if (r() < 0.7) presence[i]![d] = { route: 9_000_000 + g, start: Math.floor(600 + uni(r, -10, 10)) }; }
          else for (const i of list) own(i, 0.4);
          break;
        }
        case "ring_linked": case "ring_unlinked": case "ring_linked_spaced": case "ring_linked_staggered": {
          if (r() < 0.9) {
            const route = 11_000_000 + g * 4 + Math.floor(r() * 2), base = Math.floor(uni(r, 360, 1200));
            list.forEach((i, k) => { presence[i]![d] = { route, start: c === "ring_linked_staggered" ? base + k * Math.floor(uni(r, 25, 40)) : Math.floor(base + uni(r, -2, 2)) }; });
          }
          break;
        }
      }
    }
  }

  // Link edges.
  const edges: Edge[] = [];
  const L = m.linkProbabilityPerPair;
  const addEdge = (a: number, b: number, relation: string, truth: "honest" | "ring") => edges.push({ a, b, relation, truth, coDays: [], uReview: r() });
  for (const [, list] of members) {
    const c = accounts[list[0]!]!.cohort;
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
      const a = list[x]!, b = list[y]!;
      if (c === "siblings" || c === "shared_household" || c === "organised_walk" || c === "group_event") { if (r() < L[c]!) addEdge(a, b, c, "honest"); }
      else if (c === "guide_trainees") { const p = x === 0 ? L["guide_trainees_guide_trainee"]! : L["guide_trainees_trainee_trainee"]!; if (r() < p) addEdge(a, b, "guide_trainee", "honest"); }
      else if ((RING_COHORTS as readonly string[]).includes(c)) { if (r() < L[c]!) addEdge(a, b, c === "ring_linked_spaced" ? "ring_spaced" : "ring_tight", "ring"); }
      else if (c !== "solo") { if (r() < L["stranger_shared_infrastructure"]!) addEdge(a, b, "stranger", "honest"); }
    }
  }

  // Co-walk days on linked edges, with a pre-drawn tightness uniform (same draw reused by every variant).
  const tol = m.coWalkStartToleranceMinutes;
  for (const e of edges) {
    for (let d = 0; d < H; d++) {
      const pa = presence[e.a]![d], pb = presence[e.b]![d];
      if (pa && pb && pa.route === pb.route && Math.abs(pa.start - pb.start) <= tol) e.coDays.push({ day: d, uTight: r() });
    }
  }
  return { seed, n, accounts, presence, edges };
}

const tightProb = (relation: string, v: Variant): number => {
  const base = manifest.traceTightProbability[relation === "ring_tight" || relation === "ring_spaced" ? relation : relation === "guide_trainee" ? "guide_trainee" : relation]!;
  const honest = !relation.startsWith("ring");
  return Math.min(1, honest ? base * v.honestTightScale : base);
};

export interface VariantRun {
  variant: string;
  seed: number;
  n: number;
  /** account index -> first flag day (any edge), or -1 */
  firstFlag: Int32Array;
  upheld: Uint8Array;
  cases: number;
  casesUpheld: number;
  casesTrulyRing: number;
  casesHonestUpheld: number;
}

export function evaluate(w: World, v: Variant): VariantRun {
  const W = manifest.windowDays;
  const firstFlag = new Int32Array(w.n).fill(-1);
  const flaggedEdges: number[] = [];
  w.edges.forEach((e, ei) => {
    const days = e.coDays.filter((c) => !v.needTight || c.uTight < tightProb(e.relation, v)).map((c) => c.day);
    for (let i = v.threshold - 1; i < days.length; i++) {
      if (days[i]! - days[i - (v.threshold - 1)]! <= W - 1) {
        const f = days[i]!;
        flaggedEdges.push(ei);
        for (const a of [e.a, e.b]) if (firstFlag[a] === -1 || f < firstFlag[a]!) firstFlag[a] = f;
        break;
      }
    }
  });
  // Cases = connected components of flagged edges.
  const parent = new Map<number, number>();
  const find = (x: number): number => { let p = parent.get(x) ?? x; if (p !== x) { p = find(p); parent.set(x, p); } return p; };
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const ei of flaggedEdges) { const e = w.edges[ei]!; parent.set(e.a, parent.get(e.a) ?? e.a); parent.set(e.b, parent.get(e.b) ?? e.b); union(e.a, e.b); }
  const comps = new Map<number, number[]>();
  for (const ei of flaggedEdges) { const root = find(w.edges[ei]!.a); const l = comps.get(root) ?? []; comps.set(root, l); l.push(ei); }
  const upheld = new Uint8Array(w.n);
  let casesUpheld = 0, casesTrulyRing = 0, casesHonestUpheld = 0;
  for (const [root, eis] of comps) {
    const ring = eis.some((ei) => w.edges[ei]!.truth === "ring");
    if (ring) casesTrulyRing++;
    const u = w.edges[eis[0]!]!.uReview;
    const up = u < (ring ? manifest.reviewer.upholdTrueRing : manifest.reviewer.upholdHonest);
    if (up) {
      casesUpheld++;
      if (!ring) casesHonestUpheld++;
      const accs = new Set<number>();
      for (const ei of eis) { accs.add(w.edges[ei]!.a); accs.add(w.edges[ei]!.b); }
      for (const a of accs) upheld[a] = 1;
    }
    void root;
  }
  return { variant: v.name, seed: w.seed, n: w.n, firstFlag, upheld, cases: comps.size, casesUpheld, casesTrulyRing, casesHonestUpheld };
}

export interface ProximityCounterfactual { reviewedByCohort: Record<string, number>; avgLiveProximityRecords: number; avgLiveLinkedRecords: number; linkEdges: number; falseLinkEdges: number }
/** What a stored proximity graph would flag at the same threshold, and how many pair-day records each design keeps live (14-day retention). */
export function proximityCounterfactual(w: World, threshold: number): ProximityCounterfactual {
  const H = manifest.horizonDays, W = manifest.windowDays, tol = manifest.coWalkStartToleranceMinutes;
  const pairDays = new Map<number, number[]>(); // key a*n+b -> days
  const perDay = new Array<number>(H).fill(0);
  for (let d = 0; d < H; d++) {
    const byRoute = new Map<number, number[]>();
    for (let i = 0; i < w.n; i++) { const p = w.presence[i]![d]; if (p) { const l = byRoute.get(p.route) ?? []; byRoute.set(p.route, l); l.push(i); } }
    for (const l of byRoute.values()) for (let x = 0; x < l.length; x++) for (let y = x + 1; y < l.length; y++) {
      if (Math.abs(w.presence[l[x]!]![d]!.start - w.presence[l[y]!]![d]!.start) <= tol) {
        const k = l[x]! * w.n + l[y]!;
        const days = pairDays.get(k) ?? []; pairDays.set(k, days); days.push(d); perDay[d]!++;
      }
    }
  }
  const reviewed = new Set<number>();
  for (const [k, days] of pairDays) for (let i = threshold - 1; i < days.length; i++) if (days[i]! - days[i - (threshold - 1)]! <= W - 1) { reviewed.add(Math.floor(k / w.n)); reviewed.add(k % w.n); break; }
  const reviewedByCohort: Record<string, number> = {};
  const count: Record<string, number> = {};
  w.accounts.forEach((a, i) => { count[a.cohort] = (count[a.cohort] ?? 0) + 1; if (reviewed.has(i)) reviewedByCohort[a.cohort] = (reviewedByCohort[a.cohort] ?? 0) + 1; });
  for (const c of Object.keys(count)) reviewedByCohort[c] = (reviewedByCohort[c] ?? 0) / count[c]!;
  const linkedPerDay = new Array<number>(H).fill(0);
  for (const e of w.edges) for (const c of e.coDays) linkedPerDay[c.day]!++;
  const live = (arr: number[]) => { let s = 0, k = 0; for (let d = W; d < H; d++) { let t = 0; for (let j = d - W + 1; j <= d; j++) t += arr[j]!; s += t; k++; } return s / k; };
  return { reviewedByCohort, avgLiveProximityRecords: live(perDay), avgLiveLinkedRecords: live(linkedPerDay), linkEdges: w.edges.length, falseLinkEdges: w.edges.filter((e) => e.relation === "stranger").length };
}

/* ── aggregation ──────────────────────────────────────────────────────────── */
export interface CohortStat { cohort: Cohort; accounts: Summary; reviewed: Summary; wronglyUpheld: Summary; medianDaysToFlag?: Summary }
export interface VariantAgg {
  variant: string;
  n: number;
  cohorts: CohortStat[];
  honestReviewed: Summary;
  honestWronglyUpheld: Summary;
  strangersReviewed: Summary;
  linkedFamiliesReviewed: Summary;
  casesPer1000: Summary;
  upheldCasesPer1000: Summary;
  /** Workload from honest groups only (what the queue would hold with no rings at all). */
  honestCasesPer1000: Summary;
  honestUpheldCasesPer1000: Summary;
}

export function aggregate(nominal: number, seeds: readonly number[] = manifest.seeds, variants: readonly Variant[] = manifest.variants): { aggs: VariantAgg[]; privacy: Record<string, Summary>; proximity: Record<number, Record<string, Summary>> } {
  const cohorts: Cohort[] = [...HONEST_COHORTS, ...RING_COHORTS];
  const per = new Map<string, { runs: VariantRun[]; worlds: World[] }>();
  const privacyAcc: Record<string, number[]> = { liveProximityPer1000: [], liveLinkedPer1000: [], linkEdgesPer1000: [], falseLinkEdgesPer1000: [] };
  const prox: Record<number, Record<string, number[]>> = {};
  for (const s of seeds) {
    const w = buildWorld(s, nominal);
    for (const v of variants) { const l = per.get(v.name) ?? { runs: [], worlds: [] }; per.set(v.name, l); l.runs.push(evaluate(w, v)); l.worlds.push(w); }
    const pc = proximityCounterfactual(w, 4);
    privacyAcc.liveProximityPer1000!.push((pc.avgLiveProximityRecords * 1000) / w.n);
    privacyAcc.liveLinkedPer1000!.push((pc.avgLiveLinkedRecords * 1000) / w.n);
    privacyAcc.linkEdgesPer1000!.push((pc.linkEdges * 1000) / w.n);
    privacyAcc.falseLinkEdgesPer1000!.push((pc.falseLinkEdges * 1000) / w.n);
    const row = (prox[4] ??= {});
    for (const c of Object.keys(pc.reviewedByCohort)) (row[c] ??= []).push(pc.reviewedByCohort[c]!);
  }
  const aggs: VariantAgg[] = variants.map((v) => {
    const { runs, worlds } = per.get(v.name)!;
    const cs: CohortStat[] = [];
    const frac = (pred: (c: Cohort) => boolean, f: (run: VariantRun, i: number) => boolean) =>
      runs.map((run, k) => { const w = worlds[k]!; let num = 0, den = 0; w.accounts.forEach((a, i) => { if (pred(a.cohort)) { den++; if (f(run, i)) num++; } }); return den ? num / den : NaN; }).filter((x) => !Number.isNaN(x));
    for (const c of cohorts) {
      const counts = worlds.map((w) => w.accounts.filter((a) => a.cohort === c).length);
      if (counts.every((x) => x === 0)) continue;
      const stat: CohortStat = {
        cohort: c,
        accounts: summarise(counts),
        reviewed: summarise(frac((x) => x === c, (run, i) => run.firstFlag[i]! >= 0)),
        wronglyUpheld: summarise(frac((x) => x === c, (run, i) => run.upheld[i] === 1)),
      };
      if ((RING_COHORTS as readonly string[]).includes(c)) {
        const meds: number[] = [];
        runs.forEach((run, k) => { const w = worlds[k]!; const ds: number[] = []; w.accounts.forEach((a, i) => { if (a.cohort === c && run.firstFlag[i]! >= 0) { const firstActive = w.presence[i]!.findIndex((p) => p); ds.push(run.firstFlag[i]! - firstActive); } }); if (ds.length) { ds.sort((x, y) => x - y); meds.push(ds[Math.floor(ds.length / 2)]!); } });
        if (meds.length) stat.medianDaysToFlag = summarise(meds);
      }
      cs.push(stat);
    }
    const isHonest = (c: Cohort) => (HONEST_COHORTS as readonly string[]).includes(c);
    return {
      variant: v.name, n: nominal, cohorts: cs,
      honestReviewed: summarise(frac(isHonest, (run, i) => run.firstFlag[i]! >= 0)),
      honestWronglyUpheld: summarise(frac(isHonest, (run, i) => run.upheld[i] === 1)),
      strangersReviewed: summarise(frac((c) => (STRANGER_COHORTS as readonly string[]).includes(c), (run, i) => run.firstFlag[i]! >= 0)),
      linkedFamiliesReviewed: summarise(frac((c) => (LINKED_COHORTS as readonly string[]).includes(c), (run, i) => run.firstFlag[i]! >= 0)),
      casesPer1000: summarise(runs.map((r) => (r.cases * 1000) / r.n)),
      upheldCasesPer1000: summarise(runs.map((r) => (r.casesUpheld * 1000) / r.n)),
      honestCasesPer1000: summarise(runs.map((r) => ((r.cases - r.casesTrulyRing) * 1000) / r.n)),
      honestUpheldCasesPer1000: summarise(runs.map((r) => (r.casesHonestUpheld * 1000) / r.n)),
    };
  });
  const privacy = Object.fromEntries(Object.entries(privacyAcc).map(([k, v]) => [k, summarise(v)]));
  const proximity: Record<number, Record<string, Summary>> = { 4: Object.fromEntries(Object.entries(prox[4]!).map(([c, v]) => [c, summarise(v)])) };
  return { aggs, privacy, proximity };
}

/** Staff minutes per 1,000 participants over the 90-day horizon, for low / mid / high assumptions. */
export function staffMinutesPer1000(casesPer1000: number, upheldPer1000: number): Record<"low" | "mid" | "high", number> {
  const s = manifest.staffMinutes;
  const f = (k: "low" | "mid" | "high") => casesPer1000 * s.firstReviewPerCase[k] + upheldPer1000 * s.appealShareOfUpheld[k] * s.appealPerCase[k];
  return { low: f("low"), mid: f("mid"), high: f("high") };
}

/** Average credit weight of a fresh account over the horizon if trust rises linearly to 1 over `rampDays`. */
export function slowTrustAverageWeight(rampDays: number, horizon = manifest.horizonDays): number {
  let s = 0;
  for (let d = 0; d < horizon; d++) s += Math.min(1, (d + 1) / rampDays);
  return s / horizon;
}
