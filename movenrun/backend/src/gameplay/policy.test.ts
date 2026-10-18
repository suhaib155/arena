/**
 * The versioned takeover policies, the daily take budget and the D5 zone
 * rule, without a database: scenario tests for each case the rules define,
 * then seeded property tests over random multi-day streams.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cellToChildren, cellToParent, gridDisk, latLngToCell } from "h3-js";
import { decayTo, newUnit, type UnitState } from "@movenrun/shared/holding";
import { applyLedger, type PushEvent } from "@movenrun/shared/holdingLedger";
import { holdingsAtDayClose, settleCreditsDay, type CreditsPlayerInput } from "@movenrun/shared/holdingSettlement";
import { applyServerLedger, isTake, type ServerLedgerEntry } from "./policy.js";
import { PILOT_PROPOSAL, SIM_PILOT_2_PROPOSAL, zoneOfUnder, type GameplayRules } from "./rules.js";

type Rules = Omit<GameplayRules, "seasonOneStartDay">;
const A9 = PILOT_PROPOSAL;
const P2 = SIM_PILOT_2_PROPOSAL;

/** Resolution 10 units, grouped by their resolution 9 zone. Internal ids only; nothing here is drawn. */
const ZONES = gridDisk(latLngToCell(51.5007, -0.1246, 9), 1).sort();
const UNITS = ZONES.flatMap((z) => cellToChildren(z, 10).sort());

let seq = 0;
const ev = (unitId: string, walkerId: string, day: number, shade?: number): PushEvent => ({
  eventId: `e:${String(day).padStart(4, "0")}:${String(seq++).padStart(6, "0")}`, unitId, walkerId, day,
  push: shade === undefined ? { kind: "solid" } : { kind: "shade", strength: shade },
});

/** Apply events one batch at a time, carrying states, applied ids and per-day counters. */
function run(rules: Rules, batches: PushEvent[][], initial: Map<string, UnitState> = new Map()) {
  let states = new Map(initial);
  const applied = new Set<string>();
  const used = new Map<string, number>(); // `${walker}:${day}`
  const entries: ServerLedgerEntry[] = [];
  const results = [];
  for (const batch of batches) {
    for (const e of batch) if (!states.has(e.unitId)) states.set(e.unitId, newUnit(e.unitId, e.day));
    const day = batch[0]!.day;
    const takesUsed = new Map([...used].filter(([k]) => k.endsWith(`:${day}`)).map(([k, v]) => [k.slice(0, k.lastIndexOf(":")), v]));
    const r = applyServerLedger({ states, events: batch, holding: rules.holding, appliedEventIds: applied, takesUsed, budget: rules.takeBudget });
    states = r.states;
    for (const e of r.entries) applied.add(e.eventId);
    for (const [w, n] of r.takesUsed) used.set(`${w}:${day}`, n);
    entries.push(...r.entries);
    results.push(...r.results);
  }
  return { states, entries, results, used };
}

const held = (unitId: string, holderId: string, day = 0, over: Partial<UnitState> = {}): UnitState => ({ ...newUnit(unitId, day), holderId, strength: 100, ...over });
const outcomeOf = (r: ReturnType<typeof run>, eventId: string) => r.entries.find((e) => e.eventId === eventId)?.outcome;

/* ── takeover policies ──────────────────────────────────────────────────── */

test("immediate (A9, the default 1001): one push flips fresh ground, exactly as the shared ledger does", () => {
  assert.equal(A9.takeover.name, "immediate");
  assert.equal(A9.holding.takeover, undefined);
  const u = UNITS[0]!;
  const e = ev(u, "ben", 0);
  const server = applyServerLedger({ states: new Map([[u, held(u, "ana")]]), events: [e], holding: A9.holding, budget: null });
  const shared = applyLedger({ states: new Map([[u, held(u, "ana")]]), events: [e], rules: A9.holding });
  assert.equal(server.entries[0]!.outcome, "flipped");
  assert.deepEqual(server.states.get(u), shared.states.get(u));
  assert.equal(server.states.get(u)!.strength, 1);
});

