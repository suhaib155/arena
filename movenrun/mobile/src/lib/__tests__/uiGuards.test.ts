/**
 * UI structural guards — discovery that fails closed, and a real touch-target
 * contract.
 *
 * `designSystem.test.ts` already scans the app structurally rather than from a
 * hand-written list, which is the right shape. What it lacked was a reason to
 * believe the scan found anything. Its file-driven rules all end in
 * `assert.deepEqual(offenders, [])`, and an empty corpus produces an empty
 * offender list — so the guards pass hardest exactly when discovery is broken.
 * Proven by forcing `SCREENS = []`: two of the three file-driven guards still
 * passed, and only the Pressable rule failed, because it alone asserts a count.
 *
 * A guard that cannot tell "nothing is wrong" from "nothing was checked" is not
 * a guard. So discovery here is a contract with its own assertions, and every
 * rule below states what it inspected before stating what it found.
 *
 * Scope note: this is source-file discovery for lint-style rules. It is not
 * test discovery — PR #64 owns that, for the different question of which test
 * files execute. Neither is copied into the other.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { MIN_TOUCH_TARGET } from "../shape";

/**
 * The mobile workspace root, derived from this file's own location rather than
 * `process.cwd()`, so the corpus is identical however the suite is invoked.
 */
const MOBILE_ROOT = resolve(__dirname, "..", "..", "..");

/** The roots that hold user-visible code. Both must yield files. */
const ROOTS = ["app", join("src", "components")] as const;

/** Source extensions. `.ts` is included deliberately: a style object or a
 *  shared control helper does not have to live in a `.tsx` file, and a scan
 *  that only looks at `.tsx` is one rename away from missing it. */
const SOURCE_EXTENSIONS = [".ts", ".tsx"];

