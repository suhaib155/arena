/**
 * G5 Sybil study: how many deeds a ring of k linked accounts can obtain, under
 * the prototype contract's controls ("current") and under the draft patch's
 * controls ("proposed", shared/contract-proofs/g5-ledger/patched). SIMULATION
 * ONLY: synthetic accounts on synthetic cells; nothing here is real-world proof.
 *
 * The ring is a set of k accounts run by one operator in one city. Each member
 * holds `cellsPerMember` cells and keeps them solid every day; the other
 * members cross those cells on a rotation so that distinct crossers build up.
 *
 * ASSUMPTION R1: the ring coordinates, so a crossing never costs a member
 * their cell (the holder retakes it before day close). Honest walkers cannot
 * do this, which is why honest ground almost never reaches 30 crossers in the
 * season simulations (G5_G7_ECONOMY_RESEARCH.md §2.2) while a ring can.
 *
 * ASSUMPTION R2: the risk graph links each member to the operator's cluster
 * independently with probability `detectionRate` before the claim, and with
 * probability `lateDetectionRate` during the patched 7-day challenge window.
 * Undetected members look like unrelated singletons.
 *
 * Off-chain eligibility reuses `deedEligibility` from economyG5.ts unchanged,
 * so the related-traffic and 20% cluster-share rules are exactly the ones the
 * season studies use.
 */

import { SIM_ONLY } from "./pilotRuleset";
import { DEED_RULES_SOURCE, deedEligibility, type DeedRules } from "./economyG5";
import type { SeasonTrace, TraceDay } from "./trace";
import { rng } from "./world";

export const RING_STATUS = SIM_ONLY;

export interface RingScenario {
  /** Ring members (accounts). */
  k: number;
  /** Cells each member holds. */
  cellsPerMember: number;
  /** Season days simulated. */
  days: number;
  /** Members crossing each cell per day (rotating). */
  crossersPerCellPerDay: number;
  /** P(member linked to the operator's cluster before the claim). */
  detectionRate: number;
  /** P(member linked during the challenge window, so a pending deed is voided). Proposed regime only. */
  lateDetectionRate: number;
}

export interface OnChainControls {
  label: string;
  /** Most deeds one wallet may hold in the city (prototype `capPerHolder`). Null: none. */
  perHolderCap: number | null;
  /** Most claims per risk-graph cluster per city (patch `maxDeedsPerCluster`). Null: none. */
  perClusterCap: number | null;
  /** Most deeds the city may hold in total (patch `cityWideCap`). Null: none. */
  cityWideCap: number | null;
  /** Claims per city per day (patch `maxClaimsPerCityPerDay`). Null: none. */
  perCityPerDay: number | null;
  /** Whether pending deeds of members linked during the window are voided. */
  challengeWindow: boolean;
}

/** The prototype contract at c8262ec: one per-holder cap, nothing else on chain. */
export const CURRENT_CONTROLS: Readonly<OnChainControls> = Object.freeze({
  label: "current (prototype c8262ec)",
  perHolderCap: 1,
  perClusterCap: null,
  cityWideCap: null,
  perCityPerDay: null,
  challengeWindow: false,
});

/** The G5 draft patch defaults. The city-wide cap here is a research value, not a decision. */
export const PROPOSED_CONTROLS: Readonly<OnChainControls> = Object.freeze({
  label: "proposed (G5 draft patch)",
  perHolderCap: 1,
  perClusterCap: 1,
  cityWideCap: 50,
  perCityPerDay: 5,
  challengeWindow: true,
});

/** The research comparator rule that honest players can reach (G5_G7_ECONOMY_RESEARCH.md §2.2). */
export const DEED_RULES_LOOSE: Readonly<DeedRules> = Object.freeze({
  ...DEED_RULES_SOURCE,
  label: "7 d / 5 / 3 d (comparator)",
  tenureDays: 7,
  distinctCrossers: 5,
  trafficDays: 3,
});

const memberId = (i: number) => `ring-${String(i).padStart(3, "0")}`;
const cellId = (i: number, c: number) => `cell-${String(i).padStart(3, "0")}-${c}`;