test("two-day challenge: a first push leaves 50 and a challenge, a same-walker push one to three days later flips", () => {
  const u = UNITS[0]!;
  const d0 = ev(u, "ben", 10);
  const again = ev(u, "ben", 10);
  const d1 = ev(u, "ben", 11);
  const r = run(P2, [[d0], [again], [d1]], new Map([[u, held(u, "ana", 10)]]));
  assert.equal(outcomeOf(r, d0.eventId), "eroded");
  assert.equal(r.entries[0]!.strengthAfter, 50);
  assert.equal(outcomeOf(r, again.eventId), "refused_daily_limit", "the owner rule: one push per walker, unit and day");
  assert.equal(outcomeOf(r, d1.eventId), "flipped");
  assert.equal(r.states.get(u)!.holderId, "ben");
  assert.equal(r.states.get(u)!.challenges, undefined, "a flip clears every challenge");
  // Day boundary of the window: 3 days later still flips, 4 days later opens a new challenge.
  for (const [gap, outcome] of [[3, "flipped"], [4, "eroded"]] as const) {
    const a = ev(u, "cal", 20);
    const b = ev(u, "cal", 20 + gap);
    const w = run(P2, [[a], [b]], new Map([[u, held(u, "ana", 20)]]));
    assert.equal(outcomeOf(w, b.eventId), outcome, `gap ${gap}`);
    if (outcome === "eroded") assert.deepEqual(w.states.get(u)!.challenges, [{ walkerId: "cal", day: 24 }], "an expired challenge starts again");
  }
});

test("two-day challenge: the holder's visit between the pushes answers it; shade refresh does not", () => {
  const u = UNITS[0]!;
  const visit = run(P2, [[ev(u, "ben", 0)], [ev(u, "ana", 1)], [ev(u, "ben", 2)]], new Map([[u, held(u, "ana")]]));
  assert.deepEqual(visit.entries.map((e) => e.outcome), ["eroded", "reinforced", "eroded"]);
  assert.equal(visit.states.get(u)!.holderId, "ana");
  assert.equal(visit.states.get(u)!.strength, 50);
  const shade = run(P2, [[ev(u, "ben", 0)], [ev(u, "ana", 1, 20)], [ev(u, "ben", 2)]], new Map([[u, held(u, "ana")]]));
  assert.deepEqual(shade.entries.map((e) => e.outcome), ["eroded", "reinforced", "flipped"], "only stepping on it defends");
});

test("two-day challenge: simultaneous challengers each need their own earlier day", () => {
  const u = UNITS[0]!;
  const r = run(P2, [[ev(u, "ben", 0), ev(u, "cal", 0), ev(u, "dee", 0)], [ev(u, "eve", 1)], [ev(u, "cal", 1)]], new Map([[u, held(u, "ana")]]));
  assert.deepEqual(r.entries.map((e) => [e.walkerId, e.outcome]), [["ben", "eroded"], ["cal", "eroded"], ["dee", "eroded"], ["eve", "eroded"], ["cal", "flipped"]]);
  assert.equal(r.states.get(u)!.holderId, "cal");
  assert.equal(r.states.get(u)!.challenges, undefined, "the others' challenges end with the flip");
  // A club-mate or anyone else cannot finish someone else's challenge.
  assert.equal(r.entries[3]!.strengthAfter, r.entries[3]!.strengthBefore - 3, "eve only decays it");
});

