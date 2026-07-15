// V1 CHARACTERIZATION — deployment-script / network mismatch (issue #16).
//
// A STATIC, non-network test. It reads the committed package.json and deploy
// script as text. It never runs a deployment and never touches any network.
// See docs/CONTRACT_V1_DISCREPANCIES.md. No source is modified.
//
// HISTORICAL NOTE (do not remove): issue #16 was originally characterized as
// "`deploy:mainnet` runs the Base Sepolia deploy script" — a runnable
// `contracts/package.json` command that invoked
// `scripts/deploy/baseSepolia.ts --network baseMainnet`, a script whose saved
// metadata is hardcoded to `network: "baseSepolia"` / `chainId: 84532` /
// `deployments/baseSepolia.json` regardless of which network flag was passed.
// That specific unsafe command was REMOVED by
// `chore(contracts): add deterministic CI and disable unsafe mainnet
// deployment` — the removal is a repository/tooling fix only; the deployed
// Base Sepolia V1 contracts and `deployments/baseSepolia.json` were never
// affected by this issue and remain unchanged. The current-state invariant
// (no mainnet command exists at all) is asserted going forward by
// `test/tooling/deploymentCommands.test.ts`, not duplicated here.
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

  it("current tooling invariant (known discrepancy #16, fixed): no `deploy:mainnet` command exists in contracts/package.json", async function () {
    // Historically this command existed and ran the Base Sepolia script
    // against a mainnet network alias (see the historical note above and
    // docs/CONTRACT_V1_DISCREPANCIES.md #16). It has been removed with no
    // replacement mainnet command added — mainnet deployment remains
    // intentionally unsupported until a dedicated, reviewed, chain-asserting
    // mainnet deployment design exists.
    expect(pkg.scripts).to.not.have.property("deploy:mainnet");
    for (const [name, command] of Object.entries(pkg.scripts as Record<string, string>)) {
      expect(command, `script "${name}" must not target baseMainnet`).to.not.contain("baseMainnet");
    }
  });

  it("V1 characterization (known discrepancy #16): the Base Sepolia deploy script hardcodes network \"baseSepolia\" and chainId 84532 into its saved metadata", async function () {
    // Regardless of which network a caller connects to, the saved deployment
    // record produced by this script is hardcoded to the testnet. This fact
    // about the script's own content is unchanged by removing deploy:mainnet
    // and remains true of the still-safe deploy:sepolia command.
    expect(sepoliaScript).to.match(/network:\s*["']baseSepolia["']/);
    expect(sepoliaScript).to.match(/chainId:\s*84532/);
  });

  it("V1 characterization (known discrepancy #16): the Base Sepolia deploy script always writes deployments/baseSepolia.json", async function () {
    expect(sepoliaScript).to.contain('"baseSepolia.json"');
    // deploy:sepolia is the only remaining command that invokes this script.
    expect(pkg.scripts["deploy:sepolia"]).to.contain("scripts/deploy/baseSepolia.ts");
    expect(pkg.scripts["deploy:sepolia"]).to.contain("--network baseSepolia");

    // Intended V2 (tracked in docs/CONTRACT_V2_DESIGN.md territory, not this
    // PR): a real, separate mainnet deploy script that writes network-correct
    // metadata (base.json / baseMainnet), or a guard that refuses to run
    // against a network whose chainId != the hardcoded one.
  });
});
