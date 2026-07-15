// CURRENT TOOLING INVARIANT — no runnable mainnet deployment command exists.
//
// A STATIC, local-only test. It reads `contracts/package.json` and
// `scripts/deploy/baseSepolia.ts` as text/JSON and asserts facts about their
// content. It performs NO network requests, imports NO deployer keys,
// executes NO Hardhat deployment, and creates NO deployment artifact.
//
// This is the CURRENT-STATE counterpart to the HISTORICAL characterization in
// test/v1-characterization/05-deploy-script.char.test.ts (known discrepancy
// #16): that file documents the defect that existed and was fixed; this file
// guards that the fix stays in place going forward. See
// docs/CONTRACT_V1_DISCREPANCIES.md and docs/CONTRACTS_AUDIT.md.
import { expect } from "chai";
import fs from "fs";
import path from "path";

const CONTRACTS_ROOT = path.join(__dirname, "..", "..");
const PACKAGE_JSON_PATH = path.join(CONTRACTS_ROOT, "package.json");
const BASE_SEPOLIA_SCRIPT_PATH = "scripts/deploy/baseSepolia.ts";
const BASE_SEPOLIA_SCRIPT_ABS_PATH = path.join(CONTRACTS_ROOT, BASE_SEPOLIA_SCRIPT_PATH);

function readPackageJson(filePath: string): any {
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`deploymentCommands.test.ts: failed to parse ${filePath} as JSON: ${(err as Error).message}`);
  }
}

describe("current tooling invariant — deployment command safety (static, no network)", function () {
  const pkg = readPackageJson(PACKAGE_JSON_PATH);
  const scripts: Record<string, string> = pkg.scripts ?? {};
  const sepoliaScript = fs.readFileSync(BASE_SEPOLIA_SCRIPT_ABS_PATH, "utf8");

  it("1. contracts/package.json has no deploy:mainnet command", function () {
    expect(scripts).to.not.have.property("deploy:mainnet");
  });

  it("2. no package command invokes baseSepolia.ts with --network baseMainnet", function () {
    for (const [name, command] of Object.entries(scripts)) {
      if (command.includes(BASE_SEPOLIA_SCRIPT_PATH)) {
        expect(command, `script "${name}"`).to.not.contain("--network baseMainnet");
      }
    }
    // Also guard the raw string generally, independent of which script it's on.
    for (const [name, command] of Object.entries(scripts)) {
      expect(command, `script "${name}" must not reference baseMainnet at all`).to.not.contain("baseMainnet");
    }
  });

  it("3. the Base Sepolia command invokes the Base Sepolia script only with --network baseSepolia", function () {
    const sepoliaCommands = Object.entries(scripts).filter(([, command]) =>
      command.includes(BASE_SEPOLIA_SCRIPT_PATH),
    );
    expect(sepoliaCommands.length, "at least one command must run the Base Sepolia script").to.be.greaterThan(0);
    for (const [name, command] of sepoliaCommands) {
      expect(command, `script "${name}"`).to.contain("--network baseSepolia");
      // No other --network flag may appear on a command that runs this script.
      const networkFlags = command.match(/--network\s+\S+/g) ?? [];
      expect(networkFlags, `script "${name}" must specify exactly one --network flag`).to.have.lengthOf(1);
      expect(networkFlags[0]).to.equal("--network baseSepolia");
    }
  });

  it("4. the Base Sepolia script writes only deployments/baseSepolia.json", function () {
    const writeCalls = [...sepoliaScript.matchAll(/writeFileSync\(([^,]+),/g)];
    expect(writeCalls.length, "expected exactly one fs.writeFileSync call").to.equal(1);

    // The single writeFileSync target must resolve to deployments/baseSepolia.json —
    // confirmed via the outDir/outFile construction, not by executing the script.
    expect(sepoliaScript).to.match(/outDir\s*=\s*path\.join\(__dirname,\s*["']\.\.\/\.\.\/deployments["']\)/);
    expect(sepoliaScript).to.match(/outFile\s*=\s*path\.join\(outDir,\s*["']baseSepolia\.json["']\)/);

    // No other .json output filename literal appears anywhere in the script.
    const jsonLiterals = [...sepoliaScript.matchAll(/["'][\w./-]*\.json["']/g)].map((m) => m[0]);
    for (const literal of jsonLiterals) {
      expect(literal, "the only .json filename literal must be baseSepolia.json").to.contain("baseSepolia.json");
    }
  });

  it("5. the script's recorded chain ID is 84532", function () {
    expect(sepoliaScript).to.match(/chainId:\s*84532\b/);
    // No other numeric chainId literal is written into the saved record.
    const chainIdLiterals = [...sepoliaScript.matchAll(/chainId:\s*(\d+)/g)].map((m) => m[1]);
    expect(chainIdLiterals).to.deep.equal(chainIdLiterals.map(() => "84532"));
  });

  it("6. no command can use the current Base Sepolia script to write a misleading artifact while connected to Base mainnet", function () {
    // This is the composite guarantee of checks 1-5: the ONLY command that
    // runs baseSepolia.ts uses --network baseSepolia (never baseMainnet or
    // any other network alias), and the script it runs is hardcoded to label
    // its output as Base Sepolia (network/chainId/filename) regardless of
    // which network a caller might otherwise connect to. Since no command
    // pairs this script with a non-Sepolia --network flag, there is no way
    // for a caller using only package.json commands to produce a
    // "baseSepolia"-labelled artifact while actually connected to mainnet.
    const commandsRunningSepoliaScript = Object.entries(scripts).filter(([, command]) =>
      command.includes(BASE_SEPOLIA_SCRIPT_PATH),
    );
    for (const [, command] of commandsRunningSepoliaScript) {
      expect(command).to.contain("--network baseSepolia");
      expect(command).to.not.contain("--network baseMainnet");
      expect(command).to.not.contain("--network base ");
      expect(command.trim().endsWith("--network base")).to.equal(false);
    }
    // And there is no separate, hidden mainnet-labelled script file at all.
    const deployDir = path.join(CONTRACTS_ROOT, "scripts", "deploy");
    const deployFiles = fs.readdirSync(deployDir);
    expect(deployFiles).to.not.include("baseMainnet.ts");
    expect(deployFiles).to.not.include("mainnet.ts");
  });
});
