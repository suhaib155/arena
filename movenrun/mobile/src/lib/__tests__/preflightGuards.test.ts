/**
 * The last pre-demo guards: what a session that did not move may change, and
 * what leaving a finished session must release.
 *
 * ## The progression defect
 *
 * `isSaveable` is distance **OR** duration, so `isSaveable(0, 300_000)` is true:
 * five minutes of standing still is a saveable session that went nowhere. Every
 * downstream effect keyed off that one boolean, so a motionless session banked
 * Movement Session XP, advanced the movement streak, refreshed a zone's defence
 * and control, reset its decay clock, incremented `timesDefended` — which feeds
 * collections, season objectives, the questline, club scoring and the passport —
 * and redirected to the capture celebration.
 *
 * The app already states the bar: the defend collection reads *"Defend a zone by
 * moving over it."* So this introduces no new threshold. It reuses
 * `hasDrawableRoute`, the same predicate the map slot uses to decide whether a
 * line can honestly be drawn, which is in turn the same evidence-break rule the
 * polyline and the measured distance already share.
 *
 * ## The exit defect
 *
 * Every exit from the summary has to navigate *and* release the in-memory
 * handoff holding the route's raw coordinates. Android's hardware Back did
 * neither — it popped the screen, leaving the coordinates in module memory,
 * discarding a still-unsaved session with no confirmation, and leaving a stale
 * "View route summary" affordance on unrelated zone screens.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { isSaveable } from "../../services/moveSession";
import { hasDrawableRoute } from "../routeMapState";
import { resolveCompletion, type CompletionInput } from "../completionSummary";
import { backIntent, returnToToday } from "../todayNavigation";
import { degradesSignal } from "../mapPresence";
import { inspectFix, ON_FOOT_POLICY } from "@movenrun/shared/measurement";
import type { TrackPoint } from "../geo";

const epoch = 1_700_000_000_000;
const at = (offset: number, latitude = 26.1445, accuracy = 5): TrackPoint =>
  ({ latitude, longitude: 91.7362, timestamp: epoch + offset, accuracy });

const source = (relative: string) => readFileSync(resolve(__dirname, "../..", relative), "utf8");
const summary = () => source("../app/move/summary.tsx");

const base: CompletionInput = {
  mode: "gps", saveable: true, alreadySavedToday: false, saved: false, outcome: null, defendedCount: 0,
};

/* ── the stationary session ────────────────────────────────────────────────── */

test("standing still for five minutes is saveable and is not movement", () => {
  /* Both halves of the defect, stated together. */
  assert.equal(isSaveable(0, 300_000), true, "the duration branch makes it saveable");
  assert.equal(hasDrawableRoute([at(0)]), false, "and it moved nowhere");

  /* One accepted fix is what a stationary session actually produces: with no
     previous point there is no `within_uncertainty` check, so the first fix is
     accepted and every later one is rejected. */
  assert.equal(inspectFix(null, at(0), epoch).accepted, true);
  const jitter = inspectFix(at(0), at(4000, 26.14453), epoch + 4000);
  assert.equal(jitter.accepted, false);
  assert.equal(jitter.reason, "within_uncertainty");
});

test("a recorded session with no movement rewards nothing and claims nothing", () => {
  const view = resolveCompletion({ ...base, movedOverGround: false, saved: true });
  assert.equal(view.kind, "saved-unqualified");
  assert.equal(view.xpAwardedNow, false, "no movement XP");
  assert.equal(view.progressPersisted, false, "no movement progress");
  assert.equal(view.showRewards, false, "and no reward block promising any");
  assert.match(view.detail, /No XP, no streak and no territory change/);
  /* It is still recorded — the session is not thrown away, it just earns nothing. */
  assert.match(view.headline, /Recorded/);
});

test("the reward preview is withheld before saving too, not only after", () => {
  /* Showing a `+XP` preview and then not awarding it would be the same lie one
     tap earlier. */
  const before = resolveCompletion({ ...base, movedOverGround: false });
  assert.equal(before.kind, "ready-to-record");
  assert.equal(before.showRewards, false);
  assert.match(before.detail, /earns no XP and changes no territory/);
  /* A session that did move keeps the preview it always had. */
  assert.equal(resolveCompletion({ ...base, movedOverGround: true }).kind, "ready-to-save");
  assert.equal(resolveCompletion({ ...base, movedOverGround: true }).showRewards, true);
});

