/**
 * The game layer's two structural rules.
 *
 * The resource header, the mission hero and the ground panels are the app's
 * gamification surface. Both rules below are things that were true when they
 * were written and that nothing else in the suite can keep true:
 *
 *  1. **A MOVE readout never appears without its qualifier.** Locked MOVE has
 *     no ledger — the figure is derived from XP for display only
 *     (`lib/lockedMove.ts`). Every other surface in the app that shows it says
 *     so in a sentence beside it, and the header cannot: it is a pill on four
 *     screens with no room for a sentence. So the qualifier is a prop, and this
 *     asserts that every call site passes it. A gold pill reading "128 MOVE"
 *     beside a real XP total is a balance, and the app does not have one.
 *
 *  2. **The dark ground has exactly three owners.** It is the app's only
 *     inverted surface and its whole value is that it is rare: on a light
 *     screen, one dark object is unambiguous. A hand-rolled fourth would make
 *     it a pattern, and — because `onGround`/`groundInk` are the only tokens
 *     measured against it (`immersiveTokens.test.ts`) — a screen mixing its own
 *     dark card would also be writing unmeasured text on it.
 *
 * Discovery is asserted before either rule, for the reason `uiGuards.test.ts`
 * spells out: an empty corpus produces an empty offender list, so a broken scan
 * would otherwise pass hardest.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const MOBILE_ROOT = resolve(__dirname, "..", "..", "..");
const read = (f: string) => readFileSync(f, "utf8");
const label = (f: string) => relative(MOBILE_ROOT, f).split(sep).join("/");

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

const SOURCES = [
  ...walk(join(MOBILE_ROOT, "app")),
  ...walk(join(MOBILE_ROOT, "src", "components")),
];

/** Opening tags for a component, brace-aware so a `=>` inside a prop
 *  expression cannot be mistaken for the end of the tag. */
function openingTags(src: string, component: string): string[] {
  const tags: string[] = [];
  for (const m of src.matchAll(new RegExp(`<${component}\\b`, "g"))) {
    let depth = 0;
    for (let i = m.index! + m[0].length; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) {
        tags.push(src.slice(m.index!, i + 1));
        break;
      }
    }
  }
  return tags;
}

test("discovery fails closed: both roots yield files", () => {
  assert.ok(SOURCES.length > 20, `only ${SOURCES.length} sources discovered`);
  for (const root of ["app", "src/components"]) {
    assert.ok(
      SOURCES.some((f) => label(f).startsWith(`${root}/`)),
      `nothing discovered under ${root}/`,
    );
  }
});

/* ── rule 1: the MOVE qualifier ───────────────────────────────────────────── */

interface Pill {
  file: string;
  tag: string;
}

function movePills(): Pill[] {
  const out: Pill[] = [];
  for (const file of SOURCES) {
    for (const tag of openingTags(read(file), "ResourcePill")) {
      if (/unit="MOVE"/.test(tag)) out.push({ file, tag });
    }
  }
  return out;
}

const MOVE_PILLS = movePills();

test("the pill scan finds the pills, so an empty offender list means something", () => {
  assert.ok(
    MOVE_PILLS.length >= 2,
    `found ${MOVE_PILLS.length} MOVE pills — the header and the profile crest both render one`,
  );
  // …and the scanner can see a non-MOVE pill too, or it is matching everything.
  const all = SOURCES.flatMap((f) => openingTags(read(f), "ResourcePill"));
  assert.ok(all.length > MOVE_PILLS.length, "every ResourcePill looks like MOVE — the filter is broken");
});

test("every MOVE readout carries a visible qualifier", () => {
  const offenders = MOVE_PILLS.filter((p) => !/note="preview"/.test(p.tag)).map((p) =>
    label(p.file),
  );
  assert.deepEqual(
    offenders,
    [],
    'Locked MOVE is derived from XP for display (lib/lockedMove.ts). Pass note="preview".',
  );
});

test("every MOVE readout says the whole truth to a screen reader", () => {
  // The visible qualifier is one word and has to be; the spoken one does not,
  // and is where "not a balance and not a payout" actually gets said.
  const offenders: string[] = [];
  for (const pill of MOVE_PILLS) {
    const spoken = pill.tag.match(/accessibilityLabel=\{`([^`]*)`\}/)?.[1];
    if (!spoken) {
      offenders.push(`${label(pill.file)}: no accessibilityLabel`);
      continue;
    }
    if (!/preview/i.test(spoken)) offenders.push(`${label(pill.file)}: spoken label omits "preview"`);
    if (!/not a (balance|payout)/i.test(spoken)) {
      offenders.push(`${label(pill.file)}: spoken label does not say what it is not`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("the component cannot render a note it was not given", () => {
  // The rule above is only worth anything if the prop is genuinely optional in
  // the component and genuinely rendered when passed — otherwise the call sites
  // could be correct while the pill showed nothing.
  const pill = read(join(MOBILE_ROOT, "src", "components", "ResourcePill.tsx"));
  assert.match(pill, /note\?:\s*string/, "the qualifier must be a real prop");
  assert.match(pill, /\{note \?/, "…and must be rendered when supplied");
});

/* ── rule 2: who owns the dark ground ─────────────────────────────────────── */

/** The three components that may declare a dark surface, and nothing else. */
const GROUND_OWNERS = [
  "src/components/HexField.tsx",
  "src/components/MissionCard.tsx",
  "src/components/GroundPanel.tsx",
] as const;

test("only the ground components declare a dark surface", () => {
  const offenders: string[] = [];
  let declared = 0;
  for (const file of SOURCES) {
    // A *surface* is `backgroundColor: ground.base`. Reaching for
    // `ground.raised` to tint a chip that sits inside a panel is fine and
    // common — that is a child of an owned surface, not a new one.
    if (!/backgroundColor:\s*ground\.base\b/.test(read(file))) continue;
    declared += 1;
    if (!(GROUND_OWNERS as readonly string[]).includes(label(file))) offenders.push(label(file));
  }
  assert.ok(declared > 0, "no dark surface found anywhere — the scan is broken");
  assert.deepEqual(
    offenders,
    [],
    "compose MissionCard or GroundPanel instead of mixing a fourth dark card",
  );
});

test("each ground owner exists and actually uses the ground", () => {
  // The list above is only a rule while every entry on it is real; a renamed
  // file would otherwise silently widen the exemption to nothing.
  for (const owner of GROUND_OWNERS) {
    const source = read(join(MOBILE_ROOT, ...owner.split("/")));
    assert.match(source, /ground\./, `${owner} no longer uses the ground ramp`);
  }
});

test("text on the ground is written in the ground ramp, not the light one", () => {
  // `ink` and `colors.text*` are measured against white surfaces only
  // (colorTokens.test.ts). On the ground they are unmeasured, and two of them
  // genuinely fail there. The owners must not reach for them.
  const offenders: string[] = [];
  for (const owner of GROUND_OWNERS) {
    const source = read(join(MOBILE_ROOT, ...owner.split("/")));
    for (const [, decl] of source.matchAll(/color:\s*(ink\.\w+|colors\.text\w*)/g)) {
      offenders.push(`${owner}: ${decl}`);
    }
  }
  assert.deepEqual(offenders, [], "use onGround.* or groundInk.* on a dark surface");
});
