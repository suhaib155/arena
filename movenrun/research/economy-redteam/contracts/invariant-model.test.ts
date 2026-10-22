// Offline invariant checks over the pure model in model.ts. SYNTHETIC EXPERIMENT; seeds in seeds.json.
// Hypotheses and thresholds are fixed before the numbers are shown:
//   H-A  without a clock binding, 400M can be issued by 2 * ceil(seasons) publications at day 0.
//   H-B  with clock binding and a 2x ceiling, issued <= 2 x nominal x elapsed days at every step, for every seed.
//   H-C  with zero liquid allowance, liquid issuance from tolls alone is exactly 2% of gross (not zero).
//   H-D  a cap on totalSupply reopens after burns; a cap on cumulative minted does not.
//   H-E  a treasury transfer leaves totalSupply unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LIFETIME_CAP, ONE, PLAYER_ALLOCATION, SEASON_ONE, burn, digest, eip712Like, jumpAttack, mintV1, mintV3, mulberry32, newSettlement,
  newSupply, publish, quorumFailures, randomAttack, seasonSchedule, treasuryTransfer, v1GreatBurnPayload,
} from "./model.ts";

const here = dirname(fileURLToPath(import.meta.url));
const seeds: number[] = JSON.parse(readFileSync(join(here, "seeds.json"), "utf8")).seeds;

test("season schedule sums to exactly the 400M player allocation, first season 9M, floor 2M", () => {
  const sch = seasonSchedule();
  assert.equal(sch.reduce((a, b) => a + b, 0n), PLAYER_ALLOCATION);
  assert.equal(sch[0], SEASON_ONE);
  assert.ok(sch.length >= 170 && sch.length <= 190, `seasons: ${sch.length}`);
  assert.ok(sch.slice(0, sch.length - 1).every((b) => b >= 2_000_000n * ONE));
});

test("H-A: unbound clock, both keys held: the whole allocation is issued in about 180 publications at time zero", () => {
  const r = jumpAttack({ bindToClock: false, ceilingMultiple: 0 }, () => 0);
  assert.equal(r.lifetime, PLAYER_ALLOCATION);
  assert.ok(r.publications >= 170 && r.publications <= 190, `publications ${r.publications}`);
  assert.equal(r.lastNowDay, 0);
});

test("H-A (patched rule): the same attacker is refused on the first publication", () => {
  const r = jumpAttack({ bindToClock: true, ceilingMultiple: 2 }, () => 0);
  assert.equal(r.lifetime, 0n);
});

test("H-B: patched rule keeps issued <= 2 x nominal x elapsed days, for every manifest seed", () => {
  for (const seed of seeds) {
    const r = randomAttack(seed, 400, { bindToClock: true, ceilingMultiple: 2 });
    assert.ok(r.worstRatio <= 2.0000001, `seed ${seed}: ${r.worstRatio}`);
  }
});

test("H-B control: with the clock binding removed, the same attacker exceeds 2x nominal at some seed", () => {
  const worst = seeds.map((s) => randomAttack(s, 400, { bindToClock: false, ceilingMultiple: 0 }).worstRatio);
  assert.ok(Math.max(...worst) > 2, `max ratio ${Math.max(...worst)}`);
});

test("residual after patch: with the clock bound, a both-keys attacker cannot accelerate emission past 1x nominal, but without the ceiling one publication can still concentrate a season", () => {
  const nominal = SEASON_ONE / 90n;
  for (const skip of [0, 10, 44, 80, 89]) {
    for (const ceiling of [0, 2]) {
      const s = newSettlement();
      let maxOne = 0n, worst = 0;
      for (let day = 1; day <= 90; day++) {
        if (day <= skip) continue;
        const pool = (s.seasonBudget.get(1) ?? SEASON_ONE) - (s.seasonIssued.get(1) ?? 0n);
        const want = pool / BigInt(90 - day + 1); // greedy: the full pool for the day
        const r = publish(s, day, day, ceiling ? (want > (SEASON_ONE * 2n) / 90n ? (SEASON_ONE * 2n) / 90n : want) : want, { bindToClock: true, ceilingMultiple: ceiling });
        if (typeof r === "bigint" && r > maxOne) maxOne = r;
        worst = Math.max(worst, Number((s.lifetimeIssued * 1000n) / (nominal * BigInt(day))) / 1000);
      }
      assert.ok(worst <= 1.001, `skip ${skip} ceiling ${ceiling}: ${worst}`);
      if (skip === 89 && ceiling === 0) assert.equal(maxOne, SEASON_ONE); // one publication takes the whole season
      if (skip === 89 && ceiling === 2) assert.ok(maxOne <= (SEASON_ONE * 2n) / 90n);
    }
  }
});

