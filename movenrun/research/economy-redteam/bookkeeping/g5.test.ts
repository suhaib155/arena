/**
 * Token-equivalent side: properties over the read-only PR #122 research models
 * (shared/src/sim/contractLedger.ts and economyG5.ts). They are not in this
 * branch, so the code is imported from a local read-only checkout named by
 * BOOKKEEPING_WT122 (path to its `movenrun` directory); when it is unset or
 * missing the tests are skipped, not failed.
 *
 * SIMULATION ONLY. Nothing here is a token, a balance or a chain call.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { economyRulesFor, seasonPoolMicro } from "@movenrun/shared/economy-v3";
import { mulberry32, type Rng } from "./lib/prng";

const candidates = [process.env.BOOKKEEPING_WT122].filter(Boolean) as string[];
const root = candidates.find((p) => existsSync(join(p, "shared/src/sim/economyG5.ts")));
const skip = root ? false : "PR #122 checkout not present (set BOOKKEEPING_WT122)";
const manifest = JSON.parse(readFileSync(join(__dirname, "seeds.json"), "utf8"));
const g5Seeds = manifest.g5 as Record<string, { seed: number; cases: number }>;
const RULES = economyRulesFor(1)!;
const PROFILE_FALLBACK = "steady";

async function load() {
  const ledger = await import(join(root!, "shared/src/sim/contractLedger.ts"));
  const g5 = await import(join(root!, "shared/src/sim/economyG5.ts"));
  const world = await import(join(root!, "shared/src/sim/world.ts"));
  const pilot = await import(join(root!, "shared/src/sim/pilotRuleset.ts"));
  return { ledger, g5, world, pilot };
}

/** A synthetic per-day trace in #122's SeasonTrace shape. Ids are labels, not people or places. */
function trace(rng: Rng, SIM_ONLY: string, profiles: readonly string[]) {
  const nPlayers = rng.int(2, 12);
  const players = Array.from({ length: nPlayers }, (_, i) => ({ id: `p${i}`, profile: profiles[i % profiles.length] ?? PROFILE_FALLBACK, club: null }));
  const units = Array.from({ length: rng.int(2, 20) }, (_, i) => `u${i}`);
  const days = Array.from({ length: rng.int(3, 15) }, (_, d) => {
    const lines = players.map((p) => {
      const earned = rng.chance(0.2) ? 0 : rng.int(0, 20_000_000);
      const recharge = Math.floor(earned * rng.next() * 0.25);
      const upkeep = Math.floor((earned * 0.6 - recharge) * rng.next());
      return { playerId: p.id, earnedMicro: earned, rechargeMicro: recharge, upkeepTakenMicro: Math.max(0, upkeep), tollPaidMicro: 0, tollReceivedMicro: 0, netMicro: 0 };
    });
    const stepped = units.map((u) => [u, players.filter(() => rng.chance(0.3)).map((p) => p.id).sort()] as [string, string[]]).filter(([, w]) => w.length > 0);
    return { day: d + 1, poolMicro: RULES.seasonOneDailyPoolMicro, dayShareMicro: rng.int(0, 5_000_000), lines, levelSpendMicro: players.filter(() => rng.chance(0.1)).map((p) => [p.id, rng.int(0, 3_000_000)] as [string, number]), held: [], stepped };
  });
  const deeds = units.filter(() => rng.chance(0.3)).map((u) => ({ unitId: u, holderId: rng.pick(players).id, day: rng.int(1, days.length) }));
  deeds.sort((a, b) => a.day - b.day);
  const firstDeedDay = new Map<string, number>();
  for (const x of deeds) if (!firstDeedDay.has(x.holderId)) firstDeedDay.set(x.holderId, x.day);
  return { trace: { status: SIM_ONLY, ruleset: "synthetic", seed: 0, units: units.length, players, days }, deedReport: { status: SIM_ONLY, deeds, firstDeedDay } };
}

test("G01 #122 contractLedger: season budgets release exactly 400M ≤ 1bn and agree with economyV3 within 1 micro", { skip }, async () => {
  const { ledger } = await load();
  const b: number[] = ledger.seasonBudgets();
  const sum = b.reduce((a, x) => a + x, 0);
  assert.ok(Math.abs(sum - 400_000_000) < 1e-6 && sum <= 1_000_000_000);
  b.forEach((x, i) => assert.ok(Math.abs(x * 1e6 - seasonPoolMicro(RULES, i + 1)) <= 1, `season ${i + 1}`));
});

test("documents defect (#122 H1, prototype settlement): one publication on day 90 takes a whole season's budget, with no movement bound", { skip }, async () => {
  const { ledger } = await load();
  assert.equal(ledger.prototypeDailyPool(9_000_000, 0, 90), 9_000_000);
  const path = ledger.prototypeFastestExhaustion();
  assert.equal(path.wallClockDays, 0);
  assert.ok(Math.abs(path.minted - 400_000_000) < 1e-3, "the whole allocation in zero wall-clock days");
});

