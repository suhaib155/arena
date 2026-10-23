/**
 * Settlement invariants, item 3: the reconciler checks a day against its OWN
 * pinned rules registry, never a rules object handed to it, and the season
 * roll-up re-verifies every constituent day instead of trusting a
 * `status: "settled"` label. Missing or corrupted days fail closed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { dayBooksProblems, economyRulesFor, MICRO_PER_MOVE, reconcileDay, settleDay, type EconomyRules } from "../economyV3";
import type { HoldingRules } from "../holding";
import {
  holdingsAtDayClose,
  settleCreditsDay,
  settleCreditsSeason,
  type CreditsDayResult,
  type CreditsPlayerInput,
} from "../holdingSettlement";

const registry = economyRulesFor(1)!;
const holdingRules: HoldingRules = { rulesVersion: 7, solidDecayPerDay: 10, shadeDecayMultiplier: 3, stageFloors: { held: 60, atRisk: 30, contested: 10 } };
const zoneOf = (unitId: string) => unitId.split("/")[0]!;
const C = (n: number) => Math.round(n * MICRO_PER_MOVE);

const walker = (playerId: string, over: Partial<CreditsPlayerInput> = {}): CreditsPlayerInput => ({
  playerId,
  sessions: [{ minutes: 25, meters: 2500 }, { minutes: 25, meters: 2500 }],
  activeDaysThisWeek: 5,
  trustWeight: 1,
  kitLevel: 1,
  ...over,
});

function day(season: number, d: number): Extract<CreditsDayResult, { status: "settled" }> {
  const r = settleCreditsDay({
    rulesVersion: 1,
    season,
    day: d,
    players: [walker("ana"), walker("ben", { sessions: [{ minutes: 40, meters: 4000 }] })],
    holdings: holdingsAtDayClose({ day: d, states: new Map(), entries: [], holdingRules, zoneOf, shadeCountsAsHeld: true }),
  });
  assert.equal(r.status, "settled");
  return r as Extract<CreditsDayResult, { status: "settled" }>;
}

const clone = <T>(v: T): T => structuredClone(v);

test("a forged rules object that keeps version 1 but sets a 5% toll is refused by the reconciler", () => {
  const forged: EconomyRules = { ...registry, tollBasisPoints: 500 };
  const s = settleDay(forged, {
    poolMicro: C(100_000),
    players: [{ playerId: "r", sessions: [{ minutes: 40, meters: 4000, crossedCells: ["a", "b"] }], activeDaysThisWeek: 1, trustWeight: 1, kitLevel: 1, zonesHeld: 0, unvisitedZoneLevels: [] }],
    deedOwnerByCell: new Map([["a", "o"], ["b", "o"]]),
  });
  assert.ok(s.players[0]!.tollPaidMicro * 10_000 > s.players[0]!.dayRewardMicro * 200, "the forged rules charged more than 2%");
  assert.ok(dayBooksProblems(forged, s).length > 0, "the caller's rules object is not trusted");
  assert.ok(reconcileDay(1, s).some((p) => /toll above 2%/.test(p)), "the registry's 2% is applied");
  assert.deepEqual(reconcileDay(99, s), ["unknown economy rules version 99"]);
});

test("the registry's rules cannot be rewritten in place by a caller", () => {
  const r = economyRulesFor(1)!;
  assert.throws(() => { (r as { tollBasisPoints: number }).tollBasisPoints = 500; }, TypeError);
  assert.throws(() => { (r.rechargeRateByKit as Record<number, number>)[1] = 0; }, TypeError);
  assert.equal(economyRulesFor(1)!.tollBasisPoints, 200);
});

test("the season re-verifies each day: a doubled pool with an inflated line is refused", () => {
  const good = day(1, 0);
  const bad = clone(good);
  bad.poolMicro *= 2;
  bad.settlement.books.poolMicro *= 2;
  bad.settlement.books.returnedToSeasonPoolMicro = bad.settlement.books.poolMicro - bad.settlement.books.mintedMicro;
  bad.lines[0]!.netMicro += C(1_000);
  const s = settleCreditsSeason(1, 1, [bad, day(1, 1)]);
  assert.equal(s.status, "refused");
  if (s.status === "refused") assert.ok(s.problems.some((p) => /day 0/.test(p)), s.problems.join("; "));
});

test("the season refuses a corrupted day: lines that disagree with the books, unsafe numbers, broken identities", () => {
  const lineNet = clone(day(1, 0));
  lineNet.lines[1]!.netMicro -= 1;
  assert.equal(settleCreditsSeason(1, 1, [lineNet]).status, "refused", "a line's net does not follow from its parts");

  const lineEarned = clone(day(1, 0));
  lineEarned.lines[0]!.earnedMicro += 5;
  lineEarned.lines[0]!.netMicro += 5;
  assert.equal(settleCreditsSeason(1, 1, [lineEarned]).status, "refused", "lines do not add up to the books");

  const unsafe = clone(day(1, 0));
  unsafe.lines[0]!.netMicro = 2 ** 53;
  assert.equal(settleCreditsSeason(1, 1, [unsafe]).status, "refused", "an unsafe amount");

  const books = clone(day(1, 0));
  books.settlement.books.burnedMicro += 1;
  assert.equal(settleCreditsSeason(1, 1, [books]).status, "refused", "minted no longer accounted for");

  const droppedLine = clone(day(1, 0));
  droppedLine.lines.pop();
  assert.equal(settleCreditsSeason(1, 1, [droppedLine]).status, "refused", "a line missing");
});

test("the season refuses a day outside the season's range and reports missing days and their unsettled pool", () => {
  const out = clone(day(1, 0));
  out.day = 400;
  assert.equal(settleCreditsSeason(1, 1, [out], { firstDay: 0 }).status, "refused", "day 400 of a 90-day season starting at 0");
  assert.equal(settleCreditsSeason(1, 1, [], { firstDay: -1 }).status, "refused", "a negative first day");

  const partial = settleCreditsSeason(1, 1, [day(1, 0), day(1, 2)], { firstDay: 0 });
  assert.equal(partial.status, "settled");
  if (partial.status === "settled") {
    assert.equal(partial.missingDays.length, 88);
    assert.deepEqual(partial.missingDays.slice(0, 2), [1, 3]);
    assert.equal(partial.unsettledPoolMicro, partial.seasonPoolMicro - partial.poolMicro);
    assert.equal(partial.rulesVersion, 1, "the version pin is carried");
  }
  const strict = settleCreditsSeason(1, 1, [day(1, 0), day(1, 2)], { firstDay: 0, requireAllDays: true });
  assert.equal(strict.status, "refused", "a season closed with missing days fails closed");
  if (strict.status === "refused") assert.ok(strict.problems.some((p) => /missing/.test(p)));
});

test("a clean season still settles, and its totals are exact", () => {
  const days = Array.from({ length: 90 }, (_, d) => day(1, d));
  const s = settleCreditsSeason(1, 1, days, { firstDay: 0, requireAllDays: true });
  assert.equal(s.status, "settled", s.status === "refused" ? s.problems.join("; ") : "");
  if (s.status !== "settled") return;
  assert.equal(s.missingDays.length, 0);
  assert.equal(s.unsettledPoolMicro, 0);
  assert.equal(s.issuedMicro + s.returnedMicro, s.poolMicro);
  assert.equal(s.byPlayer.reduce((a, p) => a + p.netMicro, 0), s.issuedMicro - s.burnedMicro);
});
