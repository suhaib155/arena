/**
 * Mobile test runner — fail-closed discovery.
 *
 * The old `test` script listed every test file by hand. That is unsafe in a way
 * that is easy to miss: `node --test` **silently ignores paths that do not
 * exist** and still exits 0. Reproduced on Node v22.22.2:
 *
 *     $ node --import tsx --test src/lib/__tests__/firstRun.test.ts \
 *                               src/lib/__tests__/DOES_NOT_EXIST.test.ts
 *     # tests 16 / # pass 16 / # fail 0        exit 0, stderr empty
 *
 * So a deleted test file leaves the suite green and says nothing. That is
 * exactly what happened once already: two test files were removed and their
 * paths stayed in the script.
 *
 * The fix is two independent mechanisms:
 *
 *  1. **Discovery drives execution.** What runs is whatever is on disk under
 *     `src/**./__tests__/*.test.ts`. A file cannot be silently skipped because
 *     nothing names files any more.
 *  2. **A tracked inventory makes the set reviewable.** `test-inventory.json`
 *     is committed, so adding or deleting a test shows up as a diff a human has
 *     to approve. It is compared against disk before anything runs.
 *
 * The inventory is a *contract*, never the execution source. If it disagreed
 * with disk and we ran the inventory, we would have rebuilt the original bug.
 *
 * Exit is non-zero whenever the two disagree, the inventory is malformed, or
 * zero tests are found. There is no mode in which a missing test is tolerated.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { constants as osConstants } from "node:os";
import { join, relative, resolve, sep } from "node:path";

/**
 * The mobile workspace root, derived from this file's own location rather than
 * `process.cwd()` — so the runner behaves the same however it is invoked (yarn
 * workspace script, CI, or by absolute path).
 *
 * `__dirname` and not `import.meta.url`: this workspace compiles with
 * `module: es6` (from `expo/tsconfig.base`), under which `tsc` rejects
 * `import.meta` outright, while `package.json` declares no `"type": "module"`,
 * so tsx emits CommonJS at runtime. `__dirname` is therefore both the valid
 * type-check and the correct runtime value; `@types/node` declares it.
 */
export const MOBILE_ROOT = resolve(__dirname, "..");

/** Only `src/` is searched. */
export const SOURCE_DIR = "src";
/** A test must live inside a directory with this name. */
export const TESTS_DIR = "__tests__";
/** …and carry this suffix. */
export const TEST_SUFFIX = ".test.ts";

export const INVENTORY_FILE = "test-inventory.json";
export const INVENTORY_SCHEMA_VERSION = 1;

export interface TestInventory {
  schemaVersion: typeof INVENTORY_SCHEMA_VERSION;
  files: string[];
}

export interface InventoryValidation {
  ok: boolean;
  /** Tracked in the inventory, absent from disk — i.e. a deleted test. */
  missingFromDisk: string[];
  /** Present on disk, absent from the inventory — i.e. an unreviewed test. */
  untrackedFiles: string[];
  duplicateEntries: string[];
  invalidEntries: string[];
}

/** A problem with the inventory file itself (unreadable, malformed, wrong
 *  schema). Distinct from a *disagreement*, which is an InventoryValidation. */
export class InventoryError extends Error {}

/** A bad command line. Distinct so the CLI can print usage rather than a stack. */
export class UsageError extends Error {}

/* ── paths ─────────────────────────────────────────────────────────────── */

/**
 * The one path normalization in this module: absolute → workspace-relative,
 * POSIX separators, so discovery output and inventory entries are directly
 * comparable on every platform.
 */
export function toPosixRelative(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join("/");
}

/**
 * Whether a string is acceptable as an inventory entry.
 *
 * Deliberately strict: the inventory is compared against discovery output, and
 * a path that could be written two ways (`./src/…`, `src\…`, `src/a/../b`)
 * would compare unequal to a discovered path that means the same file, and the
 * failure would look like a phantom drift rather than a formatting mistake.
 */
export function isValidInventoryPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.includes("\\")) return false; // Windows separator — POSIX only
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false; // absolute
  if (value.includes("//")) return false;
  const segments = value.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return false; // traversal
  if (segments[0] !== SOURCE_DIR) return false; // must live under src/
  if (!segments.includes(TESTS_DIR)) return false; // …inside a __tests__ dir
  if (!value.endsWith(TEST_SUFFIX)) return false;
  return true;
}

/* ── discovery ─────────────────────────────────────────────────────────── */

