/**
 * MovenRun V3 onchain core — read-only post-deployment invariant check.
 *
 * Reads the deployed chain state and fails if any invariant is wrong. It performs no writes
 * and sends no transactions.
 *
 * Usage:
 *   npx hardhat run scripts/v3/checkDeployment.ts --network baseSepolia
 */
import * as fs from "fs";
import * as path from "path";
import hre from "hardhat";

const BASE_SEPOLIA_CHAIN_ID = 84532n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MANIFEST_PATH = path.join(__dirname, "..", "..", "deployments", "v3", "base-sepolia.json");

const EXPECTED = {
  maxLifetimeMinted: 1_000_000_000n * 10n ** 18n,
  playerMovementAllocation: 400_000_000n * 10n ** 18n,
  seasonOneBudget: 9_000_000n * 10n ** 18n,
  seasonBudgetFloor: 2_000_000n * 10n ** 18n,
  seasonLengthDays: 90n,
  tollRateBps: 200n,
  maxAutomaticBurnBps: 6_000n,
  noticePeriod: 72n * 60n * 60n,
  scoringWindow: 7n * 24n * 60n * 60n,
  countedScoringDays: 3n,
  challengerCooldown: 30n * 24n * 60n * 60n,
  defenderPeacePeriod: 14n * 24n * 60n * 60n,
  maxFortificationBps: 1_500n,
  minHomeAdvantageBps: 500n,
  maxHomeAdvantageBps: 1_000n,
};

const results: Array<{ name: string; ok: boolean; detail: string }> = [];

function check(name: string, ok: boolean, detail = ""): void {
  results.push({ name, ok, detail });
}

function checkEqual(name: string, actual: unknown, expected: unknown): void {
  const a = typeof actual === "bigint" ? actual.toString() : String(actual);
  const e = typeof expected === "bigint" ? expected.toString() : String(expected);
  check(name, a === e, a === e ? "" : `expected ${e}, found ${a}`);
}

