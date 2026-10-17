/**
 * G3: off-chain credits settled from the holding ledger. The worked numbers
 * are the source's own (section 7, 17, 18, 19); decay numbers are
 * placeholders for D4 and zones are placeholders for D5.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { dailyPoolMicro, economyRulesFor, effort, MICRO_PER_MOVE } from "../economyV3";
import { newUnit, type HoldingRules, type Push, type UnitState } from "../holding";
import { applyLedger, type LedgerEntry, type PushEvent } from "../holdingLedger";
import {
  holdingsAtDayClose,
  settleCreditsDay,
  settleCreditsSeason,
  type CreditsDayResult,
  type CreditsPlayerInput,
  type HoldingsInput,
} from "../holdingSettlement";

const economy = economyRulesFor(1)!;
// D4 is open: test values only.
const rules: HoldingRules = { rulesVersion: 7, solidDecayPerDay: 10, shadeDecayMultiplier: 3, stageFloors: { held: 60, atRisk: 30, contested: 10 } };
const SOLID: Push = { kind: "solid" };
const C = (n: number) => Math.round(n * MICRO_PER_MOVE);
const near = (actual: number, expected: number, tolerance: number, what: string) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} is not within ${tolerance} of ${expected}`);

const DAY = 10;
const held = (unitId: string, holderId: string, over: Partial<UnitState> = {}): UnitState => ({
  ...newUnit(unitId, DAY),
  holderId,
  strength: 100,
  level: 2,
  ...over,
});
const mapOf = (...states: UnitState[]) => new Map(states.map((s) => [s.unitId, s]));
const entry = (eventId: string, unitId: string, walkerId: string, over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  eventId,
  unitId,
  walkerId,
  day: DAY,
  pushKind: "solid",
  outcome: "reinforced",
  previousHolderId: walkerId,
  newHolderId: walkerId,
  strengthBefore: 100,
  strengthAfter: 100,
  rulesVersion: rules.rulesVersion,
  ...over,
});
// D5 is open: in these tests a unit's zone is the part of its id before "/".
const zoneOf = (unitId: string) => unitId.split("/")[0]!;
const close = (over: Partial<HoldingsInput>) =>
  holdingsAtDayClose({ day: DAY, states: new Map(), entries: [], holdingRules: rules, zoneOf, shadeCountsAsHeld: true, ...over });
const walker = (playerId: string, over: Partial<CreditsPlayerInput> = {}): CreditsPlayerInput => ({
  playerId,
  sessions: [
    { minutes: 25, meters: 2500 },
    { minutes: 25, meters: 2500 },
  ],
  activeDaysThisWeek: 5,
  trustWeight: 1,
  kitLevel: 1,
  ...over,
});
const settled = (r: CreditsDayResult) => {
  assert.equal(r.status, "settled", r.status === "refused" ? r.problems.join("; ") : "");
  return r as Extract<CreditsDayResult, { status: "settled" }>;
};

test("holdings: zones, levels and visits come from the ledger at close", () => {
  const states = mapOf(
    held("z1/a", "meera"),
    held("z1/b", "meera"),
    held("z2/a", "meera", { level: 3 }),
    held("z3/a", "ravi"),
    newUnit("z4/a", DAY),
  );
  const h = close({ states, entries: [entry("e1", "z1/b", "meera"), entry("e2", "z3/a", "meera", { outcome: "eroded", newHolderId: "ravi" })] });
  assert.deepEqual(h.problems, []);
  assert.deepEqual(h.holders, [
    {
      playerId: "meera",
      zones: [
        { zoneId: "z1", level: 2, visited: true, unitIds: ["z1/a", "z1/b"] },
        { zoneId: "z2", level: 3, visited: false, unitIds: ["z2/a"] },
      ],
    },
    // Meera stepping on Ravi's zone is not Ravi's visit.
    { playerId: "ravi", zones: [{ zoneId: "z3", level: 2, visited: false, unitIds: ["z3/a"] }] },
  ]);
});

test("holdings: enclosing a zone is not a visit; entries from other days are ignored", () => {
  const states = mapOf(held("z1/a", "ana"));
  const h = close({ states, entries: [entry("e1", "z1/a", "ana", { pushKind: "shade" }), entry("e2", "z1/a", "ana", { day: DAY - 1 })] });
  assert.equal(h.holders[0]!.zones[0]!.visited, false);
});

test("holdings: ground is decayed to day close (D4 as a parameter); run-out ground is not charged", () => {
  const states = mapOf(held("z1/a", "ana", { strength: 30, asOfDay: DAY - 3, level: 1 }), held("z2/a", "ana", { strength: 31, asOfDay: DAY - 3, level: 1 }));
  const h = close({ states });
  assert.equal(h.states.get("z1/a")!.holderId, null, "30 − 3 × 10 = 0: back on the map");
  assert.equal(h.states.get("z2/a")!.strength, 1);
  assert.deepEqual(h.holders.map((p) => p.zones.map((z) => z.zoneId)), [["z2"]]);
  // Outpost ground has no level resistance; fortification takes 30% off decay (section 11): 3 days × 7 = 21.
  const f = close({ states: mapOf(held("z1/a", "ana", { strength: 30, asOfDay: DAY - 3, level: 1, fortified: true })) });
  assert.equal(f.states.get("z1/a")!.strength, 9);
});

test("holdings: whether shade is a held zone is D15, decided by the caller", () => {
  const states = mapOf(held("z1/a", "ana", { ground: "shade", strength: 20 }));
  assert.equal(close({ states, shadeCountsAsHeld: true }).holders.length, 1);
  assert.equal(close({ states, shadeCountsAsHeld: false }).holders.length, 0);
  const undecided = close({ states, shadeCountsAsHeld: undefined as unknown as boolean });
  assert.ok(undecided.problems.some((p) => p.includes("D15")));
});

test("holdings: what the model cannot decide is a problem, not a guess", () => {
  const mixed = close({ states: mapOf(held("z1/a", "ana", { level: 2 }), held("z1/b", "ana", { level: 4 })) });
  assert.ok(mixed.problems.some((p) => p.includes("levels 2, 4") && p.includes("D5")), mixed.problems.join("; "));
  const version = close({ states: mapOf(held("z1/a", "ana")), entries: [entry("e1", "z1/a", "ana", { rulesVersion: 6 })] });
  assert.ok(version.problems.some((p) => p.includes("rules version 6")));
  const noZone = close({ states: mapOf(held("z1/a", "ana")), zoneOf: () => "" });
  assert.ok(noZone.problems.some((p) => p.includes("no zone")));
  const thrown = close({ states: mapOf(held("z1/a", "ana")), zoneOf: () => { throw new Error("D5 not decided"); } });
  assert.ok(thrown.problems.some((p) => p.includes("D5 not decided")));
  const later = close({ states: mapOf(held("z1/a", "ana", { asOfDay: DAY + 1 })) });
  assert.ok(later.problems.some((p) => p.includes("after day")));
  const wrong = close({ states: new Map([["x", held("z1/a", "ana")]]) });
  assert.ok(wrong.problems.some((p) => p.includes("wrong id")));
  const broken = close({ states: mapOf({ ...held("z1/a", "ana"), strength: 140 }) });
  assert.ok(broken.problems.some((p) => p.includes("inconsistent")));
  // Any of these refuses the whole day.
  const r = settleCreditsDay({ rulesVersion: 1, season: 1, day: DAY, players: [], holdings: mixed });
  assert.equal(r.status, "refused");
});

test("sections 18 and 19: Meera's and Dan's day-close charges, from ledger holdings", () => {
  // Meera holds six Camp zones and walks two of them (section 18 step 9).
  // Dan holds forty Camp zones and walks none (section 19). The rest of the
  // day is the source's: 40,000 movers, 60,000 points, a 2.50 day-share.
  const meeraZones = Array.from({ length: 6 }, (_, i) => held(`m${i}/a`, "meera"));
  const danZones = Array.from({ length: 40 }, (_, i) => held(`d${i}/a`, "dan"));
  const raw: PushEvent[] = [
    { eventId: "s1-0", unitId: "m0/a", walkerId: "meera", push: SOLID, day: DAY },
    { eventId: "s2-0", unitId: "m1/a", walkerId: "meera", push: SOLID, day: DAY },
  ];
  const ledger = applyLedger({ states: mapOf(...meeraZones, ...danZones), events: raw, rules });
  assert.ok(ledger.results.every((r) => r.status === "applied"));
  const holdings = close({ states: ledger.states, entries: ledger.entries });
  assert.deepEqual(holdings.problems, []);

  const meeraPoints = 2 * effort(economy, 25) * 1.4;
  const filler = 60_000 - 39_998 * 1.5 - meeraPoints;
  const players = [
    walker("meera"),
    ...Array.from({ length: 39_998 }, (_, i) => walker(`p${i}`, { sessions: [{ minutes: 40, meters: 4000 }], activeDaysThisWeek: 6 })),
    walker("filler", { sessions: [{ minutes: 40 * filler ** 2, meters: 4000 }], activeDaysThisWeek: 1 }),
  ];
  const r = settled(settleCreditsDay({ rulesVersion: 1, season: 1, day: DAY, players, holdings }));
  assert.equal(r.poolMicro, C(100_000), "section 17: season one's daily pool");
  near(r.settlement.dayShareMicro, C(2.5), 2, "the day-share");

  const meera = r.lines.find((l) => l.playerId === "meera")!;
  assert.equal(meera.zonesHeld, 6);
  assert.deepEqual(meera.unvisitedZoneIds, ["m2", "m3", "m4", "m5"]);
  near(meera.earnedMicro, C(3.68), C(0.01), "gross (the source rounds 1.667 × 2.21)");
  near(meera.rechargeMicro, C(0.92), C(0.003), "recharge, Starter kit 25%");
  near(meera.upkeepTakenMicro, C(0.47), C(0.003), "upkeep: 4 × 0.047 × 2.50");
  assert.equal(meera.upkeepPaidInConditionMicro, 0, "38% is under the 60% cap");
  // No deeds here, so no toll; the source's 2.27 includes a 0.0184 toll.
  near(meera.netMicro, C(2.27 + 0.0184), C(0.01), "credits kept");

  const dan = r.lines.find((l) => l.playerId === "dan")!;
  assert.equal(dan.zonesHeld, 40);
  assert.equal(dan.earnedMicro, 0);
  near(dan.upkeepPaidInConditionMicro, C(7.55), C(0.01), "section 19: owes 7.55");
  assert.equal(dan.upkeepTakenMicro, 0, "nothing taken from a zero reward");
  assert.equal(dan.netMicro, 0, "no debt, no negative");
  assert.equal(dan.unvisitedZoneIds.length, 40);
});

test("deeded units are the toll's cells; tolls are matched and the books close", () => {
  const states = mapOf(held("z1/c0", "ravi", { deeded: true }), held("z1/c1", "ravi", { deeded: true }), held("z2/c2", "sam", { deeded: true }));
  const holdings = close({ states });
  assert.deepEqual([...holdings.deedOwnerByCell], [["z1/c0", "ravi"], ["z1/c1", "ravi"], ["z2/c2", "sam"]]);
  const cells = ["z1/c0", "z1/c1", "z2/c2", "x/1", "x/2", "x/3", "x/4", "x/5", "x/6", "x/7", "x/8", "x/9"];
  const r = settled(
    settleCreditsDay({
      rulesVersion: 1,
      season: 1,
      day: DAY,
      players: [walker("meera", { sessions: [{ minutes: 25, meters: 2500, crossedCells: cells }] }), walker("ravi"), walker("sam")],
      holdings,
    }),
  );
  const b = r.settlement.books;
  assert.equal(b.tollPaidMicro, b.tollReceivedMicro);
  assert.ok(b.tollPaidMicro > 0);
  const ravi = r.lines.find((l) => l.playerId === "ravi")!;
  const sam = r.lines.find((l) => l.playerId === "sam")!;
  assert.ok(ravi.tollReceivedMicro >= 2 * sam.tollReceivedMicro - 1, "two cells to one");
  const net = r.lines.reduce((a, l) => a + l.netMicro, 0);
  assert.equal(net + b.burnedMicro, b.mintedMicro, "every credit created is kept or burned");
});

test("a flip moves the upkeep with the ground", () => {
  const states = mapOf(held("z1/a", "ana", { asOfDay: DAY - 1 }));
  const ledger = applyLedger({ states, events: [{ eventId: "e1", unitId: "z1/a", walkerId: "ben", push: SOLID, day: DAY }], rules });
  const holdings = close({ states: ledger.states, entries: ledger.entries });
  assert.deepEqual(holdings.holders.map((h) => [h.playerId, h.zones[0]!.visited, h.zones[0]!.level]), [["ben", true, 1]]);
});

test("the same day in any order gives the same credits", () => {
  const units = Array.from({ length: 12 }, (_, i) => held(`z${i % 4}/u${i}`, ["ana", "ben", "cy"][i % 3]!, { level: (1 + (i % 4)) as 1 | 2 | 3 | 4 }));
  // Keep one level per holder per zone.
  const states = units.filter((u, i, all) => all.findIndex((o) => zoneOf(o.unitId) === zoneOf(u.unitId) && o.holderId === u.holderId) === i);
  const entries = [entry("e1", states[0]!.unitId, states[0]!.holderId!), entry("e2", states[3]!.unitId, states[3]!.holderId!)];
  const players = [walker("ana"), walker("ben", { activeDaysThisWeek: 2 }), walker("dee", { sessions: [{ minutes: 60, meters: 6000 }] })];
  const a = settleCreditsDay({ rulesVersion: 1, season: 1, day: DAY, players, holdings: close({ states: mapOf(...states), entries }) });
  const b = settleCreditsDay({
    rulesVersion: 1,
    season: 1,
    day: DAY,
    players: [...players].reverse(),
    holdings: close({ states: mapOf(...[...states].reverse()), entries: [...entries].reverse() }),
  });
  assert.deepEqual(settled(a).lines, settled(b).lines);
});

test("unknown rules, a mismatched day and bad players are refused, never half-settled", () => {
  const holdings = close({ states: mapOf(held("z1/a", "ana")) });
  assert.deepEqual(settleCreditsDay({ rulesVersion: 99, season: 1, day: DAY, players: [], holdings }), {
    status: "refused",
    rulesVersion: 99,
    season: 1,
    day: DAY,
    problems: ["unknown economy rules version 99"],
  });
  assert.equal(settleCreditsDay({ rulesVersion: 1, season: 1, day: DAY + 1, players: [], holdings }).status, "refused");
  assert.equal(settleCreditsDay({ rulesVersion: 1, season: 0, day: DAY, players: [], holdings }).status, "refused");
  assert.equal(settleCreditsDay({ rulesVersion: 1, season: 1, day: DAY, players: [walker("x"), walker("x")], holdings }).status, "refused");
  assert.equal(settleCreditsDay({ rulesVersion: 1, season: 1, day: DAY, players: [walker("x", { trustWeight: 2 })], holdings }).status, "refused");
});

function smallDay(season: number, day: number): CreditsDayResult {
  return settleCreditsDay({
    rulesVersion: 1,
    season,
    day,
    players: [walker("ana"), walker("ben", { sessions: [{ minutes: 40, meters: 4000 }] })],
    holdings: holdingsAtDayClose({ day, states: new Map(), entries: [], holdingRules: rules, zoneOf, shadeCountsAsHeld: true }),
  });
}

test("section 17: a season of credits — 90 days of 100,000 is season one's 9M, and nothing crosses a season", () => {
  const days = Array.from({ length: 90 }, (_, d) => smallDay(1, d));
  const s = settleCreditsSeason(1, 1, days);
  assert.equal(s.status, "settled");
  if (s.status !== "settled") return;
  assert.equal(s.seasonPoolMicro, C(9_000_000));
  assert.equal(s.poolMicro, C(9_000_000), "9M ÷ 90 = 100,000 a day, exactly");
  assert.equal(s.issuedMicro + s.returnedMicro, s.poolMicro);
  // Ana hits the 20-a-day ceiling and Ben the 12-a-session ceiling every day; the rest stays in the season.
  assert.equal(s.issuedMicro, 90 * (C(20) + C(12)));
  assert.deepEqual(s.byPlayer, [
    { playerId: "ana", netMicro: 90 * (C(20) - C(5)) },
    { playerId: "ben", netMicro: 90 * (C(12) - C(1.5)) },
  ]);
  assert.equal(dailyPoolMicro(economy, 2) * 90, C(8_100_000), "season two: 10% less");
});

test("a season refuses repeated, extra, refused or foreign days", () => {
  const days = Array.from({ length: 90 }, (_, d) => smallDay(1, d));
  assert.equal(settleCreditsSeason(1, 1, [...days, smallDay(1, 90)]).status, "refused", "91 days");
  assert.equal(settleCreditsSeason(1, 1, [smallDay(1, 0), smallDay(1, 0)]).status, "refused", "a day twice");
  assert.equal(settleCreditsSeason(1, 1, [smallDay(2, 0)]).status, "refused", "another season");
  const refused = settleCreditsDay({ rulesVersion: 99, season: 1, day: 1, players: [], holdings: close({}) });
  assert.equal(settleCreditsSeason(1, 1, [refused]).status, "refused", "a refused day");
  assert.equal(settleCreditsSeason(99, 1, []).status, "refused", "unknown rules");
});
