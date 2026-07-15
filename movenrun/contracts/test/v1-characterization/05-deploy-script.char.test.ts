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
// affected by this issue and remain unchanged.
//
// This file intentionally does NOT re-implement the full current-state
// invariant (that is `test/tooling/deploymentCommands.test.ts`'s sole
// responsibility, with 6 independent assertions). It keeps exactly two
// things: a minimal regression guard proving the unsafe command is gone, and
// the historical root-cause fact (the script's own hardcoded metadata) that
// explains *why* the removed command was dangerous in the first place.
import { expect } from "chai";
import fs from "fs";
import path from "path";

const CONTRACTS_ROOT = path.join(__dirname, "..", "..");
const PACKAGE_JSON_PATH = path.join(CONTRACTS_ROOT, "package.json");
const BASE_SEPOLIA_SCRIPT_PATH = path.join(CONTRACTS_ROOT, "scripts", "deploy", "baseSepolia.ts");

function readJson(filePath: string): any {
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`05-deploy-script.char.test.ts: failed to parse ${filePath} as JSON: ${(err as Error).message}`);
  }
}

describe("V1 characterization — deployment script mismatch (static)", function () {
  const pkg = readJson(PACKAGE_JSON_PATH);
  const scripts: Record<string, string> = pkg.scripts ?? {};
  const sepoliaScript = fs.readFileSync(BASE_SEPOLIA_SCRIPT_PATH, "utf8");

  it("regression guard (historical known discrepancy #16, fixed): `deploy:mainnet` no longer exists", function () {
    // The full current-state invariant (no command targets baseMainnet, the
    // Sepolia command uses only --network baseSepolia, the script writes only
    // deployments/baseSepolia.json, its chain ID is 84532, and no
    // command/script pairing can mislabel a mainnet deploy as Sepolia) is
    // asserted authoritatively — and only — by
    // test/tooling/deploymentCommands.test.ts. This is a minimal guard so the
    // historical record above stays anchored to present reality.
    expect(scripts).to.not.have.property("deploy:mainnet");
  });

  it("historical characterization (known discrepancy #16): the Base Sepolia script's own hardcoded metadata is the root cause that made the removed command dangerous", function () {
    // These facts about the script's own content are unrelated to whether
    // deploy:mainnet exists — they are why pairing this script with ANY
    // non-Sepolia network flag was unsafe. Still independently and more
    // thoroughly re-verified going forward by
    // test/tooling/deploymentCommands.test.ts (checks 4-5).
    expect(sepoliaScript).to.match(/network:\s*["']baseSepolia["']/);
    expect(sepoliaScript).to.match(/chainId:\s*84532/);
    expect(sepoliaScript).to.contain('"baseSepolia.json"');
  });
});
