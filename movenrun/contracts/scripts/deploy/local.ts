import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const oracleOperator = process.env.ORACLE_ADDRESS ?? deployer.address;
  const treasury       = process.env.TREASURY_ADDRESS ?? deployer.address;

  // 1. MoveToken
  const MoveToken = await ethers.getContractFactory("MoveToken");
  const moveToken = await MoveToken.deploy(deployer.address);
  await moveToken.waitForDeployment();
  console.log("MoveToken:", await moveToken.getAddress());

  // 2. GPSOracle
  const GPSOracle = await ethers.getContractFactory("GPSOracle");
  const gpsOracle = await GPSOracle.deploy(oracleOperator);
  await gpsOracle.waitForDeployment();
  console.log("GPSOracle:", await gpsOracle.getAddress());

  // 3. ZoneNFT
  const ZoneNFT = await ethers.getContractFactory("ZoneNFT");
  const zoneNFT = await ZoneNFT.deploy(await moveToken.getAddress(), await gpsOracle.getAddress());
  await zoneNFT.waitForDeployment();
  console.log("ZoneNFT:", await zoneNFT.getAddress());

  // 4. GearNFT
  const GearNFT = await ethers.getContractFactory("GearNFT");
  const gearNFT = await GearNFT.deploy(await moveToken.getAddress());
  await gearNFT.waitForDeployment();
  console.log("GearNFT:", await gearNFT.getAddress());

  // 5. MoveVault
  const MoveVault = await ethers.getContractFactory("MoveVault");
  const moveVault = await MoveVault.deploy(await moveToken.getAddress());
  await moveVault.waitForDeployment();
  console.log("MoveVault:", await moveVault.getAddress());

  // 6. ZoneChallenge
  const ZoneChallenge = await ethers.getContractFactory("ZoneChallenge");
  const zoneChallenge = await ZoneChallenge.deploy(
    await zoneNFT.getAddress(), await moveToken.getAddress(), await gpsOracle.getAddress()
  );
  await zoneChallenge.waitForDeployment();
  console.log("ZoneChallenge:", await zoneChallenge.getAddress());

  // 7. SeasonController
  const SeasonController = await ethers.getContractFactory("SeasonController");
  const seasonController = await SeasonController.deploy(
    await moveToken.getAddress(), await zoneNFT.getAddress(), await zoneChallenge.getAddress()
  );
  await seasonController.waitForDeployment();
  console.log("SeasonController:", await seasonController.getAddress());

  // 8. MovenDAO
  const MovenDAO = await ethers.getContractFactory("MovenDAO");
  const movenDAO = await MovenDAO.deploy(
    await moveToken.getAddress(), await zoneNFT.getAddress(), await moveVault.getAddress()
  );
  await movenDAO.waitForDeployment();
  console.log("MovenDAO:", await movenDAO.getAddress());

  // Wire up roles and contracts
  const MINTER_ROLE   = ethers.id("MINTER_ROLE");
  const ORACLE_ROLE   = ethers.id("ORACLE_ROLE");
  const GOVERNOR_ROLE = ethers.id("GOVERNOR_ROLE");
  const SEASON_ROLE   = ethers.id("SEASON_ROLE");

  await moveToken.grantRole(MINTER_ROLE,   await zoneNFT.getAddress());
  await moveToken.grantRole(ORACLE_ROLE,   await gpsOracle.getAddress());
  await moveToken.grantRole(GOVERNOR_ROLE, await movenDAO.getAddress());
  await moveToken.grantRole(SEASON_ROLE,   await seasonController.getAddress());

  await gpsOracle.setMoveToken(await moveToken.getAddress());
  await zoneNFT.setSeasonController(await seasonController.getAddress());
  await zoneNFT.setChallengeContract(await zoneChallenge.getAddress());
  await zoneChallenge.setSeasonController(await seasonController.getAddress());
  await seasonController.setGpsOracle(await gpsOracle.getAddress());
  await seasonController.setDaoTreasury(treasury);
  await moveToken.setZoneNFT(await zoneNFT.getAddress());

  console.log("\nAll contracts deployed and wired.");
}

main().catch((err) => { console.error(err); process.exit(1); });
