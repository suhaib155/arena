/**
 * B1 self-checks: the catalogue's schema and citations, the source's own
 * worked arithmetic, and the same inputs through the repository's reference
 * model. Rows that disagree are asserted as documented findings, so the
 * suite stays green while the disagreement stays visible.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveSessionPath, pushUnitsOf, steppedUnitsOf, VERIFIED_STEPS_V1 } from "../../../backend/src/gameplay/path.ts";
import { allChecks, ceilingOrder, onePushAfterFlip, runCreditsDay, seasonSchedule } from "./workedExamples";
import { renderCsv, renderJson } from "./run";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const catalogue = JSON.parse(readFileSync(join(root, "docs/parallel/economy-redteam/SOURCE_RULE_CATALOGUE.json"), "utf8"));
const rows = allChecks().rows;
const byId = new Map(rows.map((r) => [r.id, r]));
const get = (id: string) => {
  const r = byId.get(id);
  assert.ok(r, `missing row ${id}`);
  return r;
};

/* ── (a) schema ─────────────────────────────────────────────────────────── */

const FIELDS = [
  "id", "mechanic", "value", "unit", "source_section", "source_classification", "evidence_tier", "owner_decision_ref",
  "implementation", "tests", "implemented_value", "mismatch", "recommended_resolution", "needs_owner_ratification",
];

test("catalogue: every entry has every field, a known classification and tier, and a unique stable id", () => {
  const classes = new Set(catalogue.classification_values);
  const tiers = new Set(catalogue.evidence_tiers);
  const ids = new Set<string>();
  assert.ok(catalogue.entries.length >= 60);
  for (const e of catalogue.entries) {
    for (const f of FIELDS) assert.ok(f in e, `${e.id}: missing ${f}`);
    assert.match(e.id, /^(SRC|PILOT)-[A-Z0-9-]+$/, e.id);
    assert.ok(!ids.has(e.id), `duplicate id ${e.id}`);
    ids.add(e.id);
    assert.ok(classes.has(e.source_classification), `${e.id}: classification ${e.source_classification}`);
    assert.ok(tiers.has(e.evidence_tier), `${e.id}: tier ${e.evidence_tier}`);
    assert.equal(typeof e.needs_owner_ratification, "boolean", e.id);
    assert.ok(e.implementation === "none" || Array.isArray(e.implementation), `${e.id}: implementation`);
    assert.ok(e.tests === "none" || Array.isArray(e.tests), `${e.id}: tests`);
    assert.ok(e.mismatch === null || typeof e.mismatch === "string", `${e.id}: mismatch`);
    if (e.id.startsWith("PILOT-")) {
      assert.match(e.source_classification, /^NOT IN SOURCE/, e.id);
      assert.equal(typeof e.origin, "string", `${e.id}: origin`);
    } else {
      assert.doesNotMatch(e.source_classification, /^NOT IN SOURCE/, e.id);
      assert.match(e.source_section, /V3 §\d+/, e.id);
    }
  }
});

