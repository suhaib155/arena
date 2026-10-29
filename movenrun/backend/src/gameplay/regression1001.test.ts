/**
 * Rule set 1001 regression: the default rule set must behave byte for byte
 * as it did before rule set 1002's path, day-boundary, walk-order and zone
 * partition work. Its config digest (what every pinned day records) and the
 * full output of seeded multi-day streams through the server ledger and day
 * close are compared with values recorded from the code before that work
 * (commit 685852b). No database; the PostgreSQL counterpart is
 * regression1001.pg.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { newUnit, type UnitState } from "@movenrun/shared/holding";
import type { PushEvent } from "@movenrun/shared/holdingLedger";
import { holdingsAtDayClose, settleCreditsDay } from "@movenrun/shared/holdingSettlement";
import { applyServerLedger } from "./policy.js";
import { PILOT_PROPOSAL, rulesetConfig, rulesetDigest, zoneOfUnder } from "./rules.js";

/** Recorded from 685852b. */
const DIGEST_1001 = "d4199ec60958750007bfa8884c88aad1bf810aed6bd2a054abb5dc74ffe41cd6";
/**
 * 1001 with sealing v2 named (`territorySeal`, docs/g34/SEALING_V2_28OCT.md):
 * the one deliberate identity change since 685852b. Without that key the
 * config is the recorded one, byte for byte.
 */
const DIGEST_1001_SEALING_V2 = "ff372572d7b754ad6c6dde3dbcc7535f7f62e13e94e718f8424eb0b1e0923bb2";
const STREAM_FINGERPRINT_1001 = "438a3ea0ddb1ad928a04207634d3b8bdbafc5e9c6f250cde58d58c7ee4148a87";

function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded streams: 12 walkers, 40 stored-cell units, 10 days, a few batches a day, some retries and shade. */
export function stream1001(seed: number): string {
  const rnd = prng(seed);
  const rules = PILOT_PROPOSAL;
  let states = new Map<string, UnitState>();
  const applied = new Set<string>();
  const out: unknown[] = [];
  let n = 0;
  for (let day = 100; day < 110; day++) {
    for (let b = 0; b < 4; b++) {
      const events: PushEvent[] = [];
      for (let k = 0; k < 15; k++) {
        const u = `u-${Math.floor(rnd() * 40)}`;
        const w = `w-${Math.floor(rnd() * 12)}`;
        const shade = rnd() < 0.1 ? Math.floor(rnd() * 26) : undefined;
        events.push({ eventId: `e-${n++}`, unitId: u, walkerId: w, day, push: shade === undefined ? { kind: "solid" } : { kind: "shade", strength: shade } });
      }
      if (rnd() < 0.3 && events.length > 0) events.push({ ...events[0]! }); // a retried event in the same batch
      for (const e of events) if (!states.has(e.unitId)) states.set(e.unitId, newUnit(e.unitId, day));
      const r = applyServerLedger({ states, events, holding: rules.holding, appliedEventIds: applied, budget: rules.takeBudget });
      states = r.states;
      for (const e of r.entries) applied.add(e.eventId);
      out.push(r.results, r.entries, [...r.takesUsed].sort());
    }
    const entries = [] as Parameters<typeof holdingsAtDayClose>[0]["entries"][number][];
    const holdings = holdingsAtDayClose({ day, states, entries, holdingRules: rules.holding, zoneOf: zoneOfUnder(rules.units), shadeCountsAsHeld: rules.shadeCountsAsHeld });
    const credits = settleCreditsDay({ rulesVersion: 1, season: 1, day, players: [], holdings });
    out.push(holdings.holders, holdings.problems, credits);
  }
  out.push([...states].sort(([a], [b]) => (a < b ? -1 : 1)));
  return createHash("sha256").update(JSON.stringify(out)).digest("hex");
}

test("1001's recorded identity is unchanged except for the named sealing v2 rule: same config otherwise, no 1002-only field", () => {
  assert.equal(rulesetDigest({ ...PILOT_PROPOSAL, territorySeal: undefined }), DIGEST_1001);
  assert.equal(rulesetDigest(PILOT_PROPOSAL), DIGEST_1001_SEALING_V2);
  const config = rulesetConfig(PILOT_PROPOSAL);
  assert.equal(config.dayAttribution, undefined);
  assert.equal(PILOT_PROPOSAL.units.source, undefined);
  assert.equal(PILOT_PROPOSAL.units.partition, undefined);
  assert.equal(PILOT_PROPOSAL.takeBudget, null);
  assert.deepEqual(PILOT_PROPOSAL.takeover, { name: "immediate", policyVersion: 1 });
});

test("1001 seeded streams through the server ledger and day close give the recorded output", () => {
  const fp = [1, 2, 3].map(stream1001).join(",");
  if (process.env.MOVENRUN_PRINT_MEASUREMENTS) console.log(`1001 stream fingerprint: ${createHash("sha256").update(fp).digest("hex")}`);
  assert.equal(createHash("sha256").update(fp).digest("hex"), STREAM_FINGERPRINT_1001);
});
