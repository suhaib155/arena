import { Worker, Queue } from "bullmq";
import IORedis from "ioredis";
import { ethers } from "ethers";
import { gte, sql } from "drizzle-orm";
import { getConfig } from "../config.js";
import { getDb } from "../db/index.js";
import { hexActivityDaily } from "../db/schema.js";
import { MIN_BURN_MINT_RATIO } from "@movenrun/shared/src/constants/emission.js";

const config = getConfig();
const redis = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

export const keeperQueue = new Queue("keeper", { connection: redis });

// Schedule the weekly keeper job on startup
keeperQueue.add(
  "weekly",
  { task: "weekly" },
  {
    repeat: { pattern: "0 0 * * 0" }, // Every Sunday at midnight
    jobId: "keeper-weekly",
  },
);

// Check season status daily
keeperQueue.add(
  "check-season",
  { task: "check-season" },
  {
    repeat: { pattern: "0 0 * * *" }, // Every day at midnight
    jobId: "keeper-check-season",
  },
);

const MOVE_TOKEN_ABI = [
  "function adjustEmissionRate(uint256 weeklyMint, uint256 weeklyBurn) external",
  "function baseRate() external view returns (uint256)",
];

const SEASON_ABI = [
  "function weeklyKeeperRun() external",
  "function pauseMinting() external",
  "function endSeason() external",
  "function seasonEnd() external view returns (uint256)",
];

interface KeeperJob {
  task: "weekly" | "check-season";
}

async function getWeeklyStats(): Promise<{ weeklyMint: bigint; weeklyBurn: bigint }> {
  const db = getDb();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const result = await db
    .select({ total: sql<string>`coalesce(sum(${hexActivityDaily.moveEarned}::numeric), 0)` })
    .from(hexActivityDaily)
    .where(gte(hexActivityDaily.date, sevenDaysAgo));

  const weeklyMint = BigInt(result[0]?.total ?? "0");

  // Burns are tracked on-chain; without an event indexer, default to 0
  // In production this would come from an indexed burn event table
  const weeklyBurn = 0n;

  return { weeklyMint, weeklyBurn };
}

const worker = new Worker<KeeperJob>(
  "keeper",
  async (job) => {
    const { task } = job.data;
    const provider = new ethers.JsonRpcProvider(config.BASE_RPC_URL);
    const keeperWallet = new ethers.Wallet(config.ORACLE_PRIVATE_KEY, provider);

    if (task === "weekly") {
      const { weeklyMint, weeklyBurn } = await getWeeklyStats();
      console.log(`[Keeper] Weekly stats — mint: ${weeklyMint}, burn: ${weeklyBurn}`);

      const moveTokenAddress = config.MOVE_TOKEN_ADDRESS;
      if (moveTokenAddress) {
        const moveToken = new ethers.Contract(moveTokenAddress, MOVE_TOKEN_ABI, keeperWallet);
        const burnMintRatio =
          weeklyMint > 0n ? Number(weeklyBurn * 1000n / weeklyMint) / 1000 : 0;

        if (burnMintRatio < MIN_BURN_MINT_RATIO) {
          console.log(
            `[Keeper] Burn/mint ratio ${burnMintRatio.toFixed(3)} < ${MIN_BURN_MINT_RATIO} — adjusting emission rate`,
          );
          const tx = await moveToken.adjustEmissionRate(weeklyMint, weeklyBurn);
          await tx.wait();
          console.log(`[Keeper] Emission rate adjusted: ${tx.hash}`);
        } else {
          console.log(`[Keeper] Burn/mint ratio healthy: ${burnMintRatio.toFixed(3)}`);
        }
      }

      const seasonAddress = config.SEASON_CONTROLLER_ADDRESS;
      if (seasonAddress) {
        const season = new ethers.Contract(seasonAddress, SEASON_ABI, keeperWallet);
        const tx = await season.weeklyKeeperRun();
        await tx.wait();
        console.log(`[Keeper] SeasonController.weeklyKeeperRun complete: ${tx.hash}`);
      }
    }

    if (task === "check-season") {
      const seasonAddress = config.SEASON_CONTROLLER_ADDRESS;
      if (!seasonAddress) {
        console.warn("[Keeper] No SeasonController address set");
        return;
      }

      const season = new ethers.Contract(seasonAddress, SEASON_ABI, keeperWallet);
      const seasonEnd: bigint = await season.seasonEnd();
      const now = BigInt(Math.floor(Date.now() / 1000));
      const twoWeeks = 14n * 24n * 3600n;

      if (now >= seasonEnd - twoWeeks && now < seasonEnd) {
        const tx = await season.pauseMinting();
        await tx.wait();
        console.log(`[Keeper] Minting paused for season end: ${tx.hash}`);
      } else if (now >= seasonEnd) {
        const tx = await season.endSeason();
        await tx.wait();
        console.log(`[Keeper] Season ended: ${tx.hash}`);
      }
    }
  },
  { connection: redis },
);

worker.on("failed", (job, err) => {
  console.error(`[Keeper Worker] Job ${job?.id} failed:`, err);
});

console.log("[Keeper Worker] Started");