test("catalogue: the mechanics B1 names are all present", () => {
  const ids = new Set(catalogue.entries.map((e: { id: string }) => e.id));
  for (const id of [
    "SRC-SUPPLY-CAP", "SRC-PLAYER-ALLOCATION", "SRC-SEASON-POOL", "SRC-DAILY-POOL-S1", "SRC-CEIL-SESSION", "SRC-CEIL-DAY", "SRC-CEIL-RATIO",
    "SRC-TOLL-RATE", "SRC-TOLL-SPLIT", "SRC-TOLL-NO-SURCHARGE", "SRC-TOLL-EXCLUSIONS", "SRC-TOLL-SEASON-BOUND", "SRC-TOLL-OWNER-UNCAPPED",
    "SRC-SEAL", "SRC-SOLID-STRENGTH", "SRC-SHADE-STRENGTH", "SRC-SHADE-DECAY", "SRC-SHADE-NO-DEED-TOLL", "SRC-MASKED", "SRC-UPKEEP",
    "SRC-AWAY-DAYS", "SRC-FORTIFY", "SRC-LAND-LEVELS", "SRC-RECHARGE-RATE", "SRC-AUTO-CHARGE-CAP", "SRC-BURN-REAL", "SRC-LIQUID-VALVE",
    "SRC-LOCKED-LIQUID-FIRST-DEED", "SRC-DAILY-SETTLEMENT", "SRC-LABEL-CREDITS-VS-TOKEN",
    "PILOT-TAKE-BUDGET-13", "PILOT-UNIT-BUDGET-300", "PILOT-SECOND-PUSH-GAP-20H", "PILOT-CHALLENGE-WINDOW", "PILOT-RES10-UNITS-RES9-ZONES",
    "PILOT-RES10-INTERPOLATION", "PILOT-ONE-PUSH-PER-WALKER-UNIT-DAY", "PILOT-SOLID-DECAY", "PILOT-STAGE-FLOORS", "PILOT-RETENTION-14-120",
    "PILOT-PLAYER-CAP-200",
  ]) assert.ok(ids.has(id), `missing ${id}`);
});

test("catalogue: the §29 labels are copied exactly for the register's rows", () => {
  const cls = (id: string) => catalogue.entries.find((e: { id: string }) => e.id === id).source_classification;
  assert.equal(cls("SRC-TOLL-RATE"), "FIXED · NOT GOVERNABLE");
  assert.equal(cls("SRC-TOLL-SEASON-BOUND"), "STRUCTURAL");
  assert.equal(cls("SRC-TOLL-OWNER-UNCAPPED"), "DELIBERATE");
  assert.equal(cls("SRC-RAW-LOCATION-RETENTION"), "TARGET");
  assert.equal(cls("SRC-CEIL-SESSION"), "HYPOTHESIS");
  assert.equal(cls("SRC-CEIL-RATIO"), "FIXED");
  assert.equal(cls("PILOT-ONE-PUSH-PER-WALKER-UNIT-DAY"), "NOT IN SOURCE — OWNER DECISION");
});

test("catalogue: the token and emission-horizon flags are explicit", () => {
  assert.match(catalogue.global_flags.token_status, /No V3 token is deployed/);
  assert.match(catalogue.global_flags.emission_horizon, /not circulating supply/);
  assert.match(catalogue.global_flags.credits_vs_token_labelling, /credits/);
});

test("catalogue: every file:line citation points at an existing file and line", () => {
  for (const e of catalogue.entries) {
    if (!Array.isArray(e.implementation)) continue;
    for (const ref of e.implementation as string[]) {
      const m = /^([\w./-]+?)(?::(\d+)(?:-(\d+))?)?(?:\s|$)/.exec(ref);
      assert.ok(m, `${e.id}: unparsable ${ref}`);
      const path = join(root, m[1]!);
      assert.ok(existsSync(path), `${e.id}: no file ${m[1]}`);
      if (m[2]) {
        const lines = readFileSync(path, "utf8").split("\n").length;
        assert.ok(Number(m[3] ?? m[2]) <= lines, `${e.id}: ${ref} past end (${lines} lines)`);
      }
    }
  }
});

/* ── (b) the source's own arithmetic ────────────────────────────────────── */

test("source: Meera's steps reproduce from the printed inputs", () => {
  for (const id of ["S18-RATE", "S18-EFFORT", "S18-POINTS", "S18-DAYPOINTS", "S18-GROSS", "S18-PER-SESSION", "S18-CEILINGS", "S18-TOLL-DAY-BASIS",
    "S18-RAVI", "S18-SAM", "S18-RECHARGE", "S18-UPKEEP-DS", "S18-UPKEEP", "S18-CAP60", "S18-CREDITED", "S18-DESTROYED"]) {
    assert.equal(get(id).agrees, true, id);
  }
});