function isSource(name: string): boolean {
  return SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/**
 * Walk a directory tree deterministically.
 *
 * Three things the previous walk did not do:
 *  - **Stay inside the workspace.** Every resolved path is checked against
 *    `MOBILE_ROOT`, so a symlink pointing out of the tree cannot drag
 *    `node_modules` or a sibling package into the corpus.
 *  - **Survive symlinks.** `Dirent.isDirectory()` is false for a symlinked
 *    directory, so the old walk silently skipped one — a fail-open hole. This
 *    resolves them, and tracks real paths so a loop terminates instead of
 *    recursing forever.
 *  - **Sort.** `readdirSync` order is filesystem-dependent; sorting keeps
 *    failure messages identical on a laptop and on CI.
 */
function walk(dir: string, seen = new Set<string>(), out: string[] = []): string[] {
  let real: string;
  try {
    real = realpathSync(dir);
  } catch {
    return out; // a broken symlink is not a source file
  }
  if (seen.has(real)) return out; // symlink loop
  seen.add(real);

  // Never leave the workspace, however we got here.
  const rel = relative(MOBILE_ROOT, real);
  if (rel.startsWith("..") || resolve(real) !== real) return out;
  if (rel.split(sep).includes("node_modules")) return out;

  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = join(dir, entry.name);
    let stats: { dir: boolean };
    try {
      // Resolve through symlinks rather than trusting the dirent, which
      // reports a symlinked directory as neither file nor directory.
      stats = { dir: readdirSync(full, { withFileTypes: true }) !== undefined };
    } catch {
      stats = { dir: false };
    }
    if (stats.dir) {
      if (entry.name !== "__tests__" && entry.name !== "node_modules") walk(full, seen, out);
    } else if (isSource(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function discoverSourceFiles(): string[] {
  return ROOTS.flatMap((root) => walk(join(MOBILE_ROOT, root))).sort();
}

const SOURCES = discoverSourceFiles();
const read = (f: string) => readFileSync(f, "utf8");
const label = (f: string) => relative(MOBILE_ROOT, f);

/* ── discovery is itself under test ───────────────────────────────────────── */

test("discovery fails closed: every root yields files, and none escape the workspace", () => {
  assert.ok(SOURCES.length > 0, "discovery found no source files at all");

  for (const root of ROOTS) {
    const found = SOURCES.filter((f) => f.startsWith(join(MOBILE_ROOT, root) + sep));
    assert.ok(found.length > 0, `discovery found nothing under ${root}/ — the scan is broken`);
  }

  for (const file of SOURCES) {
    const rel = relative(MOBILE_ROOT, file);
    assert.ok(!rel.startsWith(".."), `${rel} is outside the workspace`);
    assert.ok(!rel.split(sep).includes("node_modules"), `${rel} is a dependency, not our source`);
    assert.ok(!rel.split(sep).includes("__tests__"), `${rel} is a test, not a screen`);
  }

  // Deterministic: the same order on every platform.
  assert.deepEqual(SOURCES, [...SOURCES].sort(), "discovery order is not stable");
});

test("discovery reaches both file extensions and the nested route groups", () => {
  assert.ok(
    SOURCES.some((f) => f.endsWith(".ts")),
    "no .ts file discovered — a control or style helper outside .tsx would be invisible",
  );
  assert.ok(SOURCES.some((f) => f.endsWith(".tsx")), "no .tsx file discovered");
  // Expo route groups are parenthesised directories; a walk that mishandled
  // them would silently drop the entire tab shell.
  assert.ok(
    SOURCES.some((f) => label(f).includes("(tabs)")),
    "the (tabs) route group was not discovered",
  );
  // A top-level route is `app/opening.tsx` (2 segments from the root); a
  // nested one is `app/territory/map.tsx` (3). Seeing a 3-segment path is what
  // proves the walk descends rather than listing each root once.
  assert.ok(
    SOURCES.some((f) => label(f).split(sep).length > 2),
    "no nested route discovered — the walk is not recursing",
  );
});

/* ── interactive controls ─────────────────────────────────────────────────── */

interface Control {
  file: string;
  tag: string;
  styleNames: string[];
}

/** Opening tags for a component, brace-aware so `=>` inside a prop expression
 *  cannot be mistaken for the end of the tag. */
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

/** Brace-aware style blocks, so a nested `{ ... }` cannot end one early. */
function styleBlocks(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of src.matchAll(/(\w+):\s*\{/g)) {
    let depth = 1;
    for (let i = m.index! + m[0].length; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) {
        out.set(m[1], src.slice(m.index! + m[0].length, i));
        break;
      }
    }
  }
  return out;
}

/** The components through which the app takes a press. */
const INTERACTIVE = ["Pressable", "ScalePress"] as const;

/**
 * Every component in this codebase's vocabulary that can take a press —
 * React Native's four, plus the app's own wrapper.
 *
 * {@link INTERACTIVE} is what the scanner walks; this is what the app is
 * *allowed* to use. Keeping them apart is deliberate. An earlier version
 * derived "does this file render a press?" from INTERACTIVE itself, so
 * corrupting that list made both the question and the answer wrong together
 * and the guard stayed green — a fail-open in the fail-closed check. The test
 * below compares the two, so shrinking INTERACTIVE, or reaching for a
 * `TouchableOpacity` that nothing scans, both fail loudly.
 */
const PRESS_CAPABLE = new Set([
  "Pressable",
  "TouchableOpacity",
  "TouchableHighlight",
  "TouchableWithoutFeedback",
  "ScalePress",
]);

function controlsIn(file: string): Control[] {
  const src = read(file);
  return INTERACTIVE.flatMap((component) =>
    openingTags(src, component).map((tag) => ({
      file,
      tag,
      styleNames: [...tag.matchAll(/styles\.(\w+)/g)].map((m) => m[1]),
    })),
  );
}

const ALL_CONTROLS = SOURCES.flatMap(controlsIn);

test("the control scan fails closed: nothing that renders a press goes unparsed", () => {
  assert.ok(ALL_CONTROLS.length > 0, "no interactive controls found — the tag scan is broken");

  // The real fail-closed property, and the one with no magic number in it: a
  // file that imports a press component must yield at least one parsed control.
  // If the tag parser ever stops matching, this says so per file instead of
  // quietly shrinking the corpus.
  const unparsed: string[] = [];
  for (const file of SOURCES) {
    const src = read(file);
    // Derived from the vocabulary, NOT from INTERACTIVE — see PRESS_CAPABLE.
    const rendersPress = [...PRESS_CAPABLE].some((c) => new RegExp(`<${c}\\b`).test(src));
    if (rendersPress && controlsIn(file).length === 0) unparsed.push(label(file));
  }
  assert.deepEqual(unparsed, [], "these files render a press the scanner could not read");
});

test("the scanner covers every press component the app actually renders", () => {
  const rendered = new Set<string>();
  for (const file of SOURCES) {
    for (const m of read(file).matchAll(/<([A-Z]\w*)\b/g)) {
      if (PRESS_CAPABLE.has(m[1])) rendered.add(m[1]);
    }
  }
  assert.ok(rendered.size > 0, "no press component rendered anywhere — the scan is broken");
  const unscanned = [...rendered].filter((c) => !(INTERACTIVE as readonly string[]).includes(c));
  assert.deepEqual(
    unscanned,
    [],
    "these take presses but nothing measures them — add them to INTERACTIVE",
  );
});

/* ── the touch-target contract ────────────────────────────────────────────── */

/**
 * The smallest dimension a style block pins, or `null` when the control is
 * sized by padding, flex or its content.
 *
 * `iconTile(n)` / `avatar(n)` are counted because they *are* a size — that is
 * the whole reason they exist (see lib/shape.ts).
 */
function pinnedSize(body: string): number | null {
  const sizes: number[] = [];
  const shape = body.match(/\.\.\.(?:iconTile|avatar)\((\d+)\)/);
  if (shape) sizes.push(Number(shape[1]));
  for (const prop of ["width", "height", "minWidth", "minHeight"]) {
    const m = body.match(new RegExp(`\\b${prop}:\\s*(\\d+)`));
    if (m) sizes.push(Number(m[1]));
  }
  return sizes.length ? Math.min(...sizes) : null;
}

function declaredHitSlop(tag: string): number {
  return Number(tag.match(/hitSlop=\{(\d+)\}/)?.[1] ?? 0);
}

interface Measured extends Control {
  size: number;
  hitSlop: number;
  effective: number;
}

/** Controls whose own styles pin a size — the set this contract can speak about. */
function measurable(): Measured[] {
  const out: Measured[] = [];
  for (const file of SOURCES) {
    const blocks = styleBlocks(read(file));
    for (const control of controlsIn(file)) {
      const sizes = control.styleNames
        .map((n) => blocks.get(n))
        .filter((b): b is string => b !== undefined)
        .map(pinnedSize)
        .filter((s): s is number => s !== null);
      if (!sizes.length) continue;
      const size = Math.min(...sizes);
      const hitSlop = declaredHitSlop(control.tag);
      out.push({ ...control, size, hitSlop, effective: size + 2 * hitSlop });
    }
  }
  return out;
}

const MEASURED = measurable();

test("every control that pins its own size meets the touch-target floor", () => {
  assert.ok(MEASURED.length > 0, "nothing was measured — the size scan is broken");

  const short = MEASURED.filter((c) => c.effective < MIN_TOUCH_TARGET).map(
    (c) =>
      `${label(c.file)} ${c.styleNames.join("/")}: ${c.size}pt` +
      (c.hitSlop ? ` + ${c.hitSlop}pt slop = ${c.effective}pt` : " with no hitSlop") +
      ` (floor ${MIN_TOUCH_TARGET}pt)`,
  );
  assert.deepEqual(
    short,
    [],
    "grow the control, or give it hitSlop on ScalePress/Pressable — do not shrink the floor",
  );
});

test("compact controls are compact on purpose, and say so with hitSlop", () => {
  // The interesting half of the contract: a control drawn below the floor is
  // allowed, because inflating a 32pt sheet dismiss to 44pt would distort the
  // header it sits in. What is not allowed is being small by accident.
  const compact = MEASURED.filter((c) => c.size < MIN_TOUCH_TARGET);
  assert.ok(compact.length > 0, "no compact controls found — this rule is not being exercised");
  for (const c of compact) {
    assert.ok(
      c.hitSlop > 0,
      `${label(c.file)} ${c.styleNames.join("/")} is ${c.size}pt and declares no hitSlop`,
    );
    assert.ok(c.effective >= MIN_TOUCH_TARGET);
  }
});

test("the floor is stated once, and the shared button honours it", () => {
  assert.ok(MIN_TOUCH_TARGET >= 44, "iOS HIG / Material minimum");

  // ScalePress is the shared press wrapper, so it is where a compact control
  // expresses its real target. Without this the contract would be
  // unsatisfiable for anything built on it.
  const scalePress = read(join(MOBILE_ROOT, "src", "components", "ScalePress.tsx"));
  assert.match(scalePress, /hitSlop\?: number/, "ScalePress must be able to carry a hit area");
  assert.match(scalePress, /hitSlop=\{hitSlop\}/, "…and forward it to the Pressable");

  // The shared Button pins a height of its own; it must clear the same floor.
  const button = read(join(MOBILE_ROOT, "src", "components", "Button.tsx"));
  const minHeight = Number(button.match(/minHeight:\s*(\d+)/)?.[1]);
  assert.ok(
    Number.isFinite(minHeight) && minHeight >= MIN_TOUCH_TARGET,
    `Button pins minHeight ${minHeight}, below the ${MIN_TOUCH_TARGET}pt floor`,
  );
});

test("the contract reports its own reach instead of implying full coverage", () => {
  // Most controls are sized by padding, flex or their content, and no static
  // rule can measure those — claiming otherwise would be the kind of
  // conformance claim this repo is careful not to make. The guard covers the
  // controls that pin a size; that boundary is asserted, not assumed.
  const unmeasured = ALL_CONTROLS.length - MEASURED.length;
  assert.ok(
    MEASURED.length > 0 && unmeasured >= 0,
    "the measurable/unmeasurable split is incoherent",
  );
  assert.ok(
    MEASURED.length < ALL_CONTROLS.length,
    "every control appears measurable, which means the size scan is over-claiming",
  );
  // Static size is not a WCAG result: it says nothing about the rendered
  // layout, dynamic type, or a control overlapped by a sibling. Device
  // verification stays a release gate.
});
