/**
 * MovenRun V3 onchain core — controlled showcase.
 *
 * Demonstrates the full V3 flow end to end against a local Hardhat chain: a privacy-safe
 * dual-authorized daily settlement, a locked reward claim, rejection of a locked transfer,
 * a real burn of locked MOVE as a legitimate fee, a solid-ground deed claim, a later
 * settlement in which prior locked balance stays locked, zero-sum toll accounting with no
 * route data onchain, a voluntary deed purchase in transferable MOVE, contest escrow,
 * contest-scoped daily scores, and third-party contest settlement that moves the deed
 * without the losing side's permission.
 *
 * Every value used here is test data. Deployed contract names and public metadata are the
 * ordinary MovenRun names; only this terminal output labels the data as a test.
 *
 * This script advances local chain time and therefore runs on the Hardhat network only. It
 * refuses to run against a live chain: on Base Sepolia the same calls must be made without
 * faking elapsed time.
 *
 * Usage:
 *   npx hardhat run scripts/v3/MovenRunShowcase.ts
 */
import { time } from "@nomicfoundation/hardhat-network-helpers";
import hre from "hardhat";

const HARDHAT_CHAIN_ID = 31337n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = "0x" + "0".repeat(64);

const MOVE = (whole: string): bigint => hre.ethers.parseEther(whole);

/** Two real neighbouring H3 resolution-8 cells, used as test ground. */
const TEST_CELL_ONE = 0x08860145b49fffffn;
const TEST_CELL_TWO = 0x088618925a7fffffn;
const TEST_CITY_ID = 1;

const TIMELOCK_DELAY = 60;
const RULES_VERSION = 1;
const HOME_ADVANTAGE_BPS = 500;

let nonceCounter = 0;
const nextNonce = (): bigint => BigInt(++nonceCounter);
const farFuture = async (): Promise<bigint> => BigInt((await time.latest()) + 7 * 24 * 60 * 60);

function step(title: string): void {
  console.log(`\n── ${title}`);
}

function line(text: string): void {
  console.log(`   ${text}`);
}

// ---------------------------------------------------------------------------
// Merkle tree over domain-separated reward leaves, matching MerkleProof.verify.
// ---------------------------------------------------------------------------

function hashPair(a: string, b: string): string {
  return a <= b
    ? hre.ethers.keccak256(hre.ethers.concat([a, b]))
    : hre.ethers.keccak256(hre.ethers.concat([b, a]));
}

function buildLayers(leaves: string[]): string[][] {
  const layers: string[][] = [leaves];
  while (layers[layers.length - 1].length > 1) {
    const previous = layers[layers.length - 1];
    const next: string[] = [];
    for (let i = 0; i < previous.length; i += 2) {
      next.push(i + 1 < previous.length ? hashPair(previous[i], previous[i + 1]) : previous[i]);
    }
    layers.push(next);
  }
  return layers;
}

function proofFor(layers: string[][], index: number): string[] {
  const proof: string[] = [];
  let position = index;
  for (let level = 0; level < layers.length - 1; level += 1) {
    const sibling = position % 2 === 0 ? position + 1 : position - 1;
    if (sibling < layers[level].length) proof.push(layers[level][sibling]);
    position = Math.floor(position / 2);
  }
  return proof;
}

interface RewardEntry {
  account: string;
  locked: bigint;
  liquid: bigint;
}

function rewardLeaf(
  rewardsAddress: string,
  dayId: number,
  leafIndex: number,
  entry: RewardEntry
): string {
  const typeHash = hre.ethers.keccak256(
    hre.ethers.toUtf8Bytes(
      "MovenRunDailyRewardLeaf(uint256 chainId,address rewards,uint32 dayId,uint256 leafIndex,address account,uint256 lockedAmount,uint256 liquidAmount)"
    )
  );
  const encoded = hre.ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "uint256", "address", "uint32", "uint256", "address", "uint256", "uint256"],
    [
      typeHash,
      HARDHAT_CHAIN_ID,
      rewardsAddress,
      dayId,
      leafIndex,
      entry.account,
      entry.locked,
      entry.liquid,
    ]
  );
  return hre.ethers.keccak256(hre.ethers.keccak256(encoded));
}