test("documents finding: Meera's printed gross and net rest on rounded intermediates", () => {
  assert.equal(get("S18-GROSS-EXACT").agrees, false);
  assert.ok(Math.abs(get("S18-GROSS-EXACT").value - 3.6893) < 1e-4);
  assert.equal(get("S18-CREDITED-EXACT-DAYTOLL").agrees, false);
  assert.ok(Math.abs(get("S18-CREDITED-EXACT-DAYTOLL").value - 2.279) < 1e-3);
});

test("documents finding: §20 per-session toll on Meera's evening session is half of §18's printed toll", () => {
  assert.equal(get("S18-TOLL-SESSION-BASIS").value, 0.0092);
  assert.equal(get("S18-TOLL-DAY-BASIS").value, 0.0184);
  assert.equal(get("S18-TOLL-SESSION-BASIS").agrees, false);
});

test("source: Dan's day-shares reproduce; documents finding: exact owed is 7.5446, printed 7.55", () => {
  assert.equal(get("S19-UPKEEP-DS").agrees, true);
  assert.equal(get("S19-UPKEEP-OWED-PRINTED-INPUT").agrees, true);
  assert.equal(get("S19-UPKEEP-OWED-EXACT").agrees, false);
});

test("source: §7 upkeep table; documents finding: the 16-zone row prints 1.00 for 0.96", () => {
  for (const n of [1, 6, 30, 100, 250]) assert.equal(get(`S7-ROW${n}-ALL`).agrees, true, `${n}`);
  for (const n of [1, 6, 16, 30, 100, 250]) assert.equal(get(`S7-ROW${n}-PER`).agrees, true, `${n}`);
  assert.equal(get("S7-ROW16-ALL").value, 0.96);
  assert.equal(get("S7-ROW16-ALL").agrees, false);
  assert.equal(get("S7-ROW16-WEEK").agrees, false);
  assert.equal(get("S7-ROW30-WEEK").agrees, false, "14.74 printed as 14.8");
});

test("source: §20 toll table; documents finding: its 20.00 session exceeds the 12 session ceiling", () => {
  for (const id of ["S20-NONE", "S20-4OF6-RATE", "S20-4OF6-KEEP", "S20-4OF6-OWNERS", "S20-ALL-4-KEEP", "S20-ALL-4-EACH", "S20-ALL-8-EACH", "S20-ALL-20-KEEP", "S20-SEASON1-TOLL-BOUND", "S20-RAVI-DAY", "S20-RAVI-DS"]) {
    assert.equal(get(id).agrees, true, id);
  }
  assert.equal(get("S20-TABLE-VS-SESSION-CEIL").agrees, false);
  assert.equal(get("S20-RAVI-10X-ALL3").agrees, false, "0.45 is not ten times the upkeep of three unvisited zones");
});

test("source: §17 consistency example, ratio, population thresholds and the season schedule", () => {
  for (const id of ["S17-WALKER", "S17-RUNNER", "S17-CEIL-RATIO", "S17-DAY-LT-2SESSIONS", "S17-5000", "S17-100K", "S17-100", "S6-3000", "S17-SCHED-TOTAL", "S17-SCHED-YEARS", "S17-DAILY-S1"]) {
    assert.equal(get(id).agrees, true, id);
  }
  const s = seasonSchedule();
  assert.ok(Math.abs(s.released - 400e6) < 1);
  assert.equal(s.seasons, 180);
  assert.ok(s.fractionalSeasons > 179 && s.fractionalSeasons < 180);
  assert.equal(s.aboveFloor, 15);
  assert.ok(Math.round(s.years) === 44);
  assert.equal(get("S20-SEASON1-TOLL-BOUND").value, 180_000);
  assert.equal(get("S17-CEIL-RATIO").value, 0.6);
});

test("source: §8, §10 and §26 arithmetic", () => {
  for (const id of ["S8-ONE-STARTER", "S8-ONE-VETERAN", "S8-FLAT4", "S10-LAND", "S10-KIT", "S26-TX-YEAR"]) assert.equal(get(id).agrees, true, id);
});

