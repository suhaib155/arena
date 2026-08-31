/**
 * Tests for the test runner itself.
 *
 * The runner is the thing that decides whether anything else runs, so a bug
 * here is worse than a bug anywhere else in the suite: it fails *open*. The
 * defect these tests exist to prevent is concrete — `node --test` silently
 * ignores paths that do not exist and exits 0, so the previous hand-listed
 * script stayed green after two of its test files were deleted.
 *
 * Everything below uses temp directories and an injected spawn seam. No real
 * child process is started and there are no timers or sleeps.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import {
  discoverTestFiles,
  formatInventory,
  INVENTORY_FILE,
  INVENTORY_SCHEMA_VERSION,
  InventoryError,
  inventoryPath,
  isValidInventoryPath,
  main,
  NODE_TEST_ARGS,
  parseArgs,
  readTestInventory,
  runDiscoveredTests,
  toPosixRelative,
  UsageError,
  validateTestInventory,
  writeTestInventory,
  type TestInventory,
} from "../../../scripts/run-tests";

const RUNNER_SOURCE = join(process.cwd(), "scripts", "run-tests.ts");

/** A throwaway workspace. Registered for cleanup on the running test. */
async function sandbox(t: { after: (fn: () => unknown) => void }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "movenrun-runner-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function addFile(root: string, relPath: string, body = "// test\n"): Promise<void> {
  const full = join(root, ...relPath.split("/"));
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, body, "utf8");
}

const inventoryOf = (files: string[]): TestInventory => ({
  schemaVersion: INVENTORY_SCHEMA_VERSION,
  files,
});

interface SpawnCall {
  command: string;
  args: readonly string[];
  options: Record<string, unknown>;
}

/**
 * Records what would have been spawned. The test drives the outcome by
 * emitting on `child`; pass `autoClose` when the call happens deep inside
 * `main()` and there is no handle to emit on at the right moment.
 */
function fakeSpawn(autoClose?: number) {
  const calls: SpawnCall[] = [];
  const child = new EventEmitter() as unknown as ChildProcess;
  const spawnFn = ((command: string, args: readonly string[], options: Record<string, unknown>) => {
    calls.push({ command, args, options });
    // setImmediate, not a timer — nothing here waits on wall-clock time.
    if (autoClose !== undefined) setImmediate(() => child.emit("close", autoClose, null));
    return child;
  }) as unknown as typeof import("node:child_process").spawn;
  return { calls, child, spawnFn };
}

// ---- 1-3: discovery --------------------------------------------------------

test("recursively discovers tests under multiple nested directories", async (t) => {
  const root = await sandbox(t);
  await addFile(root, "src/lib/__tests__/a.test.ts");
  await addFile(root, "src/store/__tests__/b.test.ts");
  await addFile(root, "src/services/__tests__/c.test.ts");
  await addFile(root, "src/deep/nested/further/__tests__/d.test.ts");
  assert.deepEqual(await discoverTestFiles(root), [
    "src/deep/nested/further/__tests__/d.test.ts",
    "src/lib/__tests__/a.test.ts",
    "src/services/__tests__/c.test.ts",
    "src/store/__tests__/b.test.ts",
  ]);
});

test("discovery order is deterministic and locale-independent", async (t) => {
  const root = await sandbox(t);
  // Names chosen so a locale-aware collator would order them differently from
  // code-unit order — `localeCompare` would sort "Z" before "a".
  for (const name of ["Z", "a", "B", "_x", "10", "2"]) {
    await addFile(root, `src/lib/__tests__/${name}.test.ts`);
  }
  const first = await discoverTestFiles(root);
  const second = await discoverTestFiles(root);
  assert.deepEqual(first, second, "repeated discovery must agree");
  assert.deepEqual(first, [...first].sort(), "plain code-unit sort");
  assert.deepEqual(first, [
    "src/lib/__tests__/10.test.ts",
    "src/lib/__tests__/2.test.ts",
    "src/lib/__tests__/B.test.ts",
    "src/lib/__tests__/Z.test.ts",
    "src/lib/__tests__/_x.test.ts",
    "src/lib/__tests__/a.test.ts",
  ]);
});

test("discovery ignores everything that is not a test file", async (t) => {
  const root = await sandbox(t);
  await addFile(root, "src/lib/__tests__/real.test.ts");
  await addFile(root, "src/lib/__tests__/helpers.ts"); // not .test.ts
  await addFile(root, "src/lib/__tests__/snapshot.test.tsx"); // wrong extension
  await addFile(root, "src/lib/notInTests.test.ts"); // not under __tests__
  await addFile(root, "src/lib/__tests__/README.md");
  await addFile(root, "scripts/__tests__/outside.test.ts"); // outside src/
  assert.deepEqual(await discoverTestFiles(root), ["src/lib/__tests__/real.test.ts"]);
});

