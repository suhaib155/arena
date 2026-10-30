/**
 * Lifecycle capacity model (G34_DATA_LIFECYCLE.md section 4). SIMULATION ONLY.
 *
 * A linear, deliberately conservative projection of database size under the
 * PLANNING retention assumptions (14-day raw window, 120-day proofs and
 * movement summaries, 90-day season), for ordinary and hostile populations.
 * Every input is a measurement from the local bench (G34_STORAGE_CAPACITY.md
 * sections 11 and 14, and the churn study in the lifecycle doc) or a labelled
 * assumption. The quota is ASSUMED (500 MiB, Supabase Free's published
 * allowance); the owner must confirm the real one. Nothing here is read by the
 * service, and nothing here is live policy.
 */
import { MIB } from "./capacity.js";

export type ChurnRegime = "bench_bloat" | "vacuum_keeps_up";

/** Inputs, per 1,000 players unless noted. Sources in comments. */
export interface LifecycleInputs {
  /** Live database baseline before 0011 (measured read-only, 18 Oct). */
  baselineMiB: number;
  /** Empty 0011 schema plus partitions created ahead (17 days x 40 KiB). */
  schemaMiB: number;
  /**
   * Every 0011 table except gameplay_unit_challenges at day 14 (§14: 146.86 - 104.7).
   * Treated as the steady 14-day raw-window block. Conservative: it also holds
   * 14 days of durable rows, which are counted again below.
   */
  rawWindowMiBPer1000: number;
  /** movement_verifications at day 14 with cell lists (§14): the 14-day block. */
  movementWindowMiBPer1000: number;
  /** Movement summary row without cells (§3.2, 453 B) x sessions per player-day (§14: 12,666 / 1,000 / 14). */
  movementSummaryBytesPerPlayerDay: number;
  /** Settled credit lines and day aggregates (§11.5: 108 MiB at 1,000 players over 360 days). */
  durableBytesPerPlayerDay: number;
  /** Player-day proofs: 138 B x 60% active (§11.2). */
  proofBytesPerPlayerDay: number;
  /** Compacted snapshots, latest per unit (§11.5: 14 MiB at 1,000 players, 4 seasons). Flat. */
  snapshotMiBPer1000: number;
  /** gameplay_unit_challenges, bench pace, autovacuum never caught up (§14: 104.7 MiB at 1,000). */
  challengesBloatMiBPer1000: number;
  /** gameplay_unit_challenges compact (§14 after VACUUM FULL: 3.7 MiB) x churn-study ratio (lifecycle doc §5: 1.95 / 0.81 at 200 players, plain VACUUM every 50 sessions). */
  challengesKeptUpMiBPer1000: number;
  /** Auth sessions (37 days) and security audit (X-25 proposal, 30 days) at 6 refreshes per active day (§11.5: 125 MiB at 1,000). Reserved headroom. */
  authAuditMiBPer1000: number;
  /** One hostile account per day inside the raw window, with the 300-unit budget: gameplay 0.15 MiB (§8) + movement rows 0.077 MiB (§11.2: 5.3 MiB / 1,400 sessions x 20) + session paths 0.08 MiB (500 units x 8 B x 20). */
  hostileWindowMiBPerAccountDay: number;
  /** One hostile account per day after the raw window: 20 movement summaries without cells (20 x 453 B). */
  hostileSummaryMiBPerAccountDay: number;
}

export const LIFECYCLE_INPUTS: LifecycleInputs = Object.freeze({
  baselineMiB: 11.8,
  schemaMiB: 0.34 + (17 * 40) / 1024,
  rawWindowMiBPer1000: 146.86 - 104.7,
  movementWindowMiBPer1000: 7.87,
  movementSummaryBytesPerPlayerDay: 453 * (12_666 / 1_000 / 14),
  durableBytesPerPlayerDay: (108 * MIB) / (1_000 * 360),
  proofBytesPerPlayerDay: 138 * 0.6,
  snapshotMiBPer1000: 14,
  challengesBloatMiBPer1000: 104.7,
  challengesKeptUpMiBPer1000: 3.7 * (1.95 / 0.81),
  authAuditMiBPer1000: 125,
  hostileWindowMiBPerAccountDay: 0.15 + 5.3 / 1_400 * 20 + (500 * 8 * 20) / MIB,
  hostileSummaryMiBPerAccountDay: (20 * 453) / MIB,
});

/** PLANNING ASSUMPTIONS, not live policy. */
export interface LifecyclePolicy {
  rawDays: number;
  proofDays: number;
  movementSummaryDays: number;
  seasonDays: number;
}
export const PLANNING_LIFECYCLE: LifecyclePolicy = Object.freeze({ rawDays: 14, proofDays: 120, movementSummaryDays: 120, seasonDays: 90 });