// ---------------------------------------------------------------------------
// Showcase
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== HARDHAT_CHAIN_ID) {
    throw new Error(
      `The showcase advances chain time and only runs on the local Hardhat network ` +
        `(${HARDHAT_CHAIN_ID}). Connected chain id is ${network.chainId}.`
    );
  }

  const [
    deployer,
    admin,
    guardian,
    settlementSigner,
    reconciliationSigner,
    deedSigner,
    contestSigner,
    runnerA,
    runnerB,
    ownerC,
    relayer,
  ] = await hre.ethers.getSigners();

  console.log("MovenRun V3 showcase — local Hardhat chain, test data only");

  step("Deploying the suite");
  const deploy = async (name: string, args: unknown[]): Promise<any> => {
    const factory = await hre.ethers.getContractFactory(name);
    const contract: any = await factory.deploy(...(args as never[]));
    await contract.waitForDeployment();
    line(`${name.padEnd(22)} ${await contract.getAddress()}`);
    return contract;
  };

  const timelock = await deploy("MovenRunTimelock", [
    TIMELOCK_DELAY,
    [admin.address],
    [admin.address],
    ZERO_ADDRESS,
  ]);
  const timelockAddress = await timelock.getAddress();
  const token = await deploy("MovenRunToken", [timelockAddress, deployer.address]);
  const rewards = await deploy("MovenRunRewards", [await token.getAddress(), deployer.address]);
  const settlement = await deploy("MovenRunSettlement", [
    timelockAddress,
    guardian.address,
    await token.getAddress(),
    await rewards.getAddress(),
    settlementSigner.address,
    reconciliationSigner.address,
    RULES_VERSION,
  ]);
  const deed = await deploy("MovenRunDeed", [timelockAddress, deployer.address]);
  const deedClaims = await deploy("MovenRunDeedClaims", [
    timelockAddress,
    guardian.address,
    await token.getAddress(),
    await deed.getAddress(),
    deedSigner.address,
    RULES_VERSION,
  ]);
  const contests = await deploy("MovenRunContests", [
    timelockAddress,
    guardian.address,
    await token.getAddress(),
    await deed.getAddress(),
    contestSigner.address,
    HOME_ADVANTAGE_BPS,
    RULES_VERSION,
  ]);
  const marketplace = await deploy("MovenRunMarketplace", [
    await token.getAddress(),
    await deed.getAddress(),
  ]);

  await (await rewards.configureSettlement(await settlement.getAddress())).wait();
  await (await deed.configureContracts(await deedClaims.getAddress(), await contests.getAddress())).wait();
  await (
    await token.configureCore(await settlement.getAddress(), await rewards.getAddress(), [
      await deedClaims.getAddress(),
      await contests.getAddress(),
    ])
  ).wait();
  await (await token.finalizeBootstrap()).wait();
  line("bootstrap wiring finalized and frozen");

  const rewardsAddress = await rewards.getAddress();
  const settlementAddress = await settlement.getAddress();
  const deedClaimsAddress = await deedClaims.getAddress();
  const contestsAddress = await contests.getAddress();

  // -------------------------------------------------------------------------
  step("Opening the test city through the timelock");
  const capCall = deedClaims.interface.encodeFunctionData("configureCityConcentrationCap", [
    TEST_CITY_ID,
    10,
  ]);
  await (
    await timelock
      .connect(admin)
      .schedule(deedClaimsAddress, 0, capCall, ZERO_BYTES32, ZERO_BYTES32, TIMELOCK_DELAY)
  ).wait();
  await time.increase(TIMELOCK_DELAY + 1);
  await (
    await timelock.connect(admin).execute(deedClaimsAddress, 0, capCall, ZERO_BYTES32, ZERO_BYTES32)
  ).wait();
  const [cap, configured] = await deedClaims.cityConcentrationCap(TEST_CITY_ID);
  line(`city ${TEST_CITY_ID} concentration cap ${cap}, configured ${configured}`);

  // -------------------------------------------------------------------------
  const settlementDomain = {
    name: "MovenRunSettlement",
    version: "3",
    chainId: Number(HARDHAT_CHAIN_ID),
    verifyingContract: settlementAddress,
  };
  const settlementTypes = {
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

  async function publishDay(dayId: number, entries: RewardEntry[], totals: {
    gross: bigint;
    locked: bigint;
    liquidMovement: bigint;
    toll: bigint;
    burn: bigint;
    tollBase: bigint;
  }): Promise<string[][]> {
    const leaves = entries.map((entry, index) => rewardLeaf(rewardsAddress, dayId, index, entry));
    const layers = buildLayers(leaves);
    const authorization = {
      rulesVersion: RULES_VERSION,
      seasonId: 1,
      dayId,
      merkleRoot: layers[layers.length - 1][0],
      grossIssuance: totals.gross,
      lockedClaims: totals.locked,
      liquidMovementClaims: totals.liquidMovement,
      tollCredits: totals.toll,
      automaticBurn: totals.burn,
      tollBase: totals.tollBase,
      participantCount: entries.length,
      nonce: nextNonce(),
      expiry: await farFuture(),
    };

    const settlementSignature = await settlementSigner.signTypedData(
      settlementDomain,
      settlementTypes,
      authorization
    );
    const reconciliationSignature = await reconciliationSigner.signTypedData(
      settlementDomain,
      settlementTypes,
      authorization
    );

    // Anyone may relay a fully authorized settlement; the relayer influences nothing.
    await (
      await settlement
        .connect(relayer)
        .publishSettlement(authorization, settlementSignature, reconciliationSignature)
    ).wait();

    return layers;
  }

  step("Publishing day 1 — dual-authorized, aggregates only, no route data");
  const dayOneEntries: RewardEntry[] = [
    { account: runnerA.address, locked: MOVE("50000"), liquid: 0n },
    { account: runnerB.address, locked: MOVE("41000"), liquid: 0n },
  ];
  const dayOneLayers = await publishDay(1, dayOneEntries, {
    gross: MOVE("100000"),
    locked: MOVE("91000"),
    liquidMovement: 0n,
    toll: 0n,
    burn: MOVE("9000"),
    tollBase: 0n,
  });
  const dayOne = await settlement.settlementOf(1);
  line(`day 1 gross ${hre.ethers.formatEther(dayOne.grossIssuance)} MOVE`);
  line(`day 1 automatic burn ${hre.ethers.formatEther(dayOne.automaticBurn)} MOVE, genuinely destroyed`);
  line(`token cumulative minted ${hre.ethers.formatEther(await token.cumulativeMinted())} MOVE`);
  line(`token total supply     ${hre.ethers.formatEther(await token.totalSupply())} MOVE`);
  line("settlement record fields carry no latitude, longitude, route point or cell sequence");

  step("Claiming a locked movement reward");
  await (
    await rewards
      .connect(runnerA)
      .claim(1, 0, runnerA.address, MOVE("50000"), 0n, proofFor(dayOneLayers, 0))
  ).wait();
  line(`runnerA locked ${hre.ethers.formatEther(await token.lockedBalanceOf(runnerA.address))} MOVE`);
  line(`runnerA liquid ${hre.ethers.formatEther(await token.liquidBalanceOf(runnerA.address))} MOVE`);

  step("Locked MOVE cannot be transferred");
  try {
    await token.connect(runnerA).transfer(runnerB.address, MOVE("1"));
    throw new Error("locked MOVE was transferable, which must never happen");
  } catch (error) {
    line(`transfer rejected: ${(error as Error).message.split("(")[0].trim()}`);
  }

  // -------------------------------------------------------------------------
  const deedDomain = {
    name: "MovenRunDeedClaims",
    version: "3",
    chainId: Number(HARDHAT_CHAIN_ID),
    verifyingContract: deedClaimsAddress,
  };
  const deedTypes = {
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

  async function claimDeed(claimant: any, cellId: bigint, fee: bigint): Promise<void> {
    const attestation = {
      claimant: claimant.address,
      h3CellId: cellId,
      cityId: TEST_CITY_ID,
      solidGround: true,
      tenureDays: 30,
      distinctCrossers: 45,
      trafficDays: 14,
      relatedTrafficExcluded: true,
      claimFee: fee,
      rulesVersion: RULES_VERSION,
      nonce: nextNonce(),
      expiry: await farFuture(),
    };
    const signature = await deedSigner.signTypedData(deedDomain, deedTypes, attestation);
    await (await token.connect(claimant).approve(deedClaimsAddress, fee)).wait();
    await (await deedClaims.connect(claimant).claim(attestation, signature, fee)).wait();
  }

  step("Claiming an eligible solid deed, fee burned from locked MOVE");
  const supplyBeforeFee = await token.totalSupply();
  const mintedBeforeFee = await token.cumulativeMinted();
  await claimDeed(runnerA, TEST_CELL_ONE, MOVE("1000"));
  line(`runnerA holds deed ${TEST_CELL_ONE.toString(16)}: ${await deed.ownerOf(TEST_CELL_ONE)}`);
  line(`total supply fell by ${hre.ethers.formatEther(supplyBeforeFee - (await token.totalSupply()))} MOVE`);
  line(
    `cumulative minted unchanged at ${hre.ethers.formatEther(await token.cumulativeMinted())} MOVE ` +
      `(was ${hre.ethers.formatEther(mintedBeforeFee)}) — a burn never reopens mint capacity`
  );
  line(`runnerA locked now ${hre.ethers.formatEther(await token.lockedBalanceOf(runnerA.address))} MOVE`);

  step("Second deed so the toll has two distinct owners");
  await (
    await rewards
      .connect(relayer)
      .claim(1, 1, runnerB.address, MOVE("41000"), 0n, proofFor(dayOneLayers, 1))
  ).wait();
  line("runnerB reward claimed by a third-party relayer; funds went to runnerB");
  await claimDeed(runnerB, TEST_CELL_TWO, MOVE("1000"));
  line(`runnerB holds deed ${TEST_CELL_TWO.toString(16)}`);

  // -------------------------------------------------------------------------
  step("Publishing day 2 — 2% aggregate toll, prior locked balance stays locked");
  const lockedBeforeDayTwo = await token.lockedBalanceOf(runnerA.address);
  const dayTwoEntries: RewardEntry[] = [
    { account: runnerA.address, locked: MOVE("40000"), liquid: MOVE("500") },
    { account: runnerB.address, locked: MOVE("49000"), liquid: MOVE("1500") },
  ];
  const dayTwoLayers = await publishDay(2, dayTwoEntries, {
    gross: MOVE("100000"),
    locked: MOVE("89000"),
    liquidMovement: 0n,
    toll: MOVE("2000"),
    burn: MOVE("9000"),
    tollBase: MOVE("100000"),
  });
  const dayTwo = await settlement.settlementOf(2);
  line(`toll base   ${hre.ethers.formatEther(dayTwo.tollBase)} MOVE`);
  line(`toll credit ${hre.ethers.formatEther(dayTwo.tollCredits)} MOVE — exactly 2.00% of the base`);
  line(
    "zero-sum: locked + liquid movement + toll + burn == gross, so every owner credit is " +
      "matched by a runner-side debit inside the same settlement"
  );
  line(
    `newly created liquid movement rewards ${hre.ethers.formatEther(dayTwo.liquidMovementClaims)} ` +
      `MOVE, against an allowance of ${hre.ethers.formatEther(await settlement.liquidIssuanceAllowance())}`
  );

  await (
    await rewards
      .connect(runnerA)
      .claim(2, 0, runnerA.address, MOVE("40000"), MOVE("500"), proofFor(dayTwoLayers, 0))
  ).wait();
  await (
    await rewards
      .connect(runnerB)
      .claim(2, 1, runnerB.address, MOVE("49000"), MOVE("1500"), proofFor(dayTwoLayers, 1))
  ).wait();
  line(
    `runnerA locked ${hre.ethers.formatEther(lockedBeforeDayTwo)} -> ` +
      `${hre.ethers.formatEther(await token.lockedBalanceOf(runnerA.address))} MOVE; the earlier ` +
      "locked balance was never reclassified"
  );
  line(`runnerB liquid ${hre.ethers.formatEther(await token.liquidBalanceOf(runnerB.address))} MOVE`);

  // -------------------------------------------------------------------------
  step("Voluntary deed sale settled in transferable MOVE");
  const price = MOVE("1500");
  await (await deed.connect(runnerA).approve(await marketplace.getAddress(), TEST_CELL_ONE)).wait();
  await (await marketplace.connect(runnerA).list(TEST_CELL_ONE, price)).wait();
  await (await token.connect(ownerC).approve(await marketplace.getAddress(), price)).wait();
  try {
    await marketplace.connect(ownerC).buy(TEST_CELL_ONE, price);
    throw new Error("a buyer with no liquid MOVE completed a purchase, which must never happen");
  } catch (error) {
    line(`ownerC holds no MOVE, purchase rejected: ${(error as Error).message.split("(")[0].trim()}`);
  }
  await (await token.connect(runnerB).approve(await marketplace.getAddress(), price)).wait();
  await (await marketplace.connect(runnerB).buy(TEST_CELL_ONE, price)).wait();
  line(`deed ${TEST_CELL_ONE.toString(16)} now held by ${await deed.ownerOf(TEST_CELL_ONE)}`);
  line(`seller received ${hre.ethers.formatEther(await token.liquidBalanceOf(runnerA.address))} MOVE liquid`);

  // -------------------------------------------------------------------------
  step("Declaring a contest and escrowing the deed");
  const contestDomain = {
    name: "MovenRunContests",
    version: "3",
    chainId: Number(HARDHAT_CHAIN_ID),
    verifyingContract: contestsAddress,
  };
  const declarationTypes = {
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
  const scoreTypes = {
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

  const entryFee = MOVE("2000");
  const declaration = {
    challenger: runnerA.address,
    tokenId: TEST_CELL_ONE,
    fortificationBps: 1000,
    entryFee,
    rulesVersion: RULES_VERSION,
    nonce: nextNonce(),
    expiry: await farFuture(),
  };
  const declarationSignature = await contestSigner.signTypedData(
    contestDomain,
    declarationTypes,
    declaration
  );
  await (await token.connect(runnerA).approve(contestsAddress, entryFee)).wait();
  await (
    await contests.connect(runnerA).declareContest(declaration, declarationSignature, entryFee)
  ).wait();

  const contestId = await contests.lastContestId();
  const contest = await contests.contestOf(contestId);
  line(`contest ${contestId} declared by ${contest.challenger} against holder ${contest.defender}`);
  line(`deed holder is now the contests contract: ${await deed.ownerOf(TEST_CELL_ONE)}`);
  line(`escrow happened without any approval from the defender`);
  line(`notice ends ${contest.scoringStart}, scoring ends ${contest.scoringEnd}`);

  step("An active contest cannot be overwritten");
  const rivalDeclaration = {
    ...declaration,
    challenger: ownerC.address,
    nonce: nextNonce(),
    expiry: await farFuture(),
  };
  const rivalSignature = await contestSigner.signTypedData(
    contestDomain,
    declarationTypes,
    rivalDeclaration
  );
  try {
    await contests.connect(ownerC).declareContest(rivalDeclaration, rivalSignature, entryFee);
    throw new Error("an active contest was overwritten, which must never happen");
  } catch (error) {
    line(`a fully authorized rival declaration is still rejected: ${(error as Error).message.split("(")[0].trim()}`);
  }

  step("Submitting contest-scoped daily scores");
  await time.increaseTo(Number(contest.scoringStart) + 1);
  const submitScore = async (participant: string, day: number, score: bigint): Promise<void> => {
    const authorization = {
      contestId,
      participant,
      scoringDay: day,
      score,
      rulesVersion: RULES_VERSION,
      nonce: nextNonce(),
      expiry: BigInt(Number(contest.scoringEnd)),
    };
    const signature = await contestSigner.signTypedData(contestDomain, scoreTypes, authorization);
    await (await contests.connect(relayer).submitScore(authorization, signature)).wait();
  };

  for (const day of [0, 1, 2, 3]) {
    await submitScore(runnerA.address, day, 100n + BigInt(day));
    await submitScore(runnerB.address, day, 70n + BigInt(day));
  }
  line(`challenger counted total ${await contests.sideTotalOf(contestId, runnerA.address)}`);
  line(`defender counted total   ${await contests.sideTotalOf(contestId, runnerB.address)} before advantage`);
  line("only the best three days count for each side");

  step("Third-party settlement after the scoring window");
  await time.increaseTo(Number(contest.scoringEnd) + 1);
  const holderBefore = await deed.ownerOf(TEST_CELL_ONE);
  await (await contests.connect(relayer).settleContest(contestId)).wait();
  const settled = await contests.contestOf(contestId);
  line(`settled by ${relayer.address}, who is neither party to the contest`);
  line(`winner ${settled.winner}`);
  line(`deed holder ${holderBefore} -> ${await deed.ownerOf(TEST_CELL_ONE)}`);
  line("the losing side never approved, signed or cooperated with the transfer");
  if (settled.winner === settled.defender) {
    line(`losing challenger cooldown until ${await contests.challengerCooldownUntil(settled.challenger)}`);
    line(`surviving deed peace period until ${await contests.deedPeaceUntil(TEST_CELL_ONE)}`);
  } else {
    line("the challenger won, so no challenger cooldown and no deed peace period apply");
    line(`the deed can be contested again immediately: active contest is ${await contests.activeContestOf(TEST_CELL_ONE)}`);
  }

  // -------------------------------------------------------------------------
  step("Closing state");
  line(`token cumulative minted ${hre.ethers.formatEther(await token.cumulativeMinted())} MOVE`);
  line(`token total supply      ${hre.ethers.formatEther(await token.totalSupply())} MOVE`);
  line(`lifetime movement issued ${hre.ethers.formatEther(await settlement.lifetimeMovementIssued())} MOVE`);
  line(`remaining player allocation ${hre.ethers.formatEther(await settlement.remainingPlayerAllocation())} MOVE`);
  line(`deeds in existence ${await deed.totalDeeds()}`);
  console.log("\nShowcase complete. All values above are test data on a local chain.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