/* ── (c) the same inputs through the implementation ─────────────────────── */

test("implementation: Meera's day through settleCreditsDay balances and matches recharge, upkeep and the 60% check", () => {
  for (const id of ["IMPL-S18-DAYSHARE", "IMPL-S18-SESSION", "IMPL-S18-RECHARGE", "IMPL-S18-UPKEEP", "IMPL-S18-CAP60", "IMPL-S19-TAKEN", "IMPL-S19-ZONES"]) {
    assert.equal(get(id).agrees, true, id);
  }
  const b = runCreditsDay(12);
  // Recharge on the gross reward, before the toll (source §18 step 8).
  assert.equal(b.meera.rechargeMicro, Math.floor(0.25 * b.meera.earnedMicro));
  // Matched tolls.
  assert.equal(b.meera.tollPaidMicro, b.ravi.tollReceivedMicro + b.sam.tollReceivedMicro);
});

test("documents finding: code applies the toll per session (D10), so Meera's 12-cell evening pays 0.0092, not 0.0184", () => {
  assert.equal(get("IMPL-S18-TOLL-12").agrees, false);
  assert.ok(Math.abs(get("IMPL-S18-TOLL-12").value - 0.00922) < 1e-5);
  assert.equal(get("IMPL-S18-TOLL-6").agrees, true, "only when the evening crossed 6 cells");
});

test("documents finding: code's exact arithmetic gives Meera 3.689 gross and Dan 7.5446 owed, not the printed 3.68 and 7.55", () => {
  assert.equal(get("IMPL-S18-GROSS").agrees, false);
  assert.equal(get("IMPL-S19-OWED").agrees, false);
  assert.equal(get("IMPL-S7-16").agrees, false);
});

test("implementation: toll table, rounding remainder to the runner, and the season schedule agree", () => {
  for (const id of ["IMPL-S20-4OF6", "IMPL-S20-ALL-4", "IMPL-S20-ALL-8", "IMPL-S20-ALL-20", "IMPL-S17-SCHED-TOTAL", "IMPL-S17-SCHED-SEASONS", "IMPL-S17-DAILY-S1"]) {
    assert.equal(get(id).agrees, true, id);
  }
  assert.ok(get("IMPL-S20-REMAINDER").value > 0, "the runner keeps the floor remainder");
});

test("documents finding: the ceiling order (A7) changes the day total", () => {
  const c = ceilingOrder();
  assert.deepEqual(c.books, []);
  assert.deepEqual(c.codeSessions, [10, 10]);
  assert.ok(Math.abs(c.dayFirst.reduce((a, b) => a + b, 0) - 18.6667) < 1e-3);
});

test("owner rule A9: a flip does not grant a second hostile push the same day", () => {
  const r = onePushAfterFlip();
  assert.deepEqual([r.first, r.second, r.third], ["flipped", "flipped", "refused_daily_limit"]);
  assert.equal(r.holderAfter, "bob");
});

test("documents deviation (for ratification): 1002 pushes interpolated res10 units; the toll reads stepped units only", () => {
  // Synthetic coordinates: two accepted fixes 150 m apart, 100 s apart, no pause.
  const a = { lat: 10, lng: 10, timestamp: 0 };
  const b = { lat: 10, lng: 10 + 150 / 109_600, timestamp: 100_000 };
  const path = deriveSessionPath([a, b], [], VERIFIED_STEPS_V1);
  const pushed = pushUnitsOf(path, VERIFIED_STEPS_V1);
  const stepped = steppedUnitsOf(path);
  assert.ok(path.interpolated.some(Boolean), "the segment crosses units with no fix");
  assert.ok(pushed.length > stepped.length, "interpolated units become pushes under 1002");
  assert.equal(VERIFIED_STEPS_V1.pushInterpolated, true);
});

/* ── determinism ────────────────────────────────────────────────────────── */

test("outputs are byte-identical across runs", () => {
  assert.equal(renderJson(), renderJson());
  assert.equal(renderCsv(), renderCsv());
});
