// Shared harness for the V1 characterization suite.
//
// These helpers deploy the EXACT deployed-V1 Solidity source (unchanged) and
// wire it the same way scripts/deploy/baseSepolia.ts does, so the
// characterization tests observe the real, as-deployed behavior. Nothing here
// modifies contract source or the deployment records.
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import type {
  MoveToken,
  GPSOracle,
  ZoneNFT,
  GearNFT,
  MoveVault,
  ZoneChallenge,
  SeasonController,
  MovenDAO,
} from "../../typechain-types";

export const HEX_ID = 613177413693333503n; // H3 resolution-8 hex

export interface Deployment {
  moveToken: MoveToken;
  gpsOracle: GPSOracle;
  zoneNFT: ZoneNFT;
  gearNFT: GearNFT;
  moveVault: MoveVault;
  zoneChallenge: ZoneChallenge;
  seasonController: SeasonController;
  movenDAO: MovenDAO;
  chainId: bigint;
  deployer: SignerWithAddress;
  oracle: SignerWithAddress;
  treasury: SignerWithAddress;
  signers: SignerWithAddress[];
}

/**
 * Deploy the full contract set and apply the same post-deploy wiring as
 * scripts/deploy/baseSepolia.ts. `treasury` is the SeasonController DAO
 * treasury (as in the deploy script's TREASURY_ADDRESS).
 */
export async function deployAll(): Promise<Deployment> {
  const signers = await ethers.getSigners();
  const [deployer, oracle, , , treasury] = signers;
  const chainId = (await ethers.provider.getNetwork()).chainId;

  const moveToken = await (await ethers.getContractFactory("MoveToken")).deploy(deployer.address);
  await moveToken.waitForDeployment();

  const gpsOracle = await (await ethers.getContractFactory("GPSOracle")).deploy(oracle.address);
  await gpsOracle.waitForDeployment();

  const zoneNFT = await (await ethers.getContractFactory("ZoneNFT")).deploy(
    await moveToken.getAddress(),
    await gpsOracle.getAddress(),
  );
  await zoneNFT.waitForDeployment();

  const gearNFT = await (await ethers.getContractFactory("GearNFT")).deploy(await moveToken.getAddress());
  await gearNFT.waitForDeployment();

  const moveVault = await (await ethers.getContractFactory("MoveVault")).deploy(await moveToken.getAddress());
  await moveVault.waitForDeployment();

  const zoneChallenge = await (await ethers.getContractFactory("ZoneChallenge")).deploy(
    await zoneNFT.getAddress(),
    await moveToken.getAddress(),
    await gpsOracle.getAddress(),
  );
  await zoneChallenge.waitForDeployment();

  const seasonController = await (await ethers.getContractFactory("SeasonController")).deploy(
    await moveToken.getAddress(),
    await zoneNFT.getAddress(),
    await zoneChallenge.getAddress(),
  );
  await seasonController.waitForDeployment();

  const movenDAO = await (await ethers.getContractFactory("MovenDAO")).deploy(
    await moveToken.getAddress(),
    await zoneNFT.getAddress(),
    await moveVault.getAddress(),
  );
  await movenDAO.waitForDeployment();

  // Post-deployment wiring — mirrors scripts/deploy/baseSepolia.ts exactly.
  const MINTER_ROLE = ethers.id("MINTER_ROLE");
  const ORACLE_ROLE = ethers.id("ORACLE_ROLE");
  const GOVERNOR_ROLE = ethers.id("GOVERNOR_ROLE");
  const SEASON_ROLE = ethers.id("SEASON_ROLE");

  await moveToken.grantRole(MINTER_ROLE, await zoneNFT.getAddress());
  await moveToken.grantRole(ORACLE_ROLE, await gpsOracle.getAddress());
  await moveToken.grantRole(GOVERNOR_ROLE, await movenDAO.getAddress());
  await moveToken.grantRole(SEASON_ROLE, await seasonController.getAddress());

  await gpsOracle.setMoveToken(await moveToken.getAddress());
  await zoneNFT.setSeasonController(await seasonController.getAddress());
  await zoneNFT.setChallengeContract(await zoneChallenge.getAddress());
  await zoneChallenge.setSeasonController(await seasonController.getAddress());
  await seasonController.setGpsOracle(await gpsOracle.getAddress());
  await seasonController.setDaoTreasury(treasury.address);
  await moveToken.setZoneNFT(await zoneNFT.getAddress());

  return {
    moveToken,
    gpsOracle,
    zoneNFT,
    gearNFT,
    moveVault,
    zoneChallenge,
    seasonController,
    movenDAO,
    chainId,
    deployer,
    oracle,
    treasury,
    signers,
  };
}

// ── Oracle signature builders (match the on-chain tuples, FIX-001) ──────────

export function routeSig(oracle: SignerWithAddress, chainId: bigint) {
  return (to: string, routeHash: string, distanceMeters: bigint, hexId: bigint = 0n) => {
    const message = ethers.solidityPackedKeccak256(
      ["uint256", "address", "bytes32", "uint256", "uint64"],
      [chainId, to, routeHash, distanceMeters, hexId],
    );
    return oracle.signMessage(ethers.getBytes(message));
  };
}

export function zoneMintSig(oracle: SignerWithAddress, chainId: bigint) {
  return (hexId: bigint, to: string, mintCost: bigint) => {
    const sigHash = ethers.solidityPackedKeccak256(
      ["uint256", "uint64", "address", "uint256"],
      [chainId, hexId, to, mintCost],
    );
    return oracle.signMessage(ethers.getBytes(sigHash));
  };
}

export function declareSig(oracle: SignerWithAddress, chainId: bigint) {
  return (hexId: bigint, defender: string, baseScore: bigint) => {
    const message = ethers.solidityPackedKeccak256(
      ["uint256", "uint64", "address", "uint256"],
      [chainId, hexId, defender, baseScore],
    );
    return oracle.signMessage(ethers.getBytes(message));
  };
}

export function scoreSig(oracle: SignerWithAddress, chainId: bigint) {
  return (hexId: bigint, submitter: string, score: bigint) => {
    const message = ethers.solidityPackedKeccak256(
      ["uint256", "uint64", "address", "uint256"],
      [chainId, hexId, submitter, score],
    );
    return oracle.signMessage(ethers.getBytes(message));
  };
}

export function greatBurnSig(oracle: SignerWithAddress, chainId: bigint) {
  return (seasonNumber: bigint, topHexIds: bigint[], yields: bigint[]) => {
    const payload = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "uint256", "uint64[]", "uint256[]"],
        [chainId, seasonNumber, topHexIds, yields],
      ),
    );
    return oracle.signMessage(ethers.getBytes(payload));
  };
}

/** Mint $MOVE to `to` via a signed GPS route (hexId 0 = no zone tax). */
export async function fundMove(d: Deployment, to: SignerWithAddress, distanceMeters: bigint) {
  const sign = routeSig(d.oracle, d.chainId);
  const routeHash = ethers.hexlify(ethers.randomBytes(32));
  const sig = await sign(to.address, routeHash, distanceMeters, 0n);
  await d.gpsOracle.submitRoute(to.address, routeHash, distanceMeters, 0n, sig);
}

/** Mint a zone NFT to `to`. Assumes `to` has approved ZoneNFT to spend $MOVE. */
export async function mintZoneTo(d: Deployment, to: SignerWithAddress, hexId: bigint, mintCost: bigint) {
  const sign = zoneMintSig(d.oracle, d.chainId);
  const sig = await sign(hexId, to.address, mintCost);
  await d.zoneNFT.connect(to).mintZone(hexId, mintCost, sig);
}
