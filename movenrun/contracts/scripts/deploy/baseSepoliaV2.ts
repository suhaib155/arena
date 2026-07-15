import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

/**
 * MovenRun V2 deployment — Base Sepolia ONLY.
 *
 * Safety properties:
 * - Refuses to run unless the connected provider's chainId is exactly 84532.
 * - ADMIN_ADDRESS, ORACLE_ADDRESS, and TREASURY_ADDRESS are REQUIRED env
 *   vars; there is no silent fallback to the deployer for critical roles,
 *   and zero/invalid addresses are rejected.
 * - Writes ONLY deployments/baseSepolia-v2.json. It never touches the V1
 *   record deployments/baseSepolia.json or the deployed V1 contracts.
 * - There is deliberately no mainnet variant of this script.
 */

const EXPECTED_CHAIN_ID = 84532n; // Base Sepolia
const TIMELOCK_MIN_DELAY = 2n * 24n * 3600n; // 2 days execution delay

function requireAddressEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} env var is required — refusing to default critical roles to the deployer`);
  }
  if (!ethers.isAddress(value) || value === ethers.ZeroAddress) {
    throw new Error(`${name} must be a valid non-zero address, got: ${value}`);
  }
  return ethers.getAddress(value);
}

async function main() {
  // ── Preconditions ──────────────────────────────────────────────────────────
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `Refusing to deploy: provider chainId is ${network.chainId}, expected Base Sepolia (${EXPECTED_CHAIN_ID}). ` +
      "This script must never run against any other network."
    );
  }

  const adminAddress   = requireAddressEnv("ADMIN_ADDRESS");
  const oracleOperator = requireAddressEnv("ORACLE_ADDRESS");
  const treasury       = requireAddressEnv("TREASURY_ADDRESS");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying MovenRun V2 to Base Sepolia");
  console.log("Deployer:       ", deployer.address);
  console.log("Admin:          ", adminAddress);
  console.log("Oracle operator:", oracleOperator);
  console.log("Treasury:       ", treasury);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:        ", ethers.formatEther(balance), "ETH");
  if (balance === 0n) {
    throw new Error("Deployer has no ETH on Base Sepolia.");
  }

  const addrs: Record<string, string> = {};
  const txHashes: Record<string, string> = {};
  const checklist: string[] = [];

  async function deploy(name: string, args: unknown[]) {
    const Factory = await ethers.getContractFactory(name);
    const contract = await Factory.deploy(...args);
    const tx = contract.deploymentTransaction();
    await contract.waitForDeployment();
    const addr = await contract.getAddress();
    addrs[name] = addr;
    txHashes[name] = tx?.hash ?? "";
    console.log(`\n${name}`);
    console.log(`  address: ${addr}`);
    console.log(`  tx:      ${tx?.hash ?? "unknown"}`);
    await new Promise((r) => setTimeout(r, 8_000)); // let Basescan index
    return contract;
  }

  async function wire(label: string, txPromise: Promise<any>) {
    const tx = await txPromise;
    await tx.wait();
    checklist.push(`✓ ${label}  tx: ${tx.hash}`);
    console.log(`✓ ${label}`);
  }

  // ── Deployments ────────────────────────────────────────────────────────────
  const moveToken = await deploy("MoveTokenV2", [adminAddress]);
  const gpsOracle = await deploy("GPSOracleV2", [oracleOperator]);
  const zoneNFT   = await deploy("ZoneNFTV2", [addrs.MoveTokenV2, addrs.GPSOracleV2]);
  const gearNFT   = await deploy("GearNFTV2", [addrs.MoveTokenV2]);
  const moveVault = await deploy("MoveVaultV2", [addrs.MoveTokenV2]);
  const zoneChallenge = await deploy("ZoneChallengeV2", [
    addrs.ZoneNFTV2,
    addrs.MoveTokenV2,
    addrs.GPSOracleV2,
  ]);
  const seasonController = await deploy("SeasonControllerV2", [
    addrs.MoveTokenV2,
    addrs.ZoneNFTV2,
    addrs.ZoneChallengeV2,
  ]);
  // TimelockController: proposers/executors wired below; admin = ADMIN_ADDRESS
  // (can renounce after verifying the wiring).
  const timelock = await deploy("TimelockController", [
    TIMELOCK_MIN_DELAY,
    [],
    [],
    adminAddress,
  ]);
  const governor = await deploy("MovenGovernorV2", [addrs.MoveTokenV2, addrs.TimelockController]);

  // ── Role wiring ────────────────────────────────────────────────────────────
  console.log("\n─── Role / wiring setup ───");

  const ORACLE_ROLE    = ethers.id("ORACLE_ROLE");
  const SEASON_ROLE    = ethers.id("SEASON_ROLE");
  const CHALLENGE_ROLE = ethers.id("CHALLENGE_ROLE");
  const DAO_ROLE       = ethers.id("DAO_ROLE");

  // NOTE: the deployer holds the deploy-time admin roles on the non-token
  // contracts (their constructors grant DEFAULT_ADMIN_ROLE to msg.sender);
  // MoveTokenV2's admin is ADMIN_ADDRESS from its constructor arg.

  // GPSOracleV2 → MoveTokenV2
  await wire("GPSOracleV2.setMoveToken(MoveTokenV2)", (gpsOracle as any).setMoveToken(addrs.MoveTokenV2));

  // MoveTokenV2 roles/wiring must be executed by ADMIN_ADDRESS if it is not
  // the deployer. If so, print the required calls instead of failing silently.
  const moveTokenAdminIsDeployer =
    adminAddress.toLowerCase() === deployer.address.toLowerCase();
  if (moveTokenAdminIsDeployer) {
    await wire("MoveTokenV2.grantRole(ORACLE_ROLE, GPSOracleV2)", (moveToken as any).grantRole(ORACLE_ROLE, addrs.GPSOracleV2));
    await wire("MoveTokenV2.grantRole(SEASON_ROLE, SeasonControllerV2)", (moveToken as any).grantRole(SEASON_ROLE, addrs.SeasonControllerV2));
    await wire("MoveTokenV2.setZoneNFT(ZoneNFTV2)", (moveToken as any).setZoneNFT(addrs.ZoneNFTV2));
    await wire("MoveTokenV2.setGearNFT(GearNFTV2)", (moveToken as any).setGearNFT(addrs.GearNFTV2));
  } else {
    checklist.push("✗ PENDING (run as ADMIN_ADDRESS): MoveTokenV2.grantRole(ORACLE_ROLE, GPSOracleV2)");
    checklist.push("✗ PENDING (run as ADMIN_ADDRESS): MoveTokenV2.grantRole(SEASON_ROLE, SeasonControllerV2)");
    checklist.push("✗ PENDING (run as ADMIN_ADDRESS): MoveTokenV2.setZoneNFT(ZoneNFTV2)");
    checklist.push("✗ PENDING (run as ADMIN_ADDRESS): MoveTokenV2.setGearNFT(GearNFTV2)");
    console.warn("! ADMIN_ADDRESS is not the deployer — MoveTokenV2 wiring must be executed by the admin (see checklist).");
  }

  // ZoneNFTV2: challenge settlement + season pause roles
  await wire("ZoneNFTV2.grantRole(CHALLENGE_ROLE, ZoneChallengeV2)", (zoneNFT as any).grantRole(CHALLENGE_ROLE, addrs.ZoneChallengeV2));
  await wire("ZoneNFTV2.grantRole(SEASON_ROLE, SeasonControllerV2)", (zoneNFT as any).grantRole(SEASON_ROLE, addrs.SeasonControllerV2));

  // SeasonControllerV2 wiring
  await wire("SeasonControllerV2.setGpsOracle(GPSOracleV2)", (seasonController as any).setGpsOracle(addrs.GPSOracleV2));
  await wire("SeasonControllerV2.setDaoTreasury(TREASURY_ADDRESS)", (seasonController as any).setDaoTreasury(treasury));

  // Governor ↔ Timelock wiring (deployer is NOT the timelock admin, so these
  // must run as ADMIN_ADDRESS unless the admin deployed).
  const PROPOSER_ROLE  = await (timelock as any).PROPOSER_ROLE();
  const CANCELLER_ROLE = await (timelock as any).CANCELLER_ROLE();
  const EXECUTOR_ROLE  = await (timelock as any).EXECUTOR_ROLE();
  if (moveTokenAdminIsDeployer) {
    await wire("TimelockController.grantRole(PROPOSER_ROLE, MovenGovernorV2)", (timelock as any).grantRole(PROPOSER_ROLE, addrs.MovenGovernorV2));
    await wire("TimelockController.grantRole(CANCELLER_ROLE, MovenGovernorV2)", (timelock as any).grantRole(CANCELLER_ROLE, addrs.MovenGovernorV2));
    await wire("TimelockController.grantRole(EXECUTOR_ROLE, address(0))", (timelock as any).grantRole(EXECUTOR_ROLE, ethers.ZeroAddress));
  } else {
    checklist.push("✗ PENDING (run as ADMIN_ADDRESS): TimelockController.grantRole(PROPOSER_ROLE, MovenGovernorV2)");
    checklist.push("✗ PENDING (run as ADMIN_ADDRESS): TimelockController.grantRole(CANCELLER_ROLE, MovenGovernorV2)");
    checklist.push("✗ PENDING (run as ADMIN_ADDRESS): TimelockController.grantRole(EXECUTOR_ROLE, address(0))");
  }

  // MoveVaultV2 governed by the timelock
  await wire("MoveVaultV2.grantRole(DAO_ROLE, TimelockController)", (moveVault as any).grantRole(DAO_ROLE, addrs.TimelockController));

  // Hand contract admin over to ADMIN_ADDRESS on deployer-admined contracts.
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
  if (!moveTokenAdminIsDeployer) {
    for (const [name, contract] of [
      ["GPSOracleV2", gpsOracle],
      ["ZoneNFTV2", zoneNFT],
      ["GearNFTV2", gearNFT],
      ["MoveVaultV2", moveVault],
      ["ZoneChallengeV2", zoneChallenge],
      ["SeasonControllerV2", seasonController],
    ] as const) {
      await wire(`${name}.grantRole(DEFAULT_ADMIN_ROLE, ADMIN_ADDRESS)`, (contract as any).grantRole(DEFAULT_ADMIN_ROLE, adminAddress));
    }
    checklist.push("! NOTE: deployer still holds DEFAULT_ADMIN_ROLE on the non-token contracts — renounce after the admin verifies wiring.");
  }

  // ── Save deployment (V2 file ONLY — never baseSepolia.json) ───────────────
  const deployment = {
    network:   "baseSepolia",
    chainId:   Number(EXPECTED_CHAIN_ID),
    version:   "v2",
    deployer:  deployer.address,
    admin:     adminAddress,
    oracleOperator,
    treasury,
    timestamp: new Date().toISOString(),
    addresses: addrs,
    txHashes,
    constructorArgs: {
      MoveTokenV2:        [adminAddress],
      GPSOracleV2:        [oracleOperator],
      ZoneNFTV2:          [addrs.MoveTokenV2, addrs.GPSOracleV2],
      GearNFTV2:          [addrs.MoveTokenV2],
      MoveVaultV2:        [addrs.MoveTokenV2],
      ZoneChallengeV2:    [addrs.ZoneNFTV2, addrs.MoveTokenV2, addrs.GPSOracleV2],
      SeasonControllerV2: [addrs.MoveTokenV2, addrs.ZoneNFTV2, addrs.ZoneChallengeV2],
      TimelockController: [TIMELOCK_MIN_DELAY.toString(), [], [], adminAddress],
      MovenGovernorV2:    [addrs.MoveTokenV2, addrs.TimelockController],
    },
    wiringChecklist: checklist,
  };

  const outDir  = path.join(__dirname, "../../deployments");
  const outFile = path.join(outDir, "baseSepolia-v2.json");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(deployment, null, 2));

  console.log("\n─── V2 deployment complete ───");
  console.log("Saved to deployments/baseSepolia-v2.json (V1 record untouched)");
  console.log(JSON.stringify(addrs, null, 2));
  console.log("\n─── Role / wiring checklist ───");
  for (const line of checklist) console.log(line);
}

main().catch((err) => { console.error(err); process.exit(1); });