test("two-day challenge: decay between days, and long-unvisited ground falls at once", () => {
  const u = UNITS[0]!;
  const r = run(P2, [[ev(u, "ben", 0)], [ev(u, "cal", 1)]], new Map([[u, held(u, "ana")]]));
  assert.equal(r.states.get(u)!.strength, 47, "50 decays 3 a day; another walker's push leaves it where it is");
  // Unvisited for 24 days after the challenge: below 30, anyone takes it at once.
  const late = run(P2, [[ev(u, "ben", 0)], [ev(u, "cal", 8)]], new Map([[u, held(u, "ana")]]));
  assert.equal(late.entries[1]!.outcome, "flipped");
  // A fresh challenge inside the window never decays below the immediate line (50 - 3 * 3 = 41).
  const inside = run(P2, [[ev(u, "ben", 0)], [ev(u, "cal", 3)]], new Map([[u, held(u, "ana")]]));
  assert.equal(inside.entries[1]!.outcome, "eroded");
  // Stepped-on shade falls at once (SOURCE §4) under every policy.
  const shade = run(P2, [[ev(u, "ben", 0)]], new Map([[u, held(u, "ana", 0, { ground: "shade", strength: 20 })]]));
  assert.equal(shade.entries[0]!.outcome, "flipped");
});

test("masked ground is never claimable and deeded ground is immune, under both policies, and neither spends the budget", () => {
  for (const rules of [A9, P2]) {
    const [m, d] = [UNITS[0]!, UNITS[1]!];
    const states = new Map([[m, newUnit(m, 0, true)], [d, held(d, "ana", 0, { deeded: true })]]);
    const r = run(rules, [[ev(m, "ben", 0), ev(d, "ben", 0)], [ev(m, "ben", 1), ev(d, "ben", 1)]], states);
    assert.deepEqual(r.entries.map((e) => e.outcome), ["refused_masked", "refused_deeded", "refused_masked", "refused_deeded"]);
    assert.equal(r.states.get(m)!.holderId, null);
    assert.equal(r.states.get(d)!.holderId, "ana");
    assert.equal([...r.used.values()].reduce((a, b) => a + b, 0), 0);
  }
});

/* ── take budget ────────────────────────────────────────────────────────── */

test("the budget: 13 takes a day of other people's ground; claims, own ground and refusals are free; a 14th is refused and changes nothing", () => {
  assert.deepEqual(P2.takeBudget, { perWalkerPerDay: 13, counting: "takes-v1", order: "walk-order-v1" });
  const others = UNITS.slice(0, 20);
  const empty = UNITS.slice(20, 25);
  const own = UNITS.slice(25, 28);
  const states = new Map<string, UnitState>([...others.map((u) => [u, held(u, "ana")] as const), ...own.map((u) => [u, held(u, "ben")] as const)]);
  const batch = [...others, ...empty, ...own].map((u) => ev(u, "ben", 0));
  const r = run(P2, [batch], states);
  const by = (o: string) => r.entries.filter((e) => e.outcome === o).length;
  assert.equal(by("eroded"), 13);
  assert.equal(by("refused_take_budget"), 7);
  assert.equal(by("claimed"), 5);
  assert.equal(by("reinforced"), 3);
  assert.equal(r.used.get("ben:0"), 13);
  for (const e of r.entries.filter((x) => x.outcome === "refused_take_budget")) {
    assert.deepEqual(r.states.get(e.unitId), states.get(e.unitId), "a budget refusal changes nothing");
    assert.equal(e.newHolderId, e.previousHolderId);
  }
  // The next day the budget is whole again; the counters come from the store, not the batch.
  const next = applyServerLedger({ states: r.states, events: [ev(others[19]!, "ben", 1)], holding: P2.holding, budget: P2.takeBudget, takesUsed: new Map([["ben", 0]]) });
  assert.equal(next.entries[0]!.outcome, "eroded");
  const spent = applyServerLedger({ states: r.states, events: [ev(others[19]!, "ben", 0)], holding: P2.holding, budget: P2.takeBudget, takesUsed: new Map([["ben", 13]]) });
  assert.equal(spent.entries[0]!.outcome, "refused_take_budget");
});

