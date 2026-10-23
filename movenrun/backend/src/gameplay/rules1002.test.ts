/**
 * Rule set 1002's pilot-candidate parameters without a database: the take
 * budget in walk order, the challenge's day-boundary guard (minimum time
 * between the two pushes by server receipt) and the per-holder zone
 * partition. SIMULATION-PILOT PROPOSAL rules; none is a V3 source rule.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cellToChildren, gridDisk, latLngToCell } from "h3-js";
import { newUnit, type LandLevel, type UnitState } from "@movenrun/shared/holding";
import type { PushEvent } from "@movenrun/shared/holdingLedger";
import { holdingsAtDayClose, settleCreditsDay } from "@movenrun/shared/holdingSettlement";
import { applyServerLedger, challengeKey, type SecondPushInput } from "./policy.js";
import { DAY_MS, rulesetProblems, SIM_PILOT_2_PROPOSAL, zoneOfUnder } from "./rules.js";
import { partitionProblems, withPartitionLevels, zonePartitions } from "./zones.js";

const P2 = SIM_PILOT_2_PROPOSAL;
const H = 3_600_000;
const ZONES = gridDisk(latLngToCell(51.5007, -0.1246, 9), 1).sort();
const UNITS = ZONES.flatMap((z) => cellToChildren(z, 10).sort());
const held = (unitId: string, holderId: string, day = 0, over: Partial<UnitState> = {}): UnitState => ({ ...newUnit(unitId, day), holderId, strength: 100, ...over });
const tk = P2.takeover.name === "two-day-challenge" && P2.takeover.policyVersion === 2 ? P2.takeover : (() => { throw new Error("1002 must carry the gap"); })();

test("1002 names D1 and its new parameters, and stays a valid rule set", () => {
  assert.deepEqual(rulesetProblems(P2), []);
  assert.equal(tk.secondPush.minElapsedMs, 20 * H);
  assert.ok(rulesetProblems({ ...P2, takeover: { ...tk, secondPush: { ...tk.secondPush, minElapsedMs: 10 * 60_000 } } }).some((p) => p.includes("second-push gap")));
  assert.ok(rulesetProblems({ ...P2, takeover: { ...tk, secondPush: { ...tk.secondPush, minElapsedMs: 4 * DAY_MS } } }).some((p) => p.includes("second-push gap")));
  assert.ok(rulesetProblems({ ...P2, takeBudget: { ...P2.takeBudget!, order: "random" as "walk-order-v1" } }).length > 0);
  assert.ok(rulesetProblems({ ...P2, units: { ...P2.units, source: { kind: "session-path", rule: { ...P2.units.source!.rule, resolution: 9 } } } }).length > 0);
});

/* ── walk order ─────────────────────────────────────────────────────────── */

test("the budget meets a session's pushes in walk order, not unit id order; pushes without a walk position come last by event id", () => {
  // Twenty of Ana's units, walked in the reverse of their id order.
  const walk = UNITS.slice(0, 20).reverse();
  const states = new Map(walk.map((u) => [u, held(u, "ana")]));
  const events: PushEvent[] = walk.map((u) => ({ eventId: `mv:s1:${u}`, unitId: u, walkerId: "ben", day: 0, push: { kind: "solid" } }));
  const walkOrder = new Map(events.map((e, i) => [e.eventId, i]));
  const byWalk = applyServerLedger({ states, events, holding: P2.holding, budget: P2.takeBudget, walkOrder });
  const taken = byWalk.entries.filter((e) => e.outcome === "eroded").map((e) => e.unitId);
  assert.deepEqual(taken, walk.slice(0, 13), "the first 13 units walked");
  assert.deepEqual(byWalk.entries.map((e) => e.unitId), walk, "applied (and stored) in walk order");
  // The same input in any arrival order gives the same result.
  const shuffled = [...events].sort((a, b) => (a.unitId < b.unitId ? -1 : 1));
  assert.deepEqual(applyServerLedger({ states, events: shuffled, holding: P2.holding, budget: P2.takeBudget, walkOrder }).entries, byWalk.entries);
  // Without the order parameter (as before), unit id order decides.
  const byId = applyServerLedger({ states, events, holding: P2.holding, budget: { perWalkerPerDay: 13, counting: "takes-v1" }, walkOrder });
  assert.deepEqual(byId.entries.filter((e) => e.outcome === "eroded").map((e) => e.unitId), [...walk].sort().slice(0, 13));
  // Server pushes with no walk position: after those with one, in event id order.
  const extra: PushEvent = { eventId: "a-server", unitId: UNITS[30]!, walkerId: "ben", day: 0, push: { kind: "solid" } };
  const mixed = applyServerLedger({
    states: new Map([...states, [UNITS[30]!, held(UNITS[30]!, "ana")]]), events: [extra, ...events], holding: P2.holding, budget: P2.takeBudget, walkOrder,
  });
  assert.equal(mixed.entries[mixed.entries.length - 1]!.eventId, "a-server");
  assert.equal(mixed.entries[mixed.entries.length - 1]!.outcome, "refused_take_budget");
});

