import { test } from "node:test";
import assert from "node:assert/strict";
import { applyLedger, type PushEvent } from "../../../shared/src/domain/holdingLedger.ts";
import { settleCreditsDay, settleCreditsSeason, type CreditsPlayerInput, type CreditsDayResult } from "../../../shared/src/domain/holdingSettlement.ts";
import { clubSnapshot, districtControl, rankRows, seasonLeaderboard, type Membership, type SeasonDay } from "../../../shared/src/domain/clubsDistricts.ts";
import {
  DAY, POLICIES, boardPhase, control, districtOfPrefix, frac, hopControlFlips, hopperSpans, held, holdingRules, closeOf, manifest, member, publishBoard,
  rule, runWorld, seasonOfDay, sweep, topWithTies, unitId, zoneOf,
} from "./harness.ts";
import { summarise } from "./stats.ts";

const SOLID = { kind: "solid" } as const;
const r14 = rule([1, 4], [1, 2]);

/* ── determinism ──────────────────────────────────────────────────────────── */
test("same seed, byte-identical world outcome; manifest has distinct seeds", () => {
  const a = JSON.stringify(runWorld(manifest.seeds[0]!, 0.5, r14, 0.25));
  const b = JSON.stringify(runWorld(manifest.seeds[0]!, 0.5, r14, 0.25));
  assert.equal(a, b);
  assert.notEqual(a, JSON.stringify(runWorld(manifest.seeds[1]!, 0.5, r14, 0.25)));
  assert.equal(new Set(manifest.seeds).size, manifest.seeds.length);
});

/* ── H1 capture advantage ─────────────────────────────────────────────────── */
test("equal members and equal ground: the dense club controls districts, the dispersed club none", () => {
  const units: ReturnType<typeof held>[] = [];
  const ms: Membership[] = [];
  // Dense club D: 10 walkers x 4 units, all in district 0 (40 units). Dispersed club S: 10 walkers x 4 units, one per district over 4 districts... spread over 10 districts, 4 each.
  for (let i = 0; i < 10; i++) { ms.push(member(`d${i}`, "dense"), member(`s${i}`, "spread")); }
  let u = 0;
  for (let i = 0; i < 10; i++) for (let j = 0; j < 4; j++) units.push(held(unitId(0, u++), `d${i}`));
  const slot = new Map<number, number>();
  for (let i = 0; i < 10; i++) for (let j = 0; j < 4; j++) { const d = 1 + ((i + j * 3) % 10); const n = slot.get(d) ?? 0; slot.set(d, n + 1); units.push(held(unitId(d, n), `s${i}`)); }
  // Ten unclubbed walkers hold 4 units each in each of the ten spread districts, so the spread club never reaches half of any district.
  for (let d = 1; d <= 10; d++) for (let j = 0; j < 6; j++) units.push(held(unitId(d, 20 + j), `solo${d}`));
  const r = control(units, ms, r14);
  assert.deepEqual(r.problems, []);
  const status = (d: number) => r.districts.find((x) => x.districtId === `d${String(d).padStart(2, "0")}`)!;
  assert.equal(status(0).controllerClubId, "dense");
  const spreadWins = r.districts.filter((x) => x.controllerClubId === "spread").length;
  assert.equal(spreadWins, 0);
  const groundDense = units.filter((x) => /^d\d/.test(x.holderId!)).length;
  const groundSpread = units.filter((x) => /^s\d/.test(x.holderId!)).length;
  assert.equal(groundDense, groundSpread); // identical ground, opposite outcome
});

test("seeded sweep (H1): concentration raises districts-per-ground; small dispersed clubs win nothing", () => {
  const rows = sweep([0.2, 0.9], [[1, 4]], [[1, 2]]);
  const pick = (c: number, club: string) => rows.find((r) => r.concentration === c && r.club === club)!;
  const big9 = pick(0.9, "club0"), big2 = pick(0.2, "club0");
  // H1 as first stated (district share above ground share) was NOT supported: the minShare rule makes district share
  // fall below ground share for every club in this world. What holds is the dispersal penalty.
  assert.ok(big9.districtShare.mean < big9.groundShare.mean);
  assert.ok(big9.districtShare.mean > big2.districtShare.mean);
  assert.ok(pick(0.9, "club1").districtShare.mean > pick(0.2, "club1").districtShare.mean);
  assert.equal(pick(0.2, "club1").districtShare.mean, 0);
  assert.ok(pick(0.2, "club4").districtShare.mean <= 0.01, "3-member club at low concentration wins ~nothing");
  // All ratios are reported in out/ by run.ts; here only the direction is asserted.
});

