// V1 CHARACTERIZATION — deployment-script / network mismatch (issue #16).
//
// A STATIC, non-network test. It reads the committed package.json and deploy
// script as text and asserts the current (unsafe) wiring. It never runs a
// deployment and never touches any network. See
// docs/CONTRACT_V1_DISCREPANCIES.md. No source is modified.
import { expect } from "chai";
import fs from "fs";
import path from "path";

const CONTRACTS_ROOT = path.join(__dirname, "..", "..");

describe("V1 characterization — deployment script mismatch (static)", function () {
  const pkg = JSON.parse(fs.readFileSync(path.join(CONTRACTS_ROOT, "package.json"), "utf8"));
  const sepoliaScript = fs.readFileSync(
    path.join(CONTRACTS_ROOT, "scripts", "deploy", "baseSepolia.ts"),
    "utf8",
  );

  it("V1 characterization (known discrepancy #16): `deploy:mainnet` runs the Base Sepolia deploy script", async function () {
    const script = pkg.scripts["deploy:mainnet"] as string;
    expect(script).to.be.a("string");
    // The mainnet script points at the SEPOLIA deploy script...
    expect(script).to.contain("scripts/deploy/baseSepolia.ts");
    // ...while selecting a mainnet network alias — the dangerous mismatch.
    expect(script).to.contain("--network baseMainnet");
  });

  it("V1 characterization (known discrepancy #16): the deploy script hardcodes network \"baseSepolia\" and chainId 84532 into its saved metadata", async function () {
    // Regardless of the --network flag passed, the saved deployment record is
    // hardcoded to the testnet.
    expect(sepoliaScript).to.match(/network:\s*["']baseSepolia["']/);
    expect(sepoliaScript).to.match(/chainId:\s*84532/);
  });

  it("V1 characterization (known discrepancy #16): the deploy script always writes deployments/baseSepolia.json", async function () {
    expect(sepoliaScript).to.contain('"baseSepolia.json"');
    // Cross-check: `deploy:sepolia` and `deploy:mainnet` both invoke the very
    // same script file, so a mainnet run would overwrite the testnet record
    // with testnet-labelled metadata.
    expect(pkg.scripts["deploy:sepolia"]).to.contain("scripts/deploy/baseSepolia.ts");
    expect(pkg.scripts["deploy:mainnet"]).to.contain("scripts/deploy/baseSepolia.ts");

    // Intended V2: a real, separate mainnet deploy script that writes
    // network-correct metadata (base.json / baseMainnet), or a guard that
    // refuses to run against a network whose chainId != the hardcoded one.
  });
});
