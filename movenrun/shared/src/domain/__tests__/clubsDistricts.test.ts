/**
 * G4: clubs, contributions, district control and season leaderboards, read
 * from settled holding and credits data. The source has no worked club or
 * district example; decay numbers are placeholders for D4, zones for D5,
 * districts for D20 and control rules for D21.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { newUnit, type HoldingRules, type Push, type UnitState } from "../holding";
import { applyLedger, type LedgerEntry, type PushEvent } from "../holdingLedger";
import {
  holdingsAtDayClose,
  settleCreditsDay,
  type CreditsDayResult,
  type CreditsPlayerInput,
  type HoldingsAtClose,
} from "../holdingSettlement";
import {
  clubContributions,
  clubSnapshot,
  districtControl,
  rankRows,
  seasonLeaderboard,
  type DistrictControlRule,
  type Membership,
  type SeasonDay,
} from "../clubsDistricts";

// D4 is open: test values only.
const rules: HoldingRules = { rulesVersion: 7, solidDecayPerDay: 10, shadeDecayMultiplier: 3, stageFloors: { held: 60, atRisk: 30, contested: 10 } };
const SOLID: Push = { kind: "solid" };
const DAY = 10;
// D5 and D20 are open: in these tests a unit id is "district/zone/unit".
const zoneOf = (unitId: string) => unitId.split("/").slice(0, 2).join("/");
const districtOf = (unitId: string) => unitId.split("/")[0]!;
// D21 is open: test values only.
const rule: DistrictControlRule = { shadeWeight: { numerator: 1, denominator: 4 }, minShare: { numerator: 1, denominator: 2 } };

const held = (unitId: string, holderId: string, over: Partial<UnitState> = {}): UnitState => ({
  ...newUnit(unitId, DAY),
  holderId,
  strength: 100,
  ...over,
});
const mapOf = (...states: UnitState[]) => new Map(states.map((s) => [s.unitId, s]));
const close = (states: Map<string, UnitState>, day = DAY, entries: LedgerEntry[] = []): HoldingsAtClose =>
  holdingsAtDayClose({ day, states, entries, holdingRules: rules, zoneOf, shadeCountsAsHeld: true });
const entry = (eventId: string, unitId: string, walkerId: string, over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  eventId,
  unitId,
  walkerId,
  day: DAY,
  pushKind: "solid",
  outcome: "claimed",
  previousHolderId: null,
  newHolderId: walkerId,
  strengthBefore: 0,
  strengthAfter: 100,
  rulesVersion: rules.rulesVersion,
  ...over,
});
const member = (walkerId: string, clubId: string, fromDay = 0, toDay: number | null = null): Membership => ({ walkerId, clubId, fromDay, toDay });
// A small trust weight keeps rewards under the ceilings, so walkers differ.
const walker = (playerId: string, trustWeight = 0.0001): CreditsPlayerInput => ({
  playerId,
  sessions: [
    { minutes: 25, meters: 2500 },
    { minutes: 25, meters: 2500 },
  ],
  activeDaysThisWeek: 5,
  trustWeight,
  kitLevel: 1,
});
const settled = (r: CreditsDayResult) => {
  assert.equal(r.status, "settled", r.status === "refused" ? r.problems.join("; ") : "");
  return r as Extract<CreditsDayResult, { status: "settled" }>;
};

/* ── membership ───────────────────────────────────────────────────────────── */

test("club snapshot: membership spans are from fromDay up to, not including, toDay", () => {
  const list = [member("ana", "red", 5, 10), member("ana", "blue", 10), member("ben", "red", 0), member("cy", "blue", 11)];
  const on9 = clubSnapshot(list, 9);
  assert.deepEqual(on9.problems, []);
  assert.deepEqual(on9.clubs, [{ clubId: "red", walkerIds: ["ana", "ben"] }]);
  const on10 = clubSnapshot(list, 10);
  assert.deepEqual(on10.clubs, [
    { clubId: "blue", walkerIds: ["ana"] },
    { clubId: "red", walkerIds: ["ben"] },
  ]);
  assert.equal(on10.clubOf.get("cy"), undefined, "not yet a member");
});