/* ── H2/H3 shade weight and min share ─────────────────────────────────────── */
test("shade weight 1/4 vs 1/3: four vs three shade units equal one solid unit", () => {
  const solidClub = [held(unitId(0, 0), "a")];
  const shade = (n: number) => Array.from({ length: n }, (_, i) => held(unitId(0, 10 + i), "b", "shade"));
  const ms = [member("a", "A"), member("b", "B")];
  const at = (n: number, sw: [number, number]) => control([...solidClub, ...shade(n)], ms, rule(sw, [1, 3])).districts[0]!;
  assert.equal(at(4, [1, 4]).status, "tied");
  assert.equal(at(3, [1, 4]).controllerClubId, "A");
  assert.equal(at(5, [1, 4]).controllerClubId, "B");
  assert.equal(at(3, [1, 3]).status, "tied");
  assert.equal(at(2, [1, 3]).controllerClubId, "A");
  assert.equal(at(4, [1, 3]).controllerClubId, "B");
});

test("shade spam: with weight 1/3, cheap enclosed-only ground buys 33% more weight than at 1/4", () => {
  const n = 12;
  const ms = [member("a", "A"), member("b", "B")];
  const units = [...Array.from({ length: 4 }, (_, i) => held(unitId(0, i), "a")), ...Array.from({ length: n }, (_, i) => held(unitId(0, 10 + i), "b", "shade"))];
  const w = (sw: [number, number]) => control(units, ms, rule(sw, [1, 3])).districts[0]!.clubs.find((c) => c.clubId === "B")!.weight / sw[1];
  assert.equal(w([1, 4]), 3); // 12 shade = 3 solid-equivalents
  assert.equal(w([1, 3]), 4); // 12 shade = 4 solid-equivalents
});

test("minShare boundary is exact, and unclubbed walkers dilute control (below_share, nobody controls)", () => {
  const ms = [member("a", "A")];
  const mk = (clubbed: number, solo: number) => control([
    ...Array.from({ length: clubbed }, (_, i) => held(unitId(0, i), "a")),
    ...Array.from({ length: solo }, (_, i) => held(unitId(0, 20 + i), "x")),
  ], ms, rule([1, 4], [1, 2])).districts[0]!;
  assert.equal(mk(5, 5).status, "controlled"); // exactly one half
  assert.equal(mk(5, 6).status, "below_share"); // one unit short
  assert.equal(mk(5, 6).controllerClubId, null);
  assert.equal(mk(1, 30).status, "below_share");
});

test("seeded sweep (H2): stricter minShare controls fewer districts and leaves more below_share", () => {
  const rows = sweep([0.5], [[1, 4]], [[1, 3], [1, 2], [2, 3]]);
  const total = (ms: string) => rows.filter((r) => r.minShare === ms).reduce((a, r) => a + r.districtShare.mean, 0);
  assert.ok(total("1/3") >= total("1/2"));
  assert.ok(total("1/2") >= total("2/3"));
  const below = (ms: string) => rows.find((r) => r.minShare === ms)!.belowShare.mean;
  assert.ok(below("2/3") >= below("1/3"));
});

/* ── H4/H5 D18 switching ──────────────────────────────────────────────────── */
test("D18 effective dates: a span is [fromDay, toDay); join and leave on the same day is consistent", () => {
  const spans = [member("w", "A", 0, 5), member("w", "B", 5)];
  assert.equal(clubSnapshot(spans, 4).clubOf.get("w"), "A");
  assert.equal(clubSnapshot(spans, 5).clubOf.get("w"), "B");
  assert.deepEqual(clubSnapshot(spans, 5).problems, []);
  // next-day rule: a request made on day 5 gives fromDay 6; day 5 still counts for the old club.
  const nextDay = [member("w", "A", 0, 6), member("w", "B", 6)];
  assert.equal(clubSnapshot(nextDay, 5).clubOf.get("w"), "A");
  // a gap day (leave with no join) is a walker in no club that day, so their ground is unclubbed.
  assert.equal(clubSnapshot([member("w", "A", 0, 5), member("w", "B", 6)], 5).clubOf.has("w"), false);
});

