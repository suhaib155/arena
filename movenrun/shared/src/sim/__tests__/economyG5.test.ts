/**
 * G5–G7 research model: deed eligibility as §12 states it, toll income as §20
 * states it, wash-trade screening, Sybil break-even arithmetic, and emission
 * projections whose books close exactly and never exceed the day's pool.
 * Hand-made traces keep every expected number checkable by hand.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  binomialAtLeast,
  deedEligibility,
  DEED_RULES_SOURCE,
  directFarmBreakEven,
  G5_STATUS,
  mutualDeedRing,
  projectEconomy,
  SINKS_TRACE_ONLY,
  tollChannelBreakEven,
  tollIncome,
  v3Rules,
  washTradeCost,
  washTradeFlags,
  type DeedReport,
  type EmissionConfig,
  type SybilParams,
} from "../economyG5";
import { G5_CONTEXTS, G5_DEED_RULES, G5_EMISSION_CONFIGS, runG5 } from "../economyG5Report";
import { SIM_ONLY, SIM_PILOT_1 } from "../pilotRuleset";
import { simulate } from "../simulate";
import type { SeasonTrace, TraceDay, TraceLine } from "../trace";
import type { PopulationSpec, Profile } from "../world";

const M = 1_000_000;

function trace(days: Partial<TraceDay>[], players: [string, Profile?][], units = 10): SeasonTrace {
  return {
    status: SIM_ONLY,
    ruleset: "test",
    seed: 0,
    units,
    players: players.map(([id, profile]) => ({ id, profile: profile ?? "regular", club: null })),
    days: days.map((d, i) => ({ day: i, poolMicro: 100_000 * M, dayShareMicro: 10 * M, lines: [], levelSpendMicro: [], held: [], stepped: [], ...d })),
  };
}

const line = (playerId: string, earned: number, extra: Partial<TraceLine> = {}): TraceLine => ({
  playerId,
  earnedMicro: earned,
  rechargeMicro: 0,
  upkeepTakenMicro: 0,
  tollPaidMicro: 0,
  tollReceivedMicro: 0,
  netMicro: earned,
  ...extra,
});

/** A holds u1 (solid) for `n` days; two new walkers cross it on each of the first `trafficDays` days. */
function heldWithTraffic(n: number, trafficDays: number, crosserIds: (day: number) => string[] = (d) => [`w${2 * d}`, `w${2 * d + 1}`]): SeasonTrace {
  const days: Partial<TraceDay>[] = [];
  const ids = new Set<string>(["A"]);
  for (let d = 0; d < n; d++) {
    const ws = d < trafficDays ? crosserIds(d) : [];
    ws.forEach((w) => ids.add(w));
    days.push({ held: [["u1", "A", "solid"]], stepped: ws.length ? [["u1", ws]] : [] });
  }
  return trace(days, [...ids].map((id) => [id]));
}

const singleton = (id: string) => `c:${id}`;

test("labelled simulation only; the V3 numbers it reads are the source's", () => {
  assert.equal(G5_STATUS, SIM_ONLY);
  for (const c of G5_EMISSION_CONFIGS) assert.equal(c.status, SIM_ONLY);
  const r = v3Rules();
  assert.equal(r.seasonOneDailyPoolMicro, 100_000 * M);
  assert.equal(r.seasonOnePoolMicro, 9_000_000 * M);
  assert.equal(r.seasonDecay, 0.9);
  assert.equal(r.seasonFloorMicro, 2_000_000 * M);
  assert.equal(r.playerAllocationMicro, 400_000_000 * M);
  assert.equal(r.sessionCeilingMicro, 12 * M);
  assert.equal(r.dayCeilingMicro, 20 * M);
  assert.equal(r.tollBasisPoints, 200);
  assert.equal(r.autoChargeCapBasisPoints, 6000);
  assert.deepEqual(
    { t: DEED_RULES_SOURCE.tenureDays, c: DEED_RULES_SOURCE.distinctCrossers, d: DEED_RULES_SOURCE.trafficDays, s: DEED_RULES_SOURCE.maxClusterShare },
    { t: 21, c: 30, d: 10, s: 0.2 },
  );
  assert.ok(Object.isFrozen(DEED_RULES_SOURCE));
  assert.equal(G5_DEED_RULES[0]!.label, "source §12");
  const bad = { ...G5_EMISSION_CONFIGS[0]!, status: "PRODUCTION" } as unknown as EmissionConfig;
  assert.throws(() => projectEconomy(trace([{}], [["A"]]), bad), /SIMULATION_ONLY/);
});

