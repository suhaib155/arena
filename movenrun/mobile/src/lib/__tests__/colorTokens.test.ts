/**
 * Colour tokens — the contrast floor, and the ban on raw hex in screens.
 *
 * `lib/tone.ts` claims each `ink` clears 4.5:1 on every surface the app writes
 * it on. A claim in a doc comment is worth nothing, so this measures it: the
 * ratios below are computed from the hex values with an independent WCAG
 * implementation. Nothing in `lib/` is reused for the maths — a guard that
 * imported the app's own contrast helper would agree with it by construction
 * and prove only that the helper is self-consistent.
 *
 * What this does NOT claim: that the app is WCAG AA conformant. A ratio is a
 * property of two colours. It says nothing about the size text is finally
 * rendered at, what is layered over it, dynamic type, or a control obscured by
 * a sibling. Device verification stays a release gate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import {
  buildTones,
  canvas,
  HAIRLINE_ALPHA,
  hairline,
  ink,
  SOFT_TINT_ALPHA,
  softTint,
  STRONG_TINT_ALPHA,
  strongTint,
  tints,
} from "../tone";

const MOBILE_ROOT = resolve(__dirname, "..", "..", "..");

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

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, 1:1 … 21:1. */
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Composite `fg` at `alpha` (a 2-digit hex suffix) over an opaque `bg`. */
function composite(fg: string, alphaHex: string, bg: string): string {
  const a = Number.parseInt(alphaHex, 16) / 255;
  const f = rgb(fg);
  const b = rgb(bg);
  return (
    "#" +
    f
      .map((v, i) => Math.round(b[i] + (v - b[i]) * a).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

test("the contrast implementation matches the values WCAG defines", () => {
  // Anchors from the specification itself, so a bug in the maths above cannot
  // quietly make every other assertion in this file easier to pass.
  assert.equal(Number(contrast("#000000", "#FFFFFF").toFixed(2)), 21);
  assert.equal(Number(contrast("#FFFFFF", "#FFFFFF").toFixed(2)), 1);
  assert.equal(Number(luminance("#FFFFFF").toFixed(4)), 1);
  assert.equal(Number(luminance("#000000").toFixed(4)), 0);
  // A known mid pair: #767676 on white is the canonical 4.54:1 AA boundary.
  assert.ok(Math.abs(contrast("#767676", "#FFFFFF") - 4.54) < 0.01);
});

/* ── the ink floor ────────────────────────────────────────────────────────── */

const WHITE = "#FFFFFF"; // colors.surface — the card
const PAGE = "#F8FAF7"; // colors.bg — the page
const FLOOR = 4.5;

/** Each ink and the brand hue whose chip it is written on. */
const PAIRS: [keyof typeof ink, string][] = [
  ["green", "#18C987"],
  ["gold", "#F7B955"],
  ["coral", "#FF6B4A"],
  ["blue", "#246BFE"],
  ["violet", "#7657FF"],
  ["neutral", "#A3AAB8"],
];

test("every ink is covered by this test", () => {
  // Adding a seventh ink without a surface to measure it against would
  // otherwise slip past every assertion below.
  assert.deepEqual(
    PAIRS.map(([name]) => name).sort(),
    Object.keys(ink).sort(),
    "an ink token has no core paired with it here",
  );
});

test("every ink clears 4.5:1 on all four surfaces it is written on", () => {
  const failures: string[] = [];
  for (const [name, core] of PAIRS) {
    const value = ink[name];
    const surfaces: [string, string][] = [
      ["card", WHITE],
      ["page", PAGE],
      ["chip on card", composite(core, SOFT_TINT_ALPHA, WHITE)],
      ["chip on page", composite(core, SOFT_TINT_ALPHA, PAGE)],
    ];
    for (const [label, bg] of surfaces) {
      const ratio = contrast(value, bg);
      if (ratio < FLOOR) {
        failures.push(`ink.${name} ${value} on ${label} ${bg}: ${ratio.toFixed(2)}:1`);
      }
    }
  }
  assert.ok(PAIRS.length > 0, "no inks measured — the token import is broken");
  assert.deepEqual(failures, [], `below the ${FLOOR}:1 floor`);
});

test("the brand hues themselves are not readable, which is why ink exists", () => {
  // The premise. If a core ever became legible as text on its own, the ink
  // ramp would be dead weight and this file should say so out loud rather than
  // keep enforcing a floor on tokens nothing needs.
  for (const [, core] of PAIRS.filter(([n]) => n === "green" || n === "gold" || n === "coral")) {
    assert.ok(
      contrast(core, WHITE) < 3,
      `${core} is now readable on white — the ink ramp may be redundant`,
    );
  }
});

test("each ink keeps the hue of its core", () => {
  // Darkening is allowed; changing the colour is not. Hue is compared on the
  // circle, so a wrap at 0°/360° does not read as a 359° drift.
  const hue = (hex: string): number => {
    const [r, g, b] = rgb(hex).map((v) => v / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) return 0;
    const d = max - min;
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return h * 60;
  };
  for (const [name, core] of PAIRS) {
    const delta = Math.abs(hue(ink[name]) - hue(core));
    const drift = Math.min(delta, 360 - delta); // the short way round the circle
    assert.ok(drift < 1, `ink.${name} is ${drift.toFixed(2)}° off its core — that is a different colour`);
  }
});

/* ── the three tint roles ─────────────────────────────────────────────────── */

test("the three tint roles are distinct, ordered, and applied consistently", () => {
  const alphas = [SOFT_TINT_ALPHA, STRONG_TINT_ALPHA, HAIRLINE_ALPHA];
  assert.equal(new Set(alphas).size, 3, "two roles share an alpha — one of them has no reason to exist");
  const values = alphas.map((a) => Number.parseInt(a, 16));
  assert.deepEqual(values, [...values].sort((a, b) => a - b), "fill < emphasis < hairline");

  const c = "#246BFE";
  assert.equal(softTint(c), `${c}${SOFT_TINT_ALPHA}`);
  assert.equal(strongTint(c), `${c}${STRONG_TINT_ALPHA}`);
  assert.equal(hairline(c), `${c}${HAIRLINE_ALPHA}`);
});

test("a colour that is not #RRGGBB comes back untouched rather than corrupted", () => {
  // Appending to an 8-digit colour would produce a 10-digit string, which is
  // not a colour at all — and React Native would render something arbitrary
  // rather than throw.
  for (const bad of ["#246BFEAA", "rgba(0,0,0,0.5)", "transparent", "#FFF", ""]) {
    assert.equal(softTint(bad), bad, `${bad} must not be given an alpha suffix`);
    assert.equal(hairline(bad), bad);
    assert.equal(strongTint(bad), bad);
  }
});

test("tints and canvas greys are pale enough to be fills, and none carries text", () => {
  const surfaces = { ...tints, ...canvas };
  assert.ok(Object.keys(surfaces).length > 10, "the fill ramp is suspiciously small");
  for (const [name, value] of Object.entries(surfaces)) {
    assert.match(value, /^#[0-9A-F]{6}$/i, `${name} is not a plain hex fill`);
    assert.ok(
      contrast(value, WHITE) < 2,
      `${name} ${value} is dark enough to look like a control, not a fill`,
    );
  }
});

test("tints and canvas greys are separate vocabularies", () => {
  // A canvas grey means nothing; a tint means a state. Sharing a value would
  // make an inert cell and a real state indistinguishable.
  const overlap = Object.values(tints).filter((v) => Object.values(canvas).includes(v as never));
  assert.deepEqual(overlap, [], "a canvas grey is being used to convey a state");
});

/* ── the tone table ───────────────────────────────────────────────────────── */

test("every tone resolves to paints drawn from the ramps, not to loose values", () => {
  const tones = buildTones({
    positive: "#18C987",
    caution: "#F7B955",
    urgent: "#FF6B4A",
    info: "#246BFE",
    deed: "#7657FF",
    neutral: "#A3AAB8",
  });
  const names = Object.keys(tones) as (keyof typeof tones)[];
  assert.ok(names.length >= 6, "the tone table lost a role");
  for (const name of names) {
    const tone = tones[name];
    assert.ok(
      Object.values(ink).includes(tone.ink as never),
      `tone ${name} writes in ${tone.ink}, which is not an ink token`,
    );
    assert.ok(
      Object.values(tints).includes(tone.tint as never),
      `tone ${name} fills with ${tone.tint}, which is not a tint token`,
    );
  }
  // Distinct roles must look distinct, or the vocabulary means nothing.
  const inks = names.map((n) => tones[n].ink);
  assert.equal(new Set(inks).size, inks.length, "two tones write in the same ink");
});

/* ── no raw hex in screens ────────────────────────────────────────────────── */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__" && entry.name !== "node_modules") walk(full, out);
    } else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const SCREENS = [
  ...walk(join(MOBILE_ROOT, "app")),
  ...walk(join(MOBILE_ROOT, "src", "components")),
];

const HEX = /#[0-9A-Fa-f]{6}\b/g;

test("the hex scan finds hex where hex is supposed to live", () => {
  // The fail-closed half. An offender list is empty both when every screen is
  // clean and when the scanner is broken, so prove the scanner works by
  // pointing it at the two files that are *meant* to hold raw values.
  assert.ok(SCREENS.length > 20, `only ${SCREENS.length} screens discovered`);
  for (const owner of [join(MOBILE_ROOT, "src", "theme.ts"), join(MOBILE_ROOT, "src", "lib", "tone.ts")]) {
    const found = readFileSync(owner, "utf8").match(HEX) ?? [];
    assert.ok(found.length > 5, `${relative(MOBILE_ROOT, owner)} holds no hex — the scan is broken`);
  }
});

test("no screen or component states a colour as a raw hex value", () => {
  const offenders: string[] = [];
  for (const file of SCREENS) {
    for (const match of readFileSync(file, "utf8").match(HEX) ?? []) {
      offenders.push(`${relative(MOBILE_ROOT, file).split(sep).join("/")}: ${match}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "use a token from @/theme — palette, colors, ink, tints or canvas",
  );
});
