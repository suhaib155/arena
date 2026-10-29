/**
 * False-positive / false-negative measurement for stationary-risk/v1 over the
 * seeded synthetic corpus, through the real verification path (production
 * anomaly rules, GpsService distance, HexService cells).
 *
 * SYNTHETIC. Rates hold only under the corpus assumptions stated in
 * ./stationaryRiskCorpus.ts; they say nothing about real phones.
 *
 * Run the report:  node --import tsx src/movement/testing/stationaryRiskRates.ts [seeds]
 */
import { GpsService } from "../../services/gps.service.js";
import { HexService } from "../../services/hex.service.js";
import { detectMovementAnomalies } from "../http/productionRouter.js";
import { verifyMovement, type VerifyMovementDeps } from "../domain/verification.js";
import {
  assessStationaryRisk,
  STATIONARY_RISK_RULE_OFF,
  STATIONARY_RISK_RULE_V1,
  STATIONARY_RISK_V1_POLICY,
  type StationaryRiskPolicy,
  type StationaryRiskRuleId,
} from "../domain/stationaryRisk.js";
import { captureRoute, circle, CORPUS, corpusSeed, type CapturedRoute, type CorpusFamily } from "./stationaryRiskCorpus.js";

const gps = new GpsService();
const hex = new HexService();

export function verifyWith(route: CapturedRoute, rule: StationaryRiskRuleId) {
  const deps: VerifyMovementDeps = {
    now: () => route.now,
    detectAnomalies: (o) => detectMovementAnomalies(gps, o),
    calculateDistance: (points) => gps.calculateDistance(points as never),
    traversedHexIds: (points) => hex.getHexIdsForPoints(points),
    stationaryRiskRule: rule,
  };
  return verifyMovement(route.observation, deps);
}

export interface FamilyOutcome {
  family: CorpusFamily;
  runs: number;
  /** Verified (XP-eligible) under today's rule, with the verified distances. */
  verifiedOff: number;
  distancesOff: number[];
  /** Verified under stationary-risk/v1. */
  verifiedV1: number;
  /** Withheld by stationary-risk/v1 (the rest of the difference is other rules). */
  reviewV1: number;
  /** The captured routes that today's rule verified, for policy sweeps. */
  routes: CapturedRoute[];
}

export function measureFamily(family: CorpusFamily, seeds: number): FamilyOutcome {
  const outcome: FamilyOutcome = { family, runs: seeds, verifiedOff: 0, distancesOff: [], verifiedV1: 0, reviewV1: 0, routes: [] };
  for (let i = 0; i < seeds; i++) {
    const route = captureRoute(family.scenario(corpusSeed(family, i)));
    if (route.observation.points.length < 2) continue;
    const off = verifyWith(route, STATIONARY_RISK_RULE_OFF);
    const v1 = verifyWith(route, STATIONARY_RISK_RULE_V1);
    if (off.status === "verified") { outcome.verifiedOff += 1; outcome.distancesOff.push(off.distanceMeters ?? 0); outcome.routes.push(route); }
    if (v1.status === "verified") outcome.verifiedV1 += 1;
    if (v1.stationaryRisk?.verdict === "review") outcome.reviewV1 += 1;
  }
  return outcome;
}

/** Verdicts for routes today's rule verified, under any policy (sweeps). */
export function reviewCount(routes: readonly CapturedRoute[], policy: Readonly<StationaryRiskPolicy>): number {
  let review = 0;
  for (const route of routes) {
    const risk = assessStationaryRisk(route.observation.points.map((p) => ({
      latitude: p.lat, longitude: p.lng, timestamp: p.timestamp, accuracy: p.accuracy,
    })), route.observation.session?.pauses ?? [], policy);
    if (risk.verdict === "review") review += 1;
  }
  return review;
}

export interface Rates { honestVerified: number; honestFlagged: number; stationaryVerified: number; stationaryAccepted: number;
  stressVerified: number; stressFlagged: number }

export function rates(outcomes: readonly FamilyOutcome[], policy: Readonly<StationaryRiskPolicy> = STATIONARY_RISK_V1_POLICY): Rates {
  const r: Rates = { honestVerified: 0, honestFlagged: 0, stationaryVerified: 0, stationaryAccepted: 0, stressVerified: 0, stressFlagged: 0 };
  for (const o of outcomes) {
    const flagged = reviewCount(o.routes, policy);
    if (o.family.truth === "honest") { r.honestVerified += o.routes.length; r.honestFlagged += flagged; }
    if (o.family.truth === "stationary") { r.stationaryVerified += o.routes.length; r.stationaryAccepted += o.routes.length - flagged; }
    if (o.family.truth === "stress") { r.stressVerified += o.routes.length; r.stressFlagged += flagged; }
  }
  return r;
}