async function walk(dir: string, root: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    // A missing src/ is a real problem, but it surfaces as "zero tests
    // discovered" in main(), which is a clearer message than an ENOENT stack.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    // Symlinks are never followed. That closes traversal loops and is also the
    // reason a link cannot smuggle a path outside the workspace into the set.
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, root, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(TEST_SUFFIX)) continue;
    if (!full.split(sep).includes(TESTS_DIR)) continue;
    const rel = toPosixRelative(root, full);
    // Belt and braces: a path that escaped the root would start with "..".
    if (rel.startsWith("..") || rel.length === 0) {
      throw new Error(`Discovered test outside the workspace: ${full}`);
    }
    out.push(rel);
  }
}

/**
 * Every test file under `<root>/src`, workspace-relative, sorted.
 *
 * Sorting is plain `Array#sort` (UTF-16 code-unit order) and NOT
 * `localeCompare`, which varies with the machine's locale and would make the
 * generated inventory differ between a developer's machine and CI.
 */
export async function discoverTestFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  await walk(resolve(root, SOURCE_DIR), root, found);
  const seen = new Set<string>();
  for (const file of found) {
    if (seen.has(file)) throw new Error(`Duplicate discovered test file: ${file}`);
    seen.add(file);
  }
  return found.sort();
}

/* ── inventory ─────────────────────────────────────────────────────────── */

export function inventoryPath(root: string): string {
  return join(root, INVENTORY_FILE);
}

export async function readTestInventory(path: string): Promise<TestInventory> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new InventoryError(`Cannot read ${INVENTORY_FILE}. Run: yarn test:inventory`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new InventoryError(`${INVENTORY_FILE} is not valid JSON.`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new InventoryError(`${INVENTORY_FILE} must contain a JSON object.`);
  }
  const record = parsed as Record<string, unknown>;
  if (record.schemaVersion !== INVENTORY_SCHEMA_VERSION) {
    throw new InventoryError(
      `${INVENTORY_FILE} has schemaVersion ${String(record.schemaVersion)}; ` +
        `this runner supports ${INVENTORY_SCHEMA_VERSION}.`,
    );
  }
  if (!Array.isArray(record.files) || !record.files.every((f) => typeof f === "string")) {
    throw new InventoryError(`${INVENTORY_FILE}: "files" must be an array of strings.`);
  }
  return { schemaVersion: INVENTORY_SCHEMA_VERSION, files: record.files as string[] };
}

/**
 * Compare what is on disk with what is tracked.
 *
 * Order is not compared — the inventory is normalized for comparison, and
 * `writeTestInventory` sorts on write — so a reordered file is not a failure,
 * but a changed *set* always is.
 */
export function validateTestInventory(
  discovered: string[],
  inventory: TestInventory,
): InventoryValidation {
  const invalidEntries: string[] = [];
  const duplicateEntries: string[] = [];
  const valid = new Set<string>();

  for (const entry of inventory.files) {
    if (!isValidInventoryPath(entry)) {
      if (!invalidEntries.includes(entry)) invalidEntries.push(entry);
      continue;
    }
    if (valid.has(entry)) {
      if (!duplicateEntries.includes(entry)) duplicateEntries.push(entry);
      continue;
    }
    valid.add(entry);
  }

  const onDisk = new Set(discovered);
  const missingFromDisk = [...valid].filter((f) => !onDisk.has(f)).sort();
  const untrackedFiles = discovered.filter((f) => !valid.has(f)).sort();

  return {
    ok:
      missingFromDisk.length === 0 &&
      untrackedFiles.length === 0 &&
      duplicateEntries.length === 0 &&
      invalidEntries.length === 0,
    missingFromDisk,
    untrackedFiles,
    duplicateEntries: duplicateEntries.sort(),
    invalidEntries: invalidEntries.sort(),
  };
}

/** Two-space JSON with a trailing newline, sorted — so the file is stable and
 *  a regenerated inventory diffs cleanly. */