test("G02–G04 #122 economyG5: tolls ≤ 2% per payer-day; books balance; burns reduce supply; pool respected; locked never liquid retroactively", { skip }, async () => {
  const { g5, world, pilot } = await load();
  const m = g5Seeds.G02!;
  const rng = mulberry32(m.seed);
  const counts = { cases: 0, tollPayments: 0, projections: 0 };
  for (let i = 0; i < m.cases; i++) {
    const { trace: tr, deedReport } = trace(rng, pilot.SIM_ONLY, world.PROFILES);
    const tolls = g5.tollIncome(tr, deedReport, (id: string) => id);
    for (const d of tr.days) {
      const paid = new Map<string, number>();
      for (const t of tolls.byDay.get(d.day) ?? []) {
        assert.notEqual(t.payer, t.owner, "owner = walker paid a toll");
        paid.set(t.payer, (paid.get(t.payer) ?? 0) + t.micro);
        counts.tollPayments += 1;
      }
      for (const l of d.lines) assert.ok((paid.get(l.playerId) ?? 0) * 10_000 <= l.earnedMicro * 200, `case ${i}: day toll above 2%`);
    }
    const policy = rng.pick([{ kind: "v3_source", valveShareOfMint: rng.chance(0.5) ? null : 0.2 }, { kind: "locked_only" }, { kind: "none" }]);
    const p = g5.projectEconomy(tr, {
      label: "bk", status: pilot.SIM_ONLY, economyRulesVersion: 1, schedule: "v3", populationBySeason: [1, rng.int(1, 3)], policy,
      sinks: { label: "bk", levelSpend: true, deedClaimFeeDayShares: 0, discretionaryShareOfBalance: rng.chance(0.5) ? 0.1 : 0, seasonEndBurnShareOfLocked: rng.chance(0.5) ? 0.1 : 0 },
      deedRules: g5.DEED_RULES_SOURCE,
    }, deedReport, tolls);
    counts.projections += 1;
    assert.ok(p.booksBalanced, `case ${i}: supply change ≠ minted − burned`);
    assert.ok(p.poolRespected, `case ${i}: a day minted above its pool`);
    for (const s of p.seasons) {
      assert.equal(s.supplyEndMicro, s.supplyStartMicro + s.mintedMicro - s.burnedMicro, "burns reduce supply");
      assert.ok(s.cumulativeMintedMicro <= RULES.playerAllocationMicro);
      if (policy.kind !== "v3_source") assert.equal(s.liquidEndMicro, 0, `${policy.kind}: liquid appeared`);
    }
    if (policy.kind === "v3_source") {
      // Upper bound on liquid in season 1: earnings after each holder's first deed day plus all tolls (owners only).
      const s1 = p.seasons[0]!;
      let bound = tolls.totalMicro;
      for (const d of tr.days) for (const l of d.lines) {
        const first = deedReport.firstDeedDay.get(l.playerId);
        if (first !== undefined && d.day > first) bound += l.earnedMicro;
      }
      assert.ok(s1.liquidEndMicro <= bound, `case ${i}: liquid ${s1.liquidEndMicro} above post-deed bound ${bound}`);
      const neverDeeded = tr.players.filter((x: { id: string }) => !deedReport.firstDeedDay.has(x.id)).length;
      if (neverDeeded === tr.players.length) assert.equal(s1.liquidEndMicro, 0, "liquid without any deed");
    }
    counts.cases += 1;
  }
  assert.equal(counts.cases, m.cases);
});

test("G05 #122 economyG5: 420 flat seasons at saturating demand never pass the 400M allocation", { skip }, async () => {
  const { g5, world, pilot } = await load();
  const rng = mulberry32(g5Seeds.G05!.seed);
  const { trace: tr, deedReport } = trace(rng, pilot.SIM_ONLY, world.PROFILES);
  const p = g5.projectEconomy(tr, {
    label: "cap", status: pilot.SIM_ONLY, economyRulesVersion: 1, schedule: "flat_s1", populationBySeason: Array(420).fill(100_000), policy: { kind: "locked_only" },
    sinks: { label: "none", levelSpend: false, deedClaimFeeDayShares: 0, discretionaryShareOfBalance: 0, seasonEndBurnShareOfLocked: 0 }, deedRules: g5.DEED_RULES_SOURCE,
  }, deedReport, g5.tollIncome(tr, deedReport, (id: string) => id));
  const last = p.seasons.at(-1)!;
  assert.ok(last.cumulativeMintedMicro <= RULES.playerAllocationMicro);
  assert.ok(p.booksBalanced && p.poolRespected);
});