test("§12 deed: 21 days held, 30 distinct crossers over 10 days, claimed on the first day all hold", () => {
  const r = deedEligibility(heldWithTraffic(25, 15), DEED_RULES_SOURCE, singleton);
  assert.equal(r.deeds.length, 1);
  assert.deepEqual(r.deeds[0], { unitId: "u1", holderId: "A", day: 20 });
  assert.equal(r.firstDeedDay.get("A"), 20);
  assert.equal(r.maxTenureDays, 21, "a deeded unit stops counting tenure");
  // 29 crossers is one short.
  const short = deedEligibility(heldWithTraffic(25, 15, (d) => (d === 14 ? ["w28"] : [`w${2 * d}`, `w${2 * d + 1}`])), DEED_RULES_SOURCE, singleton);
  assert.equal(short.deeds.length, 0);
  assert.equal(short.maxCrossersAtTenure, 29);
  // 30 crossers on 9 days is one day short.
  const fewDays = deedEligibility(heldWithTraffic(25, 9, (d) => (d < 3 ? [0, 1, 2, 3, 4, 5].map((k) => `w${6 * d + k}`) : [`w${18 + 2 * d}`, `w${19 + 2 * d}`])), DEED_RULES_SOURCE, singleton);
  assert.equal(fewDays.maxCrossersAtTenure, 30);
  assert.equal(fewDays.deeds.length, 0);
  assert.ok(fewDays.failedTraffic.days > 0);
});

test("§12: own and linked traffic never counts, and no related cluster may exceed 20%", () => {
  const tr = heldWithTraffic(25, 15);
  // Linking two crossers to A removes them: 28 left.
  const linked = deedEligibility(tr, DEED_RULES_SOURCE, (id) => (id === "w0" || id === "w1" ? "c:A" : `c:${id}`));
  assert.equal(linked.deeds.length, 0);
  assert.equal(linked.maxCrossersAtTenure, 28);
  // Six of thirty in one cluster is exactly 20%: allowed. Seven is not.
  const six = deedEligibility(tr, DEED_RULES_SOURCE, (id) => (["w0", "w1", "w2", "w3", "w4", "w5"].includes(id) ? "c:ring" : `c:${id}`));
  assert.equal(six.deeds.length, 1);
  const seven = deedEligibility(tr, DEED_RULES_SOURCE, (id) => (["w0", "w1", "w2", "w3", "w4", "w5", "w6"].includes(id) ? "c:ring" : `c:${id}`));
  assert.equal(seven.deeds.length, 0);
  assert.ok(seven.failedTraffic.cluster > 0);
});

test("§12: a flip restarts tenure, and shade never counts", () => {
  const days: Partial<TraceDay>[] = [];
  for (let d = 0; d < 31; d++) days.push({ held: [["u1", d === 11 ? "B" : "A", "solid"]] });
  const r = deedEligibility(trace(days, [["A"], ["B"]]), { ...DEED_RULES_SOURCE, distinctCrossers: 0, trafficDays: 0 }, singleton);
  assert.equal(r.maxTenureDays, 19);
  assert.equal(r.deeds.length, 0);
  const shade = trace(Array.from({ length: 30 }, () => ({ held: [["u1", "A", "shade"]] as TraceDay["held"] })), [["A"]]);
  assert.equal(deedEligibility(shade, { ...DEED_RULES_SOURCE, distinctCrossers: 0, trafficDays: 0 }, singleton).maxTenureDays, 0);
});

