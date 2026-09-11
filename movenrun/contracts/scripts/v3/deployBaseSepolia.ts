/**
 * MovenRun V3 onchain core — Base Sepolia deployment.
 *
 * Refuses to run on any chain other than Base Sepolia (84532). Deploys the nine V3
 * contracts in dependency order, performs the one-time bootstrap wiring, freezes the token
 * configuration, verifies that the deployer retains no privileged role, and only then writes
 * the deployment manifest and the per-contract verification commands.
 *
 * The script never reads, logs or records a private key or any other secret.
 *
 * Usage:
 *   npx hardhat run scripts/v3/deployBaseSepolia.ts --network baseSepolia
 */
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import hre from "hardhat";

const BASE_SEPOLIA_CHAIN_ID = 84532n;
const SUITE_VERSION = "movenrun-v3.0.0";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const DEPLOYMENT_DIR = path.join(__dirname, "..", "..", "deployments", "v3");
const MANIFEST_PATH = path.join(DEPLOYMENT_DIR, "base-sepolia.json");
const VERIFY_COMMANDS_PATH = path.join(DEPLOYMENT_DIR, "base-sepolia.verify.txt");

interface RoleConfiguration {
  admin: string;
  guardian: string;
  settlementSigner: string;
  reconciliationSigner: string;
  deedSigner: string;
  contestScoreSigner: string;
}

interface DeployedContract {
  address: string;
  deploymentTx: string;
  constructorArguments: unknown[];
  deployedBytecodeHash: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value.trim();
}

function requireAddress(name: string): string {
  const value = requireEnv(name);
  if (!hre.ethers.isAddress(value)) {
    throw new Error(`Environment variable ${name} is not a valid address`);
  }
  return hre.ethers.getAddress(value);
}

function optionalNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Environment variable ${name} must be a non-negative integer`);
  }
  return parsed;
}

/**
 * Rejects role reuse. Settlement signer and reconciliation signer must never be the same
 * address, and the deployer must never be handed an administrative role. Broader reuse of
 * critical addresses is also rejected unless it is deliberately acknowledged.
 */
function assertRoleSeparation(roles: RoleConfiguration, deployer: string): void {
  if (roles.settlementSigner === roles.reconciliationSigner) {
    throw new Error(
      "Settlement signer and reconciliation signer must be different addresses. " +
        "Dual authorization is meaningless when one key controls both signatures."
    );
  }
  if (roles.admin === deployer) {
    throw new Error("The delayed administrator must not be the deployer address");
  }

  const named: Array<[string, string]> = [
    ["MOVENRUN_ADMIN_ADDRESS", roles.admin],
    ["MOVENRUN_GUARDIAN_ADDRESS", roles.guardian],
    ["MOVENRUN_SETTLEMENT_SIGNER", roles.settlementSigner],
    ["MOVENRUN_RECONCILIATION_SIGNER", roles.reconciliationSigner],
    ["MOVENRUN_DEED_SIGNER", roles.deedSigner],
    ["MOVENRUN_CONTEST_SCORE_SIGNER", roles.contestScoreSigner],
  ];

  const duplicates: string[] = [];
  for (let i = 0; i < named.length; i += 1) {
    for (let j = i + 1; j < named.length; j += 1) {
      if (named[i][1] === named[j][1]) {
        duplicates.push(`${named[i][0]} == ${named[j][0]}`);
      }
    }
  }
  for (const [name, address] of named) {
    if (address === deployer) duplicates.push(`${name} == deployer`);
  }

  if (duplicates.length > 0) {
    const acknowledged = (process.env.MOVENRUN_ALLOW_ROLE_REUSE ?? "").toLowerCase() === "true";
    const detail = duplicates.join(", ");
    if (!acknowledged) {
      throw new Error(
        `Critical MovenRun roles must use distinct addresses. Reused: ${detail}. ` +
          "Provide separate addresses, or set MOVENRUN_ALLOW_ROLE_REUSE=true to accept a " +
          "deliberately reduced testnet role model."
      );
    }
    console.log(`  ! role reuse accepted by MOVENRUN_ALLOW_ROLE_REUSE: ${detail}`);
  }
}

function gitCommit(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function gitIsClean(): boolean {
  try {
    return execSync("git status --porcelain", { encoding: "utf8" }).trim() === "";
  } catch {
    return false;
  }
}

async function deployedBytecodeHash(contractName: string): Promise<string> {
  const artifact = await hre.artifacts.readArtifact(contractName);
  return hre.ethers.keccak256(artifact.deployedBytecode);
}

async function deployContract(
  contractName: string,
  args: unknown[]
): Promise<{ contract: any; record: DeployedContract }> {
  const factory = await hre.ethers.getContractFactory(contractName);
  const contract: any = await factory.deploy(...(args as never[]));
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const deploymentTx = contract.deploymentTransaction();
  if (deploymentTx === null) {
    throw new Error(`${contractName} produced no deployment transaction`);
  }
  const receipt = await deploymentTx.wait();
  if (receipt === null || receipt.status !== 1) {
    throw new Error(`${contractName} deployment receipt did not succeed`);
  }

  console.log(`  ${contractName.padEnd(22)} ${address}`);

  return {
    contract,
    record: {
      address,
      deploymentTx: deploymentTx.hash,
      constructorArguments: args.map((value) =>
        typeof value === "bigint" ? value.toString() : value
      ),
      deployedBytecodeHash: await deployedBytecodeHash(contractName),
    },
  };
}

async function main(): Promise<void> {
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(
      `This script only deploys to Base Sepolia (${BASE_SEPOLIA_CHAIN_ID}). ` +
        `Connected chain id is ${network.chainId}. Refusing to continue.`
    );
  }

  const [deployerSigner] = await hre.ethers.getSigners();
  const deployer = await deployerSigner.getAddress();

  const roles: RoleConfiguration = {
    admin: requireAddress("MOVENRUN_ADMIN_ADDRESS"),
    guardian: requireAddress("MOVENRUN_GUARDIAN_ADDRESS"),
    settlementSigner: requireAddress("MOVENRUN_SETTLEMENT_SIGNER"),
    reconciliationSigner: requireAddress("MOVENRUN_RECONCILIATION_SIGNER"),
    deedSigner: requireAddress("MOVENRUN_DEED_SIGNER"),
    contestScoreSigner: requireAddress("MOVENRUN_CONTEST_SCORE_SIGNER"),
  };

  const timelockDelaySeconds = optionalNumber("MOVENRUN_TIMELOCK_DELAY_SECONDS", 0);
  if (timelockDelaySeconds === 0) {
    throw new Error("MOVENRUN_TIMELOCK_DELAY_SECONDS must be set to a nonzero delay");
  }
  const homeAdvantageBps = optionalNumber("MOVENRUN_HOME_ADVANTAGE_BPS", 500);
  const rulesVersion = optionalNumber("MOVENRUN_RULES_VERSION", 1);

  assertRoleSeparation(roles, deployer);

  const commit = gitCommit();
  console.log("MovenRun V3 deployment — Base Sepolia");
  console.log(`  chain id            ${network.chainId}`);
  console.log(`  git commit          ${commit}${gitIsClean() ? "" : " (working tree not clean)"}`);
  console.log(`  deployer            ${deployer}`);
  console.log(`  delayed admin       ${roles.admin}`);
  console.log(`  guardian            ${roles.guardian}`);
  console.log(`  timelock delay      ${timelockDelaySeconds}s`);
  console.log(`  home advantage      ${homeAdvantageBps} bps`);
  console.log(`  rules version       ${rulesVersion}`);
  console.log("");

  const balance = await hre.ethers.provider.getBalance(deployer);
  if (balance === 0n) {
    throw new Error("Deployer holds no Base Sepolia ETH");
  }

  console.log("Deploying contracts:");

  // The timelock administers itself; the multisignature administrator is its only proposer
  // and executor, so no deployer key remains a permanent root admin.
  const timelock = await deployContract("MovenRunTimelock", [
    BigInt(timelockDelaySeconds),
    [roles.admin],
    [roles.admin],
    ZERO_ADDRESS,
  ]);
  const timelockAddress = timelock.record.address;

  const token = await deployContract("MovenRunToken", [timelockAddress, deployer]);
  const rewards = await deployContract("MovenRunRewards", [token.record.address, deployer]);
  const settlement = await deployContract("MovenRunSettlement", [
    timelockAddress,
    roles.guardian,
    token.record.address,
    rewards.record.address,
    roles.settlementSigner,
    roles.reconciliationSigner,
    rulesVersion,
  ]);
  const deed = await deployContract("MovenRunDeed", [timelockAddress, deployer]);
  const deedClaims = await deployContract("MovenRunDeedClaims", [
    timelockAddress,
    roles.guardian,
    token.record.address,
    deed.record.address,
    roles.deedSigner,
    rulesVersion,
  ]);
  const contests = await deployContract("MovenRunContests", [
    timelockAddress,
    roles.guardian,
    token.record.address,
    deed.record.address,
    roles.contestScoreSigner,
    homeAdvantageBps,
    rulesVersion,
  ]);
  const marketplace = await deployContract("MovenRunMarketplace", [
    token.record.address,
    deed.record.address,
  ]);
  const registry = await deployContract("MovenRunRegistry", [timelockAddress, deployer]);

  console.log("\nWiring one-time bootstrap relationships:");

  await (await rewards.contract.configureSettlement(settlement.record.address)).wait();
  console.log("  rewards  -> settlement configured");

  await (
    await deed.contract.configureContracts(deedClaims.record.address, contests.record.address)
  ).wait();
  console.log("  deed     -> claims and contests configured");

  await (
    await token.contract.configureCore(settlement.record.address, rewards.record.address, [
      deedClaims.record.address,
      contests.record.address,
    ])
  ).wait();
  console.log("  token    -> settlement, rewards and fee burners configured");

  await (await token.contract.finalizeBootstrap()).wait();
  console.log("  token    -> bootstrap finalized and frozen");

  await (
    await registry.contract.publishDeployment({
      suiteVersion: SUITE_VERSION,
      chainId: network.chainId,
      timelock: timelockAddress,
      token: token.record.address,
      rewards: rewards.record.address,
      settlement: settlement.record.address,
      deed: deed.record.address,
      deedClaims: deedClaims.record.address,
      contests: contests.record.address,
      marketplace: marketplace.record.address,
      recordedAt: 0,
    })
  ).wait();
  console.log("  registry -> suite deployment published");

  console.log("\nVerifying handoff:");

  const adminRole = await token.contract.DEFAULT_ADMIN_ROLE();
  const checks: Array<[string, boolean]> = [
    ["token bootstrap frozen", (await token.contract.bootstrapFrozen()) === true],
    ["token bootstrapper cleared", (await token.contract.bootstrapper()) === ZERO_ADDRESS],
    ["token settlement wired", (await token.contract.settlement()) === settlement.record.address],
    ["token rewards wired", (await token.contract.rewards()) === rewards.record.address],
    ["rewards settlement wired", (await rewards.contract.settlement()) === settlement.record.address],
    ["rewards bootstrapper cleared", (await rewards.contract.bootstrapper()) === ZERO_ADDRESS],
    ["deed claims wired", (await deed.contract.claimsContract()) === deedClaims.record.address],
    ["deed contests wired", (await deed.contract.contestsContract()) === contests.record.address],
    ["deed bootstrapper cleared", (await deed.contract.bootstrapper()) === ZERO_ADDRESS],
    ["registry bootstrapper cleared", (await registry.contract.bootstrapper()) === ZERO_ADDRESS],
    ["deployer holds no token admin role", !(await token.contract.hasRole(adminRole, deployer))],
    ["deployer holds no deed admin role", !(await deed.contract.hasRole(adminRole, deployer))],
    [
      "deployer holds no settlement admin role",
      !(await settlement.contract.hasRole(adminRole, deployer)),
    ],
    [
      "deployer holds no claims admin role",
      !(await deedClaims.contract.hasRole(adminRole, deployer)),
    ],
    [
      "deployer holds no contests admin role",
      !(await contests.contract.hasRole(adminRole, deployer)),
    ],
    ["timelock holds token admin role", await token.contract.hasRole(adminRole, timelockAddress)],
    [
      "settlement signers distinct",
      (await settlement.contract.settlementSigner()) !==
        (await settlement.contract.reconciliationSigner()),
    ],
  ];

  const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}`);
  }
  if (failed.length > 0) {
    throw new Error(`Deployment handoff checks failed: ${failed.join(", ")}`);
  }

  const contracts: Record<string, DeployedContract> = {
    MovenRunTimelock: timelock.record,
    MovenRunToken: token.record,
    MovenRunRewards: rewards.record,
    MovenRunSettlement: settlement.record,
    MovenRunDeed: deed.record,
    MovenRunDeedClaims: deedClaims.record,
    MovenRunContests: contests.record,
    MovenRunMarketplace: marketplace.record,
    MovenRunRegistry: registry.record,
  };

  const solidity: any = hre.config.solidity.compilers[0];
  const manifest = {
    suiteVersion: SUITE_VERSION,
    rulesVersion,
    network: "baseSepolia",
    chainId: Number(network.chainId),
    gitCommit: commit,
    gitWorkingTreeClean: gitIsClean(),
    deployer,
    deployedAt: new Date().toISOString(),
    roles,
    parameters: {
      timelockDelaySeconds,
      homeAdvantageBps,
    },
    fixedConstants: {
      maxLifetimeMinted: (await token.contract.MAX_LIFETIME_MINTED()).toString(),
      playerMovementAllocation: (await settlement.contract.PLAYER_MOVEMENT_ALLOCATION()).toString(),
      seasonOneBudget: (await settlement.contract.SEASON_ONE_BUDGET()).toString(),
      seasonBudgetFloor: (await settlement.contract.SEASON_BUDGET_FLOOR()).toString(),
      seasonLengthDays: Number(await settlement.contract.SEASON_LENGTH_DAYS()),
      tollRateBps: Number(await settlement.contract.TOLL_RATE_BPS()),
      maxAutomaticBurnBps: Number(await settlement.contract.MAX_AUTOMATIC_BURN_BPS()),
      contestNoticePeriodSeconds: Number(await contests.contract.NOTICE_PERIOD()),
      contestScoringWindowSeconds: Number(await contests.contract.SCORING_WINDOW()),
      contestCountedScoringDays: Number(await contests.contract.COUNTED_SCORING_DAYS()),
      challengerCooldownSeconds: Number(await contests.contract.CHALLENGER_COOLDOWN()),
      defenderPeacePeriodSeconds: Number(await contests.contract.DEFENDER_PEACE_PERIOD()),
      maxFortificationBps: Number(await contests.contract.MAX_FORTIFICATION_BPS()),
    },
    compiler: {
      version: solidity.version,
      optimizer: solidity.settings?.optimizer,
      evmVersion: solidity.settings?.evmVersion,
    },
    contracts,
    verification: Object.fromEntries(
      Object.keys(contracts).map((name) => [name, { status: "pending", explorerUrl: "", verifiedAt: "" }])
    ),
  };

  fs.mkdirSync(DEPLOYMENT_DIR, { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nManifest written to ${path.relative(process.cwd(), MANIFEST_PATH)}`);

  const verificationOrder = [
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
  const commands = verificationOrder
    .map(
      (name) =>
        `# ${name}\nnpx hardhat verify --network baseSepolia \\\n  --constructor-args scripts/v3/verification/${name}.args.js \\\n  ${contracts[name].address}\n`
    )
    .join("\n");
  fs.writeFileSync(
    VERIFY_COMMANDS_PATH,
    `MovenRun V3 manual verification commands\ncommit ${commit}\nchain id ${network.chainId}\n\n${commands}`
  );
  console.log(`Verification commands written to ${path.relative(process.cwd(), VERIFY_COMMANDS_PATH)}`);

  console.log("\nDeployment complete. Run scripts/v3/checkDeployment.ts before anything else.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
