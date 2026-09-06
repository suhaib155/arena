/**
 * The dark ground, held to the same floor as the light page.
 *
 * `colorTokens.test.ts` measures `ink` against the four *light* surfaces the
 * app writes it on, and separately asserts that every `tints`/`canvas` value is
 * pale. Neither of those rules can speak about a dark surface, so when the
 * mission hero, the live status band and the summary banner moved onto one,
 * their text was unmeasured — and the two brand hues that fail there
 * (`baseBlue` at 3.82:1, `deedViolet` at 3.80:1) fail by an amount nobody can
 * see by eye against the four that pass.
 *
 * So this is the mirror of that file for `ground` / `onGround` / `groundInk`,
 * with the same independent WCAG implementation rather than a shared helper —
 * a guard that imported the app's own contrast maths would prove only that the
 * maths agrees with itself.
 *
 * What this does NOT claim, identically to the light-side file: that the app is
 * WCAG AA conformant. A ratio is a property of two colours and says nothing
 * about rendered size, dynamic type, or a label composited over map imagery.
 * Device verification stays a release gate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ground, groundInk, ink, onGround, tints, canvas } from "../tone";

/* ── an independent WCAG implementation ───────────────────────────────────── */

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  assert.equal(h.length, 6, `${hex} is not a 6-digit hex colour`);
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function hue(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h =
    max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

const FLOOR = 4.5;

/** The two grounds text is actually written on. `ground.edge` is a 1px
 *  division and carries none, which is why it is named here rather than
 *  silently left out of the loop below. */
const TEXT_GROUNDS: [string, string][] = [
  ["base", ground.base],
  ["raised", ground.raised],
];

test("the contrast implementation matches values WCAG defines", () => {
  assert.equal(Number(contrast("#FFFFFF", "#000000").toFixed(2)), 21);
  assert.equal(Number(contrast("#777777", "#FFFFFF").toFixed(2)), 4.48);
  assert.equal(contrast("#123456", "#123456"), 1);
});

test("the grounds are actually dark, and ordered", () => {
  // A "dark ground" that a light card could be mistaken for is the failure
  // mode: the whole point of this family is that it recedes.
  for (const [name, value] of Object.entries(ground)) {
    assert.match(value, /^#[0-9A-F]{6}$/i, `${name} is not a plain hex`);
    assert.ok(
      contrast(value, "#FFFFFF") > 4.5,
      `ground.${name} ${value} is too light to be a dark surface`,
    );
  }
  assert.ok(
    luminance(ground.base) < luminance(ground.raised),
    "a panel raised on the ground must be lighter than the ground",
  );
  assert.ok(
    luminance(ground.raised) < luminance(ground.edge),
    "the division must be lighter than the panel it divides",
  );
});

test("every neutral written on the ground clears 4.5:1 on both text grounds", () => {
  const failures: string[] = [];
  let measured = 0;
  for (const [inkName, value] of Object.entries(onGround)) {
    for (const [groundName, bg] of TEXT_GROUNDS) {
      measured += 1;
      const ratio = contrast(value, bg);
      if (ratio < FLOOR) {
        failures.push(`onGround.${inkName} ${value} on ground.${groundName}: ${ratio.toFixed(2)}:1`);
      }
    }
  }
  assert.ok(measured > 0, "nothing measured — the token import is broken");
  assert.deepEqual(failures, [], `below the ${FLOOR}:1 floor`);
});

test("every brand hue written on the ground clears the same floor", () => {
  const failures: string[] = [];
  for (const [inkName, value] of Object.entries(groundInk)) {
    for (const [groundName, bg] of TEXT_GROUNDS) {
      const ratio = contrast(value, bg);
      if (ratio < FLOOR) {
        failures.push(`groundInk.${inkName} ${value} on ground.${groundName}: ${ratio.toFixed(2)}:1`);
      }
    }
  }
  assert.deepEqual(failures, [], `below the ${FLOOR}:1 floor`);
});

test("groundInk keeps the hue of the core it is lifted from", () => {
  // Same rule as `ink` on the light side: a brand hue is not this module's to
  // move. Only lightness may change, and only as far as the floor requires.
  const CORES: Record<keyof typeof groundInk, string> = {
    green: "#18C987",
    gold: "#F7B955",
    coral: "#FF6B4A",
    blue: "#246BFE",
    violet: "#7657FF",
    neutral: "#A3AAB8",
  };
  const names = Object.keys(groundInk) as (keyof typeof groundInk)[];
  assert.deepEqual(
    names.sort(),
    (Object.keys(CORES) as (keyof typeof groundInk)[]).sort(),
    "a groundInk token has no core paired with it here",
  );
  for (const name of names) {
    const drift = Math.abs(hue(groundInk[name]) - hue(CORES[name]));
    assert.ok(drift <= 1, `groundInk.${name} drifted ${drift.toFixed(1)}° off its core hue`);
  }
});

test("a hue is only lifted when the core actually fails, never for taste", () => {
  const CORES: Record<keyof typeof groundInk, string> = {
    green: "#18C987",
    gold: "#F7B955",
    coral: "#FF6B4A",
    blue: "#246BFE",
    violet: "#7657FF",
    neutral: "#A3AAB8",
  };
  for (const name of Object.keys(CORES) as (keyof typeof groundInk)[]) {
    const core = CORES[name];
    const passesEverywhere = TEXT_GROUNDS.every(([, bg]) => contrast(core, bg) >= FLOOR);
    if (passesEverywhere) {
      assert.equal(
        groundInk[name],
        core,
        `groundInk.${name} moved a core that was already readable — that is drift, not a system`,
      );
    } else {
      assert.notEqual(groundInk[name], core, `groundInk.${name} kept a core that fails the floor`);
    }
  }
});

test("the ground family is a separate vocabulary from the light fills", () => {
  // A pale tint and a dark ground mean opposite things. Sharing a value would
  // let one be substituted for the other without any rule noticing.
  const light = new Set<string>([
    ...Object.values(tints),
    ...Object.values(canvas),
    ...Object.values(ink),
  ]);
  for (const [name, value] of Object.entries({ ...ground, ...groundInk, ...onGround })) {
    if (name === "text") continue; // plain white is not owned by anyone
    assert.ok(!light.has(value), `${name} ${value} is also a light-surface token`);
  }
});