test("the budget: a duplicate or retried event never spends it twice, and a flip on day one then reinforcing is not a second take", () => {
  const u = UNITS[0]!;
  const e = ev(u, "ben", 0);
  const r = run(P2, [[e, e], [e]], new Map([[u, held(u, "ana")]]));
  assert.equal(r.entries.length, 1);
  assert.deepEqual(r.results.map((x) => x.status), ["applied", "skipped", "skipped"]);
  assert.equal(r.used.get("ben:0"), 1);
  // Immediate policy: flip, then the walker's later sessions that day reinforce their own new ground for free.
  const a9 = run({ ...A9, takeBudget: { perWalkerPerDay: 1, counting: "takes-v1" } }, [[ev(u, "ben", 0)], [ev(u, "ben", 0)], [ev(UNITS[1]!, "ben", 0)]],
    new Map([[u, held(u, "ana")], [UNITS[1]!, held(UNITS[1]!, "ana")]]));
  assert.deepEqual(a9.entries.map((x) => x.outcome), ["flipped", "reinforced", "refused_take_budget"]);
});

/* ── D5: units and zones ────────────────────────────────────────────────── */

test("D5: a resolution 10 unit maps to its resolution 9 parent; a mixed-holder zone is held by each of its holders, never only the majority", () => {
  const zoneOf = zoneOfUnder(P2.units);
  const zone = ZONES[0]!;
  const kids = cellToChildren(zone, 10).sort();
  for (const k of kids) assert.equal(zoneOf(k), zone);
  assert.equal(zoneOf(kids[0]!), cellToParent(kids[0]!, 9), "deterministic");
  assert.throws(() => zoneOf(zone), /resolution 10/);
  // Ana holds five units of the zone, Ben one: both hold the zone and both owe its upkeep.
  const states = new Map(kids.slice(0, 6).map((k, i) => [k, held(k, i < 5 ? "ana" : "ben", 5)] as const));
  const each = holdingsAtDayClose({ day: 5, states, entries: [], holdingRules: P2.holding, zoneOf, shadeCountsAsHeld: false });
  assert.deepEqual(each.problems, []);
  assert.deepEqual(each.holders.map((h) => [h.playerId, h.zones.map((z) => [z.zoneId, z.unitIds.length])]), [["ana", [[zone, 5]]], ["ben", [[zone, 1]]]]);
  // The switch: per-unit upkeep.
  const perUnit = holdingsAtDayClose({ day: 5, states, entries: [], holdingRules: P2.holding, zoneOf: zoneOfUnder({ ...P2.units, mixedHolderZone: "unit-is-zone" }), shadeCountsAsHeld: false });
  assert.deepEqual(perUnit.holders.map((h) => [h.playerId, h.zones.length]), [["ana", 5], ["ben", 1]]);
});

/* ── properties ─────────────────────────────────────────────────────────── */

function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 2 ** 32);
}

/** A random season fragment: walkers, masked and deeded units, sessions split into batches, retries and duplicates. */
function randomStream(seed: number, days: number) {
  const rand = rng(seed);
  const units = UNITS.slice(0, 40);
  const walkers = ["w0", "w1", "w2", "w3", "w4", "w5"];
  const initial = new Map<string, UnitState>();
  initial.set(units[0]!, newUnit(units[0]!, 0, true));
  initial.set(units[1]!, held(units[1]!, "w0", 0, { deeded: true }));
  const batches: PushEvent[][] = [];
  for (let day = 0; day < days; day++) {
    for (let s = 0; s < 14; s++) {
      const walker = walkers[Math.floor(rand() * walkers.length)]!;
      // A heavy walker crosses many units; a session can be split in two (same day).
      const n = 1 + Math.floor(rand() * (walker === "w5" ? 30 : 8));
      const crossed = [...new Set(Array.from({ length: n }, () => units[Math.floor(rand() * units.length)]!))]; // one push per unit per session, as the server derives them
      const events = crossed.map((u) => ({ ...ev(u, walker, day, rand() < 0.1 ? 1 + Math.floor(rand() * 24) : undefined), eventId: `s:${day}:${s}:${u}` }));
      const cut = Math.floor(rand() * events.length);
      batches.push(events.slice(0, cut + 1));
      if (cut + 1 < events.length) batches.push(events.slice(cut + 1));
      if (rand() < 0.3) batches.push(events.slice(0, 1 + Math.floor(rand() * events.length))); // a retry
    }
  }
  return { initial, batches: batches.filter((b) => b.length > 0), units, walkers };
}