test("membership hopping (H4): immediate and next-day policies let a hopper flip control daily; a switch cooldown does not", () => {
  const out = Object.fromEntries(POLICIES.map((p) => [p.name, hopControlFlips(30, p).flips]));
  assert.ok(out["immediate"]! >= 25, JSON.stringify(out));
  assert.ok(out["next-day"]! >= 25, JSON.stringify(out)); // delay alone does not stop it
  assert.ok(out["next-day+7d-cooldown"]! <= 8, JSON.stringify(out));
  // Spans from the cooldown policy never overlap, so no day is refused.
  const spans = hopperSpans("hop", 30, POLICIES[2]!);
  for (let d = 0; d < 30; d++) assert.deepEqual(clubSnapshot(spans, d).problems, []);
});

test("documents hazard: one double-membership row refuses district control for every district", () => {
  const units = [held(unitId(0, 0), "a"), held(unitId(1, 0), "c")];
  const good = [member("a", "A"), member("c", "C")];
  assert.equal(control(units, good, r14).districts.length, 2);
  const bad = [...good, member("a", "B")]; // an unrelated walker's duplicate row
  const r = control(units, bad, r14);
  assert.equal(r.districts.length, 0, "district 1, which has no connection to walker a, is also lost for the day");
  assert.ok(r.problems.some((p) => p.includes("D18")));
  // Patch recommendation (prose in the brief): membership service enforces one open span per walker; the caller drops
  // only the offending walker rather than blanking the day.
});

/* ── H5 boundaries, D20 ───────────────────────────────────────────────────── */
test("district boundary: unit-flip margin and a throwing districtOf", () => {
  // Synthetic grid: unit id "gX_Y". Districts are vertical stripes 5 columns wide: stripe = floor(X/5). Not a real place.
  const stripe = (id: string) => `s${Math.floor(Number(id.split("_")[0]!.slice(1)) / 5)}`;
  const U = (x: number, y: number, h: string) => held(`g${x}_${y}`, h);
  const A = [0, 1, 2, 3, 4].flatMap((x) => [U(x, 0, "a")]); // 5 A units in stripe s0
  const B = [U(3, 1, "b"), U(4, 1, "b"), U(2, 1, "b"), U(1, 1, "b")]; // 4 B units in stripe s0
  const ms = [member("a", "A"), member("b", "B")];
  const before = control([...A, ...B], ms, rule([1, 4], [1, 3]), stripe);
  assert.equal(before.districts[0]!.controllerClubId, "A");
  // B takes ONE boundary-adjacent unit from A (4 vs 5 -> B 5, A 4): the controller changes.
  const after = control([...A.slice(1), U(0, 0, "b"), ...B], ms, rule([1, 4], [1, 3]), stripe);
  assert.equal(after.districts[0]!.controllerClubId, "B");
  // Same holdings, boundary moved by one column: control of s0 can change without anybody moving.
  const shifted = (id: string) => `s${Math.floor((Number(id.split("_")[0]!.slice(1)) + 1) / 5)}`;
  const a2 = control([...A, ...B], ms, rule([1, 4], [1, 3]), shifted);
  assert.notDeepEqual(a2.districts.map((d) => [d.districtId, d.controllerClubId]), before.districts.map((d) => [d.districtId, d.controllerClubId]));
  // A throwing or empty districtOf refuses the whole day (reported, not guessed).
  const bad = control([...A], ms, rule([1, 4], [1, 3]), () => { throw new Error("no polygon"); });
  assert.equal(bad.districts.length, 0);
  assert.ok(bad.problems.length > 0);
});

test("documents hazard: district_days history depends on districtOf at read time, so a redrawn map rewrites the past", () => {
  const units = [held(unitId(0, 0), "a"), held(unitId(1, 0), "b")];
  const ms = [member("a", "A"), member("b", "B")];
  const mapV1 = districtOfPrefix;
  const mapV2 = () => "merged";
  const v1 = control(units, ms, rule([1, 4], [1, 2]), mapV1).districts.filter((d) => d.controllerClubId).length;
  const v2 = control(units, ms, rule([1, 4], [1, 2]), mapV2).districts.filter((d) => d.controllerClubId).length;
  assert.notEqual(v1, v2);
  // Recommendation: store each day's DistrictControlResult with a districtMapVersion at settlement; never recompute history.
});

/* ── H: ties ──────────────────────────────────────────────────────────────── */
test("equal-score tie: control tied, nobody controls; the model's id order would split a tie at a cut-off", () => {
  const t = control([held(unitId(0, 0), "a"), held(unitId(0, 1), "b")], [member("a", "A"), member("b", "B")], r14).districts[0]!;
  assert.equal(t.status, "tied");
  assert.equal(t.controllerClubId, null);
  const rows = rankRows(new Map([["zeta", 10], ["alpha", 10], ["mid", 10], ["low", 1]]));
  assert.deepEqual(rows.map((r) => r.rank), [1, 1, 1, 4]);
  // documents hazard: slicing a board at 2 keeps "alpha" and "mid" and drops "zeta" purely by id.
  assert.deepEqual(rows.slice(0, 2).map((r) => r.id), ["alpha", "mid"]);
  assert.deepEqual(topWithTies(rows, 2).map((r) => r.id), ["alpha", "mid", "zeta"]);
});