export function formatInventory(files: string[]): string {
  const inventory: TestInventory = {
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    files: [...files].sort(),
  };
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

export async function writeTestInventory(path: string, files: string[]): Promise<void> {
  await writeFile(path, formatInventory(files), "utf8");
}

/* ── execution ─────────────────────────────────────────────────────────── */

export interface RunOptions {
  cwd?: string;
  /** Injected only by tests. */
  spawnFn?: typeof spawn;
  execPath?: string;
}

/** Fixed prefix for the child. Exported so a test can assert it exactly. */
export const NODE_TEST_ARGS = ["--import", "tsx", "--test"] as const;

/**
 * Run every discovered file in one Node test process.
 *
 * Arguments go as an **array** and `shell` is never enabled, so a path
 * containing a space, quote or shell metacharacter is passed through verbatim
 * instead of being re-parsed by a shell. Building one interpolated command
 * string here would be the classic injection shape, and with file paths as
 * input it is avoidable at zero cost.
 */
export function runDiscoveredTests(files: string[], options: RunOptions = {}): Promise<number> {
  const spawnImpl = options.spawnFn ?? spawn;
  return new Promise<number>((resolvePromise, rejectPromise) => {
    let child: ChildProcess;
    try {
      child = spawnImpl(options.execPath ?? process.execPath, [...NODE_TEST_ARGS, ...files], {
        cwd: options.cwd ?? MOBILE_ROOT,
        stdio: "inherit",
      });
    } catch (error) {
      rejectPromise(error);
      return;
    }
    // A spawn failure (missing binary, EACCES) arrives as an event, not a throw.
    child.on("error", rejectPromise);
    child.on("close", (code, signal) => {
      if (signal) {
        // Conventional shell encoding, so a killed child is never mistaken for
        // a pass just because `code` was null.
        const numbers = osConstants.signals as unknown as Record<string, number | undefined>;
        resolvePromise(128 + (numbers[signal] ?? 0));
        return;
      }
      resolvePromise(code ?? 1);
    });
  });
}

/* ── CLI ───────────────────────────────────────────────────────────────── */

export type CliMode = "run" | "write-inventory";

/** The only flag this runner accepts. Anything else is a mistake worth failing
 *  on — a silently-ignored flag is how you end up not running what you meant. */
export function parseArgs(argv: readonly string[]): CliMode {
  if (argv.length === 0) return "run";
  if (argv.length === 1 && argv[0] === "--write-inventory") return "write-inventory";
  throw new UsageError(
    `Unknown argument(s): ${argv.join(" ")}\n` +
      `Usage: run-tests.ts [--write-inventory]`,
  );
}

function reportValidation(result: InventoryValidation): void {
  // Only the sections that actually have content, so the real problem is not
  // buried under empty headings.
  const section = (title: string, items: string[]) => {
    if (items.length === 0) return;
    console.error(`\n${title}`);
    for (const item of items) console.error(`  ${item}`);
  };
  console.error(`${INVENTORY_FILE} does not match the test files on disk.`);
  section("Missing from disk:", result.missingFromDisk);
  section("Untracked test files:", result.untrackedFiles);
  section("Duplicate inventory entries:", result.duplicateEntries);
  section("Invalid inventory entries:", result.invalidEntries);
  console.error(`\nIf this change is intended, run: yarn test:inventory`);
}

export async function main(
  argv: readonly string[],
  root: string = MOBILE_ROOT,
  /** Injected only by the runner's own tests, so they can assert what would be
   *  spawned without starting a second test process. */
  options: Pick<RunOptions, "spawnFn"> = {},
): Promise<number> {
  const mode = parseArgs(argv);

  const discovered = await discoverTestFiles(root);
  if (discovered.length === 0) {
    console.error(
      `No test files discovered under ${SOURCE_DIR}/. ` +
        `Expected ${SOURCE_DIR}/**/${TESTS_DIR}/*${TEST_SUFFIX}.`,
    );
    return 1;
  }

  if (mode === "write-inventory") {
    // Writes the inventory and nothing else — no tests run, no other file
    // touched. Regenerating must never be a way to accidentally "pass".
    await writeTestInventory(inventoryPath(root), discovered);
    console.log(`Wrote ${INVENTORY_FILE} with ${discovered.length} test files.`);
    return 0;
  }

  const inventory = await readTestInventory(inventoryPath(root));
  const validation = validateTestInventory(discovered, inventory);
  if (!validation.ok) {
    reportValidation(validation);
    return 1;
  }

  return runDiscoveredTests(discovered, { cwd: root, spawnFn: options.spawnFn });
}

/* Explicit entry guard: importing this module must not run anything, so the
   unit tests can exercise the functions above without spawning a suite.
   CommonJS form, for the same reason `__dirname` is used above. */
if (require.main === module) {
  void (async () => {
    try {
      process.exitCode = await main(process.argv.slice(2));
    } catch (error) {
      if (error instanceof UsageError || error instanceof InventoryError) {
        console.error(error.message);
      } else {
        // Unexpected failures keep their stack — they are bugs, not usage.
        console.error(error);
      }
      process.exitCode = 1;
    }
  })();
}