for (const [label, rules] of [["immediate 1001 + budget 13", { ...A9, takeBudget: P2.takeBudget }], ["sim-pilot-2 1002", P2]] as const) {
  test(`properties (${label}): at most one holder, mask and deed immunity, one push per walker unit and day, 13 takes counted once`, () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { initial, batches } = randomStream(seed, 9);
      const r = run(rules, batches, initial);
      const ids = r.entries.map((e) => e.eventId);
      assert.equal(new Set(ids).size, ids.length, "each event id is in the ledger once");
      const takes = new Map<string, number>();
      const once = new Map<string, number>();
      const lastByUnit = new Map<string, ServerLedgerEntry>();
      for (const e of r.entries) {
        if (isTake(e.outcome)) {
          takes.set(`${e.walkerId}:${e.day}`, (takes.get(`${e.walkerId}:${e.day}`) ?? 0) + 1);
          const k = `${e.walkerId}:${e.unitId}:${e.day}`;
          once.set(k, (once.get(k) ?? 0) + 1);
        }
        if (e.unitId === UNITS[0]) assert.equal(e.newHolderId, null, "masked ground is never held");
        if (e.unitId === UNITS[1]) assert.equal(e.newHolderId, "w0", "deeded ground keeps its holder");
        if (e.outcome === "refused_take_budget") assert.equal(e.newHolderId, e.previousHolderId);
        const prev = lastByUnit.get(e.unitId);
        if (prev && e.outcome !== "refused_take_budget") assert.equal(e.previousHolderId, prev.newHolderId, "one chain per unit");
        if (e.outcome !== "refused_take_budget") lastByUnit.set(e.unitId, e);
      }
      for (const [k, n] of takes) {
        assert.ok(n <= 13, `${k}: ${n} takes`);
        assert.equal(r.used.get(k), n, `${k}: the counter equals the takes in the ledger`);
      }
      for (const [k, n] of once) assert.equal(n, 1, k);
      for (const s of r.states.values()) {
        if (s.masked) assert.equal(s.holderId, null);
        if (s.holderId !== null && s.challenges) assert.ok(!s.challenges.some((c) => c.walkerId === s.holderId));
      }
    }
  });

  test(`properties (${label}): replaying the recorded ledger in order gives the recorded states`, () => {
    for (let seed = 101; seed <= 115; seed++) {
      const { initial, batches } = randomStream(seed, 7);
      const recorded = run(rules, batches, initial);
      // Replay: every recorded event, one at a time, in the recorded order, budgets from zero.
      const byId = new Map(batches.flat().map((e) => [e.eventId, e]));
      const replay = run(rules, recorded.entries.map((e) => [byId.get(e.eventId)!]), initial);
      assert.deepEqual(replay.entries, recorded.entries);
      for (const [u, s] of recorded.states) assert.deepEqual(replay.states.get(u), s, u);
    }
  });
}