// ---- 4-14: inventory validation -------------------------------------------

test("an exact match between disk and inventory passes", () => {
  const files = ["src/lib/__tests__/a.test.ts", "src/store/__tests__/b.test.ts"];
  const result = validateTestInventory(files, inventoryOf(files));
  assert.ok(result.ok);
  assert.deepEqual(result, {
    ok: true,
    missingFromDisk: [],
    untrackedFiles: [],
    duplicateEntries: [],
    invalidEntries: [],
  });
});

test("a tracked test that no longer exists on disk fails", () => {
  // This is the exact regression: a deleted test file must not go unnoticed.
  const result = validateTestInventory(
    ["src/lib/__tests__/a.test.ts"],
    inventoryOf(["src/lib/__tests__/a.test.ts", "src/lib/__tests__/deleted.test.ts"]),
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingFromDisk, ["src/lib/__tests__/deleted.test.ts"]);
  assert.deepEqual(result.untrackedFiles, []);
});

test("a newly added test that is not in the inventory fails", () => {
  const result = validateTestInventory(
    ["src/lib/__tests__/a.test.ts", "src/lib/__tests__/brand-new.test.ts"],
    inventoryOf(["src/lib/__tests__/a.test.ts"]),
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.untrackedFiles, ["src/lib/__tests__/brand-new.test.ts"]);
  assert.deepEqual(result.missingFromDisk, []);
});

test("a duplicated inventory entry fails", () => {
  const result = validateTestInventory(
    ["src/lib/__tests__/a.test.ts"],
    inventoryOf(["src/lib/__tests__/a.test.ts", "src/lib/__tests__/a.test.ts"]),
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.duplicateEntries, ["src/lib/__tests__/a.test.ts"]);
});

test("invalid inventory paths are rejected, each for its own reason", () => {
  const cases: [string, string][] = [
    ["src/lib/__tests__/a.spec.ts", "wrong extension"],
    ["src/lib/__tests__/a.test.tsx", "wrong extension"],
    ["app/__tests__/a.test.ts", "outside src/"],
    ["scripts/__tests__/a.test.ts", "outside src/"],
    ["src/lib/a.test.ts", "not inside a __tests__ directory"],
    ["src/lib/__tests__/../../../etc/passwd.test.ts", "path traversal"],
    ["../src/lib/__tests__/a.test.ts", "path traversal"],
    ["/abs/src/lib/__tests__/a.test.ts", "absolute"],
    ["C:/src/lib/__tests__/a.test.ts", "absolute (windows)"],
    ["src\\lib\\__tests__\\a.test.ts", "backslash separator"],
    ["./src/lib/__tests__/a.test.ts", "non-normalized"],
    ["src//lib/__tests__/a.test.ts", "empty segment"],
    ["", "empty"],
  ];
  for (const [path, why] of cases) {
    assert.equal(isValidInventoryPath(path), false, `should reject (${why}): ${path}`);
    const result = validateTestInventory([], inventoryOf([path]));
    assert.equal(result.ok, false, `validation should fail for ${why}`);
    assert.deepEqual(result.invalidEntries, [path]);
  }
  assert.equal(isValidInventoryPath("src/lib/__tests__/a.test.ts"), true);
});

test("malformed inventory JSON fails", async (t) => {
  const root = await sandbox(t);
  await writeFile(inventoryPath(root), "{ this is not json", "utf8");
  await assert.rejects(() => readTestInventory(inventoryPath(root)), InventoryError);
});

test("an unsupported schema version fails", async (t) => {
  const root = await sandbox(t);
  await writeFile(inventoryPath(root), JSON.stringify({ schemaVersion: 2, files: [] }), "utf8");
  await assert.rejects(
    () => readTestInventory(inventoryPath(root)),
    (error: Error) => error instanceof InventoryError && /schemaVersion 2/.test(error.message),
  );
});

test("a non-array or non-string files field fails", async (t) => {
  const root = await sandbox(t);
  for (const files of [{}, "src/a.test.ts", 42, null, ["ok.test.ts", 7]]) {
    await writeFile(
      inventoryPath(root),
      JSON.stringify({ schemaVersion: INVENTORY_SCHEMA_VERSION, files }),
      "utf8",
    );
    await assert.rejects(() => readTestInventory(inventoryPath(root)), InventoryError);
  }
  // A top-level array is not an object.
  await writeFile(inventoryPath(root), "[]", "utf8");
  await assert.rejects(() => readTestInventory(inventoryPath(root)), InventoryError);
});