test("a real movement session keeps every existing reward and territory behaviour", () => {
  const moved = { ...base, movedOverGround: true };
  assert.equal(resolveCompletion({ ...moved, saved: true, outcome: "saved" }).xpAwardedNow, true);
  assert.equal(resolveCompletion({ ...moved, saved: true, outcome: "captured" }).kind, "saved-captured");
  assert.equal(resolveCompletion({ ...moved, saved: true, outcome: "defended", defendedCount: 2 }).kind, "saved-defended");
  assert.equal(resolveCompletion({ ...moved, alreadySavedToday: true }).kind, "already-saved");
  assert.equal(resolveCompletion({ ...moved, saveable: false }).kind, "too-short");
  assert.equal(resolveCompletion({ ...moved, mode: "demo" }).kind, "demo-preview");
  /* Absent the flag entirely, behaviour is exactly what it was — older callers
     and fixtures describe sessions that did move. */
  assert.equal(resolveCompletion(base).kind, "ready-to-save");
});

test("no new distance or duration threshold was introduced", () => {
  /* The whole point of reusing `hasDrawableRoute`: this patch must not become
     the eligibility PR. Two observed fixes in one span is a route; one is not. */
  assert.equal(hasDrawableRoute([]), false);
  assert.equal(hasDrawableRoute([at(0)]), false);
  assert.equal(hasDrawableRoute([at(0), at(4000, 26.1455)]), true);
  assert.equal(hasDrawableRoute([at(0), { ...at(600_000, 26.30), breakBefore: true }]), false);
  const screen = summary();
  assert.ok(!/\b(?:200|750|150)\b\s*(?:\*|<=|>=|<|>)/.test(screen.replace(/\/\*[\s\S]*?\*\//g, "")),
    "no bare distance comparison was added to the summary");
  assert.match(screen, /hasDrawableRoute\(session\.points, mapPauses\)/);
});

test("every progression effect is gated on movement, at its own call site", () => {
  const screen = summary();
  /* XP, streak and the movement-history row all go through `completeQuest`. */
  assert.match(screen, /if \(movedOverGround\) completeQuest\(sessionQuest\)/);
  /* Territory defence, and therefore `timesDefended`, the defence/control gains
     and the decay-clock reset that follow from `applyDefend`. */
  assert.match(screen, /evidenceComplete && movedOverGround\s*\n?\s*\? defendZones/);
  /* The celebration is reached only from a real capture or defence, both of
     which are now unreachable without movement. */
  assert.match(screen, /if \(defendedCount > 0\) \{/);
  /* Capture is untouched: still seal-gated exactly as before. */
  assert.match(screen, /if \(candidate && evidenceComplete && seal\?\.sealed === true\)/);
  /* And the screen does not promise a defence refresh it will not perform. */
  assert.match(screen, /ownedTouched\.length > 0 && saveable && movedOverGround/);
});

test("a route that cannot be drawn cannot seal, so capture needs no second gate", () => {
  /* Why leaving the capture condition alone is safe rather than lucky. */
  for (const points of [[], [at(0)], [at(0), { ...at(600_000, 26.30), breakBefore: true }]]) {
    assert.equal(hasDrawableRoute(points as TrackPoint[]), false);
  }
});

/* ── leaving a finished session ────────────────────────────────────────────── */

test("the exit path both navigates and releases, in that order", () => {
  /* `returnToToday` is the single releasing exit, and every Back case funnels
     into it. Its two responsibilities were only ever asserted at the call site,
     which meant the release could have been deleted from the function itself
     without a single test noticing. */
  const calls: string[] = [];
  returnToToday(
    { replace: (href) => { calls.push(`replace:${href}`); } },
    () => { calls.push("release"); },
  );
  assert.deepEqual(calls, ["replace:/(tabs)", "release"],
    "leaving must navigate and release the in-memory handoff");
});

test("hardware Back releases the handoff, and asks first only when it would cost something", () => {
  assert.equal(backIntent({ saveInFlight: false, unsavedProgress: false }), "leave");
  assert.equal(backIntent({ saveInFlight: false, unsavedProgress: true }), "confirm");
  assert.equal(backIntent({ saveInFlight: true, unsavedProgress: false }), "block");
  /* A save in flight wins: it is one synchronous transaction and must not be
     interrupted half-applied. */
  assert.equal(backIntent({ saveInFlight: true, unsavedProgress: true }), "block");
});

test("both finished-session screens intercept Back and leave through the releasing path", () => {
  const screen = summary();
  assert.match(screen, /BackHandler\.addEventListener\("hardwareBackPress", leave\)/);
  assert.match(screen, /const intent = backIntent\(exitRef\.current\)/);
  assert.match(screen, /returnToToday\(router, clearLastSession\)/);
  /* Confirming keeps the summary; leaving releases. */
  assert.match(screen, /text: "Keep summary", style: "cancel"/);
  assert.match(screen, /text: "Leave", style: "destructive", onPress: done/);
  /* A session with nothing to reward is not worth a prompt. */
  assert.match(screen, /unsavedProgress: showFooterSave && movedOverGround/);
  /* Registered before the no-session early return, or it would be a hook that
     does not always run. */
  assert.ok(screen.indexOf('BackHandler.addEventListener') < screen.indexOf("if (!session) {"),
    "the Back handler must be registered unconditionally");

  const captured = source("../app/move/captured.tsx");
  assert.match(captured, /BackHandler\.addEventListener\("hardwareBackPress", \(\) => \{ done\(\); return true; \}\)/);
  assert.match(captured, /clearLastSession\(\);\s*\n\s*router\.dismissAll\(\);/);
  assert.ok(captured.indexOf("BackHandler.addEventListener") < captured.indexOf("if (!zone) {"));
});

test("the stale route-summary affordance cannot outlive the session it points at", () => {
  const zone = source("../app/zone/[id].tsx");
  /* Read once at render, this button outlived its session: the handoff is
     released when the summary is left, and an already-mounted zone screen went
     on offering a summary for a walk that no longer existed. */
  assert.match(zone, /useSyncExternalStore\(\s*subscribeVerification,\s*\(\) => getLastSession\(\) !== null,/);
  assert.ok(!/const hasSession = getLastSession\(\) !== null;/.test(zone),
    "the affordance must not be a one-shot render-time read");
  /* No new persistence was added to support it. */
  for (const forbidden of ["AsyncStorage", "SecureStore", "persist("]) {
    assert.ok(!zone.includes(forbidden), `the affordance must not persist anything (${forbidden})`);
  }
});

/* ── signal truth ─────────────────────────────────────────────────────────── */

test("a bad signal degrades the chip; a stationary player does not", () => {
  assert.equal(degradesSignal("weak_accuracy"), true);
  assert.equal(degradesSignal("stale_fix"), true);
  /* The common rejection, and the one that must never read as a bad signal. */
  assert.equal(degradesSignal("within_uncertainty"), false);
  for (const reason of ["acquiring", "invalid_fix", "unknown_accuracy", "non_increasing_time",
    "future_fix", "implausible_speed"] as const) {
    assert.equal(degradesSignal(reason), false, reason);
  }
  assert.equal(degradesSignal(null), false, "an accepted fix is not a degradation");
});

test("the rejections that degrade are the ones the fix inspector actually produces", () => {
  /* Pinned against the real inspector so a renamed reason cannot silently make
     the guard dead code. */
  const weak = inspectFix(null, at(0, 26.1445, ON_FOOT_POLICY.maxAccuracyMeters + 1), epoch);
  assert.equal(weak.reason, "weak_accuracy");
  assert.equal(degradesSignal(weak.reason), true);

  const stale = inspectFix(null, at(0), epoch + ON_FOOT_POLICY.maxFixAgeMs + 1000);
  assert.equal(stale.reason, "stale_fix");
  assert.equal(degradesSignal(stale.reason), true);

  const still = inspectFix(at(0), at(4000, 26.14453), epoch + 4000);
  assert.equal(still.reason, "within_uncertainty");
  assert.equal(degradesSignal(still.reason), false);
});

test("degrading the chip changes nothing about what counts as evidence", () => {
  const screen = source("../app/move/session.tsx");
  /* The guard sits inside the rejected branch, which still returns before any
     distance, preview or route work. */
  const rejected = screen.slice(screen.indexOf("if (!decision.accepted) {"));
  const branch = rejected.slice(0, rejected.indexOf("\n        }"));
  assert.match(branch, /if \(degradesSignal\(decision\.reason\)\) setSignal\("degraded"\)/);
  assert.match(branch, /return;/);
  for (const forbidden of ["pushPoint", "setDistanceM", "distanceRef.current =", "previewRef.current?.push", "showLocation"]) {
    assert.ok(!branch.includes(forbidden), `a rejected fix must not ${forbidden}`);
  }
  /* A later accepted fix restores the good state — the accepted branch is the
     only other writer. */
  assert.match(screen, /setSignal\(p\.accuracy != null && p\.accuracy > 25 \? "degraded" : "usable"\)/);
});

/* ── large text ───────────────────────────────────────────────────────────── */

test("both result screens keep their actions reachable at the largest font", () => {
  const result = source("../app/result.tsx");
  assert.match(result, /<ScrollView\s+style=\{styles\.compactScroll\}/);
  assert.ok(result.indexOf("</ScrollView>") < result.indexOf("styles.compactActions"),
    "the incomplete result's actions sit outside the scroller");
  assert.match(result, /compact: \{ flexGrow: 1/, "a short result still sits where it did");

  const captured = source("../app/move/captured.tsx");
  assert.match(captured, /<ScrollView\s+style=\{styles\.centerScroll\}/);
  assert.ok(captured.indexOf("</ScrollView>") < captured.indexOf("styles.footer"),
    "the capture celebration's actions sit outside the scroller");
  assert.match(captured, /center: \{ flexGrow: 1, alignItems: "center", justifyContent: "center"/);
  /* Important text is not shrunk to fit. */
  assert.ok(!/fontSize: [0-9]\b/.test(captured), "no text was shrunk into unreadability");
});
