/**
 * Deterministic false-positive / false-negative harness for stationary-risk/v1.
 *
 * SYNTHETIC ONLY. Every route comes from the seeded generator in
 * ./stationaryRiskCorpus.ts (open-ocean frame, AR(1) error model, the real
 * `inspectFix` capture rule). Nothing here is a recording, a person or a place,
 * and the rates are conditional on the generator's assumptions. They are not a
 * claim about real phones.
 *
 * The test (../stationaryRiskHarness.test.ts) pins the numbers this module
 * produces. A threshold change in domain/stationaryRisk.ts, a change to the
 * generator, or a change to the capture rule moves them; the pinned values must
 * then be updated deliberately, together with HARNESS_VERSION if the generator
 * itself changed.
 *
 * Report:  node --import tsx src/movement/testing/stationaryRiskHarness.ts [seeds]
 */
import { GpsService } from "../../services/gps.service.js";
import { HexService } from "../../services/hex.service.js";
import { detectMovementAnomalies } from "../http/productionRouter.js";
import { verifyMovement, type VerifyMovementDeps } from "../domain/verification.js";
import { STATIONARY_RISK_RULE_OFF, STATIONARY_RISK_RULE_V1, type StationaryRiskRuleId } from "../domain/stationaryRisk.js";
import type { MovementObservation } from "../domain/types.js";
import {
  block, captureRoute, circle, CORPUS, corpusSeed, line, type CapturedRoute, type CorpusFamily, type CorpusLeg,
} from "./stationaryRiskCorpus.js";
import { measureFamily, rates } from "./stationaryRiskRates.js";

/**
 * Generator identity. Bump HARNESS_VERSION when the generator, the families
 * below or the capture model change; the pinned numbers are only comparable
 * within one version.
 */
export const HARNESS_VERSION = "sr-harness/1 (corpus generator: stationaryRiskCorpus.ts, AR(1) error, 4 s / 5 m watch)";
/** corpusSeed(family, i) = CORPUS_SEED_BASE + i * 7919 + family.name.length * 131. */
export const CORPUS_SEED_BASE = 0x5eed;
/** Seeds per family in the headline run (matches the rule doc). */
export const HEADLINE_SEEDS = 50;

const gps = new GpsService();
const hex = new HexService();

export function verifyRoute(route: CapturedRoute, rule: StationaryRiskRuleId, observation: MovementObservation = route.observation) {
  const deps: VerifyMovementDeps = {
    now: () => route.now,
    detectAnomalies: (o) => detectMovementAnomalies(gps, o),
    calculateDistance: (points) => gps.calculateDistance(points as never),
    traversedHexIds: (points) => hex.getHexIdsForPoints(points),
    stationaryRiskRule: rule,
  };
  return verifyMovement(observation, deps);
}

/** What a group of routes did: how many today's rule verifies, and how many v1 then withholds. */
export interface GroupCount {
  runs: number;
  /** Verified (XP-eligible) with the rule off. */
  verifiedOff: number;
  /** Of those, withheld by stationary-risk/v1. */
  withheld: number;
}

export function countGroup(families: readonly CorpusFamily[], seeds: number): GroupCount {
  const out: GroupCount = { runs: 0, verifiedOff: 0, withheld: 0 };
  for (const family of families) {
    for (let i = 0; i < seeds; i++) {
      const route = captureRoute(family.scenario(corpusSeed(family, i)));
      out.runs += 1;
      if (route.observation.points.length < 2) continue;
      if (verifyRoute(route, STATIONARY_RISK_RULE_OFF).status !== "verified") continue;
      out.verifiedOff += 1;
      if (verifyRoute(route, STATIONARY_RISK_RULE_V1).stationaryRisk?.verdict === "review") out.withheld += 1;
    }
  }
  return out;
}

/* ── headline: the main corpus ─────────────────────────────────────────────── */

export interface Headline {
  honestVerified: number;
  /** FP: honest, verified today, withheld by v1. */
  honestFlagged: number;
  stationaryVerified: number;
  /** FN: stationary, verified today, still XP-eligible under v1. */
  stationaryAccepted: number;
  stressVerified: number;
  stressFlagged: number;
}

export function headline(seeds = HEADLINE_SEEDS): Headline {
  return rates(CORPUS.map((f) => measureFamily(f, seeds)));
}

/* ── adversarial groups, each reported separately ──────────────────────────── */

const honestBase = () => CORPUS.filter((f) => f.truth === "honest");

/**
 * Reported-accuracy mismatch: every honest family with its real error set to
 * `ratio` x the reported accuracy (the corpus itself uses about 0.4).
 */
export function accuracyMismatch(ratio: number, seeds: number): GroupCount {
  return countGroup(honestBase().map((f) => ({
    ...f,
    scenario: (seed: number) => { const s = f.scenario(seed); return { ...s, sigmaM: s.accuracyM * ratio }; },
  })), seeds);
}