test("club snapshot: two clubs on one day is D18, reported and never split", () => {
  const s = clubSnapshot([member("ana", "red"), member("ana", "blue"), member("ben", "red")], DAY);
  assert.ok(s.problems.some((p) => p.includes("ana") && p.includes("blue, red") && p.includes("D18")), s.problems.join("; "));
  assert.equal(s.clubOf.has("ana"), false);
  const twice = clubSnapshot([member("ana", "red"), member("ana", "red", 3)], DAY);
  assert.ok(twice.problems.some((p) => p.includes("listed twice")));
  const bad = clubSnapshot([member("", "red"), member("ana", "red", -1), member("ben", "red", 5, 5)], DAY);
  assert.equal(bad.problems.length, 3);
});

/* ── contributions ────────────────────────────────────────────────────────── */

test("contributions: the day's ledger entries counted per member, by outcome and by kind", () => {
  const snap = clubSnapshot([member("ana", "red"), member("ben", "red"), member("cy", "blue")], DAY);
  const entries = [
    entry("e1", "d1/z1/a", "ana"),
    entry("e2", "d1/z1/b", "ana", { pushKind: "shade", strengthAfter: 20 }),
    entry("e3", "d1/z2/a", "ana", { outcome: "eroded", previousHolderId: "cy", newHolderId: "cy" }),
    entry("e4", "d1/z2/a", "ana", { outcome: "refused_daily_limit", previousHolderId: "cy", newHolderId: "cy" }),
    entry("e5", "d1/z3/a", "solo", { outcome: "flipped", previousHolderId: "ben", newHolderId: "solo" }),
    entry("e6", "d1/z1/a", "ana", { day: DAY - 1 }),
  ];
  const r = clubContributions({ day: DAY, entries, snapshot: snap, holdingRulesVersion: rules.rulesVersion });
  assert.deepEqual(r.problems, []);
  const red = r.clubs.find((c) => c.clubId === "red")!;
  const ana = red.members.find((m) => m.walkerId === "ana")!;
  assert.deepEqual(ana.byOutcome, { claimed: 2, reinforced: 0, eroded: 1, flipped: 0, refused_deeded: 0, refused_masked: 0, refused_daily_limit: 1 });
  assert.equal(ana.solid, 2, "the refused push changed nothing and is not stepped ground");
  assert.equal(ana.shade, 1);
  assert.equal(ana.onClubMateGround, 0);
  // Ben is a member with nothing on the day: a zero row, not a missing one.
  assert.deepEqual(red.members.map((m) => m.walkerId), ["ana", "ben"]);
  assert.equal(red.members[1]!.byOutcome.claimed, 0);
  assert.equal(red.totals.byOutcome.claimed, 2);
  // A walker in no club counts for no club.
  assert.equal(r.clubs.find((c) => c.clubId === "blue")!.totals.byOutcome.flipped, 0);
});

test("contributions: one push per walker per unit per day holds through the ledger", () => {
  // Owner decision 17 Oct: a second push on someone else's unit the same day is refused.
  const states = mapOf(held("d1/z1/a", "cy", { level: 2 }));
  const events: PushEvent[] = [
    { eventId: "a1", unitId: "d1/z1/a", walkerId: "ana", push: SOLID, day: DAY },
    { eventId: "a2", unitId: "d1/z1/a", walkerId: "ana", push: SOLID, day: DAY },
  ];
  const ledger = applyLedger({ states, events, rules });
  const snap = clubSnapshot([member("ana", "red"), member("cy", "blue")], DAY);
  const r = clubContributions({ day: DAY, entries: ledger.entries, snapshot: snap, holdingRulesVersion: rules.rulesVersion });
  const ana = r.clubs.find((c) => c.clubId === "red")!.members[0]!;
  assert.equal(ana.byOutcome.eroded, 1);
  assert.equal(ana.byOutcome.refused_daily_limit, 1);
  assert.equal(ana.solid, 1);
});

