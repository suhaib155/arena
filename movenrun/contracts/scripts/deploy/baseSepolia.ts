import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying to Base Sepolia with:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  if (balance === 0n) {
    throw new Error("Deployer has no ETH. Fund the account at https://www.coinbase.com/faucets/base-ethereum-goerli-faucet");
  }

  const oracleOperator = process.env.ORACLE_ADDRESS ?? deployer.address;
  const adminAddress   = process.env.ADMIN_ADDRESS  ?? deployer.address;
  const treasury       = process.env.TREASURY_ADDRESS ?? deployer.address;

  console.log("\nOracle operator:", oracleOperator);
  console.log("Admin:          ", adminAddress);
  console.log("Treasury:       ", treasury);

  const addrs: Record<string, string> = {};
  const txHashes: Record<string, string> = {};

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
    // Give Basescan time to index
    await new Promise((r) => setTimeout(r, 8_000));
    return contract;
  }

  // ─── 1. MoveToken ──────────────────────────────────────────────────────────
  const moveToken = await deploy("MoveToken", [adminAddress]);

  // ─── 2. GPSOracle ──────────────────────────────────────────────────────────
  const gpsOracle = await deploy("GPSOracle", [oracleOperator]);

  // ─── 3. ZoneNFT ────────────────────────────────────────────────────────────
  const zoneNFT = await deploy("ZoneNFT", [addrs.MoveToken, addrs.GPSOracle]);

  // ─── 4. GearNFT ────────────────────────────────────────────────────────────
  const gearNFT = await deploy("GearNFT", [addrs.MoveToken]);

  // ─── 5. MoveVault ──────────────────────────────────────────────────────────
  const moveVault = await deploy("MoveVault", [addrs.MoveToken]);

  // ─── 6. ZoneChallenge ──────────────────────────────────────────────────────
  const zoneChallenge = await deploy("ZoneChallenge", [
    addrs.ZoneNFT,
    addrs.MoveToken,
    addrs.GPSOracle,
  ]);

  // ─── 7. SeasonController ───────────────────────────────────────────────────
  const seasonController = await deploy("SeasonController", [
    addrs.MoveToken,
    addrs.ZoneNFT,
    addrs.ZoneChallenge,
  ]);

  // ─── 8. MovenDAO ───────────────────────────────────────────────────────────
  const movenDAO = await deploy("MovenDAO", [
    addrs.MoveToken,
    addrs.ZoneNFT,
    addrs.MoveVault,
  ]);

  // ─── Post-deployment wiring ────────────────────────────────────────────────
  console.log("\n─── Post-deployment setup ───");

  const MINTER_ROLE   = ethers.id("MINTER_ROLE");
  const ORACLE_ROLE   = ethers.id("ORACLE_ROLE");
  const GOVERNOR_ROLE = ethers.id("GOVERNOR_ROLE");
  const SEASON_ROLE   = ethers.id("SEASON_ROLE");

  let tx;

  tx = await (moveToken as any).grantRole(MINTER_ROLE, addrs.ZoneNFT);
  await tx.wait();
  console.log("✓ MoveToken.grantRole(MINTER_ROLE, ZoneNFT)  tx:", tx.hash);

  tx = await (moveToken as any).grantRole(ORACLE_ROLE, addrs.GPSOracle);
  await tx.wait();
  console.log("✓ MoveToken.grantRole(ORACLE_ROLE, GPSOracle) tx:", tx.hash);

  tx = await (moveToken as any).grantRole(GOVERNOR_ROLE, addrs.MovenDAO);
  await tx.wait();
  console.log("✓ MoveToken.grantRole(GOVERNOR_ROLE, MovenDAO) tx:", tx.hash);

  tx = await (moveToken as any).grantRole(SEASON_ROLE, addrs.SeasonController);
  await tx.wait();
  console.log("✓ MoveToken.grantRole(SEASON_ROLE, SeasonController) tx:", tx.hash);

  tx = await (gpsOracle as any).setMoveToken(addrs.MoveToken);
  await tx.wait();
  console.log("✓ GPSOracle.setMoveToken tx:", tx.hash);

  tx = await (zoneNFT as any).setSeasonController(addrs.SeasonController);
  await tx.wait();
  console.log("✓ ZoneNFT.setSeasonController tx:", tx.hash);

  tx = await (zoneNFT as any).setChallengeContract(addrs.ZoneChallenge);
  await tx.wait();
  console.log("✓ ZoneNFT.setChallengeContract tx:", tx.hash);

  tx = await (zoneChallenge as any).setSeasonController(addrs.SeasonController);
  await tx.wait();
  console.log("✓ ZoneChallenge.setSeasonController tx:", tx.hash);

  tx = await (seasonController as any).setGpsOracle(addrs.GPSOracle);
  await tx.wait();
  console.log("✓ SeasonController.setGpsOracle tx:", tx.hash);

  tx = await (seasonController as any).setDaoTreasury(treasury);
  await tx.wait();
  console.log("✓ SeasonController.setDaoTreasury tx:", tx.hash);

  tx = await (moveToken as any).setZoneNFT(addrs.ZoneNFT);
  await tx.wait();
  console.log("✓ MoveToken.setZoneNFT tx:", tx.hash);

  // ─── Save deployment ────────────────────────────────────────────────────────
  const deployment = {
    network:   "baseSepolia",
    chainId:   84532,
    deployer:  deployer.address,
    timestamp: new Date().toISOString(),
    addresses: addrs,
    txHashes,
    constructorArgs: {
      MoveToken:       [adminAddress],
      GPSOracle:       [oracleOperator],
      ZoneNFT:         [addrs.MoveToken, addrs.GPSOracle],
      GearNFT:         [addrs.MoveToken],
      MoveVault:       [addrs.MoveToken],
      ZoneChallenge:   [addrs.ZoneNFT, addrs.MoveToken, addrs.GPSOracle],
      SeasonController:[addrs.MoveToken, addrs.ZoneNFT, addrs.ZoneChallenge],
      MovenDAO:        [addrs.MoveToken, addrs.ZoneNFT, addrs.MoveVault],
    },
  };

  const outDir  = path.join(__dirname, "../../deployments");
  const outFile = path.join(outDir, "baseSepolia.json");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(deployment, null, 2));

  console.log("\n─── Deployment complete ───");
  console.log("Saved to deployments/baseSepolia.json");
  console.log(JSON.stringify(addrs, null, 2));
  console.log("\nTransaction hashes:");
  console.log(JSON.stringify(txHashes, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
