import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, buildWorld, evaluate, manifest, proximityCounterfactual, slowTrustAverageWeight, staffMinutesPer1000 } from "./sim.ts";
import {
  DEFAULT_POLICY, RETENTION, decide, decideAppeal, expireStale, fileAppeal, notificationFor, openCase, wordingProblems, type CaseState, type ReviewCase,
} from "./dueProcess.ts";

const seeds10 = manifest.seeds.slice(0, 10);
const v = (name: string) => manifest.variants.find((x) => x.name.startsWith(name))!;

test("determinism: same seed gives byte-identical worlds and results; seeds are distinct", () => {
  const a = buildWorld(manifest.seeds[0]!, 200), b = buildWorld(manifest.seeds[0]!, 200);
  assert.equal(JSON.stringify([a.edges, a.accounts]), JSON.stringify([b.edges, b.accounts]));
  assert.equal(JSON.stringify(Array.from(evaluate(a, v("V0")).firstFlag)), JSON.stringify(Array.from(evaluate(b, v("V0")).firstFlag)));
  assert.notEqual(JSON.stringify(a.edges), JSON.stringify(buildWorld(manifest.seeds[1]!, 200).edges));
  assert.equal(new Set(manifest.seeds).size, manifest.seeds.length);
});

test("synthetic only: account ids are opaque pseudonyms and nothing else identifies anyone", () => {
  const w = buildWorld(manifest.seeds[0]!, 100);
  for (const a of w.accounts) assert.match(a.id, /^a\d{4}$/);
  assert.deepEqual(Object.keys(w.accounts[0]!).sort(), ["cohort", "group", "id"]);
});

test("proximity alone is never evidence: unlinked rings have no edges and are never reviewed, whatever the variant", () => {
  const w = buildWorld(manifest.seeds[0]!, 1000);
  const idx = w.accounts.map((a, i) => (a.cohort === "ring_unlinked" ? i : -1)).filter((i) => i >= 0);
  assert.ok(idx.length >= 3);
  assert.equal(w.edges.filter((e) => idx.includes(e.a) || idx.includes(e.b)).length, 0);
  // They really do walk together (same route and time on most days).
  const together = w.presence[idx[0]!]!.filter((p, d) => p && w.presence[idx[1]!]![d] && w.presence[idx[1]!]![d]!.route === p.route).length;
  assert.ok(together > 60);
  for (const variant of manifest.variants) for (const i of idx) assert.equal(evaluate(w, variant).firstFlag[i], -1);
  // And the case opener refuses without a link edge.
  const r = openCase({ caseId: "c1", accountIds: ["a0001", "a0002"], day: 20, linkedEdgeCount: 0, coWalkDays: 12, threshold: 4, windowDays: 14, recordHashes: [] });
  assert.equal(r.ok, false);
});

test("F1: under the #123 rule the share of honest accounts put into review is several times its wrongly-upheld share", () => {
  const a = aggregate(1000, seeds10, [v("V0")]).aggs[0]!;
  assert.ok(a.honestReviewed.lo > 0.1, `reviewed ${a.honestReviewed.mean}`);
  assert.ok(a.honestWronglyUpheld.mean < 0.02);
  assert.ok(a.honestReviewed.mean > 5 * a.honestWronglyUpheld.mean);
});

test("pass bar stated in the manifest: the #123 rule fails it (honest review rate > 2%); a trace-tightness variant narrowly fails, a stricter one passes but loses spaced rings", () => {
  const aggs = Object.fromEntries(aggregate(1000, seeds10).aggs.map((x) => [x.variant.split("-")[0]!, x]));
  assert.ok(aggs["V0"]!.honestReviewed.mean > 0.02);
  assert.ok(aggs["V2"]!.honestReviewed.mean < aggs["V0"]!.honestReviewed.mean / 4);
  assert.ok(aggs["V3"]!.honestReviewed.mean <= 0.02);
  const ring = (k: string, c: string) => aggs[k]!.cohorts.find((x) => x.cohort === c)!.reviewed.mean;
  assert.ok(ring("V0", "ring_linked") > 0.7 && ring("V0", "ring_linked") < 0.97, "linked-ring detection is bounded by link coverage");
  assert.ok(ring("V0", "ring_unlinked") === 0);
  assert.ok(ring("V0", "ring_linked_staggered") < 0.05, "staggered starts evade");
  assert.ok(ring("V3", "ring_linked_spaced") < 0.4, "spaced phones evade the tightness variant");
  // Sensitivity: if honest co-walkers are twice as tight as assumed, the tightness variant loses most of its advantage.
  assert.ok(aggs["V2s"]!.honestReviewed.mean > 2 * aggs["V2"]!.honestReviewed.mean);
});

test("stranger cohorts: reviews come only from false link edges; a proximity graph would review commuters and transit riders wholesale", () => {
  const a = aggregate(1000, seeds10, [v("V0")]);
  assert.ok(a.aggs[0]!.strangersReviewed.mean < 0.01);
  const commute = a.aggs[0]!.cohorts.find((c) => c.cohort === "commute_corridor")!;
  assert.ok(commute.reviewed.mean > 0, "false links do reach some commuters");
  const prox = proximityCounterfactual(buildWorld(seeds10[0]!, 1000), 4).reviewedByCohort;
  assert.ok(prox["commute_corridor"]! > 0.9 && prox["night_shift"]! > 0.9 && prox["public_transit"]! > 0.9);
  assert.equal(prox["solo"], 0);
});

