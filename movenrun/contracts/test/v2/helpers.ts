import { ethers } from "hardhat";
import { Signer, TypedDataDomain } from "ethers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import {
  MoveTokenV2,
  GPSOracleV2,
  ZoneNFTV2,
  GearNFTV2,
  MoveVaultV2,
  ZoneChallengeV2,
  SeasonControllerV2,
  MovenGovernorV2,
  TimelockController,
} from "../../typechain-types";

export const SIGNING_DOMAIN_NAME = "MovenRun";
export const SIGNING_DOMAIN_VERSION = "2";

export const TIMELOCK_MIN_DELAY = 2n * 24n * 3600n; // 2 days

// ── EIP-712 type definitions (must match the V2 contracts exactly) ──────────

export const ROUTE_PROOF_TYPES = {
  RouteProof: [
    { name: "recipient", type: "address" },
    { name: "routeHash", type: "bytes32" },
    { name: "distanceMeters", type: "uint256" },
    { name: "hexId", type: "uint64" },
    { name: "deadline", type: "uint256" },
  ],
};

export const ZONE_MINT_TYPES = {
  ZoneMint: [
    { name: "hexId", type: "uint64" },
    { name: "minter", type: "address" },
    { name: "mintCost", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

export const CHALLENGE_DECLARATION_TYPES = {
  ChallengeDeclaration: [
    { name: "challengeId", type: "uint256" },
    { name: "hexId", type: "uint64" },
    { name: "challenger", type: "address" },
    { name: "defender", type: "address" },
    { name: "defenderBaseScore", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

export const SCORE_TYPES = {
  Score: [
    { name: "challengeId", type: "uint256" },
    { name: "hexId", type: "uint64" },
    { name: "submitter", type: "address" },
    { name: "score", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

export const GREAT_BURN_TYPES = {
  GreatBurn: [
    { name: "seasonNumber", type: "uint256" },
    { name: "topHexIds", type: "uint64[]" },
    { name: "yields", type: "uint256[]" },
    { name: "deadline", type: "uint256" },
  ],
};

export function v2Domain(chainId: bigint, verifyingContract: string): TypedDataDomain {
  return {
    name: SIGNING_DOMAIN_NAME,
    version: SIGNING_DOMAIN_VERSION,
    chainId,
    verifyingContract,
  };
}

export async function farDeadline(): Promise<bigint> {
  const block = await ethers.provider.getBlock("latest");
  return BigInt(block!.timestamp) + 7n * 24n * 3600n;
}

// ── Full V2 deployment fixture (mirrors scripts/deploy/baseSepoliaV2.ts) ────

export interface V2Fixture {
  chainId: bigint;
  admin: SignerWithAddress;
  oracle: SignerWithAddress; // oracle operator EOA (signs typed data)
  treasury: SignerWithAddress;
  moveToken: MoveTokenV2;
  gpsOracle: GPSOracleV2;
  zoneNFT: ZoneNFTV2;
  gearNFT: GearNFTV2;
  moveVault: MoveVaultV2;
  zoneChallenge: ZoneChallengeV2;
  seasonController: SeasonControllerV2;
  timelock: TimelockController;
  governor: MovenGovernorV2;
}

export async function deployV2(
  admin: SignerWithAddress,
  oracle: SignerWithAddress,
  treasury: SignerWithAddress
): Promise<V2Fixture> {
  const chainId = (await ethers.provider.getNetwork()).chainId;

  const moveToken = await (await ethers.getContractFactory("MoveTokenV2", admin)).deploy(admin.address);
  await moveToken.waitForDeployment();

  const gpsOracle = await (await ethers.getContractFactory("GPSOracleV2", admin)).deploy(oracle.address);
  await gpsOracle.waitForDeployment();
  await gpsOracle.setMoveToken(await moveToken.getAddress());

  const zoneNFT = await (await ethers.getContractFactory("ZoneNFTV2", admin)).deploy(
    await moveToken.getAddress(),
    await gpsOracle.getAddress()
  );
  await zoneNFT.waitForDeployment();

  const gearNFT = await (await ethers.getContractFactory("GearNFTV2", admin)).deploy(
    await moveToken.getAddress()
  );
  await gearNFT.waitForDeployment();

  const moveVault = await (await ethers.getContractFactory("MoveVaultV2", admin)).deploy(
    await moveToken.getAddress()
  );
  await moveVault.waitForDeployment();

  const zoneChallenge = await (await ethers.getContractFactory("ZoneChallengeV2", admin)).deploy(
    await zoneNFT.getAddress(),
    await moveToken.getAddress(),
    await gpsOracle.getAddress()
  );
  await zoneChallenge.waitForDeployment();

  const seasonController = await (await ethers.getContractFactory("SeasonControllerV2", admin)).deploy(
    await moveToken.getAddress(),
    await zoneNFT.getAddress(),
    await zoneChallenge.getAddress()
  );
  await seasonController.waitForDeployment();

  const timelock = await (await ethers.getContractFactory("TimelockController", admin)).deploy(
    TIMELOCK_MIN_DELAY,
    [], // proposers wired below
    [], // executors wired below
    admin.address
  );
  await timelock.waitForDeployment();

  const governor = await (await ethers.getContractFactory("MovenGovernorV2", admin)).deploy(
    await moveToken.getAddress(),
    await timelock.getAddress()
  );
  await governor.waitForDeployment();

  // ── Role wiring (identical to the deploy script) ──────────────────────────
  const ORACLE_ROLE    = ethers.id("ORACLE_ROLE");
  const SEASON_ROLE    = ethers.id("SEASON_ROLE");
  const CHALLENGE_ROLE = ethers.id("CHALLENGE_ROLE");
  const DAO_ROLE       = ethers.id("DAO_ROLE");

  await moveToken.grantRole(ORACLE_ROLE, await gpsOracle.getAddress());
  await moveToken.grantRole(SEASON_ROLE, await seasonController.getAddress());
  await moveToken.setZoneNFT(await zoneNFT.getAddress());
  await moveToken.setGearNFT(await gearNFT.getAddress());

  await zoneNFT.grantRole(CHALLENGE_ROLE, await zoneChallenge.getAddress());
  await zoneNFT.grantRole(SEASON_ROLE, await seasonController.getAddress());

  await seasonController.setGpsOracle(await gpsOracle.getAddress());
  await seasonController.setDaoTreasury(treasury.address);

  // Governor ↔ Timelock wiring
  const PROPOSER_ROLE  = await timelock.PROPOSER_ROLE();
  const CANCELLER_ROLE = await timelock.CANCELLER_ROLE();
  const EXECUTOR_ROLE  = await timelock.EXECUTOR_ROLE();
  await timelock.grantRole(PROPOSER_ROLE, await governor.getAddress());
  await timelock.grantRole(CANCELLER_ROLE, await governor.getAddress());
  await timelock.grantRole(EXECUTOR_ROLE, ethers.ZeroAddress); // open execution after delay

  // Timelock governs MoveVaultV2
  await moveVault.grantRole(DAO_ROLE, await timelock.getAddress());

  return {
    chainId,
    admin,
    oracle,
    treasury,
    moveToken,
    gpsOracle,
    zoneNFT,
    gearNFT,
    moveVault,
    zoneChallenge,
    seasonController,
    timelock,
    governor,
  };
}

// ── Typed-data signing helpers ───────────────────────────────────────────────

export async function signRouteProof(
  signer: Signer,
  chainId: bigint,
  gpsOracleAddr: string,
  value: { recipient: string; routeHash: string; distanceMeters: bigint; hexId: bigint; deadline: bigint }
) {
  return signer.signTypedData(v2Domain(chainId, gpsOracleAddr), ROUTE_PROOF_TYPES, value);
}

export async function signZoneMint(
  signer: Signer,
  chainId: bigint,
  zoneNFTAddr: string,
  value: { hexId: bigint; minter: string; mintCost: bigint; nonce: bigint; deadline: bigint }
) {
  return signer.signTypedData(v2Domain(chainId, zoneNFTAddr), ZONE_MINT_TYPES, value);
}

export async function signChallengeDeclaration(
  signer: Signer,
  chainId: bigint,
  zoneChallengeAddr: string,
  value: {
    challengeId: bigint;
    hexId: bigint;
    challenger: string;
    defender: string;
    defenderBaseScore: bigint;
    deadline: bigint;
  }
) {
  return signer.signTypedData(v2Domain(chainId, zoneChallengeAddr), CHALLENGE_DECLARATION_TYPES, value);
}

export async function signScore(
  signer: Signer,
  chainId: bigint,
  zoneChallengeAddr: string,
  value: {
    challengeId: bigint;
    hexId: bigint;
    submitter: string;
    score: bigint;
    nonce: bigint;
    deadline: bigint;
  }
) {
  return signer.signTypedData(v2Domain(chainId, zoneChallengeAddr), SCORE_TYPES, value);
}

export async function signGreatBurn(
  signer: Signer,
  chainId: bigint,
  seasonControllerAddr: string,
  value: { seasonNumber: bigint; topHexIds: bigint[]; yields: bigint[]; deadline: bigint }
) {
  return signer.signTypedData(v2Domain(chainId, seasonControllerAddr), GREAT_BURN_TYPES, value);
}

// ── Convenience flows ────────────────────────────────────────────────────────

/// Mint $MOVE to `to` through the V2 oracle route path (hexId 0 = no zone).
export async function mintMoveTo(
  f: V2Fixture,
  to: string,
  distanceMeters: bigint,
  hexId: bigint = 0n
) {
  const routeHash = ethers.hexlify(ethers.randomBytes(32));
  const deadline = await farDeadline();
  const sig = await signRouteProof(f.oracle, f.chainId, await f.gpsOracle.getAddress(), {
    recipient: to,
    routeHash,
    distanceMeters,
    hexId,
    deadline,
  });
  await f.gpsOracle.submitRoute(to, routeHash, distanceMeters, hexId, deadline, sig);
}

/// Mint a Zone Deed to `minter` through the V2 EIP-712 mint path.
export async function mintZoneTo(
  f: V2Fixture,
  minter: SignerWithAddress,
  hexId: bigint,
  mintCost: bigint
) {
  const deadline = await farDeadline();
  const nonce = await f.zoneNFT.mintNonces(minter.address);
  const sig = await signZoneMint(f.oracle, f.chainId, await f.zoneNFT.getAddress(), {
    hexId,
    minter: minter.address,
    mintCost,
    nonce,
    deadline,
  });
  await f.moveToken.connect(minter).approve(await f.zoneNFT.getAddress(), ethers.MaxUint256);
  await f.zoneNFT.connect(minter).mintZone(hexId, mintCost, deadline, sig);
}

/// Declare a challenge on hexId by `challenger` through the V2 path.
export async function declareChallengeOn(
  f: V2Fixture,
  challenger: SignerWithAddress,
  hexId: bigint,
  defenderBaseScore: bigint
): Promise<bigint> {
  const challengeId = await f.zoneChallenge.nextChallengeId();
  const defender = await f.zoneNFT.zoneOwner(hexId);
  const deadline = await farDeadline();
  const sig = await signChallengeDeclaration(f.oracle, f.chainId, await f.zoneChallenge.getAddress(), {
    challengeId,
    hexId,
    challenger: challenger.address,
    defender,
    defenderBaseScore,
    deadline,
  });
  await f.moveToken.connect(challenger).approve(await f.zoneChallenge.getAddress(), ethers.MaxUint256);
  await f.zoneChallenge.connect(challenger).declareChallenge(hexId, defenderBaseScore, deadline, sig);
  return challengeId;
}

/// Submit a score for a challenge participant through the V2 path.
export async function submitScoreFor(
  f: V2Fixture,
  submitter: SignerWithAddress,
  challengeId: bigint,
  hexId: bigint,
  score: bigint
) {
  const deadline = await farDeadline();
  const nonce = await f.zoneChallenge.scoreNonces(submitter.address);
  const sig = await signScore(f.oracle, f.chainId, await f.zoneChallenge.getAddress(), {
    challengeId,
    hexId,
    submitter: submitter.address,
    score,
    nonce,
    deadline,
  });
  await f.zoneChallenge.connect(submitter).submitScore(challengeId, score, deadline, sig);
}
