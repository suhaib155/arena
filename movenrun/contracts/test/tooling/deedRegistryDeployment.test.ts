/**
 * DeedRegistry deployment safety — static, local-only.
 *
 * Reads the deployment script and `package.json` as text. Performs no network
 * request, imports no key, deploys nothing.
 *
 * The invariant it guards is the one PR #49 established and this sprint must
 * not quietly undo: **there is no command that deploys to mainnet by
 * accident.** A mainnet deployment has to be typed out in full, with an
 * explicit target, and the script itself has to agree with the live chain
 * before it will spend anything.
 */
import { expect } from "chai";
import fs from "fs";
import path from "path";

const ROOT = path.join(__dirname, "..", "..");
const SCRIPT_PATH = path.join(ROOT, "scripts", "deploy", "deedRegistry.ts");
const script = fs.readFileSync(SCRIPT_PATH, "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const scripts: Record<string, string> = pkg.scripts ?? {};

describe("DeedRegistry deployment safety (static, no network)", () => {
  it("has no package command that can reach mainnet", () => {
    for (const [name, command] of Object.entries(scripts)) {
      if (!command.includes("deedRegistry.ts")) continue;
      expect(command, `script "${name}"`).to.contain("--network baseSepolia");
      expect(command, `script "${name}" must not name a mainnet network`).to.not.match(
        /--network\s+(base|baseMainnet)\b(?!Sepolia)/,
      );
    }
    expect(scripts).to.not.have.property("deploy:deed:mainnet");
    expect(scripts).to.not.have.property("deploy:mainnet");
  });

  it("pins both chain ids and refuses a mismatch against the live chain", () => {
    expect(script).to.contain("84532n");
    expect(script).to.contain("8453n");
    // The comparison must be against what the NODE reports, not the config —
    // the config is the thing that might be wrong.
    expect(script).to.contain("await ethers.provider.getNetwork()");
    expect(script).to.match(/live\.chainId !== expected\.chainId/);
    expect(script).to.contain("Refusing to deploy");
  });

  it("requires an explicit target rather than trusting --network alone", () => {
    expect(script).to.contain('required("DEED_TARGET")');
    expect(script).to.match(/DEED_TARGET must be one of/);
  });

  it("refuses to collapse the admin and oracle roles", () => {
    expect(script).to.match(/admin\.toLowerCase\(\) === oracleSigner\.toLowerCase\(\)/);
    expect(script).to.match(/must be different addresses/);
  });

  it("holds mainnet to stricter configuration than testnet", () => {
    expect(script).to.contain("DEED_BASE_URI must be set for a mainnet deployment");
    expect(script).to.contain("must not be the deploying EOA");
    // A Safe is a contract; an EOA administrator on mainnet must be deliberate.
    expect(script).to.contain("getCode(admin)");
  });

  it("verifies the roles it just configured, and fails if they are wrong", () => {
    for (const assertion of [
      "admin holds DEFAULT_ADMIN_ROLE",
      "oracle holds ORACLE_SIGNER_ROLE",
      "admin is NOT an oracle signer",
      "oracle is NOT an administrator",
      "deployer holds no admin role",
    ]) {
      expect(script, assertion).to.contain(assertion);
    }
    expect(script).to.contain("Post-deploy verification failed");
  });

  it("never reads, prints or records key material", () => {
    for (const banned of [
      "PRIVATE_KEY",
      "privateKey",
      "mnemonic",
      "DEPLOYER_PRIVATE_KEY",
      "Wallet(",
    ]) {
      expect(script, `${banned} must not appear in a deployment script`).to.not.contain(banned);
    }
    // The recorded artifact carries public addresses only.
    expect(script).to.contain("Public addresses only");
  });

  it("refuses to overwrite an existing deployment record", () => {
    expect(script).to.contain("already records a");
    expect(script).to.match(/existsSync\(file\)/);
  });
});
