import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

export const RULES_VERSION = 1;
export const HOME_ADVANTAGE_BPS = 500;
export const TIMELOCK_DELAY = 3600;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const ZERO_BYTES32 = "0x" + "0".repeat(64);
export const SUITE_VERSION = "movenrun-v3.0.0";

export const ONE = 10n ** 18n;
export const MAX_LIFETIME_MINTED = 1_000_000_000n * ONE;
export const PLAYER_MOVEMENT_ALLOCATION = 400_000_000n * ONE;
export const SEASON_ONE_BUDGET = 9_000_000n * ONE;
export const SEASON_LENGTH_DAYS = 90n;
/** Reward budget available to settlement day one: the season budget spread over ninety days. */
export const DAY_ONE_POOL = SEASON_ONE_BUDGET / SEASON_LENGTH_DAYS;

export interface Suite {
  deployer: HardhatEthersSigner;
  admin: HardhatEthersSigner;
  guardian: HardhatEthersSigner;
  settlementSigner: HardhatEthersSigner;
  reconciliationSigner: HardhatEthersSigner;
  deedSigner: HardhatEthersSigner;
  contestScoreSigner: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  carol: HardhatEthersSigner;
  relayer: HardhatEthersSigner;
  timelock: any;
  token: any;
  rewards: any;
  settlement: any;
  deed: any;
  deedClaims: any;
  contests: any;
  marketplace: any;
  registry: any;
  addresses: Record<string, string>;
  chainId: number;
}

/**
 * Deploys the nine V3 contracts exactly as scripts/v3/deployBaseSepolia.ts does: same
 * constructor order, same one-time wiring, same bootstrap freeze, and the timelock as the
 * only delayed administrator. Every role is a distinct account, and the deployer keeps no
 * administrative role once wiring completes.
 */
export async function deploySuite(): Promise<Suite> {
  const [
    deployer,
    admin,
    guardian,
    settlementSigner,
    reconciliationSigner,
    deedSigner,
    contestScoreSigner,
    alice,
    bob,
    carol,
    relayer,
  ] = await ethers.getSigners();

  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  const timelock = await (
    await ethers.getContractFactory("MovenRunTimelock")
  ).deploy(TIMELOCK_DELAY, [admin.address], [admin.address], ZERO_ADDRESS);
  const timelockAddress = await timelock.getAddress();

  const token = await (
    await ethers.getContractFactory("MovenRunToken")
  ).deploy(timelockAddress, deployer.address);
  const tokenAddress = await token.getAddress();

  const rewards = await (
    await ethers.getContractFactory("MovenRunRewards")
  ).deploy(tokenAddress, deployer.address);
  const rewardsAddress = await rewards.getAddress();

  const settlement = await (
    await ethers.getContractFactory("MovenRunSettlement")
  ).deploy(
    timelockAddress,
    guardian.address,
    tokenAddress,
    rewardsAddress,
    settlementSigner.address,
    reconciliationSigner.address,
    RULES_VERSION
  );
  const settlementAddress = await settlement.getAddress();

  const deed = await (
    await ethers.getContractFactory("MovenRunDeed")
  ).deploy(timelockAddress, deployer.address);
  const deedAddress = await deed.getAddress();

  const deedClaims = await (
    await ethers.getContractFactory("MovenRunDeedClaims")
  ).deploy(
    timelockAddress,
    guardian.address,
    tokenAddress,
    deedAddress,
    deedSigner.address,
    RULES_VERSION
  );
  const deedClaimsAddress = await deedClaims.getAddress();

  const contests = await (
    await ethers.getContractFactory("MovenRunContests")
  ).deploy(
    timelockAddress,
    guardian.address,
    tokenAddress,
    deedAddress,
    contestScoreSigner.address,
    HOME_ADVANTAGE_BPS,
    RULES_VERSION
  );
  const contestsAddress = await contests.getAddress();

  const marketplace = await (
    await ethers.getContractFactory("MovenRunMarketplace")
  ).deploy(tokenAddress, deedAddress);

  const registry = await (
    await ethers.getContractFactory("MovenRunRegistry")
  ).deploy(timelockAddress, deployer.address);

  await (await rewards.configureSettlement(settlementAddress)).wait();
  await (await deed.configureContracts(deedClaimsAddress, contestsAddress)).wait();
  await (
    await token.configureCore(settlementAddress, rewardsAddress, [deedClaimsAddress, contestsAddress])
  ).wait();
  await (await token.finalizeBootstrap()).wait();
  await (
    await registry.publishDeployment({
      suiteVersion: SUITE_VERSION,
      chainId,
      timelock: timelockAddress,
      token: tokenAddress,
      rewards: rewardsAddress,
      settlement: settlementAddress,
      deed: deedAddress,
      deedClaims: deedClaimsAddress,
      contests: contestsAddress,
      marketplace: await marketplace.getAddress(),
      recordedAt: 0,
    })
  ).wait();

  return {
    deployer,
    admin,
    guardian,
    settlementSigner,
    reconciliationSigner,
    deedSigner,
    contestScoreSigner,
    alice,
    bob,
    carol,
    relayer,
    timelock,
    token,
    rewards,
    settlement,
    deed,
    deedClaims,
    contests,
    marketplace,
    registry,
    chainId,
    addresses: {
      timelock: timelockAddress,
      token: tokenAddress,
      rewards: rewardsAddress,
      settlement: settlementAddress,
      deed: deedAddress,
      deedClaims: deedClaimsAddress,
      contests: contestsAddress,
      marketplace: await marketplace.getAddress(),
      registry: await registry.getAddress(),
    },
  };
}