test("caps: a per-holder cap is walked around with a second wallet; a city-wide share is not", () => {
  const loose = { ...DEED_RULES_SOURCE, tenureDays: 1, distinctCrossers: 0, trafficDays: 0 };
  const one = trace([{ held: [["u1", "A", "solid"], ["u2", "A", "solid"]] }], [["A"]], 2);
  const capped = deedEligibility(one, { ...loose, perHolderCap: 1 }, singleton);
  assert.equal(capped.deeds.length, 1);
  assert.equal(capped.refusedHolderCap, 1);
  // The same person with two wallets (linked in the risk graph, but the cap counts wallets).
  const split = trace([{ held: [["u1", "A", "solid"], ["u2", "A2", "solid"]] }], [["A"], ["A2"]], 2);
  const sameCluster = (id: string) => (id.startsWith("A") ? "c:A" : `c:${id}`);
  assert.equal(deedEligibility(split, { ...loose, perHolderCap: 1 }, sameCluster).deeds.length, 2);
  // A city share of half of two units allows one deed, whoever holds the wallets.
  const city = deedEligibility(split, { ...loose, cityCapShare: 0.5 }, sameCluster);
  assert.equal(city.deeds.length, 1);
  assert.equal(city.refusedCityCap, 1);
});

const report = (deeds: DeedReport["deeds"], tr: SeasonTrace): DeedReport => ({
  ...deedEligibility(tr, { ...DEED_RULES_SOURCE, tenureDays: 1e9 }, singleton),
  deeds,
  firstDeedDay: new Map(deeds.map((x) => [x.holderId, x.day])),
});

test("§20 toll: 2% of the walker's reward × the owner's share of the units crossed; own and linked land free", () => {
  const tr = trace(
    [{ lines: [line("W", 10 * M), line("A", 10 * M), line("L", 10 * M)], stepped: [["u1", ["A", "L", "W"]], ["u2", ["W"]]] }],
    [["A"], ["W"], ["L"]],
  );
  const cluster = (id: string) => (id === "L" ? "c:A" : `c:${id}`);
  const t = tollIncome(tr, report([{ unitId: "u1", holderId: "A", day: 0 }], tr), cluster);
  assert.deepEqual(t.byDay.get(0), [{ payer: "W", owner: "A", micro: 100_000 }]);
  assert.equal(t.totalMicro, 100_000);
  assert.equal(t.maxDeedSeasonMicro, 100_000);
});

test("wash-trade screening: related parties, round trips, cycles and outlier prices", () => {
  const cluster = (id: string) => (id === "A2" ? "c:A" : `c:${id}`);
  const flags = washTradeFlags(
    [
      { unitId: "u1", from: "A", to: "B", day: 1, price: 10 },
      { unitId: "u1", from: "B", to: "A", day: 5, price: 11 },
      { unitId: "u2", from: "A", to: "B", day: 1, price: 10 },
      { unitId: "u2", from: "B", to: "C", day: 2, price: 10 },
      { unitId: "u2", from: "C", to: "A", day: 3, price: 10 },
      { unitId: "u3", from: "A", to: "A2", day: 4, price: 9 },
      { unitId: "u4", from: "D", to: "E", day: 6, price: 500 },
      { unitId: "u5", from: "F", to: "G", day: 7, price: 10 },
      { unitId: "u5", from: "G", to: "F", day: 90, price: 10 },
    ],
    cluster,
  );
  const of = (unit: string, day: number) => flags.find((f) => f.transfer.unitId === unit && f.transfer.day === day)!.flags;
  assert.deepEqual(of("u1", 1), ["round_trip"]);
  assert.deepEqual(of("u2", 1), ["cycle"]);
  assert.deepEqual(of("u3", 4), ["related_parties"]);
  assert.deepEqual(of("u4", 6), ["price_outlier"]);
  assert.deepEqual(of("u5", 7), [], "outside the window is not a round trip");
  assert.equal(washTradeCost(10, 100, 0, 0), 0, "a zero-fee market makes wash trades free");
  assert.equal(washTradeCost(10, 100, 250, 0.1), 26);
});