/* ── settled-only leaderboards, new-club fairness, appeals, reset ─────────── */
const walker = (playerId: string, trustWeight = 0.0001): CreditsPlayerInput => ({
  playerId, sessions: [{ minutes: 25, meters: 2500 }, { minutes: 25, meters: 2500 }], activeDaysThisWeek: 5, trustWeight, kitLevel: 1,
});
function playDay(day: number, ms: Membership[], events: PushEvent[], players: CreditsPlayerInput[], season = 1) {
  const ledger = applyLedger({ states: new Map(), events, rules: holdingRules, createMissing: true });
  const holdings = { ...closeOf([...ledger.states.values()]), day };
  const holdingsFull = require_holdings(ledger, day);
  const credits = settleCreditsDay({ rulesVersion: 1, season, day, players, holdings: holdingsFull });
  const snapshot = clubSnapshot(ms, day);
  const districts = districtControl({ holdings: holdingsFull, snapshot, districtOf: districtOfPrefix, rule: r14 });
  void holdings;
  return { credits, seasonDay: { credits, snapshot, districts } satisfies SeasonDay };
}
import { holdingsAtDayClose } from "../../../shared/src/domain/holdingSettlement.ts";
function require_holdings(ledger: ReturnType<typeof applyLedger>, day: number) {
  // Ledger entries carry the day they were applied for; states are decayed to `day`.
  return holdingsAtDayClose({ day, states: ledger.states, entries: ledger.entries, holdingRules, zoneOf, shadeCountsAsHeld: true });
}
const ev = (eventId: string, unit: string, walkerId: string, day: number): PushEvent => ({ eventId, unitId: unit, walkerId, push: SOLID, day });

test("leaderboards: built from settled days only; no days is an empty board; a refused day refuses the board", () => {
  const empty = seasonLeaderboard({ rulesVersion: 1, season: 1, days: [], metric: "club_credits" });
  assert.equal(empty.status, "settled");
  if (empty.status === "settled") { assert.deepEqual(empty.rows, []); assert.equal(empty.throughDay, null); assert.equal(empty.seasonComplete, false); assert.equal(empty.basis, "settled_days"); }
  const d1 = playDay(1, [member("a", "A")], [ev("1", unitId(0, 0), "a", 1)], [walker("a")]);
  const refusedCredits: CreditsDayResult = { status: "refused", season: 1, day: 2, problems: ["synthetic refusal"] } as unknown as CreditsDayResult;
  const board = seasonLeaderboard({ rulesVersion: 1, season: 1, days: [d1.seasonDay, { ...d1.seasonDay, credits: refusedCredits }], metric: "player_credits" });
  assert.equal(board.status, "refused");
  const wrongSeason = playDay(2, [member("a", "A")], [ev("2", unitId(0, 1), "a", 2)], [walker("a")], 2);
  assert.equal(seasonLeaderboard({ rulesVersion: 1, season: 1, days: [d1.seasonDay, wrongSeason.seasonDay], metric: "player_credits" }).status, "refused");
  assert.equal(seasonLeaderboard({ rulesVersion: 1, season: 1, days: [d1.seasonDay, d1.seasonDay], metric: "player_credits" }).status, "refused");
});

test("new-club fairness: raw club_credits ranks by size; per-capita is near-equal (proposal metric)", () => {
  const ms: Membership[] = [];
  const events: PushEvent[] = [];
  const players: CreditsPlayerInput[] = [];
  const add = (club: string, n: number) => { for (let i = 0; i < n; i++) { const id = `${club}${i}`; ms.push(member(id, club)); players.push(walker(id)); events.push(ev(`e${id}`, unitId(club === "old" ? 0 : 1, i), id, 1)); } };
  add("old", 20); add("new", 3);
  const day = playDay(1, ms, events, players);
  const b = seasonLeaderboard({ rulesVersion: 1, season: 1, days: [day.seasonDay], metric: "club_credits" });
  assert.equal(b.status, "settled");
  if (b.status !== "settled") return;
  assert.equal(b.rows[0]!.id, "old");
  const score = Object.fromEntries(b.rows.map((r) => [r.id, r.score]));
  const perCapita = { old: score["old"]! / 20, new: score["new"]! / 3 };
  assert.ok(Math.abs(perCapita.old - perCapita.new) / perCapita.old < 0.01, JSON.stringify(perCapita));
  assert.ok(score["old"]! > 5 * score["new"]!);
});

