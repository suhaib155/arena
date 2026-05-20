import { ethers, run } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying to Base Sepolia with:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");

  const oracleAddress = process.env.ORACLE_ADDRESS!;
  const adminAddress  = process.env.ADMIN_ADDRESS!;
  const treasury      = process.env.TREASURY_ADDRESS!;
  if (!oracleAddress || !adminAddress || !treasury) {
    throw new Error("Set ORACLE_ADDRESS, ADMIN_ADDRESS, TREASURY_ADDRESS in .env");
  }

  const deployedAddresses: Record<string, string> = {};

  async function deploy(name: string, args: unknown[]) {
    const Factory = await ethers.getContractFactory(name);
    const contract = await Factory.deploy(...args);
    await contract.waitForDeployment();
    const addr = await contract.getAddress();
    deployedAddresses[name] = addr;
    console.log(`${name}: ${addr}`);
    // Wait for Basescan indexing
    await new Promise((r) => setTimeout(r, 10_000));
    return contract;
  }

  const moveToken      = await deploy("MoveToken",      [oracleAddress, adminAddress]);
  const zoneNFT        = await deploy("ZoneNFT",        [deployedAddresses.MoveToken, oracleAddress, adminAddress]);
  const gearNFT        = await deploy("GearNFT",        [deployedAddresses.MoveToken, adminAddress]);
  const zoneChallenge  = await deploy("ZoneChallenge",  [deployedAddresses.MoveToken, deployedAddresses.ZoneNFT, oracleAddress, adminAddress]);
  const moveVault      = await deploy("MoveVault",      [deployedAddresses.MoveToken, adminAddress]);
  const movenDAO       = await deploy("MovenDAO",       [deployedAddresses.MoveToken, deployedAddresses.MoveVault, adminAddress]);
  const seasonCtrl     = await deploy("SeasonController",[deployedAddresses.MoveToken, deployedAddresses.ZoneNFT, oracleAddress, treasury, adminAddress]);

  // Wire up
  const SEASON_ROLE = ethers.id("SEASON_ROLE");
  await (moveToken as any).grantRole(SEASON_ROLE, deployedAddresses.SeasonController);
  await (zoneNFT as any).setChallengeContract(deployedAddresses.ZoneChallenge);

  console.log("\nDeployed addresses:", JSON.stringify(deployedAddresses, null, 2));
  console.log("\nUpdate shared/src/constants/contracts.ts with these addresses.");
}

main().catch((err) => { console.error(err); process.exit(1); });