test("Sybil break-even: nothing sellable means no price pays; the formulas otherwise", () => {
  const p: SybilParams = { costPerAccountDay: 0.25, detectionRate: 0.5, trustWeight: 1, rewardPerDayMicro: 20 * M };
  for (const kind of ["none", "locked_only"] as const) {
    assert.equal(directFarmBreakEven({ kind }, p), Infinity);
    assert.equal(mutualDeedRing({ kind }, DEED_RULES_SOURCE, p).breakEvenPrice, Infinity);
    assert.equal(tollChannelBreakEven({ kind }, p), Infinity);
  }
  assert.equal(directFarmBreakEven({ kind: "v3_source", valveShareOfMint: null }, p), Infinity, "free accounts are locked under §21");
  assert.equal(directFarmBreakEven({ kind: "liquid_all" }, p), 0.25 / 10);
  const capped = directFarmBreakEven({ kind: "capped_conversion", ratio: 0.5, capPerAccountPerSeasonMicro: 300 * M }, p);
  assert.ok(Math.abs(capped - 0.25 / ((300 / 90) * 0.5)) < 1e-12);
  assert.ok(Math.abs(tollChannelBreakEven({ kind: "v3_source", valveShareOfMint: null }, p) - 0.25 / (20 * 0.5 * 0.02)) < 1e-12);

  assert.equal(binomialAtLeast(30, 1, 30), 1);
  assert.equal(binomialAtLeast(30, 0, 1), 0);
  assert.ok(Math.abs(binomialAtLeast(30, 0.5, 30) - 0.5 ** 30) < 1e-15);
  assert.equal(binomialAtLeast(5, 0.3, 6), 0);
  const free = mutualDeedRing({ kind: "v3_source", valveShareOfMint: null }, DEED_RULES_SOURCE, { ...p, detectionRate: 0 });
  assert.equal(free.ringSize, 31, "each member needs 30 others");
  assert.ok(Math.abs(free.breakEvenPrice - (0.25 * (21 + 90)) / (20 * 90)) < 1e-12);
  const detected = mutualDeedRing({ kind: "v3_source", valveShareOfMint: null }, DEED_RULES_SOURCE, { ...p, detectionRate: 0.6 });
  assert.ok(detected.ringSize! > 75 && detected.passProbability >= 0.95);
});

function projectionTrace(): SeasonTrace {
  // A holds deed u1 from day 0; B crosses it every day. Two players at the 20-credit ceiling.
  const days: Partial<TraceDay>[] = [];
  for (let d = 0; d < 3; d++) {
    days.push({
      lines: [line("A", 20 * M, { rechargeMicro: 2 * M }), line("B", 20 * M, { upkeepTakenMicro: M })],
      stepped: [["u1", ["B"]], ["u2", ["B"]]],
      held: [["u1", "A", "solid"]],
      levelSpendMicro: d === 2 ? [["A", 4 * M]] : [],
    });
  }
  return trace(days, [["A"], ["B"]]);
}

const project = (tr: SeasonTrace, policy: EmissionConfig["policy"], populationBySeason: number[], deeds: DeedReport["deeds"] = []) =>
  projectEconomy(
    tr,
    { label: "t", status: SIM_ONLY, economyRulesVersion: 1, schedule: "v3", populationBySeason, policy, sinks: SINKS_TRACE_ONLY, deedRules: DEED_RULES_SOURCE },
    report(deeds, tr),
    tollIncome(tr, report(deeds, tr), singleton),
  );

test("projection: books close exactly, the pool is never exceeded, and rewards scale down when it binds", () => {
  const tr = projectionTrace();
  const small = project(tr, { kind: "none" }, [1, 1]);
  assert.ok(small.booksBalanced && small.poolRespected);
  assert.equal(small.seasons[0]!.mintedMicro, 120 * M);
  assert.equal(small.seasons[0]!.burnedMicro, (3 * 3 + 4) * M);
  assert.equal(small.seasons[0]!.supplyEndMicro, 107 * M);
  assert.equal(small.seasons[1]!.inflation, 1);
  assert.equal(small.seasons[0]!.liquidEndMicro, 0, "no conversion: nothing liquid");
  // 10,000 copies ask for 400,000 a day against a 100,000 pool: everything at a quarter.
  const big = project(tr, { kind: "none" }, [10_000]);
  assert.ok(big.booksBalanced && big.poolRespected);
  assert.equal(big.seasons[0]!.poolBindingDays, 3);
  assert.equal(big.seasons[0]!.mintedMicro, 3 * 100_000 * M);
  // Season 2's pool is 10% smaller (§17): 8.1M ÷ 90 = 90,000 a day.
  const two = project(tr, { kind: "none" }, [10_000, 10_000]);
  assert.equal(two.seasons[1]!.mintedMicro, 3 * 90_000 * M);
  assert.throws(() => project(tr, { kind: "none" }, [1.5]), /integers/);
});