test("forfeiture residual: publishing only the latest closed day forfeits every earlier day, permanently", () => {
  const s = newSettlement();
  const opt = { bindToClock: true, ceilingMultiple: 2 };
  assert.equal(typeof publish(s, 10, 10, 1n, opt), "bigint");
  assert.equal(publish(s, 3, 10, 1n, opt), "DayNotAdvancing");
});

test("H-C: valve closed (zero allowance): tolls still make exactly 2% of gross liquid", () => {
  const s = newSettlement();
  for (let d = 1; d <= 90; d++) publish(s, d, 90, SEASON_ONE / 90n, { bindToClock: false, ceilingMultiple: 0 });
  assert.equal(s.liquidFromTolls, (s.lifetimeIssued * 200n) / 10000n);
  assert.ok(s.liquidFromTolls > 0n);
  const life = (PLAYER_ALLOCATION * 200n) / 10000n;
  assert.equal(life, 8_000_000n * ONE); // upper bound across the whole allocation, toll rate fixed in code
});

test("H-D: V3 cumulative cap does not reopen after burns; V1 totalSupply cap does", () => {
  const rnd = mulberry32(seeds[0]!);
  const v3 = newSupply(), v1 = newSupply();
  for (let i = 0; i < 4000; i++) {
    const amt = BigInt(1 + Math.floor(rnd() * 900)) * 1_000_000n * ONE / 10n;
    if (rnd() < 0.55) { mintV3(v3, amt); mintV1(v1, amt); }
    else { const b = amt < v3.totalSupply ? amt : v3.totalSupply; burn(v3, b); const b1 = b < v1.totalSupply ? b : v1.totalSupply; burn(v1, b1); }
  }
  assert.ok(v3.everMinted <= LIFETIME_CAP);
  assert.ok(v1.everMinted > LIFETIME_CAP, "V1-style cap lets total ever minted exceed the stated lifetime cap after burns");
});

test("H-E: a transfer to a treasury is not a burn; supply is unchanged", () => {
  const s = newSupply();
  mintV3(s, 1000n * ONE);
  const before = s.totalSupply;
  treasuryTransfer(s, 100n * ONE);
  assert.equal(s.totalSupply, before);
  burn(s, 100n * ONE);
  assert.equal(s.totalSupply, before - 100n * ONE);
  assert.equal(s.cumulativeMinted, before);
});

test("replay: signatures bound to a different chain, contract or season produce different digests; V1 great-burn payload has none of the freshness fields", () => {
  const sh = digest(["settle", 1, 1000]);
  const base = eip712Like("MovenRunSettlement", "3", 84532, "0xA", sh);
  assert.notEqual(base, eip712Like("MovenRunSettlement", "3", 8453, "0xA", sh));
  assert.notEqual(base, eip712Like("MovenRunSettlement", "3", 84532, "0xB", sh));
  assert.notEqual(base, eip712Like("MovenRunSettlement", "4", 84532, "0xA", sh));
  const p1 = v1GreatBurnPayload(84532, 2, [1, 2], [5n, 6n]);
  assert.equal(p1, v1GreatBurnPayload(84532, 2, [1, 2], [5n, 6n])); // same payload, same digest, no nonce: replayable
  assert.notEqual(p1, v1GreatBurnPayload(84532, 3, [1, 2], [5n, 6n])); // season is bound
});

test("signer concentration: one compromised key suffices for a one-signer path and not for a two-of-two path", () => {
  const compromised = new Set(["eligibility-1"]);
  assert.equal(quorumFailures(compromised, ["eligibility-1"], 1), true);
  assert.equal(quorumFailures(compromised, ["eligibility-1", "eligibility-2"], 2), false);
  assert.equal(quorumFailures(new Set(["eligibility-1", "eligibility-2"]), ["eligibility-1", "eligibility-2"], 2), true); // shared pipeline defeats it
});

test("determinism: same seed gives byte-identical output; different seeds differ", () => {
  const a = JSON.stringify(randomAttack(seeds[0]!, 120, { bindToClock: false, ceilingMultiple: 0 }), (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  const b = JSON.stringify(randomAttack(seeds[0]!, 120, { bindToClock: false, ceilingMultiple: 0 }), (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  const c = JSON.stringify(randomAttack(seeds[1]!, 120, { bindToClock: false, ceilingMultiple: 0 }), (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(new Set(seeds).size, seeds.length);
});
