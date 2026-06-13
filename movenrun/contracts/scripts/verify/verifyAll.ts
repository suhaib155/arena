import { run } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
  const deploymentFile = path.join(__dirname, "../../deployments/baseSepolia.json");

  if (!fs.existsSync(deploymentFile)) {
    console.error("deployments/baseSepolia.json not found. Run deploy:sepolia first.");
    process.exit(1);
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
  const { addresses, constructorArgs } = deployment;

  console.log(`Verifying ${Object.keys(addresses).length} contracts on Basescan...`);
  console.log(`Network: ${deployment.network} (chainId ${deployment.chainId})`);
  console.log(`Deployed at: ${deployment.timestamp}\n`);

  for (const [name, address] of Object.entries(addresses) as [string, string][]) {
    const args = constructorArgs[name] ?? [];
    console.log(`Verifying ${name} at ${address}...`);
    try {
      await run("verify:verify", {
        address,
        constructorArguments: args,
      });
      console.log(`  ✓ ${name} verified\n`);
    } catch (e: any) {
      if (e.message?.includes("Already Verified")) {
        console.log(`  ✓ ${name} already verified\n`);
      } else {
        console.log(`  ✗ ${name} failed: ${e.message}\n`);
      }
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
