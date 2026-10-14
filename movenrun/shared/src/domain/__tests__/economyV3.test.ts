/**
 * Game Economy V3 — the source document's own worked numbers, reproduced.
 *
 * Every vector here is printed in the V3 source (revision 2): Meera's Tuesday
 * (section 18), Dan's day (section 19), the toll table (section 20), the
 * upkeep table (section 7) and the season schedule (section 17). Where the
 * source rounds for display, the test allows that rounding and says so.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  consistencyMultiplier,
  dailyPoolMicro,
  dayBooksProblems,
  dayCloseCharges,
  economyRulesFor,
  effort,
  MICRO_PER_MOVE,
  scoringSessionIndices,
  seasonPoolMicro,
  sessionQualifies,
  sessionToll,
  settleDay,
  upkeepOwedDayShares,
  type PlayerDayInput,
} from "../economyV3";

const rules = economyRulesFor(1)!;
const MOVE = (n: number) => Math.round(n * MICRO_PER_MOVE);
const near = (actual: number, expected: number, tolerance: number, what: string) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} is not within ${tolerance} of ${expected}`);

test("an unknown rules version has no economy, never the newest", () => {
  assert.equal(economyRulesFor(2), null);
  assert.equal(economyRulesFor(0), null);
});

test("section 17: one session can never max a day (ratio 0.6)", () => {
  assert.equal(rules.sessionCeilingMicro / rules.dayCeilingMicro, 0.6);
});

test("section 2: a session needs both 10 minutes and 750 m", () => {
  assert.equal(sessionQualifies(rules, 10, 750), true);
  assert.equal(sessionQualifies(rules, 9.9, 5000), false);
  assert.equal(sessionQualifies(rules, 60, 749), false);
});

test("section 17: the effort curve floors at 0.5 and saturates at 40 minutes", () => {
  assert.equal(effort(rules, 10), 0.5);
  assert.equal(effort(rules, 40), 1);
  assert.equal(effort(rules, 180), 1);
  near(effort(rules, 25), 0.79, 0.005, "25 minutes (section 18 step 1)");
  assert.throws(() => effort(rules, -1), RangeError);
});

test("section 17: consistency ×1.00 to ×1.50 at six days; a seventh adds nothing", () => {
  assert.equal(consistencyMultiplier(rules, 1), 1);
  near(consistencyMultiplier(rules, 5), 1.4, 1e-12, "Meera's fifth day");
  near(consistencyMultiplier(rules, 6), 1.5, 1e-12, "six days");
  near(consistencyMultiplier(rules, 7), 1.5, 1e-12, "seven days");
  assert.throws(() => consistencyMultiplier(rules, 0), RangeError);
  assert.throws(() => consistencyMultiplier(rules, 8), RangeError);
});

test("section 17: two 25-minute walks six days a week score 2.37; one three-hour run scores 1.00", () => {
  near(2 * effort(rules, 25) * consistencyMultiplier(rules, 6), 2.37, 0.005, "two walks");
  assert.equal(effort(rules, 180) * consistencyMultiplier(rules, 1), 1);
});

test("only the two best qualifying, scored sessions count", () => {
  const sessions = [
    { minutes: 12, meters: 900 },
    { minutes: 50, meters: 6000 },
    { minutes: 30, meters: 3000, unscored: true },
    { minutes: 5, meters: 400 },
    { minutes: 20, meters: 2000 },
  ];
  assert.deepEqual(scoringSessionIndices(rules, sessions), [1, 4]);
});

test("section 20: the toll table — 2% once, however many owners", () => {
  const me = new Set(["runner"]);
  const six = ["a", "b", "c", "d", "e", "f"];
  const none = sessionToll(rules, MOVE(20), six, new Map(), me);
  assert.equal(none.paidMicro, 0);

  const fourOfSix = sessionToll(rules, MOVE(20), six, new Map(six.slice(0, 4).map((c) => [c, "owner"])), me);
  near(fourOfSix.paidMicro, MOVE(0.27), MOVE(0.005), "four of six deeded");

  for (const owners of [4, 8, 20]) {
    const cells = Array.from({ length: owners * 2 }, (_, i) => `c${i}`);
    const deeds = new Map(cells.map((c, i) => [c, `o${i % owners}`]));
    const t = sessionToll(rules, MOVE(20), cells, deeds, me);
    near(t.paidMicro, MOVE(0.4), owners, `every cell deeded, ${owners} owners`);
    assert.equal(t.toOwners.size, owners);
    for (const amount of t.toOwners.values()) near(amount, MOVE(0.4) / owners, 1, "equal split");
  }
});

test("section 20: own and linked land is free, laps count once, remainders stay with the runner", () => {
  const deeds = new Map([
    ["mine", "runner"],
    ["friend", "linked"],
    ["x", "ravi"],
  ]);
  const t = sessionToll(rules, MOVE(10), ["mine", "friend", "x", "x", "x", "y"], deeds, new Set(["runner", "linked"]));
  // One of four distinct cells is tolled: 10 × 2% × 1/4 = 0.05.
  assert.equal(t.paidMicro, MOVE(0.05));
  assert.deepEqual([...t.toOwners.keys()], ["ravi"]);

  const odd = sessionToll(rules, 7, ["a", "b", "c"], new Map([["a", "p"], ["b", "q"], ["c", "r"]]), new Set(["runner"]));
  assert.ok(odd.paidMicro <= (7 * 200) / 10_000, "never more than disclosed");
});

test("section 18 step 6–7: Meera's toll, 3 of 12 cells, Ravi 2 and Sam 1", () => {
  const cells = Array.from({ length: 12 }, (_, i) => `c${i}`);
  const deeds = new Map([
    ["c0", "ravi"],
    ["c1", "ravi"],
    ["c2", "sam"],
  ]);
  const t = sessionToll(rules, MOVE(3.68), cells, deeds, new Set(["meera"]));
  near(t.paidMicro, MOVE(0.0184), 1, "the toll");
  near(t.toOwners.get("ravi")!, MOVE(0.012), MOVE(0.0005), "Ravi");
  near(t.toOwners.get("sam")!, MOVE(0.006), MOVE(0.0005), "Sam");
});

test("section 7: the upkeep table", () => {
  const camp = (n: number) => Array.from({ length: n }, () => 2 as const);
  const rows: Array<[number, number, number]> = [
    [1, 0.03, 0.03],
    [6, 0.047, 0.28],
    [16, 0.06, 1.0],
    [30, 0.07, 2.11],
    [100, 0.095, 9.49],
    [250, 0.119, 29.8],
  ];
  for (const [zones, perZone, all] of rows) {
    near(upkeepOwedDayShares(rules, zones, camp(1)), perZone, 0.0005, `${zones} zones, per zone`);
    near(upkeepOwedDayShares(rules, zones, camp(zones)), all, 0.05, `${zones} zones, all unvisited`);
  }
  assert.equal(upkeepOwedDayShares(rules, 6, camp(4), true), 0, "away protection");
  near(upkeepOwedDayShares(rules, 6, [5]), 0.047 * 0.85, 0.0005, "Citadel multiplier");
  assert.throws(() => upkeepOwedDayShares(rules, 2, camp(3)), RangeError);
});

test("section 18 steps 8–11: Meera's day-close charges", () => {
  const c = dayCloseCharges(rules, {
    dayRewardMicro: MOVE(3.68),
    scoringSessions: 2,
    kitLevel: 1,
    dayShareMicro: MOVE(2.5),
    zonesHeld: 6,
    unvisitedZoneLevels: [2, 2, 2, 2],
  });
  assert.equal(c.rechargeMicro, MOVE(0.92));
  near(c.upkeepOwedMicro, MOVE(0.47), MOVE(0.005), "upkeep");
  assert.equal(c.upkeepPaidInConditionMicro, 0, "38% is under the 60% cap");
  const credited = MOVE(3.68) - MOVE(0.0184) - c.rechargeMicro - c.upkeepTakenMicro;
  near(credited, MOVE(2.27), MOVE(0.005), "credited");
});

test("section 19: Dan owes 7.55 and pays nothing but condition", () => {
  const c = dayCloseCharges(rules, {
    dayRewardMicro: 0,
    scoringSessions: 0,
    kitLevel: 1,
    dayShareMicro: MOVE(2.5),
    zonesHeld: 40,
    unvisitedZoneLevels: Array.from({ length: 40 }, () => 2 as const),
  });
  near(c.upkeepOwedMicro, MOVE(7.55), MOVE(0.01), "owed");
  assert.equal(c.upkeepTakenMicro, 0);
  assert.equal(c.rechargeMicro, 0);
  assert.equal(c.upkeepPaidInConditionMicro, c.upkeepOwedMicro);
});

test("section 8: recharge is pro-rated to the charge used, Starter 25% and Veteran 15%", () => {
  const base = { dayRewardMicro: MOVE(10), dayShareMicro: 0, zonesHeld: 0, unvisitedZoneLevels: [] };
  assert.equal(dayCloseCharges(rules, { ...base, scoringSessions: 1, kitLevel: 1 }).rechargeMicro, MOVE(1.25));
  assert.equal(dayCloseCharges(rules, { ...base, scoringSessions: 1, kitLevel: 5 }).rechargeMicro, MOVE(0.75));
  assert.equal(dayCloseCharges(rules, { ...base, scoringSessions: 2, kitLevel: 5 }).rechargeMicro, MOVE(1.5));
  assert.equal(dayCloseCharges(rules, { ...base, scoringSessions: 0, kitLevel: 1 }).rechargeMicro, 0);
});

test("sections 7–8: recharge plus upkeep never pass 60%; the rest is paid in condition", () => {
  const c = dayCloseCharges(rules, {
    dayRewardMicro: MOVE(4),
    scoringSessions: 2,
    kitLevel: 1,
    dayShareMicro: MOVE(2.5),
    zonesHeld: 100,
    unvisitedZoneLevels: Array.from({ length: 100 }, () => 2 as const),
  });
  assert.equal(c.rechargeMicro + c.upkeepTakenMicro, MOVE(2.4));
  assert.ok(c.upkeepPaidInConditionMicro > 0);
});

test("section 17: the season schedule — 9M, −10% a season, floor 2M, about 180 seasons", () => {
  assert.equal(seasonPoolMicro(rules, 1), MOVE(9_000_000));
  assert.equal(seasonPoolMicro(rules, 2), MOVE(8_100_000));
  assert.equal(seasonPoolMicro(rules, 30), MOVE(2_000_000));
  assert.equal(dailyPoolMicro(rules, 1), MOVE(100_000));
  let total = 0;
  let seasons = 0;
  while (seasonPoolMicro(rules, seasons + 1) > 0) {
    total += seasonPoolMicro(rules, ++seasons);
    if (seasons > 400) break;
  }
  assert.equal(total, MOVE(400_000_000), "the allocation is released exactly");
  assert.ok(seasons >= 175 && seasons <= 185, `${seasons} seasons`);
});

function player(id: string, extra: Partial<PlayerDayInput> = {}): PlayerDayInput {
  return {
    playerId: id,
    sessions: [
      { minutes: 25, meters: 2500 },
      { minutes: 25, meters: 2500 },
    ],
    activeDaysThisWeek: 5,
    trustWeight: 1,
    kitLevel: 1,
    zonesHeld: 0,
    unvisitedZoneLevels: [],
    ...extra,
  };
}

test("section 18: Meera's Tuesday, settled among 40,000 players with 60,000 points", () => {
  // The source's day: pool 100,000, 40,000 players, 60,000 points, rate 1.667
  // and a day-share of 2.50. A crowd of 39,998 players on 1.5 points each
  // (one 40-minute session, sixth active day) earns exactly 2.50 and is the
  // median; one filler player brings the total to 60,000.
  const meeraPoints = 2 * effort(rules, 25) * 1.4;
  const filler = 60_000 - 39_998 * 1.5 - meeraPoints;
  const meera = player("meera", {
    zonesHeld: 6,
    unvisitedZoneLevels: [2, 2, 2, 2],
    sessions: [
      { minutes: 25, meters: 2500, crossedCells: ["h0", "h1", "h2", "h3", "h4", "h5"] },
      { minutes: 25, meters: 2500, crossedCells: ["c0", "c1", "c2", "c3", "c4", "c5"] },
    ],
  });
  const crowd = Array.from({ length: 39_998 }, (_, i) =>
    player(`p${i}`, { sessions: [{ minutes: 40, meters: 4000 }], activeDaysThisWeek: 6 }),
  );
  const fill = player("filler", { sessions: [{ minutes: 40 * filler ** 2, meters: 4000 }], activeDaysThisWeek: 1 });
  const s = settleDay(rules, {
    poolMicro: dailyPoolMicro(rules, 1),
    players: [meera, ...crowd, fill],
    deedOwnerByCell: new Map([
      ["c0", "ravi"],
      ["c1", "ravi"],
      ["c2", "sam"],
    ]),
  });
  assert.deepEqual(dayBooksProblems(rules, s), []);
  assert.equal(s.players.length, 40_000);
  near(s.totalPoints, 60_000, 1e-6, "points");
  near(s.dayShareMicro, MOVE(2.5), 2, "the day-share");
  const m = s.players[0]!;
  // The source multiplies rounded intermediates (1.667 × 2.21 = 3.68); exact
  // arithmetic gives 3.689.
  near(m.dayRewardMicro, MOVE(3.68), MOVE(0.01), "gross");
  near(m.tollPaidMicro, MOVE(0.0184), MOVE(0.0002), "toll");
  near(m.charges.rechargeMicro, MOVE(0.92), MOVE(0.003), "recharge");
  near(m.charges.upkeepTakenMicro, MOVE(0.47), MOVE(0.003), "upkeep");
  near(m.creditedMicro, MOVE(2.27), MOVE(0.01), "credited");
});

test("section 17: below about 5,000 players the ceilings bite and the surplus returns", () => {
  const s = settleDay(rules, {
    poolMicro: MOVE(100_000),
    players: Array.from({ length: 100 }, (_, i) =>
      player(`p${i}`, {
        sessions: [
          { minutes: 45, meters: 5000 },
          { minutes: 45, meters: 5000 },
          { minutes: 45, meters: 5000 },
        ],
        activeDaysThisWeek: 6,
      }),
    ),
    deedOwnerByCell: new Map(),
  });
  assert.deepEqual(dayBooksProblems(rules, s), []);
  for (const r of s.players) {
    assert.equal(r.scoringSessions, 2, "a third session scores nothing");
    assert.equal(r.dayRewardMicro, MOVE(20));
    assert.deepEqual(r.sessionRewardsMicro, [MOVE(10), MOVE(10)]);
  }
  assert.equal(s.books.mintedMicro, MOVE(2_000));
  assert.equal(s.books.returnedToSeasonPoolMicro, MOVE(98_000));
});

test("section 17: trust weight withheld stays in the pool, not with other players", () => {
  const players = Array.from({ length: 10_000 }, (_, i) =>
    player(`p${i}`, { trustWeight: i === 0 ? 0.5 : 1, activeDaysThisWeek: 1 }),
  );
  const s = settleDay(rules, { poolMicro: MOVE(100_000), players, deedOwnerByCell: new Map() });
  assert.deepEqual(dayBooksProblems(rules, s), []);
  near(s.players[0]!.dayRewardMicro * 2, s.players[1]!.dayRewardMicro, 2, "half weight earns half");
  assert.ok(s.books.returnedToSeasonPoolMicro >= Math.floor(s.players[1]!.dayRewardMicro / 2) - 2);
});

test("section 20 and 26: tolls are matched debits and credits, and the books close", () => {
  const cells = ["a", "b", "c", "d"];
  const players = [
    player("runner", { sessions: [{ minutes: 40, meters: 4000, crossedCells: cells }] }),
    player("owner1", { sessions: [{ minutes: 10, meters: 800 }] }),
    player("owner2", { sessions: [] }),
    ...Array.from({ length: 6_000 }, (_, i) => player(`x${i}`, { activeDaysThisWeek: 3 })),
  ];
  const s = settleDay(rules, {
    poolMicro: MOVE(100_000),
    players,
    deedOwnerByCell: new Map([
      ["a", "owner1"],
      ["b", "owner2"],
      ["c", "owner2"],
    ]),
  });
  assert.deepEqual(dayBooksProblems(rules, s), []);
  const runner = s.players[0]!;
  assert.ok(runner.tollPaidMicro > 0);
  assert.equal(s.books.tollPaidMicro, s.books.tollReceivedMicro);
  const owner2 = s.players.find((r) => r.playerId === "owner2")!;
  assert.equal(owner2.dayRewardMicro, 0, "a toll is received, not minted");
  assert.ok(owner2.tollReceivedMicro > 0);
});

test("the reconciler flags books that do not balance", () => {
  const s = settleDay(rules, {
    poolMicro: MOVE(100_000),
    players: [player("a"), player("b")],
    deedOwnerByCell: new Map(),
  });
  assert.deepEqual(dayBooksProblems(rules, s), []);
  const tampered = { ...s, books: { ...s.books, creditedMicro: s.books.creditedMicro + 1 } };
  assert.ok(dayBooksProblems(rules, tampered).includes("minted not fully accounted for"));
  const overMinted = { ...s, books: { ...s.books, mintedMicro: s.books.poolMicro + 1 } };
  assert.ok(dayBooksProblems(rules, overMinted).includes("minted more than the daily pool"));
});

test("bad input fails closed", () => {
  assert.throws(() => settleDay(rules, { poolMicro: -1, players: [], deedOwnerByCell: new Map() }), RangeError);
  assert.throws(
    () => settleDay(rules, { poolMicro: 1, players: [player("a"), player("a")], deedOwnerByCell: new Map() }),
    RangeError,
  );
  assert.throws(
    () => settleDay(rules, { poolMicro: 1, players: [player("a", { trustWeight: 1.5 })], deedOwnerByCell: new Map() }),
    RangeError,
  );
  const empty = settleDay(rules, { poolMicro: MOVE(100_000), players: [], deedOwnerByCell: new Map() });
  assert.equal(empty.books.returnedToSeasonPoolMicro, MOVE(100_000));
  assert.equal(empty.dayShareMicro, 0);
});

test("section 26: the books close on 300 randomised days", () => {
  // A seeded generator, so a failure names a reproducible day.
  let seed = 0x5eed;
  const rnd = () => ((seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff) / 0x7fffffff);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const cells = Array.from({ length: 40 }, (_, i) => `c${i}`);
  for (let day = 0; day < 300; day++) {
    const n = 1 + Math.floor(rnd() * 60);
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const deeds = new Map(cells.filter(() => rnd() < 0.4).map((c) => [c, pick(ids)]));
    const players = ids.map((id) =>
      player(id, {
        linkedPlayerIds: rnd() < 0.2 ? [pick(ids)] : [],
        sessions: Array.from({ length: Math.floor(rnd() * 4) }, () => ({
          minutes: rnd() * 120,
          meters: rnd() * 12_000,
          unscored: rnd() < 0.1,
          crossedCells: cells.filter(() => rnd() < 0.2),
        })),
        activeDaysThisWeek: 1 + Math.floor(rnd() * 7),
        trustWeight: rnd() < 0.3 ? rnd() : 1,
        kitLevel: pick([1, 2, 3, 4, 5] as const),
        zonesHeld: 12,
        unvisitedZoneLevels: Array.from({ length: Math.floor(rnd() * 13) }, () => pick([1, 2, 3, 4, 5] as const)),
        awayProtected: rnd() < 0.1,
      }),
    );
    const pool = pick([MOVE(100_000), MOVE(500), 7, 0]);
    const s = settleDay(rules, { poolMicro: pool, players, deedOwnerByCell: deeds });
    assert.deepEqual(dayBooksProblems(rules, s), [], `day ${day}`);
  }
});
