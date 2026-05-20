import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const oracleAddress = process.env.ORACLE_ADDRESS ?? deployer.address;
  const adminAddress  = process.env.ADMIN_ADDRESS  ?? deployer.address;
  const treasury      = process.env.TREASURY_ADDRESS ?? deployer.address;

  // 1. MoveToken
  const MoveToken = await ethers.getContractFactory("MoveToken");
  const moveToken = await MoveToken.deploy(oracleAddress, adminAddress);
  await moveToken.waitForDeployment();
  console.log("MoveToken:", await moveToken.getAddress());

  // 2. ZoneNFT
  const ZoneNFT = await ethers.getContractFactory("ZoneNFT");
  const zoneNFT = await ZoneNFT.deploy(await moveToken.getAddress(), oracleAddress, adminAddress);
  await zoneNFT.waitForDeployment();
  console.log("ZoneNFT:", await zoneNFT.getAddress());

  // 3. GearNFT
  const GearNFT = await ethers.getContractFactory("GearNFT");
  const gearNFT = await GearNFT.deploy(await moveToken.getAddress(), adminAddress);
  await gearNFT.waitForDeployment();
  console.log("GearNFT:", await gearNFT.getAddress());

  // 4. ZoneChallenge
  const ZoneChallenge = await ethers.getContractFactory("ZoneChallenge");
  const zoneChallenge = await ZoneChallenge.deploy(
    await moveToken.getAddress(), await zoneNFT.getAddress(), oracleAddress, adminAddress
  );
  await zoneChallenge.waitForDeployment();
  console.log("ZoneChallenge:", await zoneChallenge.getAddress());

  // 5. MoveVault
  const MoveVault = await ethers.getContractFactory("MoveVault");
  const moveVault = await MoveVault.deploy(await moveToken.getAddress(), adminAddress);
  await moveVault.waitForDeployment();
  console.log("MoveVault:", await moveVault.getAddress());

  // 6. MovenDAO
  const MovenDAO = await ethers.getContractFactory("MovenDAO");
  const movenDAO = await MovenDAO.deploy(
    await moveToken.getAddress(), await moveVault.getAddress(), adminAddress
  );
  await movenDAO.waitForDeployment();
  console.log("MovenDAO:", await movenDAO.getAddress());

  // 7. SeasonController
  const SeasonController = await ethers.getContractFactory("SeasonController");
  const seasonController = await SeasonController.deploy(
    await moveToken.getAddress(), await zoneNFT.getAddress(), oracleAddress, treasury, adminAddress
  );
  await seasonController.waitForDeployment();
  console.log("SeasonController:", await seasonController.getAddress());

  // Wire up roles
  const SEASON_ROLE = ethers.id("SEASON_ROLE");
  await moveToken.grantRole(SEASON_ROLE, await seasonController.getAddress());
  await zoneNFT.setChallengeContract(await zoneChallenge.getAddress());

  console.log("\nAll contracts deployed and wired.");
}

main().catch((err) => { console.error(err); process.exit(1); });
