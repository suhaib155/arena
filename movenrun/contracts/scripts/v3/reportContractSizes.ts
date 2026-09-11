/**
 * MovenRun V3 onchain core — deployed bytecode size report.
 *
 * Reports the deployed bytecode size of every V3 contract and fails hard if any of them
 * exceeds the EVM contract size limit.
 *
 * Usage:
 *   npx hardhat run scripts/v3/reportContractSizes.ts
 */
import hre from "hardhat";

/** EIP-170 deployed bytecode size limit, in bytes. */
const CONTRACT_SIZE_LIMIT = 24576;

/** Headroom below which a contract is reported as worth watching. */
const HEADROOM_WARNING_RATIO = 0.85;

const V3_CONTRACTS = [
  "MovenRunTimelock",
  "MovenRunToken",
  "MovenRunRewards",
  "MovenRunSettlement",
  "MovenRunDeed",
  "MovenRunDeedClaims",
  "MovenRunContests",
  "MovenRunMarketplace",
  "MovenRunRegistry",
];

async function main(): Promise<void> {
  await hre.run("compile");

  console.log("MovenRun V3 deployed bytecode sizes");
  console.log(`  limit ${CONTRACT_SIZE_LIMIT} bytes\n`);

  const oversized: string[] = [];
  const tight: string[] = [];

  for (const name of V3_CONTRACTS) {
    const artifact = await hre.artifacts.readArtifact(name);
    const size = (artifact.deployedBytecode.length - 2) / 2;
    const ratio = size / CONTRACT_SIZE_LIMIT;
    const headroom = CONTRACT_SIZE_LIMIT - size;

    if (size > CONTRACT_SIZE_LIMIT) oversized.push(name);
    else if (ratio > HEADROOM_WARNING_RATIO) tight.push(name);

    console.log(
      `  ${name.padEnd(22)} ${String(size).padStart(6)} bytes  ` +
        `${(ratio * 100).toFixed(1).padStart(5)}%  headroom ${headroom} bytes`
    );
  }

  if (tight.length > 0) {
    console.log(`\nLow headroom: ${tight.join(", ")}`);
  }
  if (oversized.length > 0) {
    throw new Error(
      `Contracts above the ${CONTRACT_SIZE_LIMIT} byte limit: ${oversized.join(", ")}`
    );
  }

  console.log("\nEvery V3 contract is within the contract size limit.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
