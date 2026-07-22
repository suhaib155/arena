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
  assert.match(s.headline, /3 zones/);
});

test("saved with zero capture is honest about no new territory", () => {
  const s = resolveCompletion({ ...base(), saved: true, outcome: "saved" });
  assert.equal(s.kind, "saved");
  assert.match(s.detail, /No new territory/i);
  assert.equal(s.progressPersisted, true);
});
