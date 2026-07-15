#!/usr/bin/env node
// Verifies the active `yarn` matches the repo's single source of truth for
// the package-manager version: package.json's "packageManager" field.
//
// Zero dependencies (Node built-ins only), no network calls, prints no
// secrets. Intended to run right after `corepack enable` in CI, before any
// install step, so a version drift fails fast instead of silently installing
// with the wrong Yarn.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootPackageJsonPath = join(scriptDir, "..", "package.json");

function fail(message) {
  console.error(`verify-package-manager: ${message}`);
  process.exit(1);
}

let rootPackageJson;
try {
  rootPackageJson = JSON.parse(readFileSync(rootPackageJsonPath, "utf8"));
} catch (err) {
  fail(`could not read/parse ${rootPackageJsonPath}: ${err.message}`);
}

const packageManager = rootPackageJson.packageManager;
const match = typeof packageManager === "string" && packageManager.match(/^yarn@(\d+\.\d+\.\d+)$/);
if (!match) {
  fail(
    `root package.json's "packageManager" must look like "yarn@X.Y.Z", ` +
      `got: ${JSON.stringify(packageManager)}`,
  );
}
const expectedVersion = match[1];

let actualVersion;
try {
  actualVersion = execFileSync("yarn", ["--version"], { encoding: "utf8" }).trim();
} catch (err) {
  fail(`failed to run "yarn --version" (is Corepack enabled?): ${err.message}`);
}

console.log(`Expected Yarn: ${expectedVersion}`);
console.log(`Actual Yarn:   ${actualVersion}`);

if (actualVersion !== expectedVersion) {
  fail(
    `Yarn version mismatch — expected ${expectedVersion} (from ` +
      `package.json's "packageManager"), got ${actualVersion}.`,
  );
}

console.log("verify-package-manager: OK");