test("privacy: a linked-pairs-only design keeps far fewer live pair records than a stored proximity graph", () => {
  const p = proximityCounterfactual(buildWorld(seeds10[0]!, 1000), 4);
  assert.ok(p.avgLiveProximityRecords > 3 * p.avgLiveLinkedRecords);
  assert.ok(RETENTION.every((r) => r.rawLocation === false));
  assert.ok(RETENTION.every((r) => r.retentionDays !== undefined));
});

test("staff minutes: low < mid < high, and the workload falls with the stricter variant", () => {
  const [a0, a2] = aggregate(1000, seeds10, [v("V0"), v("V2-")]).aggs;
  const s0 = staffMinutesPer1000(a0!.honestCasesPer1000.mean, a0!.honestUpheldCasesPer1000.mean);
  const s2 = staffMinutesPer1000(a2!.honestCasesPer1000.mean, a2!.honestUpheldCasesPer1000.mean);
  assert.ok(s0.low < s0.mid && s0.mid < s0.high);
  assert.ok(s2.mid < s0.mid / 3);
});

test("slow trust accumulation arithmetic: a linear ramp costs a fresh account (and a fresh ring) part of the horizon", () => {
  assert.ok(slowTrustAverageWeight(28) < slowTrustAverageWeight(14));
  assert.ok(Math.abs(slowTrustAverageWeight(1) - 1) < 1e-12);
});

/* ── due process ──────────────────────────────────────────────────────────── */
const opened = () => {
  const r = openCase({ caseId: "c1", accountIds: ["a0002", "a0001"], day: 20, linkedEdgeCount: 1, coWalkDays: 4, threshold: 4, windowDays: 14, recordHashes: ["h1", "h2"] });
  assert.ok(r.ok);
  return r.ok ? r.case : (undefined as never);
};

test("a new case changes nothing: no effect, no minted credit, evidence is codes and counts only", () => {
  const c = opened();
  assert.equal(c.effect, null);
  assert.equal(c.mintedMicro, 0);
  assert.deepEqual(Object.keys(c.evidence).sort(), ["coWalkDays", "linkedAccountCount", "reasonCodes", "recordHashes", "windowDays"]);
  assert.equal(openCase({ caseId: "x", accountIds: ["a"], day: 1, linkedEdgeCount: 1, coWalkDays: 3, threshold: 4, windowDays: 14, recordHashes: [] }).ok, false);
});

test("uphold is prospective and delayed; appeal needs a different reviewer; overturn restores and mints nothing", () => {
  const up = decide(opened(), 25, "rv1", "uphold");
  assert.deepEqual(up.effect, { kind: "linked_group_earns_as_one", fromDay: 25 + DEFAULT_POLICY.reviewDelayDays });
  assert.equal(up.mintedMicro, 0);
  const ap = fileAppeal(up, 40);
  assert.throws(() => decideAppeal(ap, 41, "rv1", "overturn"), /different reviewer/);
  const ov = decideAppeal(ap, 41, "rv2", "overturn");
  assert.equal(ov.state, "appeal_cleared");
  assert.equal(ov.effect, null);
  assert.equal(ov.mintedMicro, 0);
  assert.ok(ov.exemptUntilDay! > 41);
  assert.throws(() => fileAppeal(up, 25 + DEFAULT_POLICY.appealDays + 1), /closed/);
  assert.equal(decideAppeal(ap, 41, "rv2", "confirm").state, "appeal_upheld");
});

test("a cleared group is exempt from re-review; stale open cases expire with no effect", () => {
  const cleared = decide(opened(), 22, "rv1", "clear");
  const again = openCase({ caseId: "c2", accountIds: ["a0001", "a0002"], day: 40, linkedEdgeCount: 1, coWalkDays: 6, threshold: 4, windowDays: 14, recordHashes: [], exemptUntilDay: cleared.exemptUntilDay });
  assert.equal(again.ok, false);
  const stale = expireStale(opened(), 20 + DEFAULT_POLICY.maxOpenDays + 1);
  assert.equal(stale.state, "expired");
  assert.equal(stale.effect, null);
});

test("no state restricts an account: states and effects contain no ban, freeze or XP action", () => {
  const states: CaseState[] = ["open", "cleared", "upheld", "appeal_open", "appeal_cleared", "appeal_upheld", "expired"];
  for (const s of states) assert.doesNotMatch(s, /ban|freeze|suspend|lock/);
  const c: ReviewCase = decide(opened(), 25, "rv1", "uphold");
  assert.equal(Object.keys(c.effect!).join(), "kind,fromDay");
  assert.equal(c.effect!.kind, "linked_group_earns_as_one");
});

test("notification wording: every state is free of accusing words and never names a co-walker", () => {
  const states: ReviewCase["state"][] = ["open", "cleared", "upheld", "appeal_open", "appeal_cleared", "appeal_upheld", "expired"];
  for (const s of states) {
    const n = notificationFor({ ...opened(), state: s });
    const text = `${n.title} ${n.body}`;
    assert.deepEqual(wordingProblems(text), [], `${s}: ${text}`);
    assert.doesNotMatch(text, /a\d{4}/);
  }
  assert.ok(wordingProblems("This account was banned for farming").length >= 2);
  assert.ok(wordingProblems("you are a cheater").length > 0);
});