async function main(): Promise<void> {
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(
      `Expected Base Sepolia (${BASE_SEPOLIA_CHAIN_ID}), connected to ${network.chainId}`
    );
  }
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Deployment manifest not found at ${MANIFEST_PATH}`);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const addressOf = (name: string): string => {
    const record = manifest.contracts?.[name];
    if (!record?.address) throw new Error(`Manifest holds no address for ${name}`);
    return hre.ethers.getAddress(record.address);
  };

  const at = async (name: string, contract: string) =>
    (await hre.ethers.getContractAt(contract, addressOf(name))) as any;

  const token = await at("MovenRunToken", "MovenRunToken");
  const rewards = await at("MovenRunRewards", "MovenRunRewards");
  const settlement = await at("MovenRunSettlement", "MovenRunSettlement");
  const deed = await at("MovenRunDeed", "MovenRunDeed");
  const deedClaims = await at("MovenRunDeedClaims", "MovenRunDeedClaims");
  const contests = await at("MovenRunContests", "MovenRunContests");
  const marketplace = await at("MovenRunMarketplace", "MovenRunMarketplace");
  const registry = await at("MovenRunRegistry", "MovenRunRegistry");
  const timelockAddress = addressOf("MovenRunTimelock");
  const timelock = (await hre.ethers.getContractAt("MovenRunTimelock", timelockAddress)) as any;

  checkEqual("chain id is Base Sepolia", network.chainId, BASE_SEPOLIA_CHAIN_ID);

  // Token: fixed cap and issuance state.
  checkEqual("token lifetime cap is one billion MOVE", await token.MAX_LIFETIME_MINTED(), EXPECTED.maxLifetimeMinted);
  const cumulativeMinted: bigint = await token.cumulativeMinted();
  check(
    "token cumulative minted within cap",
    cumulativeMinted <= EXPECTED.maxLifetimeMinted,
    `cumulativeMinted ${cumulativeMinted}`
  );
  const totalSupply: bigint = await token.totalSupply();
  check(
    "token total supply never exceeds cumulative minted",
    totalSupply <= cumulativeMinted,
    `totalSupply ${totalSupply}, cumulativeMinted ${cumulativeMinted}`
  );
  checkEqual("token name", await token.name(), "MovenRun MOVE");
  checkEqual("token symbol", await token.symbol(), "MOVE");
  checkEqual("token decimals", await token.decimals(), 18n);

  // Token: bootstrap wiring frozen.
  checkEqual("token bootstrap frozen", await token.bootstrapFrozen(), true);
  checkEqual("token bootstrapper cleared", await token.bootstrapper(), ZERO_ADDRESS);
  checkEqual("token settlement wired", await token.settlement(), addressOf("MovenRunSettlement"));
  checkEqual("token rewards wired", await token.rewards(), addressOf("MovenRunRewards"));

  // Rewards wiring.
  checkEqual("rewards settlement wired", await rewards.settlement(), addressOf("MovenRunSettlement"));
  checkEqual("rewards bootstrapper cleared", await rewards.bootstrapper(), ZERO_ADDRESS);
  checkEqual("rewards token wired", await rewards.moveToken(), addressOf("MovenRunToken"));

  // Settlement: fixed economic constants.
  checkEqual("player movement allocation is 400M", await settlement.PLAYER_MOVEMENT_ALLOCATION(), EXPECTED.playerMovementAllocation);
  checkEqual("season one budget is 9M", await settlement.SEASON_ONE_BUDGET(), EXPECTED.seasonOneBudget);
  checkEqual("season budget floor is 2M", await settlement.SEASON_BUDGET_FLOOR(), EXPECTED.seasonBudgetFloor);
  checkEqual("season length is 90 days", await settlement.SEASON_LENGTH_DAYS(), EXPECTED.seasonLengthDays);
  checkEqual("toll rate is fixed at 2 percent", await settlement.TOLL_RATE_BPS(), EXPECTED.tollRateBps);
  checkEqual("automatic charge ceiling is 60 percent", await settlement.MAX_AUTOMATIC_BURN_BPS(), EXPECTED.maxAutomaticBurnBps);

  const lifetimeIssued: bigint = await settlement.lifetimeMovementIssued();
  check(
    "lifetime movement issuance within allocation",
    lifetimeIssued <= EXPECTED.playerMovementAllocation,
    `lifetimeMovementIssued ${lifetimeIssued}`
  );
  checkEqual("settlement token wired", await settlement.moveToken(), addressOf("MovenRunToken"));
  checkEqual("settlement rewards wired", await settlement.rewards(), addressOf("MovenRunRewards"));

  // Critical signer separation.
  const settlementSigner = await settlement.settlementSigner();
  const reconciliationSigner = await settlement.reconciliationSigner();
  check(
    "settlement and reconciliation signers are distinct",
    settlementSigner !== reconciliationSigner,
    `${settlementSigner} vs ${reconciliationSigner}`
  );
  checkEqual("settlement signer matches manifest", settlementSigner, hre.ethers.getAddress(manifest.roles.settlementSigner));
  checkEqual("reconciliation signer matches manifest", reconciliationSigner, hre.ethers.getAddress(manifest.roles.reconciliationSigner));
  checkEqual("deed eligibility signer matches manifest", await deedClaims.eligibilitySigner(), hre.ethers.getAddress(manifest.roles.deedSigner));
  checkEqual("contest score signer matches manifest", await contests.contestSigner(), hre.ethers.getAddress(manifest.roles.contestScoreSigner));

  // Deed wiring and supply.
  checkEqual("deed claims wired", await deed.claimsContract(), addressOf("MovenRunDeedClaims"));
  checkEqual("deed contests wired", await deed.contestsContract(), addressOf("MovenRunContests"));
  checkEqual("deed bootstrapper cleared", await deed.bootstrapper(), ZERO_ADDRESS);
  const totalDeeds: bigint = await deed.totalDeeds();
  const allowExistingDeeds = (process.env.MOVENRUN_ALLOW_EXISTING_DEEDS ?? "").toLowerCase() === "true";
  check(
    "deed supply is the expected initial value",
    allowExistingDeeds ? true : totalDeeds === 0n,
    totalDeeds === 0n ? "" : `totalDeeds ${totalDeeds}; set MOVENRUN_ALLOW_EXISTING_DEEDS=true if deeds are expected`
  );

  // Contest fixed timings and cooldowns.
  checkEqual("contest notice period is 72 hours", await contests.NOTICE_PERIOD(), EXPECTED.noticePeriod);
  checkEqual("contest scoring window is 7 days", await contests.SCORING_WINDOW(), EXPECTED.scoringWindow);
  checkEqual("contest counts best 3 days", await contests.COUNTED_SCORING_DAYS(), EXPECTED.countedScoringDays);
  checkEqual("losing challenger cooldown is 30 days", await contests.CHALLENGER_COOLDOWN(), EXPECTED.challengerCooldown);
  checkEqual("surviving defender peace is 14 days", await contests.DEFENDER_PEACE_PERIOD(), EXPECTED.defenderPeacePeriod);
  checkEqual("fortification ceiling is 15 percent", await contests.MAX_FORTIFICATION_BPS(), EXPECTED.maxFortificationBps);
  const homeAdvantage: bigint = await contests.homeAdvantageBps();
  check(
    "home advantage inside 5 to 10 percent",
    homeAdvantage >= EXPECTED.minHomeAdvantageBps && homeAdvantage <= EXPECTED.maxHomeAdvantageBps,
    `homeAdvantageBps ${homeAdvantage}`
  );

  // Deed eligibility hypotheses are visible onchain.
  checkEqual("minimum tenure days", await deedClaims.minTenureDays(), 21n);
  checkEqual("minimum distinct crossers", await deedClaims.minDistinctCrossers(), 30n);
  checkEqual("minimum traffic days", await deedClaims.minTrafficDays(), 10n);

  // Marketplace wiring.
  checkEqual("marketplace token wired", await marketplace.moveToken(), addressOf("MovenRunToken"));
  checkEqual("marketplace deed wired", await marketplace.deed(), addressOf("MovenRunDeed"));

  // Timelock and administration.
  const adminRole = await token.DEFAULT_ADMIN_ROLE();
  const guardianRole = await settlement.GUARDIAN_ROLE();
  const deployer = hre.ethers.getAddress(manifest.deployer);
  const guardian = hre.ethers.getAddress(manifest.roles.guardian);
  const admin = hre.ethers.getAddress(manifest.roles.admin);

  for (const [name, contract] of [
    ["token", token],
    ["settlement", settlement],
    ["deed", deed],
    ["deedClaims", deedClaims],
    ["contests", contests],
    ["registry", registry],
  ] as Array<[string, any]>) {
    checkEqual(`${name} admin role held by timelock`, await contract.hasRole(adminRole, timelockAddress), true);
    checkEqual(`${name} admin role not held by deployer`, await contract.hasRole(adminRole, deployer), false);
    checkEqual(`${name} admin role not held directly by admin key`, await contract.hasRole(adminRole, admin), false);
    checkEqual(`${name} admin role not held by guardian`, await contract.hasRole(adminRole, guardian), false);
  }

  for (const [name, contract] of [
    ["settlement", settlement],
    ["deedClaims", deedClaims],
    ["contests", contests],
  ] as Array<[string, any]>) {
    checkEqual(`${name} guardian role held by guardian`, await contract.hasRole(guardianRole, guardian), true);
    checkEqual(`${name} guardian role not held by deployer`, await contract.hasRole(guardianRole, deployer), false);
  }

  const timelockDelay: bigint = await timelock.getMinDelay();
  check("timelock delay is nonzero", timelockDelay > 0n, `minDelay ${timelockDelay}`);
  checkEqual("timelock delay matches manifest", timelockDelay, BigInt(manifest.parameters.timelockDelaySeconds));
  const proposerRole = await timelock.PROPOSER_ROLE();
  const executorRole = await timelock.EXECUTOR_ROLE();
  const timelockAdminRole = await timelock.DEFAULT_ADMIN_ROLE();
  checkEqual("timelock proposer is the administrator", await timelock.hasRole(proposerRole, admin), true);
  checkEqual("timelock executor is the administrator", await timelock.hasRole(executorRole, admin), true);
  checkEqual("timelock retains no deployer admin", await timelock.hasRole(timelockAdminRole, deployer), false);

  // Pause semantics: nothing may pause a finalized reward claim.
  checkEqual("settlement publication is not paused", await settlement.publicationPaused(), false);
  checkEqual("deed claims are not paused", await deedClaims.claimsPaused(), false);
  checkEqual("contest declarations are not paused", await contests.declarationsPaused(), false);

  const rewardsAbi = (await hre.artifacts.readArtifact("MovenRunRewards")).abi;
  const rewardsPauseFunctions = rewardsAbi
    .filter((entry: any) => entry.type === "function" && /pause/i.test(entry.name))
    .map((entry: any) => entry.name);
  check(
    "rewards contract exposes no pause path",
    rewardsPauseFunctions.length === 0,
    rewardsPauseFunctions.join(", ")
  );
  const rewardsAdminFunctions = rewardsAbi
    .filter((entry: any) => entry.type === "function" && /(withdraw|sweep|rescue|recover|seize)/i.test(entry.name))
    .map((entry: any) => entry.name);
  check(
    "rewards contract exposes no administrative withdrawal",
    rewardsAdminFunctions.length === 0,
    rewardsAdminFunctions.join(", ")
  );

  // Registry must match the manifest exactly.
  const record = await registry.currentDeployment();
  checkEqual("registry chain id", record.chainId, network.chainId);
  checkEqual("registry timelock address", record.timelock, timelockAddress);
  checkEqual("registry token address", record.token, addressOf("MovenRunToken"));
  checkEqual("registry rewards address", record.rewards, addressOf("MovenRunRewards"));
  checkEqual("registry settlement address", record.settlement, addressOf("MovenRunSettlement"));
  checkEqual("registry deed address", record.deed, addressOf("MovenRunDeed"));
  checkEqual("registry deed claims address", record.deedClaims, addressOf("MovenRunDeedClaims"));
  checkEqual("registry contests address", record.contests, addressOf("MovenRunContests"));
  checkEqual("registry marketplace address", record.marketplace, addressOf("MovenRunMarketplace"));
  checkEqual("registry bootstrapper cleared", await registry.bootstrapper(), ZERO_ADDRESS);

  console.log("MovenRun V3 post-deployment check — Base Sepolia\n");
  const failures = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`  ${r.ok ? "ok  " : "FAIL"}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
  }
  console.log(`\n${results.length - failures.length} passed, ${failures.length} failed`);

  if (failures.length > 0) {
    throw new Error(`Post-deployment invariant check failed: ${failures.map((f) => f.name).join(", ")}`);
  }
  console.log("All post-deployment invariants hold.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