test("projection: §21 makes rewards liquid after the first deed and tolls liquid; the valve and the fallback lock them", () => {
  const tr = projectionTrace();
  const deeds = [{ unitId: "u1", holderId: "A", day: 0 }];
  const v3 = project(tr, { kind: "v3_source", valveShareOfMint: null }, [1], deeds);
  assert.ok(v3.booksBalanced && v3.poolRespected);
  // A: day 0 locked (18), days 1–2 liquid (18 each), toll from B each day: 20 × 2% ÷ 2 units = 0.2, liquid. Level spend 4 taken locked first.
  assert.equal(v3.liquidByProfile.regular, (2 * 18 * M + 3 * 200_000) / 2);
  const s = v3.seasons[0]!;
  assert.equal(s.liquidEndMicro, 2 * 18 * M + 3 * 200_000);
  assert.equal(s.supplyEndMicro, 120 * M - 13 * M);
  const fallback = project(tr, { kind: "locked_only" }, [1], deeds);
  assert.equal(fallback.seasons[0]!.liquidEndMicro, 0);
  assert.equal(fallback.seasons[0]!.supplyEndMicro, s.supplyEndMicro, "the fallback changes what is sellable, not the supply");
  const valve = project(tr, { kind: "v3_source", valveShareOfMint: 0 }, [1], deeds);
  assert.equal(valve.seasons[0]!.liquidEndMicro, 0);
  assert.equal(valve.seasons[0]!.valveLockedMicro, s.liquidEndMicro);
  // Capped conversion: at most the cap per season, the haircut burned.
  const capped = project(tr, { kind: "capped_conversion", ratio: 0.5, capPerAccountPerSeasonMicro: 10 * M }, [1]);
  assert.ok(capped.booksBalanced);
  assert.equal(capped.seasons[0]!.liquidEndMicro, 2 * 5 * M);
  assert.equal(capped.seasons[0]!.burnedMicro, 13 * M + 2 * 5 * M);
});

const SMALL: PopulationSpec = { casual: 24, regular: 12, heavy: 5, colluder: 4, switcher: 4, route_farmer: 3, shade_farmer: 3, honestClubs: 3 };

test("the trace changes nothing the simulator computes, and agrees with its books", () => {
  const opts = { seed: 7, ruleset: SIM_PILOT_1, population: SMALL, cityRadiusMeters: 2500, days: 21 };
  const plain = simulate(opts);
  const traced = simulate({ ...opts, trace: true });
  assert.equal(plain.trace, undefined);
  assert.equal(traced.fingerprint, plain.fingerprint);
  const tr = traced.trace!;
  assert.equal(tr.status, SIM_ONLY);
  assert.equal(tr.days.length, 21);
  assert.equal(tr.players.length, plain.players);
  const earned = tr.days.reduce((a, d) => a + d.lines.reduce((x, l) => x + l.earnedMicro, 0), 0);
  assert.equal(earned, plain.books.issuedMicro);
  const level = tr.days.reduce((a, d) => a + d.levelSpendMicro.reduce((x, [, m]) => x + m, 0), 0);
  assert.equal(level, plain.books.simLevelSpendMicro);
});

test("the research run is deterministic and every projection balances", () => {
  const opts = { seeds: [7], contexts: G5_CONTEXTS.slice(0, 1), population: SMALL, cityRadiusMeters: 2500, days: 21 };
  const a = runG5(opts);
  const b = runG5(opts);
  assert.equal(a.status, SIM_ONLY);
  assert.equal(a.deeds.length, G5_DEED_RULES.length);
  assert.equal(a.projections.length, G5_EMISSION_CONFIGS.length);
  for (const p of a.projections) {
    assert.ok(p.result.booksBalanced, p.result.label);
    assert.ok(p.result.poolRespected, p.result.label);
  }
  assert.deepEqual(
    a.projections.map((p) => p.result.seasons.map((s) => s.supplyEndMicro)),
    b.projections.map((p) => p.result.seasons.map((s) => s.supplyEndMicro)),
  );
  const none = a.sybil.filter((r) => r.policy === "none");
  assert.ok(none.length > 0 && none.every((r) => r.direct === Infinity && r.ring === Infinity && r.toll === Infinity));
});