/* ── the day-boundary guard ─────────────────────────────────────────────── */

function gap(eventAt: Record<string, number>, opened: Record<string, number> = {}): SecondPushInput {
  return { minElapsedMs: tk.secondPush.minElapsedMs, windowDays: tk.windowDays, eventReceivedMs: new Map(Object.entries(eventAt)), challengeOpenedMs: new Map(Object.entries(opened)) };
}

/** Ben challenges Ana's unit (received at `firstAt`), then pushes again on `day2` (received at `secondAt`). */
function challengeThenPush(day1: number, firstAt: number, day2: number, secondAt: number, unit = UNITS[0]!) {
  const e1: PushEvent = { eventId: "e1", unitId: unit, walkerId: "ben", day: day1, push: { kind: "solid" } };
  const r1 = applyServerLedger({ states: new Map([[unit, held(unit, "ana", day1)]]), events: [e1], holding: P2.holding, budget: P2.takeBudget, secondPush: gap({ e1: firstAt }) });
  assert.equal(r1.entries[0]!.outcome, "eroded");
  assert.equal(r1.challengeOpenedMs.get(challengeKey(unit, "ben")), firstAt);
  const e2: PushEvent = { eventId: "e2", unitId: unit, walkerId: "ben", day: day2, push: { kind: "solid" } };
  const r2 = applyServerLedger({
    states: r1.states, events: [e2], holding: P2.holding, budget: P2.takeBudget,
    secondPush: { ...gap({ e2: secondAt }), challengeOpenedMs: r1.challengeOpenedMs },
  });
  return { r1, r2, unit };
}

test("midnight straddle: a challenge at 23:50 and a push at 00:20 (30 minutes) erodes and keeps the challenge's first day; it was a flip under D1 alone", () => {
  const d = 100;
  const { r2, unit } = challengeThenPush(d, d * DAY_MS + 23.83 * H, d + 1, (d + 1) * DAY_MS + 0.33 * H);
  assert.equal(r2.entries[0]!.outcome, "eroded");
  assert.equal(r2.states.get(unit)!.holderId, "ana");
  assert.deepEqual(r2.states.get(unit)!.challenges, [{ walkerId: "ben", day: d }], "not restarted");
  assert.equal(r2.entries[0]!.strengthBefore, 50, "the stored strength before is the unit's own, not the decayed copy shown to the model");
  // The same two pushes without the guard (D1 only) flip.
  const plain = applyServerLedger({ states: challengeThenPush(d, 0, d, 0).r1.states, events: [{ eventId: "x", unitId: unit, walkerId: "ben", day: d + 1, push: { kind: "solid" } }], holding: P2.holding, budget: P2.takeBudget });
  assert.equal(plain.entries[0]!.outcome, "flipped");
});

test("the gap is measured on server receipt: 19h59 is too soon, 20h exactly flips, and a third day inside the window then completes", () => {
  const d = 200;
  const t1 = d * DAY_MS + 18 * H;
  assert.equal(challengeThenPush(d, t1, d + 1, t1 + 20 * H - 60_000).r2.entries[0]!.outcome, "eroded");
  assert.equal(challengeThenPush(d, t1, d + 1, t1 + 20 * H).r2.entries[0]!.outcome, "flipped");
  // Too soon on day d+1, then back on d+2: the kept challenge (day d) completes inside the window.
  const { r2, unit } = challengeThenPush(d, t1, d + 1, t1 + 2 * H);
  const r3 = applyServerLedger({
    states: r2.states, events: [{ eventId: "e3", unitId: unit, walkerId: "ben", day: d + 2, push: { kind: "solid" } }], holding: P2.holding, budget: P2.takeBudget,
    secondPush: { ...gap({ e3: t1 + 40 * H }), challengeOpenedMs: r2.challengeOpenedMs },
  });
  assert.equal(r3.entries[0]!.outcome, "flipped");
  // The window still ends the challenge: day d+4 opens a new one whatever the gap.
  const late = challengeThenPush(d, t1, d + 4, t1 + 4 * DAY_MS);
  assert.equal(late.r2.entries[0]!.outcome, "eroded");
  assert.deepEqual(late.r2.states.get(late.unit)!.challenges, [{ walkerId: "ben", day: d + 4 }]);
});

