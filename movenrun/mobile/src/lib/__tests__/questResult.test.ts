/**
 * The quest result screen, both outcomes.
 *
 * Ending Sunrise Sprint early already earned nothing — that rule is
 * `questCompletionSatisfied` and these tests do not touch it. What was wrong was
 * the telling: five centred lines in an otherwise empty page. So these pin two
 * things. First that the verdict is still read and never re-decided here.
 * Second that the unfinished result is a designed result — it says what
 * happened, shows the zero, shows how far the attempt got, and offers a way
 * forward — while never celebrating.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { resolveQuestResult, heldFraction, type QuestResultInput } from "../questResult";

const base: QuestResultInput = {
  questTitle: "Sunrise Sprint",
  completionSatisfied: false,
  xpGained: 0,
  activeMs: 28_000,
  requiredMs: 90_000,
  alreadyAwardedToday: false,
  attemptSettled: true,
};

test("an early finish is reported plainly, with the zero stated and nothing celebrated", () => {
  const view = resolveQuestResult(base);
  assert.equal(view.kind, "not-completed");
  assert.equal(view.title, "Not completed");
  assert.equal(view.xpEarned, 0);
  assert.equal(view.xpLabel, "0 XP", "a zero the player cannot find reads as a screen still loading");
  assert.equal(view.celebrate, false, "there is no consolation confetti");
  assert.equal(view.tone, "neutral");
  assert.match(view.reason, /no XP this time/);
  /* One short line, never a paragraph. */
  assert.ok(view.reason.length <= 80, view.reason);
  assert.ok(!/fail|sorry|unfortunately/i.test(view.reason), "it reports, it does not scold or apologise");
});

test("the held fraction is real progress, clamped, and never flattering", () => {
  assert.equal(heldFraction(28_000, 90_000).toFixed(4), (28 / 90).toFixed(4));
  assert.equal(heldFraction(0, 90_000), 0);
  assert.equal(heldFraction(-5, 90_000), 0);
  assert.equal(heldFraction(200_000, 90_000), 1, "progress cannot exceed the requirement");
  assert.equal(heldFraction(NaN, 90_000), 0);
  /* A quest with no duration requirement is not 0% held — it has no clock. */
  assert.equal(heldFraction(1000, 0), 1);
  assert.equal(resolveQuestResult({ ...base, activeMs: 0 }).progress, 0);
  assert.match(resolveQuestResult({ ...base, activeMs: 0 }).reason, /did not start/);
});

test("completion keeps its badge, its XP and its stronger treatment", () => {
  const view = resolveQuestResult({ ...base, completionSatisfied: true, xpGained: 120, activeMs: 90_000 });
  assert.equal(view.kind, "completed");
  assert.equal(view.title, "Quest complete");
  assert.equal(view.xpEarned, 120);
  assert.equal(view.xpLabel, "+120 XP");
  assert.equal(view.celebrate, true);
  assert.equal(view.tone, "green");
  assert.equal(view.progress, 1);
  assert.equal(view.retry, false, "a completed quest is not offered again");
});

test("a completion that earned nothing because today is already banked says so", () => {
  const view = resolveQuestResult({ ...base, completionSatisfied: true, xpGained: 0, alreadyAwardedToday: true });
  assert.equal(view.kind, "completed");
  assert.equal(view.xpLabel, "+0 XP");
  assert.match(view.reason, /Already completed today/);
  assert.equal(view.celebrate, true, "the quest was still completed");
});

test("Try again is offered only when a fresh attempt could actually earn", () => {
  assert.equal(resolveQuestResult(base).retry, true);
  /* XP already banked today: another attempt spends the player's time for
     nothing, so the button would be a lie about what it does. */
  assert.equal(resolveQuestResult({ ...base, alreadyAwardedToday: true }).retry, false);
  /* An attempt is still live: starting a second would race the one they are in. */
  assert.equal(resolveQuestResult({ ...base, attemptSettled: false }).retry, false);
  /* Nothing identified to retry. */
  assert.equal(resolveQuestResult({ ...base, questTitle: null }).retry, false);
});

test("an unresolvable quest ends without inventing a name or a reward", () => {
  const view = resolveQuestResult({ ...base, questTitle: null });
  assert.equal(view.kind, "ended");
  assert.equal(view.title, "Quest ended");
  assert.equal(view.xpEarned, 0);
  assert.equal(view.celebrate, false);
  assert.equal(view.progress, 0);
});

test("no outcome invents XP the settled attempt did not record", () => {
  for (const xpGained of [0, 25, 120]) {
    const failed = resolveQuestResult({ ...base, xpGained });
    assert.equal(failed.xpEarned, 0, "a non-completion earns nothing whatever the input claims");
    const passed = resolveQuestResult({ ...base, completionSatisfied: true, xpGained });
    assert.equal(passed.xpEarned, xpGained, "a completion reports exactly what was settled");
  }
});

test("the screen renders the resolved view and re-decides no reward rule", () => {
  const screen = readFileSync(resolve(__dirname, "../../../app/result.tsx"), "utf8");
  assert.match(screen, /resolveQuestResult\(\{/);
  assert.match(screen, /completionSatisfied: outcome\?\.completionSatisfied \?\? false/);
  /* The gate is unchanged: the settled verdict, and nothing derived from it
     here. Nothing on this screen awards, completes or advances anything. */
  for (const forbidden of ["completeQuest", "advanceQuest", "startQuest", "captureZone", "settleQuest"]) {
    assert.ok(!screen.includes(forbidden), `the result screen must not call ${forbidden}`);
  }

  /* The unfinished branch is content-sized, not a centred void. */
  assert.ok(!/styles\.center, \{ justifyContent: "center"/.test(screen),
    "the old centred-void layout is gone");
  /* Scrollable content with the actions outside it, so large text can never put
     Back to Today out of reach. */
  assert.match(screen, /contentContainerStyle=\{styles\.compact\}/);
  assert.match(screen, /<ScrollView\s+style=\{styles\.compactScroll\}/);
  const closeScroll = screen.indexOf("</ScrollView>");
  assert.ok(closeScroll > 0 && screen.indexOf("styles.compactActions") > closeScroll,
    "the actions must sit outside the scroller");
  assert.match(screen, /label="Back to Today"/);
  assert.match(screen, /view\.retry && quest \? \(/);
  assert.match(screen, /\{view\.xpLabel\}/);

  /* No celebration on the failure path: the badge, the pop and the share card
     all belong to the completed branch below it. */
  const failing = screen.slice(
    screen.indexOf('if (!quest || !outcome?.completionSatisfied)'),
    screen.indexOf("const level = getLevelInfo"),
  );
  for (const forbidden of ["styles.badge", "ShareCard", "levelUp", "CountUpText", "glow("]) {
    assert.ok(!failing.includes(forbidden), `the unfinished result must not use ${forbidden}`);
  }
  /* And it is reduced-motion-safe by construction: it animates nothing. */
  assert.ok(!failing.includes("Animated"), "the unfinished result has no animation to reduce");
});
