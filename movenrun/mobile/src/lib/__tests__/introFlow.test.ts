/**
 * Intro step machine + one-shot tap guard — pure behavioural tests.
 *
 * The point of these is the bug they lock out: progression must be ordinary
 * state, so every transition here is expressible without any scroll offset,
 * momentum event, layout width, or animation callback.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canGoBack,
  FIRST_INTRO_STEP,
  INTRO_STEPS,
  INTRO_STEP_COUNT,
  introPositionLabel,
  introProgress,
  introStepAnnouncement,
  isLastIntroStep,
  LAST_INTRO_STEP,
  nextIntroStep,
  previousIntroStep,
  toIntroStep,
  type IntroStep,
} from "../introFlow";
import { createTapGuard } from "../tapGuard";

test("forward: 0 → 1 → 2, and 2 is the last step", () => {
  assert.equal(nextIntroStep(0), 1);
  assert.equal(nextIntroStep(1), 2);
  assert.equal(isLastIntroStep(2), true);
  assert.equal(isLastIntroStep(1), false);
  assert.equal(LAST_INTRO_STEP, 2);
  assert.equal(INTRO_STEP_COUNT, 3);
});

test("repeated Next can never exceed the last step", () => {
  let step: IntroStep = FIRST_INTRO_STEP;
  for (let i = 0; i < 25; i++) step = nextIntroStep(step);
  assert.equal(step, LAST_INTRO_STEP);
});

test("back: 2 → 1 → 0, and Back at 0 stays 0 (and is not offered)", () => {
  assert.equal(previousIntroStep(2), 1);
  assert.equal(previousIntroStep(1), 0);
  assert.equal(previousIntroStep(0), 0);
  assert.equal(canGoBack(0), false, "Back is unavailable on the first step");
  assert.equal(canGoBack(1), true);
  assert.equal(canGoBack(2), true);
});

test("progress and position are derived from the step alone", () => {
  assert.equal(introProgress(0), 1 / 3);
  assert.equal(introProgress(1), 2 / 3);
  assert.equal(introProgress(2), 1);
  assert.equal(introPositionLabel(0), "1 of 3");
  assert.equal(introPositionLabel(2), "3 of 3");
});

test("a corrupt or out-of-range step is clamped onto a legal one", () => {
  assert.equal(toIntroStep(-4), 0);
  assert.equal(toIntroStep(99), 2);
  assert.equal(toIntroStep(1.9), 1);
  assert.equal(toIntroStep(Number.NaN), 0);
  assert.equal(toIntroStep(Number.POSITIVE_INFINITY), 0);
});

test("exactly three steps, each with title, body and its own CTA", () => {
  assert.equal(INTRO_STEPS.length, INTRO_STEP_COUNT, "no fourth educational step");
  for (const step of INTRO_STEPS) {
    assert.ok(step.title.length > 0);
    assert.ok(step.body.length > 0);
    assert.ok(step.ctaLabel.length > 0);
  }
  // The three required concepts, in order.
  assert.match(INTRO_STEPS[0].body, /movement session/i);
  assert.match(INTRO_STEPS[1].body, /capture|defend/i);
  assert.match(INTRO_STEPS[2].body, /local beta/i);
  assert.match(INTRO_STEPS[2].body, /Raw routes are not stored/i);
  assert.match(INTRO_STEPS[2].body, /No wallet or minting is required/i);
  assert.equal(INTRO_STEPS[2].ctaLabel, "Start my first move");
});

test("intro copy avoids earn / ownership / market claims", () => {
  const forbidden =
    /move[- ]to[- ]earn|guaranteed|mint now|claim rewards|market value|passive yield|on-chain finality|global competition/i;
  for (const step of INTRO_STEPS) {
    assert.ok(!forbidden.test(`${step.title} ${step.body} ${step.ctaLabel}`), step.title);
  }
});

test("every step change produces a screen-reader announcement naming its position", () => {
  assert.match(introStepAnnouncement(0), /^Step 1 of 3\./);
  assert.match(introStepAnnouncement(1), /^Step 2 of 3\./);
  assert.match(introStepAnnouncement(2), /^Step 3 of 3\./);
  assert.match(introStepAnnouncement(1), /Capture and defend/);
});

test("a double press on the final CTA collapses into one completion", () => {
  let now = 1000;
  const guard = createTapGuard(1200, () => now);
  assert.equal(guard.tryAcquire(), true, "the first press completes the intro");
  assert.equal(guard.tryAcquire(), false, "an immediate second press is dropped");
  now += 400;
  assert.equal(guard.tryAcquire(), false);
  now += 1200;
  assert.equal(guard.tryAcquire(), true, "a later, deliberate replay is allowed again");
});