const still = (seconds: number): CorpusLeg => ({ kind: "still", seconds });
const honestAccuracy = (seed: number) => ({ accuracyM: seed % 2 ? 5 : 8, sigmaM: seed % 2 ? 2 : 3.2 });

/** An honest loop below the corpus's 100 m floor (tracks, playgrounds). */
export function smallLoop(circumference: number, speedMps: number): CorpusFamily {
  return {
    name: `small loop ${circumference} m at ${speedMps} m/s`, truth: "honest",
    scenario: (seed) => ({ seed, legs: [still(15), { kind: "move", path: circle(circumference, Math.ceil(900 / circumference)), speedMps }], ...honestAccuracy(seed) }),
  };
}

/** A phone left still whose error wanders with the given correlation (S03 accuracy: reports 6 m, real 15 m). */
export function slowDrift(rho: number): CorpusFamily {
  return {
    name: `slow drift, still 615 s, accuracy 6 m, real error 15 m, rho ${rho}`, truth: "stationary",
    scenario: (seed) => ({ seed, legs: [still(615)], accuracyM: 6, sigmaM: 15, rho }),
  };
}

/** Honest walking so slowly that the accepted fixes crawl. */
export const slowWalks: readonly CorpusFamily[] = [0.3, 0.5].map((v) => ({
  name: `slow genuine walk ${v} m/s, 120 m`, truth: "honest" as const,
  scenario: (seed: number) => ({ seed, legs: [still(15), { kind: "move" as const, path: line(120), speedMps: v }, still(5)], ...honestAccuracy(seed) }),
}));

/** Vehicle-like routes: a pure vehicle upload, a mixed walk/vehicle/walk (I02), a bike. */
export const vehicleFamilies: readonly CorpusFamily[] = [
  { name: "vehicle only, 2 km at 12 m/s", truth: "honest",
    scenario: (seed) => ({ seed, legs: [still(10), { kind: "move", path: line(2000), speedMps: 12 }], ...honestAccuracy(seed) }) },
  { name: "walk, 1.8 km bus leg at 15 m/s, walk", truth: "honest",
    scenario: (seed) => ({ seed, legs: [still(15), { kind: "move", path: line(150), speedMps: 1.4 }, { kind: "move", path: line(1800), speedMps: 15 },
      { kind: "move", path: line(150), speedMps: 1.4 }, still(5)], ...honestAccuracy(seed) }) },
  { name: "bike 1.5 km at 6 m/s with a loop", truth: "honest",
    scenario: (seed) => ({ seed, legs: [still(10), { kind: "move", path: block(300, 300, 1), speedMps: 6 }, { kind: "move", path: line(300), speedMps: 6 }], ...honestAccuracy(seed) }) },
];

/** Stable fixtures from Track A, rebuilt synthetically here. */
export const STABLE_FIXTURES: readonly { id: string; family: CorpusFamily }[] = [
  { id: "W04", family: { name: "W04 urban 220 m walk, accuracy 15 m", truth: "honest",
    scenario: (seed) => ({ seed, legs: [still(15), { kind: "move", path: line(220), speedMps: 1.4 }, still(5)], accuracyM: 15, sigmaM: 5 }) } },
  { id: "I02", family: { name: "I02 walk, 1.8 km bus leg at 15 m/s, walk", truth: "honest", scenario: vehicleFamilies[1]!.scenario } },
  { id: "C01", family: { name: "C01 500 m walk, 370 s, clean clock", truth: "honest",
    scenario: (seed) => ({ seed, legs: [still(15), { kind: "move", path: line(500), speedMps: 1.4 }, still(5)], ...honestAccuracy(seed) }) } },
  { id: "S03", family: { name: "S03 still 300 s, accuracy 6 m, real error 15 m", truth: "stationary",
    scenario: (seed) => ({ seed, legs: [still(315)], accuracyM: 6, sigmaM: 15, rho: 0.95 }) } },
];

export interface FixtureVerdict {
  id: string;
  seeds: number;
  /** Seeds where rule-off and rule-on give the same status, distance and cells. */
  unchanged: number;
  verifiedOff: number;
  verifiedOn: number;
}

export function stableFixtureVerdicts(seeds: number): FixtureVerdict[] {
  return STABLE_FIXTURES.map(({ id, family }) => {
    const v: FixtureVerdict = { id, seeds, unchanged: 0, verifiedOff: 0, verifiedOn: 0 };
    for (let i = 0; i < seeds; i++) {
      const route = captureRoute(family.scenario(corpusSeed(family, i)));
      const off = verifyRoute(route, STATIONARY_RISK_RULE_OFF), on = verifyRoute(route, STATIONARY_RISK_RULE_V1);
      if (off.status === "verified") v.verifiedOff += 1;
      if (on.status === "verified") v.verifiedOn += 1;
      if (off.status === on.status && off.distanceMeters === on.distanceMeters &&
          JSON.stringify(off.traversedHexIds) === JSON.stringify(on.traversedHexIds)) v.unchanged += 1;
    }
    return v;
  });
}