test("contributions: pushing a club-mate's ground is counted apart (D23)", () => {
  const snap = clubSnapshot([member("ana", "red"), member("ben", "red")], DAY);
  const r = clubContributions({
    day: DAY,
    entries: [entry("e1", "d1/z1/a", "ana", { outcome: "flipped", previousHolderId: "ben" })],
    snapshot: snap,
    holdingRulesVersion: rules.rulesVersion,
  });
  assert.equal(r.clubs[0]!.totals.onClubMateGround, 1);
});

test("contributions: repeated ids, other rules versions and a bad snapshot are problems", () => {
  const snap = clubSnapshot([member("ana", "red")], DAY);
  const dup = clubContributions({ day: DAY, entries: [entry("e1", "u", "ana"), entry("e1", "u", "ana")], snapshot: snap, holdingRulesVersion: 7 });
  assert.ok(dup.problems.some((p) => p.includes("twice")));
  assert.equal(dup.clubs[0]!.totals.byOutcome.claimed, 1, "never counted twice");
  const ver = clubContributions({ day: DAY, entries: [entry("e1", "u", "ana", { rulesVersion: 6 })], snapshot: snap, holdingRulesVersion: 7 });
  assert.ok(ver.problems.some((p) => p.includes("rules version 6")));
  const other = clubContributions({ day: DAY + 1, entries: [], snapshot: snap, holdingRulesVersion: 7 });
  assert.ok(other.problems.some((p) => p.includes("snapshot is for day")));
});

/* ── districts ────────────────────────────────────────────────────────────── */

test("district control: solid and shade both count (section 4), shade at the D21 weight", () => {
  const states = mapOf(
    // d1: red 2 solid (weight 8), blue 1 solid + 4 shade (4 + 4 = 8), so tied.
    held("d1/z1/a", "ana"),
    held("d1/z1/b", "ben"),
    held("d1/z2/a", "cy"),
    ...["a", "b", "c", "d"].map((u) => held(`d1/z3/${u}`, "cy", { ground: "shade", strength: 20 })),
    // d2: red 3 solid (12), unclubbed 3 solid (12): red leads with exactly half.
    held("d2/z1/a", "ana"),
    held("d2/z1/b", "ana"),
    held("d2/z1/c", "ana"),
    held("d2/z2/a", "solo"),
    held("d2/z2/b", "solo"),
    held("d2/z2/c", "solo"),
    // d3: blue 1 solid (4) against unclubbed 2 solid (8): blue leads clubs at a third.
    held("d3/z1/a", "cy"),
    held("d3/z2/a", "solo"),
    held("d3/z2/b", "solo"),
    // d4: only unclubbed ground; masked and unheld ground count for nobody.
    held("d4/z1/a", "solo"),
    newUnit("d4/z1/b", DAY, true),
    newUnit("d5/z1/a", DAY),
  );
  const snap = clubSnapshot([member("ana", "red"), member("ben", "red"), member("cy", "blue")], DAY);
  const r = districtControl({ holdings: close(states), snapshot: snap, districtOf, rule });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(
    r.districts.map((d) => [d.districtId, d.status, d.controllerClubId]),
    [
      ["d1", "tied", null],
      ["d2", "controlled", "red"],
      ["d3", "below_share", null],
      ["d4", "no_club", null],
    ],
  );
  const d1 = r.districts[0]!;
  assert.deepEqual(d1.held, { solidUnits: 3, shadeUnits: 4, weight: 16 });
  assert.deepEqual(d1.clubs, [
    { clubId: "blue", solidUnits: 1, shadeUnits: 4, weight: 8 },
    { clubId: "red", solidUnits: 2, shadeUnits: 0, weight: 8 },
  ]);
  assert.deepEqual(r.districts[1]!.unclubbed, { solidUnits: 3, shadeUnits: 0, weight: 12 });
  // With shade at full weight, blue (5) leads d1 at 5 of 7.
  const full = districtControl({ holdings: close(states), snapshot: snap, districtOf, rule: { ...rule, shadeWeight: { numerator: 1, denominator: 1 } } });
  assert.equal(full.districts[0]!.controllerClubId, "blue");
  // A higher minimum share takes d2 back to below_share.
  const strict = districtControl({ holdings: close(states), snapshot: snap, districtOf, rule: { ...rule, minShare: { numerator: 3, denominator: 5 } } });
  assert.equal(strict.districts[1]!.status, "below_share");
});