test("new-club fairness (seeded): a 3-member club is shut out of control unless it has a district to itself", () => {
  const wins = manifest.seeds.map((s) => runWorld(s, 0.9, r14, 0.25).clubs[4]!.districtsControlled);
  const sOld = summarise(manifest.seeds.map((s) => runWorld(s, 0.9, r14, 0.25).clubs[0]!.districtsControlled));
  const sNew = summarise(wins);
  assert.ok(sNew.mean < sOld.mean);
});

test("k-threshold publishing: groups below k are merged; a lone suppressed row is paired so totals do not reveal it", () => {
  const rows = [
    { id: "A", score: 90, contributors: 12 }, { id: "B", score: 40, contributors: 6 }, { id: "C", score: 7, contributors: 3 },
  ];
  const p = publishBoard(rows, 5);
  assert.deepEqual(p.shown.map((r) => r.id), ["A"]);
  assert.equal(p.other!.count, 2); // C plus the smallest shown row B, so C's score cannot be recovered by subtraction
  assert.equal(p.other!.score, 47);
  const all5 = publishBoard([{ id: "X", score: 1, contributors: 5 }, { id: "Y", score: 2, contributors: 9 }], 5);
  assert.equal(all5.other, null);
  assert.equal(publishBoard([{ id: "X", score: 1, contributors: 4 }, { id: "Y", score: 2, contributors: 3 }], 5).shown.length, 0);
});

test("documents hazard: re-settling a settled day without a removed player redistributes the fixed day pool to the others (a retroactive mint to them)", () => {
  const ms = [member("a", "A"), member("b", "B")];
  const ev1 = [ev("1", unitId(0, 0), "a", 1), ev("2", unitId(1, 0), "b", 1)];
  const original = playDay(1, ms, ev1, [walker("a"), walker("b")]);
  const corrected = playDay(1, ms, [ev1[0]!], [walker("a")]);
  const so = settleCreditsSeason(1, 1, [original.credits]);
  const sc = settleCreditsSeason(1, 1, [corrected.credits]);
  assert.equal(so.status, "settled"); assert.equal(sc.status, "settled");
  if (so.status === "settled" && sc.status === "settled") {
    assert.ok(sc.issuedMicro <= so.issuedMicro);
    const credit = (r: typeof so, id: string) => r.byPlayer.find((p) => p.playerId === id)?.netMicro ?? 0;
    assert.equal(sc.issuedMicro, so.issuedMicro, "the whole day pool is issued either way");
    assert.equal(credit(sc, "a"), 2 * credit(so, "a"), "survivor's credit doubles after the other player is removed");
    // Recommendation: a correction is never a re-settlement. Withdraw the removed player's line and return it to the season pool
    // (or burn it); leave every other player's settled line untouched.
  }
});

test("appeal windows and seasonal reset: phases are provisional, appeal_open, final; days map to one season", () => {
  assert.equal(seasonOfDay(0), 1); assert.equal(seasonOfDay(89), 1); assert.equal(seasonOfDay(90), 2);
  assert.equal(boardPhase(89, 1, 14), "provisional");
  assert.equal(boardPhase(90, 1, 14), "appeal_open");
  assert.equal(boardPhase(103, 1, 14), "appeal_open");
  assert.equal(boardPhase(104, 1, 14), "final");
  // A membership spanning the reset still holds in season 2: the model does not reset clubs (owner decision).
  const spanning = [member("w", "A", 80, null)];
  assert.equal(clubSnapshot(spanning, 95).clubOf.get("w"), "A");
  // Days of another season refuse the board: season 2 day cannot sneak into season 1.
  const d = playDay(95, spanning, [ev("s2", unitId(0, 0), "w", 95)], [walker("w")], 2);
  assert.equal(seasonLeaderboard({ rulesVersion: 1, season: 1, days: [d.seasonDay], metric: "club_credits" }).status, "refused");
  assert.equal(seasonLeaderboard({ rulesVersion: 1, season: 2, days: [d.seasonDay], metric: "club_credits" }).status, "settled");
});

test("frac helper sanity", () => assert.deepEqual(frac([1, 4]), { numerator: 1, denominator: 4 }));