/** Synthetic trace of a coordinated ring (R1). Deterministic: no randomness inside. */
export function ringTrace(s: RingScenario): SeasonTrace {
  const players = Array.from({ length: s.k }, (_, i) => ({ id: memberId(i), profile: "colluder" as const, club: null }));
  const days: TraceDay[] = [];
  const perDay = Math.min(s.crossersPerCellPerDay, s.k - 1);
  for (let day = 1; day <= s.days; day++) {
    const held: TraceDay["held"] = [];
    const stepped: TraceDay["stepped"] = [];
    for (let i = 0; i < s.k; i++) {
      for (let c = 0; c < s.cellsPerMember; c++) {
        const u = cellId(i, c);
        held.push([u, memberId(i), "solid"]);
        if (perDay <= 0) continue;
        const walkers: string[] = [];
        for (let r = 0; r < perDay; r++) {
          // Rotation over the other k-1 members, offset by day so new crossers keep arriving.
          const offset = 1 + (((day - 1) * perDay + r + c) % (s.k - 1));
          walkers.push(memberId((i + offset) % s.k));
        }
        stepped.push([u, [...new Set(walkers)].sort()]);
      }
    }
    held.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    stepped.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    days.push({ day, poolMicro: 0, dayShareMicro: 0, lines: [], levelSpendMicro: [], held, stepped });
  }
  return { status: SIM_ONLY, ruleset: "ring", seed: 0, units: s.k * s.cellsPerMember, players, days };
}

export interface RingOutcome {
  /** Deeds the off-chain rule would issue (before any on-chain control). */
  offChainEligible: number;
  /** Deeds that survive the on-chain controls. */
  deeds: number;
  /** Distinct members holding at least one deed. */
  membersWithDeed: number;
}

/** Applies on-chain controls to an off-chain eligible list, in claim-day order. */
export function applyControls(
  eligible: { unitId: string; holderId: string; day: number }[],
  clusterOf: (id: string) => string,
  lateDetected: Set<string>,
  ctl: OnChainControls,
): RingOutcome {
  const perHolder = new Map<string, number>();
  const perCluster = new Map<string, number>();
  const perDay = new Map<number, number>();
  const kept: { holderId: string }[] = [];
  // Claims refused by the daily limit are retried the next day (the ring is patient).
  const queue = [...eligible].sort((a, b) => a.day - b.day || (a.unitId < b.unitId ? -1 : 1));
  for (const e of queue) {
    if (ctl.perHolderCap !== null && (perHolder.get(e.holderId) ?? 0) >= ctl.perHolderCap) continue;
    const cl = clusterOf(e.holderId);
    if (ctl.perClusterCap !== null && (perCluster.get(cl) ?? 0) >= ctl.perClusterCap) continue;
    if (ctl.cityWideCap !== null && kept.length >= ctl.cityWideCap) break;
    let day = e.day;
    if (ctl.perCityPerDay !== null) while ((perDay.get(day) ?? 0) >= ctl.perCityPerDay) day += 1;
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
    perHolder.set(e.holderId, (perHolder.get(e.holderId) ?? 0) + 1);
    perCluster.set(cl, (perCluster.get(cl) ?? 0) + 1);
    // The cluster cap counts claims, so a voided claim still uses the cluster's slot.
    if (ctl.challengeWindow && lateDetected.has(e.holderId)) continue;
    kept.push(e);
  }
  return { offChainEligible: eligible.length, deeds: kept.length, membersWithDeed: new Set(kept.map((x) => x.holderId)).size };
}

export interface RingRow {
  status: typeof SIM_ONLY;
  rules: string;
  controls: string;
  k: number;
  detectionRate: number;
  trials: number;
  meanDeeds: number;
  minDeeds: number;
  maxDeeds: number;
  meanOffChainEligible: number;
  /** Deeds per member. */
  deedsPerAccount: number;
}

/**
 * Seeded Monte Carlo over detection draws. One synthetic trace per scenario
 * (the ring's behaviour does not depend on who is detected); detection only
 * changes the cluster map and the late-detection set.
 */