test("district control reads ground decayed to day close and follows a flip", () => {
  // Cy's ground ran out by day close (30 − 3 × 10 = 0), so it controls nothing.
  const decayed = districtControl({
    holdings: close(mapOf(held("d1/z1/a", "cy", { strength: 30, asOfDay: DAY - 3 }))),
    snapshot: clubSnapshot([member("cy", "blue")], DAY),
    districtOf,
    rule,
  });
  assert.deepEqual(decayed.districts, []);
  // Ana flips Cy's fresh ground; the district moves from blue to red.
  const ledger = applyLedger({ states: mapOf(held("d1/z1/a", "cy")), events: [{ eventId: "f", unitId: "d1/z1/a", walkerId: "ana", push: SOLID, day: DAY }], rules });
  const r = districtControl({
    holdings: close(ledger.states, DAY, ledger.entries),
    snapshot: clubSnapshot([member("ana", "red"), member("cy", "blue")], DAY),
    districtOf,
    rule,
  });
  assert.equal(r.districts[0]!.controllerClubId, "red");
});

test("district control: an undecided rule or district, or a bad day, is a problem", () => {
  const holdings = close(mapOf(held("d1/z1/a", "ana")));
  const snap = clubSnapshot([member("ana", "red")], DAY);
  const noRule = districtControl({ holdings, snapshot: snap, districtOf, rule: undefined as unknown as DistrictControlRule });
  assert.ok(noRule.problems.some((p) => p.includes("shadeWeight (D21)")) && noRule.problems.some((p) => p.includes("minShare (D21)")));
  const zeroShade = districtControl({ holdings, snapshot: snap, districtOf, rule: { ...rule, shadeWeight: { numerator: 0, denominator: 1 } } });
  assert.ok(zeroShade.problems.some((p) => p.includes("shadeWeight")), "section 4: shade counts, so its weight is above 0");
  const overOne = districtControl({ holdings, snapshot: snap, districtOf, rule: { ...rule, minShare: { numerator: 3, denominator: 2 } } });
  assert.ok(overOne.problems.some((p) => p.includes("at most 1")));
  const noDistrict = districtControl({ holdings, snapshot: snap, districtOf: () => { throw new Error("D20 not decided"); }, rule });
  assert.ok(noDistrict.problems.some((p) => p.includes("D20 not decided")));
  assert.deepEqual(noDistrict.districts, []);
  const wrongDay = districtControl({ holdings, snapshot: clubSnapshot([member("ana", "red")], DAY + 1), districtOf, rule });
  assert.ok(wrongDay.problems.some((p) => p.includes("snapshot is for day")));
  const badHoldings = districtControl({ holdings: { ...holdings, problems: ["zone z: D5"] }, snapshot: snap, districtOf, rule });
  assert.deepEqual(badHoldings.problems, ["zone z: D5"]);
});

/* ── leaderboards ─────────────────────────────────────────────────────────── */

test("ranking: highest first, equal scores share a rank and are listed by id", () => {
  assert.deepEqual(rankRows(new Map([["c", 5], ["a", 9], ["b", 5], ["d", 1]])), [
    { rank: 1, id: "a", score: 9 },
    { rank: 2, id: "b", score: 5 },
    { rank: 2, id: "c", score: 5 },
    { rank: 4, id: "d", score: 1 },
  ]);
});

