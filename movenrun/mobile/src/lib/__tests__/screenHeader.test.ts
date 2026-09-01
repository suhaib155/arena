/**
 * The screen header is a component, and every screen uses it.
 *
 * Twenty-four screens hand-rolled a back or close control. The *geometry* had
 * survived copy-paste — twenty declared a byte-identical `headerRow` — but
 * everything around it drifted: the glyph was 22, 24, 26 or 28pt; the back
 * control was `colors.text` while the dismiss control was `colors.textDim`;
 * the spacer that keeps the title centred was a style on most screens, an
 * inline `{ width: 24 }` on one, `{ width: 26 }` on another; one screen passed
 * `pressFade()` with no base style so its control had no size at all; and one
 * put `onPress` straight onto an `<Ionicons>`.
 *
 * And not one of the twenty-four carried an `accessibilityLabel`. The most
 * used control in the app announced nothing, on every screen that had it.
 *
 * The fix is structural rather than twenty-four edits: `ScreenHeader` supplies
 * the label by construction. These rules keep it that way — a screen cannot
 * quietly grow a twenty-fifth hand-rolled header.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { MIN_TOUCH_TARGET } from "../shape";

const MOBILE_ROOT = resolve(__dirname, "..", "..", "..");
const HEADER = join(MOBILE_ROOT, "src", "components", "ScreenHeader.tsx");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__" && entry.name !== "node_modules") walk(full, out);
    } else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const SCREENS = walk(join(MOBILE_ROOT, "app"));
const read = (f: string) => readFileSync(f, "utf8");
const label = (f: string) => relative(MOBILE_ROOT, f).split(sep).join("/");

test("discovery reaches the screens, or this file proves nothing", () => {
  assert.ok(SCREENS.length > 20, `only ${SCREENS.length} screens discovered under app/`);
  assert.ok(
    SCREENS.some((f) => label(f).includes("(tabs)")),
    "the tab route group was not discovered",
  );
  assert.ok(
    SCREENS.some((f) => label(f).split("/").length > 2),
    "no nested route discovered — the walk is not recursing",
  );
});

test("the header is actually used, on many screens", () => {
  // The counterweight to the ban below: forbidding hand-rolled headers is
  // trivially satisfiable by having no headers at all.
  const users = SCREENS.filter((f) => /<ScreenHeader\b/.test(read(f)));
  assert.ok(
    users.length >= 20,
    `only ${users.length} screens render <ScreenHeader> — the migration regressed`,
  );
  for (const file of users) {
    assert.match(
      read(file),
      /from "@\/components\/ScreenHeader"/,
      `${label(file)} renders <ScreenHeader> without importing it`,
    );
  }
});

test("no screen hand-rolls a back or dismiss control", () => {
  const offenders: string[] = [];
  for (const file of SCREENS) {
    const src = read(file);
    for (const glyph of ['name="chevron-back"', 'name="close"']) {
      if (src.includes(glyph)) offenders.push(`${label(file)}: ${glyph}`);
    }
  }
  assert.deepEqual(offenders, [], "render <ScreenHeader> instead");
});

test("no screen puts onPress on a bare icon", () => {
  /*
   * `app/quest/[id].tsx` did exactly this:
   *
   *     <Ionicons name="chevron-back" size={28} onPress={() => router.back()} />
   *
   * That is a press target with no `accessibilityRole`, no label, no press
   * feedback, and a hit area the size of the glyph. Worse, being neither
   * `Pressable` nor `ScalePress`, it was invisible to every rule in
   * `uiGuards.test.ts` — the control scan cannot report on a control it does
   * not recognise as one.
   */
  const offenders: string[] = [];
  for (const file of [...SCREENS, ...walk(join(MOBILE_ROOT, "src", "components"))]) {
    const src = read(file);
    for (const m of src.matchAll(/<(Ionicons|Text|Image|View)\b([^>]*?)\/?>/gs)) {
      if (/\bonPress=/.test(m[2])) {
        offenders.push(`${label(file)}: <${m[1]} onPress=…>`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "wrap it in Pressable or ScalePress so it has a role, a label and a target",
  );
});

/* ── the header's own contract ────────────────────────────────────────────── */

test("the header labels its control, and the label is not optional", () => {
  const src = read(HEADER);
  assert.match(src, /accessibilityRole="button"/, "the control must announce itself as a button");
  assert.match(
    src,
    /accessibilityLabel=\{actionLabel \?\? SPOKEN\[action\]\}/,
    "the label must be supplied by construction, not left to the caller",
  );
  // A default per action, so "Back" and "Close" are not the same promise.
  assert.match(src, /const SPOKEN = \{ back: "Back", dismiss: "Close" \}/);
});

test("the header's control clears the touch-target floor", () => {
  const src = read(HEADER);
  const size = Number(src.match(/const CONTROL = (\d+);/)?.[1]);
  const slop = Number(src.match(/hitSlop=\{(\d+)\}/)?.[1]);
  assert.ok(Number.isFinite(size) && Number.isFinite(slop), "the header stopped stating its size");
  assert.ok(
    size + 2 * slop >= MIN_TOUCH_TARGET,
    `${size}pt + ${slop}pt slop = ${size + 2 * slop}pt, under the ${MIN_TOUCH_TARGET}pt floor`,
  );
  // The control is deliberately drawn small; that is only allowed with slop.
  assert.ok(slop > 0, "a control below the floor must declare its real hit area");
});

test("the header reserves the trailing slot so titles do not shift between screens", () => {
  // Half the screens have a chip or a count on the right and half do not. If
  // the slot collapsed when empty, the title would sit centred on one screen
  // and off-centre on the next — which is the drift this component exists to
  // end, reappearing inside the component itself.
  const src = read(HEADER);
  assert.match(src, /trailing: \{ minWidth: CONTROL/, "the empty trailing slot must hold its width");
});

test("one glyph size and one colour, for both actions", () => {
  const src = read(HEADER);
  const sizes = [...src.matchAll(/<Ionicons[^>]*size=\{(\d+)\}/gs)].map((m) => m[1]);
  assert.equal(sizes.length, 1, "the header renders exactly one icon");
  const colours = [...src.matchAll(/<Ionicons[^>]*color=\{([\w.]+)\}/gs)].map((m) => m[1]);
  assert.deepEqual(colours, ["colors.text"], "back and dismiss are equally legible");
});