export function ringDeedYield(
  s: RingScenario,
  rules: DeedRules,
  controls: OnChainControls[],
  opts: { trials?: number; seed?: number } = {},
): RingRow[] {
  const trials = opts.trials ?? 40;
  const trace = ringTrace(s);
  const acc = controls.map(() => ({ sum: 0, min: Infinity, max: -Infinity, elig: 0 }));
  const r = rng(opts.seed ?? 20261018 + s.k * 1009 + Math.round(s.detectionRate * 1000));
  for (let t = 0; t < trials; t++) {
    const detected = new Set<string>();
    const late = new Set<string>();
    for (const p of trace.players) {
      if (r() < s.detectionRate) detected.add(p.id);
      else if (r() < s.lateDetectionRate) late.add(p.id);
    }
    const clusterOf = (id: string) => (detected.has(id) ? "cluster:operator" : `cluster:${id}`);
    // Off-chain: the season study's rule with no cap (caps are applied as on-chain controls).
    const report = deedEligibility(trace, { ...rules, perHolderCap: null, cityCapShare: null }, clusterOf);
    controls.forEach((ctl, i) => {
      const o = applyControls(report.deeds, clusterOf, late, ctl);
      const a = acc[i]!;
      a.sum += o.deeds;
      a.elig += o.offChainEligible;
      a.min = Math.min(a.min, o.deeds);
      a.max = Math.max(a.max, o.deeds);
    });
  }
  return controls.map((ctl, i) => {
    const a = acc[i]!;
    return {
      status: SIM_ONLY,
      rules: rules.label,
      controls: ctl.label,
      k: s.k,
      detectionRate: s.detectionRate,
      trials,
      meanDeeds: a.sum / trials,
      minDeeds: a.min,
      maxDeeds: a.max,
      meanOffChainEligible: a.elig / trials,
      deedsPerAccount: a.sum / trials / s.k,
    };
  });
}

/** Smallest ring that gets at least one deed with no detection: distinctCrossers + 1 (the holder never counts). */
export function minimumRing(rules: DeedRules): number {
  return rules.distinctCrossers + 1;
}

export const RING_SIZES = [6, 10, 20, 31, 40, 60, 100];
export const RING_DETECTION = [0, 0.3, 0.6];

export function ringStudy(opts: { trials?: number; sizes?: number[]; detection?: number[] } = {}): RingRow[] {
  const rows: RingRow[] = [];
  for (const rules of [DEED_RULES_SOURCE, DEED_RULES_LOOSE]) {
    for (const k of opts.sizes ?? RING_SIZES) {
      for (const d of opts.detection ?? RING_DETECTION) {
        const s: RingScenario = { k, cellsPerMember: 3, days: 90, crossersPerCellPerDay: 10, detectionRate: d, lateDetectionRate: 0.2 };
        rows.push(...ringDeedYield(s, rules, [CURRENT_CONTROLS, PROPOSED_CONTROLS], { trials: opts.trials }));
      }
    }
  }
  return rows;
}

export function ringTable(rows: RingRow[]): string {
  const out = ["| Deed rule | k | Detection | Off-chain eligible | Current deeds | Proposed deeds |", "|---|---|---|---|---|---|"];
  const key = (r: RingRow) => `${r.rules}|${r.k}|${r.detectionRate}`;
  const groups = new Map<string, RingRow[]>();
  for (const r of rows) groups.set(key(r), [...(groups.get(key(r)) ?? []), r]);
  const f = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
  for (const g of groups.values()) {
    const cur = g.find((r) => r.controls === CURRENT_CONTROLS.label)!;
    const pro = g.find((r) => r.controls === PROPOSED_CONTROLS.label)!;
    out.push(
      `| ${cur.rules} | ${cur.k} | ${cur.detectionRate} | ${f(cur.meanOffChainEligible)} | ${f(cur.meanDeeds)} (${cur.minDeeds}–${cur.maxDeeds}) | ${f(pro.meanDeeds)} (${pro.minDeeds}–${pro.maxDeeds}) |`,
    );
  }
  return out.join("\n");
}