/** One settled day end to end: ledger → holdings → credits → clubs → districts. */
function playDay(day: number, memberships: Membership[], states: Map<string, UnitState>, events: PushEvent[], players: CreditsPlayerInput[]) {
  const ledger = applyLedger({ states, events, rules, createMissing: true });
  const holdings = close(ledger.states, day, ledger.entries);
  const credits = settleCreditsDay({ rulesVersion: 1, season: 1, day, players, holdings });
  const snapshot = clubSnapshot(memberships, day);
  const districts = districtControl({ holdings, snapshot, districtOf, rule });
  return { ledger, seasonDay: { credits, snapshot, districts } satisfies SeasonDay };
}

test("season leaderboard from settled days only, by each D22 metric", () => {
  const memberships = [member("ana", "red"), member("ben", "red", 0, 2), member("ben", "blue", 2), member("cy", "blue"), member("dee", "green")];
  const ev = (eventId: string, unitId: string, walkerId: string, day: number): PushEvent => ({ eventId, unitId, walkerId, push: SOLID, day });
  // Day 1: Ana and Ben (red) claim d1; Cy (blue) claims d2. Ben is trusted more, so earns more.
  const d1 = playDay(1, memberships, new Map(), [ev("1a", "d1/z1/a", "ana", 1), ev("1b", "d1/z1/b", "ben", 1), ev("1c", "d2/z1/a", "cy", 1)], [
    walker("ana"),
    walker("ben", 0.0002),
    walker("cy"),
  ]);
  // Day 2: Ben has moved to blue with his ground; with Cy that is 2 of d1's 3 units for blue.
  const d2 = playDay(2, memberships, d1.ledger.states, [ev("2a", "d1/z1/c", "cy", 2), ev("2b", "d1/z1/b", "ben", 2), ev("2c", "d1/z1/a", "ana", 2)], [
    walker("ana"),
    walker("ben", 0.0002),
    walker("cy"),
  ]);
  const days = [d2.seasonDay, d1.seasonDay]; // any order
  for (const d of days) settled(d.credits);
  assert.deepEqual(d1.seasonDay.districts.districts.map((d) => d.controllerClubId), ["red", "blue"]);
  assert.deepEqual(d2.seasonDay.districts.districts.map((d) => d.controllerClubId), ["blue", "blue"]);

  const districtDays = seasonLeaderboard({ rulesVersion: 1, season: 1, days, metric: "club_district_days" });
  assert.equal(districtDays.status, "settled");
  if (districtDays.status !== "settled") return;
  assert.equal(districtDays.basis, "settled_days");
  assert.equal(districtDays.daysSettled, 2);
  assert.equal(districtDays.throughDay, 2);
  assert.equal(districtDays.seasonComplete, false, "two of 90 days: never presented as the season's result");
  assert.deepEqual(districtDays.rows, [
    { rank: 1, id: "blue", score: 3 },
    { rank: 2, id: "red", score: 1 },
    { rank: 3, id: "green", score: 0 },
  ]);

  const net = (day: { credits: CreditsDayResult }, id: string) => settled(day.credits).lines.find((l) => l.playerId === id)!.netMicro;
  const players = seasonLeaderboard({ rulesVersion: 1, season: 1, days, metric: "player_credits" });
  assert.equal(players.status, "settled");
  if (players.status !== "settled") return;
  const benTotal = net(d1.seasonDay, "ben") + net(d2.seasonDay, "ben");
  assert.equal(players.rows[0]!.id, "ben", "the bigger earner leads");
  assert.equal(players.rows[0]!.score, benTotal);
  // Ana and Cy walked the same, but Cy left d2 unvisited on day 2 and paid its upkeep.
  assert.deepEqual(settled(d2.seasonDay.credits).lines.find((l) => l.playerId === "cy")!.unvisitedZoneIds, ["d2/z1"]);
  assert.deepEqual(players.rows.map((r) => [r.rank, r.id]), [[1, "ben"], [2, "ana"], [3, "cy"]]);
  assert.ok(players.rows[1]!.score > players.rows[2]!.score);

  // Ben's day 1 counts for red, his day 2 for blue.
  const clubs = seasonLeaderboard({ rulesVersion: 1, season: 1, days, metric: "club_credits" });
  assert.equal(clubs.status, "settled");
  if (clubs.status !== "settled") return;
  const score = (id: string) => clubs.rows.find((r) => r.id === id)!.score;
  assert.equal(score("red"), net(d1.seasonDay, "ana") + net(d2.seasonDay, "ana") + net(d1.seasonDay, "ben"));
  assert.equal(score("blue"), net(d1.seasonDay, "cy") + net(d2.seasonDay, "cy") + net(d2.seasonDay, "ben"));
  assert.equal(score("green"), 0);

  // The same days in any order give the same board.
  assert.deepEqual(seasonLeaderboard({ rulesVersion: 1, season: 1, days: [...days].reverse(), metric: "club_credits" }), clubs);
});