/** Runs one administrative call through the real timelock, delay included. */
export async function execViaTimelock(
  fx: Suite,
  target: string,
  data: string,
  salt: string = ZERO_BYTES32
): Promise<void> {
  await (
    await fx.timelock.connect(fx.admin).schedule(target, 0, data, ZERO_BYTES32, salt, TIMELOCK_DELAY)
  ).wait();
  await time.increase(TIMELOCK_DELAY + 1);
  await (
    await fx.timelock.connect(fx.admin).execute(target, 0, data, ZERO_BYTES32, salt)
  ).wait();
}

/** Opens a city by setting how many deeds a single holder may hold inside it. */
export async function configureCityCap(fx: Suite, cityId: number, capPerHolder: number) {
  await execViaTimelock(
    fx,
    fx.addresses.deed,
    fx.deed.interface.encodeFunctionData("configureCityConcentrationCap", [cityId, capPerHolder]),
    ethers.id(`city-cap-${cityId}-${capPerHolder}`)
  );
}

// ---------------------------------------------------------------------------
// EIP-712 authorizations
// ---------------------------------------------------------------------------

export const SETTLEMENT_TYPES = {
  SettlementAuthorization: [
    { name: "rulesVersion", type: "uint16" },
    { name: "seasonId", type: "uint32" },
    { name: "dayId", type: "uint32" },
    { name: "merkleRoot", type: "bytes32" },
    { name: "grossIssuance", type: "uint256" },
    { name: "lockedClaims", type: "uint256" },
    { name: "liquidMovementClaims", type: "uint256" },
    { name: "tollCredits", type: "uint256" },
    { name: "automaticBurn", type: "uint256" },
    { name: "tollBase", type: "uint256" },
    { name: "participantCount", type: "uint64" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint64" },
  ],
};

export const ELIGIBILITY_TYPES = {
  DeedEligibilityAttestation: [
    { name: "claimant", type: "address" },
    { name: "h3CellId", type: "uint64" },
    { name: "cityId", type: "uint32" },
    { name: "solidGround", type: "bool" },
    { name: "tenureDays", type: "uint32" },
    { name: "distinctCrossers", type: "uint32" },
    { name: "trafficDays", type: "uint32" },
    { name: "relatedTrafficExcluded", type: "bool" },
    { name: "claimFee", type: "uint256" },
    { name: "rulesVersion", type: "uint16" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint64" },
  ],
};

export const DECLARATION_TYPES = {
  ContestDeclarationAuthorization: [
    { name: "challenger", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "fortificationBps", type: "uint16" },
    { name: "entryFee", type: "uint256" },
    { name: "rulesVersion", type: "uint16" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint64" },
  ],
};

export const SCORE_TYPES = {
  ContestScoreAuthorization: [
    { name: "contestId", type: "uint256" },
    { name: "participant", type: "address" },
    { name: "scoringDay", type: "uint8" },
    { name: "score", type: "uint256" },
    { name: "rulesVersion", type: "uint16" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint64" },
  ],
};

export function domain(name: string, chainId: number, verifyingContract: string) {
  return { name, version: "3", chainId, verifyingContract };
}

export async function futureExpiry(secondsAhead = 3600): Promise<number> {
  return (await time.latest()) + secondsAhead;
}

let nonceCounter = 1n;
export function nextNonce(): bigint {
  nonceCounter += 1n;
  return nonceCounter;
}

export interface SettlementAuthorization {
  rulesVersion: number;
  seasonId: number;
  dayId: number;
  merkleRoot: string;
  grossIssuance: bigint;
  lockedClaims: bigint;
  liquidMovementClaims: bigint;
  tollCredits: bigint;
  automaticBurn: bigint;
  tollBase: bigint;
  participantCount: number;
  nonce: bigint;
  expiry: number;
}

/**
 * Builds a settlement authorization that satisfies the accounting identity by construction:
 * every component the caller does not pin is absorbed into the locked runner claims.
 */
export async function settlementAuthorization(
  overrides: Partial<SettlementAuthorization> & { dayId: number; grossIssuance: bigint }
): Promise<SettlementAuthorization> {
  const liquidMovementClaims = overrides.liquidMovementClaims ?? 0n;
  const tollCredits = overrides.tollCredits ?? 0n;
  const automaticBurn = overrides.automaticBurn ?? 0n;
  const lockedClaims =
    overrides.lockedClaims ??
    overrides.grossIssuance - liquidMovementClaims - tollCredits - automaticBurn;

  return {
    rulesVersion: RULES_VERSION,
    seasonId: Math.floor((overrides.dayId - 1) / 90) + 1,
    merkleRoot: ZERO_BYTES32,
    participantCount: 1,
    nonce: nextNonce(),
    expiry: await futureExpiry(),
    ...overrides,
    lockedClaims,
    liquidMovementClaims,
    tollCredits,
    automaticBurn,
    tollBase: overrides.tollBase ?? 0n,
  };
}

/** Signs a settlement authorization with both independent signers. */
export async function signSettlement(fx: Suite, authorization: SettlementAuthorization) {
  const dom = domain("MovenRunSettlement", fx.chainId, fx.addresses.settlement);
  return {
    settlementSignature: await fx.settlementSigner.signTypedData(dom, SETTLEMENT_TYPES, authorization),
    reconciliationSignature: await fx.reconciliationSigner.signTypedData(
      dom,
      SETTLEMENT_TYPES,
      authorization
    ),
  };
}

/** Publishes a fully authorized settlement day through an unprivileged relayer. */
export async function publishSettlement(fx: Suite, authorization: SettlementAuthorization) {
  const { settlementSignature, reconciliationSignature } = await signSettlement(fx, authorization);
  return fx.settlement
    .connect(fx.relayer)
    .publishSettlement(authorization, settlementSignature, reconciliationSignature);
}

export interface EligibilityAttestation {
  claimant: string;
  h3CellId: bigint;
  cityId: number;
  solidGround: boolean;
  tenureDays: number;
  distinctCrossers: number;
  trafficDays: number;
  relatedTrafficExcluded: boolean;
  claimFee: bigint;
  rulesVersion: number;
  nonce: bigint;
  expiry: number;
}

export async function eligibilityAttestation(
  overrides: Partial<EligibilityAttestation> & { claimant: string; h3CellId: bigint; cityId: number }
): Promise<EligibilityAttestation> {
  return {
    solidGround: true,
    tenureDays: 30,
    distinctCrossers: 40,
    trafficDays: 15,
    relatedTrafficExcluded: true,
    claimFee: 0n,
    rulesVersion: RULES_VERSION,
    nonce: nextNonce(),
    expiry: await futureExpiry(),
    ...overrides,
  };
}

export async function signEligibility(fx: Suite, attestation: EligibilityAttestation) {
  return fx.deedSigner.signTypedData(
    domain("MovenRunDeedClaims", fx.chainId, fx.addresses.deedClaims),
    ELIGIBILITY_TYPES,
    attestation
  );
}

export async function claimDeed(
  fx: Suite,
  claimant: HardhatEthersSigner,
  h3CellId: bigint,
  cityId: number,
  overrides: Partial<EligibilityAttestation> = {}
) {
  const attestation = await eligibilityAttestation({
    claimant: claimant.address,
    h3CellId,
    cityId,
    ...overrides,
  });
  const signature = await signEligibility(fx, attestation);
  return fx.deedClaims.connect(claimant).claim(attestation, signature, attestation.claimFee);
}

export interface DeclarationAuthorization {
  challenger: string;
  tokenId: bigint;
  fortificationBps: number;
  entryFee: bigint;
  rulesVersion: number;
  nonce: bigint;
  expiry: number;
}

export async function declarationAuthorization(
  overrides: Partial<DeclarationAuthorization> & { challenger: string; tokenId: bigint }
): Promise<DeclarationAuthorization> {
  return {
    fortificationBps: 0,
    entryFee: 0n,
    rulesVersion: RULES_VERSION,
    nonce: nextNonce(),
    expiry: await futureExpiry(),
    ...overrides,
  };
}

export async function signDeclaration(fx: Suite, authorization: DeclarationAuthorization) {
  return fx.contestScoreSigner.signTypedData(
    domain("MovenRunContests", fx.chainId, fx.addresses.contests),
    DECLARATION_TYPES,
    authorization
  );
}

export async function declareContest(
  fx: Suite,
  challenger: HardhatEthersSigner,
  tokenId: bigint,
  overrides: Partial<DeclarationAuthorization> = {}
) {
  const authorization = await declarationAuthorization({
    challenger: challenger.address,
    tokenId,
    ...overrides,
  });
  const signature = await signDeclaration(fx, authorization);
  return fx.contests.connect(challenger).declareContest(authorization, signature, authorization.entryFee);
}

export async function submitScore(
  fx: Suite,
  contestId: bigint,
  participant: string,
  scoringDay: number,
  score: bigint
) {
  const authorization = {
    contestId,
    participant,
    scoringDay,
    score,
    rulesVersion: RULES_VERSION,
    nonce: nextNonce(),
    expiry: await futureExpiry(30 * 24 * 3600),
  };
  const signature = await fx.contestScoreSigner.signTypedData(
    domain("MovenRunContests", fx.chainId, fx.addresses.contests),
    SCORE_TYPES,
    authorization
  );
  return fx.contests.connect(fx.relayer).submitScore(authorization, signature);
}

// ---------------------------------------------------------------------------
// Reward Merkle tree
// ---------------------------------------------------------------------------

export interface RewardEntry {
  leafIndex: number;
  account: string;
  lockedAmount: bigint;
  liquidAmount: bigint;
}

const REWARD_LEAF_TYPEHASH = ethers.id(
  "MovenRunDailyRewardLeaf(uint256 chainId,address rewards,uint32 dayId,uint256 leafIndex,address account,uint256 lockedAmount,uint256 liquidAmount)"
);

export function rewardLeaf(
  chainId: number,
  rewardsAddress: string,
  dayId: number,
  entry: RewardEntry
): string {
  const inner = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256", "address", "uint32", "uint256", "address", "uint256", "uint256"],
      [
        REWARD_LEAF_TYPEHASH,
        chainId,
        rewardsAddress,
        dayId,
        entry.leafIndex,
        entry.account,
        entry.lockedAmount,
        entry.liquidAmount,
      ]
    )
  );
  return ethers.keccak256(inner);
}

function hashPair(a: string, b: string): string {
  return BigInt(a) <= BigInt(b)
    ? ethers.keccak256(ethers.concat([a, b]))
    : ethers.keccak256(ethers.concat([b, a]));
}

/**
 * Builds the sorted-pair Merkle tree MovenRunRewards verifies against. Leaves are already
 * double-hashed, so no internal node can be reinterpreted as a leaf.
 */
export function buildRewardTree(chainId: number, rewardsAddress: string, dayId: number, entries: RewardEntry[]) {
  const leaves = entries.map((entry) => rewardLeaf(chainId, rewardsAddress, dayId, entry));
  const layers: string[][] = [leaves];

  while (layers[layers.length - 1].length > 1) {
    const current = layers[layers.length - 1];
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      next.push(i + 1 < current.length ? hashPair(current[i], current[i + 1]) : current[i]);
    }
    layers.push(next);
  }

  const proofFor = (leafIndex: number): string[] => {
    const proof: string[] = [];
    let index = entries.findIndex((entry) => entry.leafIndex === leafIndex);
    if (index < 0) throw new Error(`no reward entry with leafIndex ${leafIndex}`);
    for (let level = 0; level < layers.length - 1; level += 1) {
      const layer = layers[level];
      const pairIndex = index % 2 === 0 ? index + 1 : index - 1;
      if (pairIndex < layer.length) proof.push(layer[pairIndex]);
      index = Math.floor(index / 2);
    }
    return proof;
  };

  return { root: layers[layers.length - 1][0], leaves, proofFor };
}

// ---------------------------------------------------------------------------
// Funding test accounts through the real issuance path
// ---------------------------------------------------------------------------

export interface Grant {
  account: string;
  amount: bigint;
}

/** Issues locked MOVE to accounts the only way the suite allows: a settled day, then claims. */
export async function fundLockedMove(fx: Suite, dayId: number, grants: Grant[]) {
  const entries = grants.map((grant, index) => ({
    leafIndex: index,
    account: grant.account,
    lockedAmount: grant.amount,
    liquidAmount: 0n,
  }));
  const total = grants.reduce((sum, grant) => sum + grant.amount, 0n);
  const tree = buildRewardTree(fx.chainId, fx.addresses.rewards, dayId, entries);

  await (
    await publishSettlement(
      fx,
      await settlementAuthorization({
        dayId,
        grossIssuance: total,
        merkleRoot: tree.root,
        participantCount: grants.length,
      })
    )
  ).wait();

  for (const entry of entries) {
    await (
      await fx.rewards
        .connect(fx.relayer)
        .claim(dayId, entry.leafIndex, entry.account, entry.lockedAmount, 0n, tree.proofFor(entry.leafIndex))
    ).wait();
  }
}

/** Issues liquid MOVE, which first needs the timelock to open liquid issuance capacity. */
export async function fundLiquidMove(fx: Suite, dayId: number, grants: Grant[]) {
  const total = grants.reduce((sum, grant) => sum + grant.amount, 0n);
  await execViaTimelock(
    fx,
    fx.addresses.settlement,
    fx.settlement.interface.encodeFunctionData("raiseLiquidIssuanceAllowance", [total]),
    ethers.id(`liquid-allowance-${dayId}-${total}`)
  );

  const entries = grants.map((grant, index) => ({
    leafIndex: index,
    account: grant.account,
    lockedAmount: 0n,
    liquidAmount: grant.amount,
  }));
  const tree = buildRewardTree(fx.chainId, fx.addresses.rewards, dayId, entries);

  await (
    await publishSettlement(
      fx,
      await settlementAuthorization({
        dayId,
        grossIssuance: total,
        lockedClaims: 0n,
        liquidMovementClaims: total,
        merkleRoot: tree.root,
        participantCount: grants.length,
      })
    )
  ).wait();

  for (const entry of entries) {
    await (
      await fx.rewards
        .connect(fx.relayer)
        .claim(dayId, entry.leafIndex, entry.account, 0n, entry.liquidAmount, tree.proofFor(entry.leafIndex))
    ).wait();
  }
}