test("properties (sim-pilot-2): every flip of solid ground at 30 or more completes the same walker's earlier, unexpired, unanswered challenge", () => {
  const W = 3;
  for (let seed = 201; seed <= 230; seed++) {
    const { initial, batches } = randomStream(seed, 10);
    const recorded = run(P2, batches, initial);
    const byId = new Map(batches.flat().map((e) => [e.eventId, e]));
    // Step through the recorded ledger, checking each flip against the state just before it.
    const states = new Map(initial);
    const used = new Map<string, number>();
    const history = new Map<string, ServerLedgerEntry[]>();
    let checked = 0;
    for (const entry of recorded.entries) {
      const e = byId.get(entry.eventId)!;
      const pre = states.get(e.unitId) ?? newUnit(e.unitId, e.day);
      const k = `${e.walkerId}:${e.day}`;
      const step = applyServerLedger({ states: new Map([[e.unitId, pre]]), events: [e], holding: P2.holding, budget: P2.takeBudget, takesUsed: new Map([[e.walkerId, used.get(k) ?? 0]]) });
      const out = step.entries[0]!;
      assert.deepEqual(out, entry);
      used.set(k, step.takesUsed.get(e.walkerId)!);
      const before = history.get(e.unitId) ?? [];
      if (out.outcome === "flipped" && pre.holderId !== null && !pre.deeded) {
        const dec = decayTo(pre, e.day, P2.holding);
        if (dec.holderId !== null && dec.ground === "solid" && dec.strength >= 30) {
          checked += 1;
          // Independently of the stored marks: the walker's own eroded push on an earlier day within W,
          // with no flip, claim or stepped-on visit by the holder since.
          const ok = before.some((c, i) => c.walkerId === e.walkerId && c.outcome === "eroded" && c.day < e.day && e.day - c.day <= W
            && !before.slice(i + 1).some((b) => b.outcome === "flipped" || b.outcome === "claimed" || (b.outcome === "reinforced" && b.pushKind === "solid")));
          assert.ok(ok, `seed ${seed}: ${e.eventId} flipped ${e.unitId} without a challenge`);
        }
      }
      states.set(e.unitId, step.states.get(e.unitId)!);
      before.push(out);
      history.set(e.unitId, before);
    }
    assert.ok(checked > 0 || seed !== 201, "the stream exercises challenge flips");
  }
});

test("properties: every day settles and its books balance, with each holder of a mixed zone holding it", () => {
  for (let seed = 301; seed <= 310; seed++) {
    const { initial, batches } = randomStream(seed, 6);
    const r = run(P2, batches, initial);
    const zoneOf = zoneOfUnder(P2.units);
    for (let day = 0; day < 6; day++) {
      // States as of the end of `day`: replay up to it.
      const upTo = run(P2, batches.filter((b) => b[0]!.day <= day), initial);
      const entries = upTo.entries.filter((e) => e.day === day).map((e) => e as unknown as Parameters<typeof holdingsAtDayClose>[0]["entries"][number]);
      const holdings = holdingsAtDayClose({ day, states: upTo.states, entries, holdingRules: P2.holding, zoneOf, shadeCountsAsHeld: false });
      const walkers = [...new Set(entries.map((e) => e.walkerId))].sort();
      const players: CreditsPlayerInput[] = walkers.map((playerId) => ({
        playerId, sessions: [{ minutes: 30, meters: 3000, crossedCells: [] }], activeDaysThisWeek: 1, trustWeight: 1, kitLevel: 1,
      }));
      const credits = settleCreditsDay({ rulesVersion: 1, season: 1, day, players, holdings });
      assert.equal(credits.status, "settled", JSON.stringify(credits.status === "refused" ? credits.problems : []));
      if (credits.status !== "settled") continue;
      const b = credits.settlement.books;
      assert.equal(b.mintedMicro + b.returnedToSeasonPoolMicro, b.poolMicro);
      assert.equal(b.creditedMicro + b.tollPaidMicro + b.burnedMicro, b.mintedMicro);
      assert.equal(credits.lines.reduce((a, l) => a + l.netMicro, 0), b.creditedMicro + b.tollReceivedMicro);
      // Mixed zones: the number of (holder, zone) pairs equals the distinct pairs over held units.
      const pairs = new Set([...holdings.states.values()].filter((s) => s.holderId !== null && s.ground === "solid").map((s) => `${s.holderId}:${zoneOf(s.unitId)}`));
      assert.equal(holdings.holders.reduce((a, h) => a + h.zones.length, 0), pairs.size);
    }
    assert.ok(r.entries.length > 0);
  }
});