/**
 * KNOWN BYPASS. `breakBefore` is a client-sent pause marker; it ends a
 * continuous stretch and a window needs several segments, so marking a break
 * every few points leaves nothing to judge. This measures the CURRENT
 * behaviour on drift routes the rule otherwise withholds; it is not a
 * statement that the behaviour is acceptable.
 */
export interface BypassCount {
  runs: number;
  /** Routes verified with the rule off. */
  verifiedOff: number;
  /** Of those, withheld by v1 when sent without markers (the rule works). */
  withheldPlain: number;
  /** Of those, still withheld by v1 with a break marker every `every` points. */
  withheldMarked: number;
  /** Of those, verified with the markers: the bypass. */
  bypassed: number;
}

export function pauseMarkerBypass(every: number, seeds: number): BypassCount {
  const family = STABLE_FIXTURES.find((f) => f.id === "S03")!.family;
  const out: BypassCount = { runs: seeds, verifiedOff: 0, withheldPlain: 0, withheldMarked: 0, bypassed: 0 };
  for (let i = 0; i < seeds; i++) {
    const route = captureRoute(family.scenario(corpusSeed(family, i)));
    if (verifyRoute(route, STATIONARY_RISK_RULE_OFF).status !== "verified") continue;
    out.verifiedOff += 1;
    if (verifyRoute(route, STATIONARY_RISK_RULE_V1).status !== "verified") out.withheldPlain += 1;
    const marked: MovementObservation = {
      ...route.observation,
      points: route.observation.points.map((p, j) => (j > 0 && j % every === 0 ? { ...p, breakBefore: true } : p)),
    };
    if (verifyRoute(route, STATIONARY_RISK_RULE_V1, marked).status === "verified") out.bypassed += 1;
    else out.withheldMarked += 1;
  }
  return out;
}

/* ── report ────────────────────────────────────────────────────────────────── */

const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${((100 * a) / b).toFixed(1)}% (${a}/${b})`);

function report(seeds: number) {
  const h = headline(seeds);
  console.log(`${HARNESS_VERSION}; seed base 0x${CORPUS_SEED_BASE.toString(16)}; ${seeds} seeds per family; synthetic only`);
  console.log(`\nHEADLINE (main corpus)`);
  console.log(`FP honest withheld:        ${pct(h.honestFlagged, h.honestVerified)}`);
  console.log(`FN stationary still paid:  ${pct(h.stationaryAccepted, h.stationaryVerified)}`);
  console.log(`stress withheld:           ${pct(h.stressFlagged, h.stressVerified)}`);
  console.log(`\nADVERSARIAL (reported separately)`);
  for (const r of [0.8, 1.5]) { const g = accuracyMismatch(r, seeds); console.log(`accuracy mismatch, real error ${r}x reported: FP ${pct(g.withheld, g.verifiedOff)}`); }
  for (const [c, v] of [[30, 1.4], [50, 1.4], [50, 3], [75, 1.4]] as const) { const g = countGroup([smallLoop(c, v)], seeds); console.log(`${smallLoop(c, v).name}: FP ${pct(g.withheld, g.verifiedOff)}`); }
  for (const rho of [0.5, 0.7, 0.99]) { const g = countGroup([slowDrift(rho)], seeds); console.log(`${slowDrift(rho).name}: FN ${pct(g.verifiedOff - g.withheld, g.verifiedOff)}`); }
  { const g = countGroup(slowWalks, seeds); console.log(`slow genuine walks: FP ${pct(g.withheld, g.verifiedOff)}`); }
  for (const f of vehicleFamilies) { const g = countGroup([f], seeds); console.log(`${f.name}: verified today ${g.verifiedOff}/${g.runs}, withheld by v1 ${g.withheld}`); }
  const b = pauseMarkerBypass(4, seeds);
  console.log(`KNOWN BYPASS, break marker every 4th point: verified today ${b.verifiedOff}, withheld unmarked ${b.withheldPlain}, withheld marked ${b.withheldMarked}, bypassed ${b.bypassed}`);
  for (const v of stableFixtureVerdicts(seeds)) console.log(`fixture ${v.id}: unchanged ${v.unchanged}/${v.seeds}, verified off ${v.verifiedOff}, verified on ${v.verifiedOn}`);
}

if (process.argv[1] && /stationaryRiskHarness\.ts$/.test(process.argv[1])) report(Number(process.argv[2] ?? HEADLINE_SEEDS));