test("device clocks never count: the guard reads only server receipt times, so a time-zone change, DST or a skewed device changes nothing", () => {
  const d = 300;
  // 2026-10-25 is a European DST change. Receipt 23:30 and 19:45 the next evening: 20h15, flips.
  const t1 = Date.UTC(2026, 9, 24, 23, 30);
  const day1 = Math.floor(t1 / DAY_MS);
  assert.equal(challengeThenPush(day1, t1, day1 + 1, t1 + 20.25 * H).r2.entries[0]!.outcome, "flipped");
  // Whatever the device says about when the walks happened (the events carry no device time), only receipt decides.
  assert.equal(challengeThenPush(d, d * DAY_MS + 1 * H, d + 1, d * DAY_MS + 1.5 * H).r2.entries[0]!.outcome, "eroded");
  // A missing receipt time is treated as too soon (fail closed).
  const { r1, unit } = challengeThenPush(d, d * DAY_MS, d + 1, (d + 1) * DAY_MS + 23 * H);
  const unknown = applyServerLedger({
    states: r1.states, events: [{ eventId: "e9", unitId: unit, walkerId: "ben", day: d + 1, push: { kind: "solid" } }], holding: P2.holding, budget: P2.takeBudget,
    secondPush: gap({ e9: (d + 2) * DAY_MS }), // opened time not known
  });
  assert.equal(unknown.entries[0]!.outcome, "eroded");
});

test("long offline and out-of-order uploads: the gap runs from when the server received each walk", () => {
  const d = 400;
  // Walk at 18:00 on day d, uploaded offline at 01:30 on d+1 (inside the grace, still day d).
  const opened = (d + 1) * DAY_MS + 1.5 * H;
  // Next walk at 18:00 on d+1, uploaded at once: only 16h30 after the server first saw the challenge.
  assert.equal(challengeThenPush(d, opened, d + 1, (d + 1) * DAY_MS + 18 * H).r2.entries[0]!.outcome, "eroded");
  // Held back and uploaded 20 hours after the first upload: the defender had those 20 hours.
  assert.equal(challengeThenPush(d, opened, d + 1, opened + 20 * H).r2.entries[0]!.outcome, "flipped");
});

test("ground below the immediate-take line and stepped-on shade still fall at once; the holder's visit still answers the challenge", () => {
  const d = 500;
  const u = UNITS[1]!;
  const weak = applyServerLedger({
    states: new Map([[u, held(u, "ana", d, { strength: 20, challenges: [{ walkerId: "ben", day: d - 1 }] })]]),
    events: [{ eventId: "w", unitId: u, walkerId: "ben", day: d, push: { kind: "solid" } }], holding: P2.holding, budget: P2.takeBudget,
    secondPush: gap({ w: 0 }, { [challengeKey(u, "ben")]: 0 }),
  });
  assert.equal(weak.entries[0]!.outcome, "flipped");
  const { r2, unit } = challengeThenPush(d, d * DAY_MS + 23 * H, d + 1, (d + 1) * DAY_MS + H);
  const defended = applyServerLedger({ states: r2.states, events: [{ eventId: "h", unitId: unit, walkerId: "ana", day: d + 1, push: { kind: "solid" } }], holding: P2.holding, budget: P2.takeBudget, secondPush: gap({ h: 0 }) });
  assert.equal(defended.entries[0]!.outcome, "reinforced");
  assert.equal(defended.states.get(unit)!.challenges, undefined);
});

/* ── zone partitions ────────────────────────────────────────────────────── */

const zoneOf = zoneOfUnder(P2.units);
const kids = cellToChildren(ZONES[0]!, 10).sort();