const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(1)}% (${a}/${b})`);

function main(seeds: number) {
  const outcomes = CORPUS.map((f) => measureFamily(f, seeds));
  console.log(`| truth | family | runs | verified, rule off (median / max m) | verified, v1 | v1 review |`);
  console.log(`|---|---|---|---|---|---|`);
  for (const o of outcomes) {
    const d = [...o.distancesOff].sort((a, b) => a - b);
    const med = d.length ? d[d.length >> 1] : 0, max = d.length ? d[d.length - 1] : 0;
    console.log(`| ${o.family.truth} | ${o.family.name} | ${o.runs} | ${o.verifiedOff} (${med} / ${max}) | ${o.verifiedV1} | ${o.reviewV1} |`);
  }
  const base = rates(outcomes);
  console.log(`\nFP (honest verified today, withheld by v1): ${pct(base.honestFlagged, base.honestVerified)}`);
  console.log(`FN (stationary verified today, still XP-eligible under v1): ${pct(base.stationaryAccepted, base.stationaryVerified)}`);
  console.log(`Stress (honest under multipath) withheld: ${pct(base.stressFlagged, base.stressVerified)}`);

  const sweeps: [string, (p: StationaryRiskPolicy) => StationaryRiskPolicy, readonly number[]][] = [
    ["incoherenceThreshold", (p) => p, [0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75]],
    ["dwellRadiusMeters", (p) => p, [25, 35, 45, 60, 80]],
    ["dwellAccuracyMultiple", (p) => p, [1.5, 2, 2.5, 3, 4]],
    ["progressMeters", (p) => p, [15, 20, 25, 35, 50, Number.POSITIVE_INFINITY]],
    ["progressAccuracyMultiple", (p) => p, [1, 1.5, 2, 3]],
    ["reviewShare", (p) => p, [0.3, 0.4, 0.5, 0.6, 0.8]],
    ["reviewMeters", (p) => p, [250, 500, 1000, Number.POSITIVE_INFINITY]],
    ["minWindowSegments", (p) => p, [4, 5, 6, 8, 10]],
    ["windowMs", (p) => p, [90_000, 120_000, 180_000, 240_000, 300_000]],
    ["reversalDegrees", (p) => p, [110, 120, 135, 150]],
  ];
  console.log(`\n| threshold | value | FP honest | FN stationary | stress withheld |`);
  console.log(`|---|---|---|---|---|`);
  for (const [key, , values] of sweeps) {
    for (const value of values) {
      const policy = { ...STATIONARY_RISK_V1_POLICY, [key]: value } as StationaryRiskPolicy;
      const r = rates(outcomes, policy);
      const mark = (STATIONARY_RISK_V1_POLICY as unknown as Record<string, number>)[key] === value ? " (v1)" : "";
      console.log(`| ${key} | ${value}${mark} | ${pct(r.honestFlagged, r.honestVerified)} | ${pct(r.stationaryAccepted, r.stationaryVerified)} | ${pct(r.stressFlagged, r.stressVerified)} |`);
    }
  }
  assumptionSweep(seeds);
}

/**
 * Sensitivity to the corpus ASSUMPTIONS rather than to the thresholds: honest
 * routes whose real error is a larger fraction of their reported accuracy, and
 * loops smaller than the corpus's 100 m floor.
 */
function assumptionSweep(seeds: number) {
  console.log(`\n| assumption | value | honest verified today | withheld by v1 |`);
  console.log(`|---|---|---|---|`);
  const honest = CORPUS.filter((f) => f.truth === "honest");
  for (const ratio of [0.4, 0.6, 0.8, 1.0, 1.5]) {
    const scaled = honest.map((f) => ({ ...f, scenario: (seed: number) => {
      const s = f.scenario(seed);
      return { ...s, sigmaM: s.accuracyM * ratio };
    } }));
    const r = rates(scaled.map((f) => measureFamily(f, seeds)));
    console.log(`| honest real error / reported accuracy | ${ratio} | ${r.honestVerified} | ${pct(r.honestFlagged, r.honestVerified)} |`);
  }
  for (const [lap, v] of [[30, 1.4], [50, 1.4], [50, 3.0], [75, 1.4]] as const) {
    const f: CorpusFamily = { name: `loop ${lap} m at ${v} m/s`, truth: "honest", scenario: (seed) => ({ seed,
      legs: [{ kind: "still", seconds: 15 }, { kind: "move", path: circle(lap, Math.ceil(900 / lap)), speedMps: v }],
      accuracyM: seed % 2 ? 5 : 8, sigmaM: seed % 2 ? 2 : 3.2 }) };
    const r = rates([measureFamily(f, seeds)]);
    console.log(`| honest loop below the corpus floor | ${lap} m at ${v} m/s | ${r.honestVerified} | ${pct(r.honestFlagged, r.honestVerified)} |`);
  }
  for (const rho of [0.5, 0.7, 0.99]) {
    const f: CorpusFamily = { name: `still rho ${rho}`, truth: "stationary", scenario: (seed) => ({ seed,
      legs: [{ kind: "still", seconds: 615 }], accuracyM: 6, sigmaM: 15, rho }) };
    const r = rates([measureFamily(f, seeds)]);
    console.log(`| stationary error correlation (S03 accuracy) | rho ${rho} | ${r.stationaryVerified} | FN ${pct(r.stationaryAccepted, r.stationaryVerified)} |`);
  }
}

if (process.argv[1] && /stationaryRiskRates\.ts$/.test(process.argv[1])) main(Number(process.argv[2] ?? 50));