test("season leaderboard: nothing settled is an empty board, never seeded", () => {
  const r = seasonLeaderboard({ rulesVersion: 1, season: 1, days: [], metric: "club_district_days" });
  assert.deepEqual(r, {
    status: "settled",
    basis: "settled_days",
    metric: "club_district_days",
    rulesVersion: 1,
    season: 1,
    daysSettled: 0,
    throughDay: null,
    seasonComplete: false,
    rows: [],
  });
});

test("season leaderboard refuses refused, repeated or foreign days, missing data and an undecided metric", () => {
  const memberships = [member("ana", "red")];
  const ok = playDay(1, memberships, new Map(), [{ eventId: "x", unitId: "d1/z1/a", walkerId: "ana", push: SOLID, day: 1 }], [walker("ana")]).seasonDay;
  const board = (days: SeasonDay[], metric: Parameters<typeof seasonLeaderboard>[0]["metric"] = "club_district_days") =>
    seasonLeaderboard({ rulesVersion: 1, season: 1, days, metric });
  const refusedDay: SeasonDay = { credits: { status: "refused", rulesVersion: 1, season: 1, day: 2, problems: ["x"] } };
  assert.equal(board([ok, refusedDay]).status, "refused");
  assert.equal(board([ok, ok]).status, "refused", "a day counted twice");
  assert.equal(board([{ ...ok, credits: { ...settled(ok.credits), season: 2 } }]).status, "refused");
  const noDistricts = board([{ credits: ok.credits, snapshot: ok.snapshot }]);
  assert.ok(noDistricts.status === "refused" && noDistricts.problems.some((p) => p.includes("no district control")));
  const noSnap = board([{ credits: ok.credits }], "club_credits");
  assert.ok(noSnap.status === "refused" && noSnap.problems.some((p) => p.includes("no club snapshot")));
  const wrongSnap = board([{ ...ok, snapshot: clubSnapshot(memberships, 3) }]);
  assert.ok(wrongSnap.status === "refused" && wrongSnap.problems.some((p) => p.includes("snapshot is for day 3")));
  const badSnap = board([{ ...ok, snapshot: clubSnapshot([...memberships, member("ana", "blue")], 1) }], "club_credits");
  assert.ok(badSnap.status === "refused" && badSnap.problems.some((p) => p.includes("D18")));
  const undecided = seasonLeaderboard({ rulesVersion: 1, season: 1, days: [ok], metric: undefined as unknown as "player_credits" });
  assert.ok(undecided.status === "refused" && undecided.problems.some((p) => p.includes("D22")));
  assert.equal(seasonLeaderboard({ rulesVersion: 99, season: 1, days: [ok], metric: "player_credits" }).status, "refused");
  // Player credits need no club data.
  assert.equal(board([{ credits: ok.credits }], "player_credits").status, "settled");
});
