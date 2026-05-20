import { Worker, Queue } from "bullmq";
import IORedis from "ioredis";
import { ethers } from "ethers";
import { getConfig } from "../config.js";

const config = getConfig();
const redis = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

export const keeperQueue = new Queue("keeper", { connection: redis });

// Minimal ABI for the SeasonController calls we need
const SEASON_ABI = [
  "function weeklyKeeperRun() external",
  "function pauseMinting() external",
  "function endSeason() external",
  "function seasonEnd() external view returns (uint256)",
];

const worker = new Worker(
  "keeper",
  async (job) => {
    const { task } = job.data as { task: "weekly" | "check-season" };
    const provider = new ethers.JsonRpcProvider(config.BASE_RPC_URL);
    const keeperWallet = new ethers.Wallet(config.ORACLE_PRIVATE_KEY, provider);

    const seasonAddress = config.SEASON_CONTROLLER_ADDRESS;
    if (!seasonAddress) { console.warn("[Keeper] No SeasonController address set"); return; }

    const season = new ethers.Contract(seasonAddress, SEASON_ABI, keeperWallet);

    if (task === "weekly") {
      const tx = await season.weeklyKeeperRun();
      await tx.wait();
      console.log(`[Keeper] Weekly emission adjustment complete: ${tx.hash}`);
    }

    if (task === "check-season") {
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
  { connection: redis }
);

worker.on("failed", (job, err) => {
  console.error(`[Keeper Worker] Job ${job?.id} failed:`, err);
});

console.log("[Keeper Worker] Started");
