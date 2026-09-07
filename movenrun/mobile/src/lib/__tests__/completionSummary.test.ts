/**
 * Completion / route-summary state — offline node tests.
 *
 * The core invariant: preview rewards are never presented as confirmed, and no
 * fabricated backend "pending / review / rejected" outcome is produced (the
 * reward model is a local simulation). Also covers demo, too-short,
 * already-saved, ready-to-save, and the three saved outcomes incl. zero-capture.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveCompletion, type CompletionInput } from "../completionSummary";

function base(): CompletionInput {
  return {
    mode: "gps",
    saveable: true,
    alreadySavedToday: false,
    saved: false,
    outcome: null,
    defendedCount: 0,
  };
}

test("rewards are always tagged local-preview, never a confirmed payout", () => {
  // Sweep the full input space; rewardStatus must never drift from local-preview.
  for (const mode of ["gps", "demo"] as const) {
    for (const saveable of [true, false]) {
      for (const alreadySavedToday of [true, false]) {
        for (const saved of [true, false]) {
          for (const outcome of [null, "captured", "defended", "saved"] as const) {
            const s = resolveCompletion({
              ...base(),
              mode,
              saveable,
              alreadySavedToday,
              saved,
              outcome,
              defendedCount: outcome === "defended" ? 2 : 0,
            });
            assert.equal(s.rewardStatus, "local-preview");
          }
        }
      }
    }
  }
});

test("XP is only marked awarded when a real save persisted (not demo/too-short/already)", () => {
  assert.equal(resolveCompletion({ ...base(), mode: "demo", saved: true, outcome: "captured" }).xpAwardedNow, false);
  assert.equal(resolveCompletion({ ...base(), saveable: false }).xpAwardedNow, false);
  assert.equal(resolveCompletion({ ...base(), alreadySavedToday: true }).xpAwardedNow, false);
  assert.equal(resolveCompletion({ ...base(), saved: true, outcome: "saved" }).xpAwardedNow, true);
});

test("demo → preview only, no persistence, no rewards block", () => {
  const s = resolveCompletion({ ...base(), mode: "demo" });
  assert.equal(s.kind, "demo-preview");
  assert.equal(s.progressPersisted, false);
  assert.equal(s.showRewards, false);
});

test("too-short → cannot save, no rewards", () => {
  const s = resolveCompletion({ ...base(), saveable: false });
  assert.equal(s.kind, "too-short");
  assert.equal(s.showRewards, false);
  assert.equal(s.tone, "warning");
});

test("already-saved today → honest, no extra XP", () => {
  const s = resolveCompletion({ ...base(), alreadySavedToday: true });
  assert.equal(s.kind, "already-saved");
  assert.equal(s.xpAwardedNow, false);
});

test("ready-to-save shows the reward preview but marks it not yet banked", () => {
  const s = resolveCompletion(base());
  assert.equal(s.kind, "ready-to-save");
  assert.equal(s.showRewards, true);
  assert.equal(s.progressPersisted, false);
  assert.equal(s.xpAwardedNow, false);
});

test("saved + captured → confirmed local capture", () => {
  const s = resolveCompletion({ ...base(), saved: true, outcome: "captured" });
  assert.equal(s.kind, "saved-captured");
  assert.equal(s.progressPersisted, true);
  assert.equal(s.tone, "green");
});

test("saved + defended reports the defended count", () => {
  const s = resolveCompletion({ ...base(), saved: true, outcome: "defended", defendedCount: 3 });
  assert.equal(s.kind, "saved-defended");
  assert.equal(s.headline, "3 local zones refreshed");
});

test("saved with zero capture is honest about no new territory", () => {
  const s = resolveCompletion({ ...base(), saved: true, outcome: "saved" });
  assert.equal(s.kind, "saved");
  assert.match(s.detail, /No new territory/i);
  assert.equal(s.progressPersisted, true);
});

test("the summary states each fact once, in the order a reader needs them", () => {
  const screen = readFileSync(resolve(__dirname, "../../../app/move/summary.tsx"), "utf8");

  /* The result was rendered twice: the kicker in the page header and again
     inside a callout, with "Not enough movement" as both a subtitle and a
     callout headline. A reader does not learn a fact twice by reading it twice —
     they start wondering whether the two are different facts. */
  assert.ok(!screen.includes("<ResultCallout"), "the duplicate result callout is gone");
  assert.equal((screen.match(/completion\.kicker/g) ?? []).length, 1, "one kicker");
  assert.equal((screen.match(/completion\.headline/g) ?? []).length, 1, "one headline");
  assert.equal((screen.match(/completion\.detail/g) ?? []).length, 1, "one supporting sentence");

  /* Exactly one Preview label on the screen. Two read as two different
     qualifications rather than one honest one. */
  assert.equal((screen.match(/>Preview</g) ?? []).length, 1, "one Preview label");

  /* One route-quality explanation, not an explanation plus a note repeating it. */
  assert.ok(!screen.includes("Preview score. Rewards and territory are evaluated separately."),
    "the duplicate route-quality note is gone");
  /* Rendered once. The other occurrence is the persisted route-trust record's
     own field, which is stored rather than shown. */
  assert.equal((screen.match(/\{trust\.explanation\}/g) ?? []).length, 1);

  /* Target order: result, then the numbers, then the ground. Metrics lead the
     map now — for a session with no route the numbers are the result, and a map
     slot explaining its own emptiness is a poor thing to lead with. */
  /* Scoped to the main render: the no-session early return above it has its own
     Back to Today and would satisfy the last marker before the first. */
  const body = screen.slice(screen.indexOf("contentContainerStyle={styles.scroll}"));
  const order = ["completion.headline", "styles.statsRow", "<RouteMapPanel", "styles.trustCard", "Share your route", 'label="Back to Today"'];
  let cursor = -1;
  for (const marker of order) {
    const at = body.indexOf(marker);
    assert.ok(at > cursor, `${marker} is out of order in the summary`);
    cursor = at;
  }

  /* Cards that would report only an absence are not rendered at all. A session
     with no route used to show an "Areas traversed" card whose entire content
     was "No zones reached yet", a sealing line about a route that does not
     exist, and a Preview tag. */
  assert.match(screen, /\{zonesTouched\.length > 0 \? \(/);
  assert.ok(!screen.includes(">No zones reached yet<"), "the empty-zone caption is no longer rendered");

  /* Every truth claim survives: the gap notice, the retained-prefix notice,
     the sealing verdict and the server verdict are all still stated. */
  assert.match(screen, /\{gaps\}/);
  assert.match(screen, /!evidenceComplete \?/);
  assert.match(screen, /finishedSealLabel\(seal\)/);
  assert.match(screen, /serverSealLabel\(verification\)/);
});

test("the capture celebration makes no geographic claim", () => {
  const screen = readFileSync(resolve(__dirname, "../../../app/move/captured.tsx"), "utf8");
  /* This stage drew two horizontal roads, a cross-street and a nine-dot route
     line into the hex, none of it from the session. On the one screen that tells
     you you have taken ground, that reads as the streets you walked to take it. */
  for (const forbidden of ["canvas.road", "canvas.roadCross", "styles.road", "routeDot", "routeRow"]) {
    assert.ok(!screen.includes(forbidden), `the capture stage must not draw ${forbidden}`);
  }
  /* What replaces it has no direction and cannot be followed. */
  assert.match(screen, /styles\.ring/);
  assert.match(screen, /borderColor: canvas\.ring/);
});