test("a mixed zone is split per holder: each partition pays once at its lowest level, no unit counted twice, lines add up", () => {
  const day = 10;
  const states = new Map<string, UnitState>([
    [kids[0]!, held(kids[0]!, "ana", day, { level: 2 as LandLevel })],
    [kids[1]!, held(kids[1]!, "ana", day)],
    [kids[2]!, held(kids[2]!, "ana", day)],
    [kids[3]!, held(kids[3]!, "ben", day)],
    [kids[4]!, held(kids[4]!, "cal", day, { ground: "shade", strength: 20 })], // shade: not counted (D15)
  ]);
  const partitions = zonePartitions({ day, states, holding: P2.holding, zoneOf, shadeCountsAsHeld: false });
  assert.deepEqual(partitions.map((p) => [p.holderId, p.level, p.unitIds.length]), [["ana", 1, 3], ["ben", 1, 1]]);
  // The shared model refuses a holder at two levels in one zone; with the partition levels it settles.
  const raw = holdingsAtDayClose({ day, states, entries: [], holdingRules: P2.holding, zoneOf, shadeCountsAsHeld: false });
  assert.ok(raw.problems.some((p) => p.includes("levels")));
  const holdings = holdingsAtDayClose({ day, states: withPartitionLevels(states, partitions), entries: [], holdingRules: P2.holding, zoneOf, shadeCountsAsHeld: false });
  assert.deepEqual(holdings.problems, []);
  assert.deepEqual(partitionProblems({ partitions, holdings }), []);
  const credits = settleCreditsDay({ rulesVersion: 1, season: 1, day, players: [], holdings });
  assert.equal(credits.status, "settled");
  if (credits.status !== "settled") return;
  assert.deepEqual(credits.lines.map((l) => [l.playerId, l.zonesHeld]), [["ana", 1], ["ben", 1]]);
  assert.deepEqual(partitionProblems({ partitions, holdings, lines: credits.lines }), []);
  assert.equal(credits.lines.reduce((a, l) => a + l.zonesHeld, 0), partitions.length);
});

test("partition invariants catch double counting, a zone without a unit and lines that do not add up", () => {
  const day = 10;
  const states = new Map<string, UnitState>([[kids[0]!, held(kids[0]!, "ana", day)], [kids[1]!, held(kids[1]!, "ben", day)]]);
  const partitions = zonePartitions({ day, states, holding: P2.holding, zoneOf, shadeCountsAsHeld: false });
  const holdings = holdingsAtDayClose({ day, states, entries: [], holdingRules: P2.holding, zoneOf, shadeCountsAsHeld: false });
  assert.deepEqual(partitionProblems({ partitions, holdings }), []);
  const twice = [...partitions, { ...partitions[0]!, holderId: "cal" }];
  assert.ok(partitionProblems({ partitions: twice, holdings }).some((p) => p.includes("two partitions")));
  const phantom = { holders: [...holdings.holders, { playerId: "dee", zones: [{ zoneId: ZONES[0]!, level: 1 as LandLevel, visited: false, unitIds: [] }] }] };
  assert.ok(partitionProblems({ partitions, holdings: phantom }).some((p) => p.includes("without a unit")));
  const doubled = { holders: holdings.holders.map((h) => ({ ...h, zones: [...h.zones, ...h.zones] })) };
  assert.ok(partitionProblems({ partitions, holdings: doubled }).some((p) => p.includes("counted twice")));
  assert.ok(partitionProblems({ partitions, holdings, lines: [{ playerId: "ana", zonesHeld: 2 }, { playerId: "ben", zonesHeld: 1 }] }).length > 0);
});

test("partitions are deterministic and follow decay: ground that ran out leaves its partition", () => {
  const states = new Map<string, UnitState>([[kids[0]!, held(kids[0]!, "ana", 0, { strength: 5 })], [kids[1]!, held(kids[1]!, "ben", 0)]]);
  const a = zonePartitions({ day: 5, states, holding: P2.holding, zoneOf, shadeCountsAsHeld: false });
  const b = zonePartitions({ day: 5, states: new Map([...states].reverse()), holding: P2.holding, zoneOf, shadeCountsAsHeld: false });
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((p) => p.holderId), ["ben"], "Ana's 5 decayed to 0 by day 5");
});
