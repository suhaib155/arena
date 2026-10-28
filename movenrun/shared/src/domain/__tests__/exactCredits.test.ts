/**
 * Exact integer arithmetic for off-chain credits (settlement invariants,
 * item 2): every amount and pool is a non-negative SAFE integer, the books'
 * identities are checked exactly (bigint), and a conversion to an
 * 18-decimal unit never goes through a float.
 *
 * Track B's float-conversion finding is reproduced here first: the float path
 * (micro × 1e12) disagrees with the exact one on a large share of generated
 * amounts, so only the exact path is offered.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  dayBooksProblems,
  dayCloseCharges,
  economyRulesFor,
  sessionToll,
  settleDay,
  type DaySettlement,
} from "../economyV3";
import {
  CreditConversionRefused,
  decimalToFixed18,
  fixed18ToMicroExact,
  microToFixed18,
  WEI_PER_MICRO,
} from "../creditUnits";

const rules = economyRulesFor(1)!;

/** mulberry32: a deterministic generator, so the counts below are stable. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("Track B finding reproduced: the float path to an 18-decimal unit is wrong on many amounts; the exact path never is", () => {
  const next = prng(80117);
  let floatWrong = 0;
  const cases = 5_000;
  for (let i = 0; i < cases; i++) {
    // Up to the 1bn hard cap in micro (1e15), as Track B generated them.
    const micro = Math.floor(next() * 1e15);
    const exact = BigInt(micro) * WEI_PER_MICRO;
    const viaFloat = BigInt(Math.round(micro * 1e12));
    if (viaFloat !== exact) floatWrong += 1;
    assert.equal(microToFixed18(micro), exact);
    assert.equal(fixed18ToMicroExact(exact), BigInt(micro));
  }
  assert.ok(floatWrong > cases / 3, `float path wrong in ${floatWrong} of ${cases}`);
});

test("the exact conversion refuses unsafe, negative, fractional and sub-micro amounts instead of rounding", () => {
  for (const bad of [2 ** 53, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_VALUE]) {
    assert.throws(() => microToFixed18(bad), CreditConversionRefused, String(bad));
  }
  assert.throws(() => fixed18ToMicroExact(WEI_PER_MICRO + 1n), CreditConversionRefused, "dust is an error, never dropped");
  assert.throws(() => fixed18ToMicroExact(-1n), CreditConversionRefused);
  assert.throws(() => fixed18ToMicroExact(BigInt(Number.MAX_SAFE_INTEGER + 1) * WEI_PER_MICRO), CreditConversionRefused);
});

test("a decimal factor becomes 18-decimal fixed point exactly, by its written decimal, never by float multiplication", () => {
  assert.equal(decimalToFixed18(1.1), 1_100_000_000_000_000_000n);
  assert.notEqual(BigInt(Math.round(1.1 * 1e18)), 1_100_000_000_000_000_000n, "the float path is off");
  assert.equal(decimalToFixed18(1), 10n ** 18n);
  assert.equal(decimalToFixed18(0.000001), 10n ** 12n);
  assert.equal(decimalToFixed18(1e-7), 10n ** 11n);
  assert.equal(decimalToFixed18(0), 0n);
  for (const bad of [-0.5, Number.NaN, Number.POSITIVE_INFINITY, 1e-19, 1e60]) {
    assert.throws(() => decimalToFixed18(bad), CreditConversionRefused, String(bad));
  }
});

test("settleDay refuses a pool that is not a safe integer (2^53, 2^62, MAX_VALUE)", () => {
  for (const poolMicro of [2 ** 53, 2 ** 62, Number.MAX_VALUE]) {
    assert.throws(() => settleDay(rules, { poolMicro, players: [], deedOwnerByCell: new Map() }), RangeError, String(poolMicro));
  }
});

test("charges and tolls refuse amounts that are not safe integers instead of returning NaN, Infinity or inexact values", () => {
  assert.throws(() => sessionToll(rules, Number.NaN, ["a"], new Map([["a", "o"]]), new Set()), RangeError);
  assert.throws(() => sessionToll(rules, Number.POSITIVE_INFINITY, ["a"], new Map([["a", "o"]]), new Set()), RangeError);
  assert.throws(() => dayCloseCharges(rules, { dayRewardMicro: 0, scoringSessions: 0, kitLevel: 1, dayShareMicro: Number.NaN, zonesHeld: 1, unvisitedZoneLevels: [1] }), RangeError);
  assert.throws(() => dayCloseCharges(rules, { dayRewardMicro: 0, scoringSessions: 0, kitLevel: 1, dayShareMicro: 1, zonesHeld: 1.8e308, unvisitedZoneLevels: [1] }), RangeError);
  assert.throws(() => dayCloseCharges(rules, { dayRewardMicro: 1, scoringSessions: 1, kitLevel: 9 as never, dayShareMicro: 1, zonesHeld: 0, unvisitedZoneLevels: [] }), RangeError);
});

test("the reconciler refuses books whose amounts are not safe integers, even when the float sums happen to agree", () => {
  const big = Number.MAX_VALUE;
  const s: DaySettlement = {
    totalPoints: 1,
    dayShareMicro: 0,
    players: [],
    // At MAX_VALUE, minted + returned === pool in floating point although the
    // exact difference is not `returned`.
    books: { poolMicro: big, mintedMicro: 2 ** 60, creditedMicro: 2 ** 60, tollPaidMicro: 0, tollReceivedMicro: 0, burnedMicro: 0, returnedToSeasonPoolMicro: big },
  };
  assert.equal(s.books.mintedMicro + s.books.returnedToSeasonPoolMicro, s.books.poolMicro, "the float identity holds");
  assert.ok(dayBooksProblems(rules, s).length > 0, "but the books are refused");

  // 2^53 + 1 is not representable: an off-by-one hidden by float rounding.
  const t: DaySettlement = {
    totalPoints: 1,
    dayShareMicro: 0,
    players: [],
    books: { poolMicro: 2 ** 53 + 2, mintedMicro: 2 ** 53, creditedMicro: 2 ** 53, tollPaidMicro: 0, tollReceivedMicro: 0, burnedMicro: 0, returnedToSeasonPoolMicro: 1 },
  };
  assert.ok(dayBooksProblems(rules, t).some((p) => /safe integer/.test(p)));
});
