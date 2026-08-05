/**
 * Design-system consistency — the rules that kept getting broken by hand.
 *
 * Three classes of visual bug motivated these, all of them reported as "the UI
 * looks wrong when I tap things":
 *
 *  1. The same kind of control rendered as a circle on one screen and a
 *     rounded square on another, because every icon container used the same
 *     absolute `radius.md` (16) regardless of its size — which reads as a
 *     circle at 24px and as a square at 48px.
 *  2. Tapping a card applied a 2px border that had not been reserved, so the
 *     card grew 4px and reflowed its row the moment it was selected.
 *  3. Half the tappable surfaces were bare `Pressable`s with no feedback at
 *     all, so identical-looking rows responded to touch on one screen and felt
 *     dead on the next.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  avatar,
  ICON_TILE_RATIO,
  iconTile,
  MIN_TOUCH_TARGET,
  selectionRing,
  tileRadius,
} from "../shape";

const APP = join(process.cwd(), "app");
const SRC = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") walk(full, out);
    } else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const SCREENS = [...walk(APP), ...walk(SRC)];
const read = (f: string) => readFileSync(f, "utf8");

/** Opening `<Pressable ...>` tags, brace-aware so a `=>` inside a prop
 *  expression cannot be mistaken for the end of the tag. */
function pressableTags(src: string): string[] {
  const tags: string[] = [];
  for (const m of src.matchAll(/<Pressable\b/g)) {
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

// ---- shape ------------------------------------------------------------------

test("icon tiles keep the same optical corner at every size", () => {
  // The bug: one absolute radius for all sizes. The rule: radius scales, so a
  // small tile and a large tile belong to the same family.
  assert.equal(tileRadius(24), 8);
  assert.equal(tileRadius(48), 15);
  // Every size sits on the same ratio, to within the half-pixel that rounding
  // to an integer radius can cost.
  for (const size of [20, 24, 28, 32, 38, 42, 44, 48, 56, 72]) {
    const drift = Math.abs(tileRadius(size) / size - ICON_TILE_RATIO);
    assert.ok(drift <= 0.5 / size, `${size}px drifts from the ratio by ${drift.toFixed(4)}`);
  }
  // Never so round that a tile becomes a circle.
  for (const size of [20, 24, 32, 38, 42, 56, 72]) {
    assert.ok(tileRadius(size) < size / 2, `${size}px tile must not be a circle`);
  }
});

test("iconTile and avatar are the only two shapes, and they differ", () => {
  const tile = iconTile(44);
  const round = avatar(44);
  assert.equal(round.borderRadius, 22, "avatar is a true circle");
  assert.ok((tile.borderRadius as number) < 22, "a tile is never a circle");
  for (const s of [tile, round]) {
    assert.equal(s.width, 44);
    assert.equal(s.height, 44, "always square before rounding");
    assert.equal(s.alignItems, "center");
    assert.equal(s.justifyContent, "center");
  }
});

test("no screen hand-rolls a square icon container any more", () => {
  const offenders: string[] = [];
  for (const file of SCREENS) {
    const src = read(file);
    // A centred box with equal width/height and its own borderRadius is the
    // shape iconTile()/avatar() exist to own.
    const blocks = src.matchAll(/(\w+):\s*\{([^{}]*?)\}/gs);
    for (const [, name, body] of blocks) {
      const w = body.match(/width:\s*(\d+)\s*,/);
      const h = body.match(/height:\s*(\d+)\s*,/);
      const r = /borderRadius:/.test(body);
      const centred = body.includes('alignItems: "center"') && body.includes('justifyContent: "center"');
      if (w && h && r && centred && w[1] === h[1] && Number(w[1]) >= 20) {
        offenders.push(`${file.replace(process.cwd(), "")}: ${name}`);
      }
    }
  }
  assert.deepEqual(offenders, [], "use iconTile(size) or avatar(size) instead");
});

// ---- card surfaces ----------------------------------------------------------

/** Style blocks, brace-aware so a nested `{ width, height }` doesn't end one. */
function styleBlocks(src: string): [string, string][] {
  const out: [string, string][] = [];
  for (const m of src.matchAll(/(\w+):\s*\{/g)) {
    let depth = 1;
    const start = m.index! + m[0].length;
    for (let i = start; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) {
        out.push([m[1], src.slice(start, i)]);
        break;
      }
    }
  }
  return out;
}

test("anything that floats above the page uses a card radius", () => {
  // A shadow is the app saying "this is a card". Cards had drifted across four
  // different radii, which is why the same list row looked softer on one screen
  // than the next. Shadowless things — inputs, inset panels, tiny badges — are
  // their own families and are deliberately not covered by this rule.
  const CARD_RADII = ["radius.lg", "radius.xl", "radius.pill"];
  const offenders: string[] = [];
  for (const file of SCREENS) {
    for (const [name, body] of styleBlocks(read(file))) {
      if (!/\.\.\.shadows\.(card|float)/.test(body)) continue;
      const radius = body.match(/borderRadius:\s*([\w.]+)/)?.[1];
      if (radius && !CARD_RADII.includes(radius)) {
        offenders.push(`${file.replace(process.cwd(), "")}: ${name} (${radius})`);
      }
    }
  }
  assert.deepEqual(offenders, [], `use ${CARD_RADII.join(" / ")}, or drop the shadow`);
});

test("the Card primitive is the only place card geometry is defined", () => {
  const card = read(join(SRC, "components", "Card.tsx"));
  // Three variants, no more: standard, hero, flat. A fourth is how a design
  // system starts meaning nothing.
  for (const variant of ["standard", "hero", "flat"]) {
    assert.ok(card.includes(`${variant}: {`), `Card lost its ${variant} variant`);
  }
  assert.ok(!/shadows\.float/.test(read(join(SRC, "components", "TaskRow.tsx"))),
    "rows are standard cards — only the spotlight floats");
});

// ---- selection --------------------------------------------------------------

test("a selection outline never changes an element's size", () => {
  const on = selectionRing(true, "#246BFE");
  const off = selectionRing(false, "#246BFE");
  assert.equal(on.borderWidth, off.borderWidth, "the border is always reserved");
  assert.equal(off.borderColor, "transparent", "it is merely invisible when unselected");
  assert.notEqual(on.borderColor, "transparent");
});

test("no screen adds a border only in its selected state", () => {
  for (const file of SCREENS) {
    const src = read(file);
    for (const [, body] of src.matchAll(/\w*(?:Selected|Active)\w*:\s*\{([^{}]*)\}/g)) {
      assert.ok(
        !/borderWidth:/.test(body),
        `${file}: a selected-only borderWidth shifts layout — use selectionRing()`,
      );
    }
  }
});

// ---- press feedback ---------------------------------------------------------

test("every Pressable gives press feedback", () => {
  const dead: string[] = [];
  let total = 0;
  for (const file of SCREENS) {
    // ScalePress is the component that owns the OTHER feedback mode (it
    // springs); the test below pins that it must not also fade.
    if (file.endsWith("ScalePress.tsx")) continue;
    for (const tag of pressableTags(read(file))) {
      total += 1;
      if (!tag.includes("pressFade")) dead.push(`${file.replace(process.cwd(), "")}`);
    }
  }
  assert.ok(total > 40, `expected the full pressable surface, saw ${total}`);
  assert.deepEqual([...new Set(dead)], [], "wrap the style in pressFade()");
});

test("ScalePress owns its own feedback and does not also fade", () => {
  const src = read(join(SRC, "components", "ScalePress.tsx"));
  assert.ok(!/pressFade/.test(src), "springing AND fading is double feedback");
  assert.match(src, /springTo/);
});

test("the shared touch-target floor is a real minimum", () => {
  assert.ok(MIN_TOUCH_TARGET >= 44, "iOS HIG / Material minimum");
});