export interface Tripwires {
  quotaMiB: number;
  warn: number;
  backpressure: number;
  hardStop: number;
}
/** ASSUMED 500 MiB allowance; warn 60%, backpressure 75%, fail closed 85% (capacity.ts DEFAULT_THRESHOLDS). */
export const ASSUMED_TRIPWIRES: Tripwires = Object.freeze({ quotaMiB: 500, warn: 0.6, backpressure: 0.75, hardStop: 0.85 });

export interface Scenario {
  players: number;
  /** Share of accounts that are hostile, 0 to 1 (counted inside `players`). */
  hostileShare: number;
  seasons: number;
  churn: ChurnRegime;
}

export interface Projection {
  totalMiB: number;
  /** Size that does not depend on players. */
  fixedMiB: number;
  /** Size per player (blended ordinary and hostile). */
  perPlayerMiB: number;
  parts: Record<string, number>;
}

/** Linear projection: fixed + per-player x players. Hostile accounts are assumed active for the whole horizon (worse than §11.5's 14 days). */
export function projectLifecycle(s: Scenario, inp: LifecycleInputs = LIFECYCLE_INPUTS, pol: LifecyclePolicy = PLANNING_LIFECYCLE): Projection {
  const horizon = s.seasons * pol.seasonDays;
  const k = 1 / 1_000;
  const after = (ttl: number) => Math.max(0, Math.min(ttl, horizon) - pol.rawDays); // days beyond the 14-day block that a class still keeps
  const perOrdinary: Record<string, number> = {
    rawWindow: inp.rawWindowMiBPer1000 * k,
    movementWindow: inp.movementWindowMiBPer1000 * k,
    movementSummaries: (inp.movementSummaryBytesPerPlayerDay * after(pol.movementSummaryDays)) / MIB,
    proofs: (inp.proofBytesPerPlayerDay * after(pol.proofDays)) / MIB,
    durableRecord: (inp.durableBytesPerPlayerDay * horizon) / MIB,
    snapshots: inp.snapshotMiBPer1000 * k,
    challenges: (s.churn === "bench_bloat" ? inp.challengesBloatMiBPer1000 : inp.challengesKeptUpMiBPer1000) * k,
    authAudit: inp.authAuditMiBPer1000 * k,
  };
  const hostileExtra = inp.hostileWindowMiBPerAccountDay * Math.min(pol.rawDays, horizon) + inp.hostileSummaryMiBPerAccountDay * after(pol.movementSummaryDays);
  const ordinary = Object.values(perOrdinary).reduce((a, b) => a + b, 0);
  const perPlayerMiB = ordinary + s.hostileShare * hostileExtra;
  const fixedMiB = inp.baselineMiB + inp.schemaMiB;
  const parts: Record<string, number> = { fixed: fixedMiB };
  for (const [key, v] of Object.entries(perOrdinary)) parts[key] = v * s.players;
  parts.hostile = s.hostileShare * hostileExtra * s.players;
  return { totalMiB: fixedMiB + perPlayerMiB * s.players, fixedMiB, perPlayerMiB, parts };
}

export type Level = "ok" | "warn" | "backpressure" | "fail_closed";
export function levelOf(totalMiB: number, t: Tripwires = ASSUMED_TRIPWIRES): Level {
  const f = totalMiB / t.quotaMiB;
  if (!Number.isFinite(f)) return "fail_closed";
  if (f >= t.hardStop) return "fail_closed";
  if (f >= t.backpressure) return "backpressure";
  if (f >= t.warn) return "warn";
  return "ok";
}

/** Most players whose projection stays strictly under `fraction` of the quota (0 when even one does not fit). */
export function maxPlayersUnder(s: Omit<Scenario, "players">, fraction: number, quotaMiB = ASSUMED_TRIPWIRES.quotaMiB, inp: LifecycleInputs = LIFECYCLE_INPUTS, pol: LifecyclePolicy = PLANNING_LIFECYCLE): number {
  const p = projectLifecycle({ ...s, players: 1 }, inp, pol);
  const room = fraction * quotaMiB - p.fixedMiB;
  if (room <= 0) return 0;
  const n = Math.floor(room / p.perPlayerMiB);
  // strictly under the line
  return projectLifecycle({ ...s, players: n }, inp, pol).totalMiB < fraction * quotaMiB ? n : Math.max(0, n - 1);
}

/** Inputs scaled by `factor` on every per-player coefficient (sensitivity). */
export function scaledInputs(factor: number, inp: LifecycleInputs = LIFECYCLE_INPUTS): LifecycleInputs {
  const out = { ...inp } as Record<string, number>;
  for (const k of Object.keys(out)) if (k !== "baselineMiB" && k !== "schemaMiB") out[k] = out[k]! * factor;
  return out as unknown as LifecycleInputs;
}