test("a missing inventory file fails with actionable guidance", async (t) => {
  const root = await sandbox(t);
  await assert.rejects(
    () => readTestInventory(inventoryPath(root)),
    (error: Error) => error instanceof InventoryError && /test:inventory/.test(error.message),
  );
});

// ---- 15-17: zero tests, and generated output ------------------------------

test("zero discovered tests fails instead of passing vacuously", async (t) => {
  const root = await sandbox(t);
  await writeFile(inventoryPath(root), formatInventory([]), "utf8");
  assert.deepEqual(await discoverTestFiles(root), []);
  assert.equal(await main([], root), 1, "run mode must fail");
  assert.equal(await main(["--write-inventory"], root), 1, "write mode must fail too");
});

test("the generated inventory is deterministic, sorted and newline-terminated", async (t) => {
  const root = await sandbox(t);
  const unsorted = ["src/store/__tests__/b.test.ts", "src/lib/__tests__/a.test.ts"];
  await writeTestInventory(inventoryPath(root), unsorted);
  const written = await readFile(inventoryPath(root), "utf8");

  assert.ok(written.endsWith("\n"), "must end with a trailing newline");
  assert.ok(!written.endsWith("\n\n"), "exactly one trailing newline");
  assert.equal(written, formatInventory([...unsorted].reverse()), "input order is irrelevant");
  assert.deepEqual(JSON.parse(written), {
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    files: ["src/lib/__tests__/a.test.ts", "src/store/__tests__/b.test.ts"],
  });
  assert.match(written, /^\{\n {2}"schemaVersion"/, "two-space indentation");
});

// ---- 18-20: CLI ------------------------------------------------------------

test("an unknown CLI flag fails rather than being ignored", () => {
  assert.equal(parseArgs([]), "run");
  assert.equal(parseArgs(["--write-inventory"]), "write-inventory");
  for (const argv of [["--watch"], ["--write-inventory", "extra"], ["-w"], ["--write-inventory=1"]]) {
    assert.throws(() => parseArgs(argv), UsageError, `should reject: ${argv.join(" ")}`);
  }
});

test("normal mode never rewrites the inventory", async (t) => {
  const root = await sandbox(t);
  await addFile(root, "src/lib/__tests__/a.test.ts");
  // Deliberately unsorted-but-valid content, so any rewrite is visible.
  const original = `{\n  "schemaVersion": 1,\n  "files": [\n    "src/lib/__tests__/a.test.ts"\n  ]\n}\n`;
  await writeFile(inventoryPath(root), original, "utf8");

  const { calls, spawnFn } = fakeSpawn(0);
  assert.equal(await main([], root, { spawnFn }), 0, "a matching inventory runs the tests");
  assert.equal(calls.length, 1, "run mode does spawn the suite");

  assert.equal(await readFile(inventoryPath(root), "utf8"), original, "byte-identical");
});

test("run mode refuses to start the suite when the inventory disagrees", async (t) => {
  const root = await sandbox(t);
  await addFile(root, "src/lib/__tests__/a.test.ts");
  await addFile(root, "src/lib/__tests__/untracked.test.ts");
  await writeFile(inventoryPath(root), formatInventory(["src/lib/__tests__/a.test.ts"]), "utf8");

  const { calls, spawnFn } = fakeSpawn(0);
  assert.equal(await main([], root, { spawnFn }), 1, "must fail");
  assert.equal(calls.length, 0, "and must fail BEFORE running a single test");
});

test("write mode writes the inventory and runs no tests", async (t) => {
  const root = await sandbox(t);
  await addFile(root, "src/lib/__tests__/a.test.ts");
  await addFile(root, "src/store/__tests__/b.test.ts");
  const before = readFileSync(join(root, "src/lib/__tests__/a.test.ts"), "utf8");

  const { calls, spawnFn } = fakeSpawn(0);
  assert.equal(await main(["--write-inventory"], root, { spawnFn }), 0);
  assert.equal(calls.length, 0, "write mode must never spawn a test process");

  assert.deepEqual(JSON.parse(await readFile(inventoryPath(root), "utf8")), {
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    files: ["src/lib/__tests__/a.test.ts", "src/store/__tests__/b.test.ts"],
  });
  // No source or test file was touched, and no package file was created.
  assert.equal(readFileSync(join(root, "src/lib/__tests__/a.test.ts"), "utf8"), before);
  await assert.rejects(() => readFile(join(root, "package.json"), "utf8"));
});

// ---- 21-26: child process --------------------------------------------------

test("the child receives the node test flags and every discovered file", async () => {
  const files = ["src/lib/__tests__/a.test.ts", "src/store/__tests__/b.test.ts"];
  const { calls, child, spawnFn } = fakeSpawn();
  const pending = runDiscoveredTests(files, { spawnFn, execPath: "/fake/node", cwd: "/wd" });
  child.emit("close", 0, null);
  assert.equal(await pending, 0);

  assert.equal(calls.length, 1, "exactly one child");
  const call = calls[0]!;
  assert.equal(call.command, "/fake/node", "invokes process.execPath, not the string 'node'");
  assert.deepEqual(call.args, [...NODE_TEST_ARGS, ...files]);
  assert.deepEqual([...NODE_TEST_ARGS], ["--import", "tsx", "--test"]);
  for (const file of files) assert.ok(call.args.includes(file), `${file} must be passed`);
});

test("child arguments are an array and shell execution is disabled", async () => {
  const { calls, child, spawnFn } = fakeSpawn();
  const pending = runDiscoveredTests(["src/lib/__tests__/a b.test.ts"], { spawnFn });
  child.emit("close", 0, null);
  await pending;

  const call = calls[0]!;
  assert.ok(Array.isArray(call.args), "arguments must be an array, never one command string");
  assert.equal(call.options.shell, undefined, "shell must never be enabled");
  // A path with a space survives verbatim precisely because no shell re-parses it.
  assert.deepEqual(call.args.slice(-1), ["src/lib/__tests__/a b.test.ts"]);
});

test("the runner source never builds a shell command", () => {
  // A source guard, because switching to `shell: true` or an interpolated
  // command string would still pass every behavioural test above.
  const source = readFileSync(RUNNER_SOURCE, "utf8");
  assert.ok(!/shell:\s*true/.test(source), "shell: true is forbidden");
  assert.ok(!/\bexecSync\b|\bexec\(/.test(source), "exec() re-introduces a shell");
  assert.ok(!/spawnSync/.test(source), "spawnSync would block the event loop");
  assert.match(source, /process\.execPath/, "must invoke the current Node binary");
  assert.match(source, /\[\.\.\.NODE_TEST_ARGS, \.\.\.files\]/, "arguments stay an array");
});

test("a non-zero child exit code is propagated", async () => {
  for (const code of [1, 7, 255]) {
    const { child, spawnFn } = fakeSpawn();
    const pending = runDiscoveredTests(["src/lib/__tests__/a.test.ts"], { spawnFn });
    child.emit("close", code, null);
    assert.equal(await pending, code, `exit ${code} must survive`);
  }
});

test("a null exit code is treated as failure, not success", async () => {
  const { child, spawnFn } = fakeSpawn();
  const pending = runDiscoveredTests(["src/lib/__tests__/a.test.ts"], { spawnFn });
  child.emit("close", null, null);
  assert.equal(await pending, 1, "unknown outcome must never read as a pass");
});

test("a spawn error is propagated rather than swallowed", async () => {
  const { child, spawnFn } = fakeSpawn();
  const pending = runDiscoveredTests(["src/lib/__tests__/a.test.ts"], { spawnFn });
  const failure = new Error("spawn ENOENT");
  child.emit("error", failure);
  await assert.rejects(() => pending, /spawn ENOENT/);
});

test("a child killed by a signal reports the conventional 128 + signal code", async () => {
  const { child, spawnFn } = fakeSpawn();
  const pending = runDiscoveredTests(["src/lib/__tests__/a.test.ts"], { spawnFn });
  child.emit("close", null, "SIGTERM");
  const code = await pending;
  assert.equal(code, 128 + 15, "SIGTERM is 15");
  assert.notEqual(code, 0, "a killed run is never a pass");
});

// ---- the real workspace ----------------------------------------------------

test("this workspace's inventory matches what is actually on disk", async () => {
  // The end-to-end contract: if someone adds or deletes a test without running
  // `yarn test:inventory`, this fails here as well as in the runner.
  const root = process.cwd();
  const discovered = await discoverTestFiles(root);
  const inventory = await readTestInventory(inventoryPath(root));
  const result = validateTestInventory(discovered, inventory);
  assert.deepEqual(result.missingFromDisk, []);
  assert.deepEqual(result.untrackedFiles, []);
  assert.deepEqual(result.duplicateEntries, []);
  assert.deepEqual(result.invalidEntries, []);
  assert.ok(discovered.length > 0, "the workspace must have tests");
  assert.ok(
    discovered.includes(`${"src/lib/__tests__"}/testDiscovery.test.ts`),
    "the runner's own tests must be discovered",
  );
  assert.equal(toPosixRelative(root, join(root, "src", "x.ts")), "src/x.ts");
  assert.equal(INVENTORY_FILE, "test-inventory.json");
});
