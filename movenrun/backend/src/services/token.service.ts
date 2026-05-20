import { ethers } from "ethers";
import { getConfig } from "../config.js";
import { BASE_RATE, HALVING_INTERVAL, DAILY_CAP_INITIAL } from "@movenrun/shared/src/constants/emission.js";

export class TokenService {
  private provider: ethers.JsonRpcProvider;

  constructor() {
    const config = getConfig();
    this.provider = new ethers.JsonRpcProvider(config.BASE_RPC_URL);
  }

  // Calculate how many $MOVE a user earns for a given distance
  async calculateEarning(walletAddress: string, distanceMeters: number, gearMultiplier = 1.0): Promise<bigint> {
    const blockNumber = await this.provider.getBlockNumber();
    const rate = this._rateAtBlock(blockNumber);
    const earned = (BigInt(distanceMeters) * rate * BigInt(Math.round(gearMultiplier * 1e18))) / (1000n * BigInt(1e18));
    return earned;
  }

  async getUserStats(walletAddress: string): Promise<{
    totalDistanceMeters: number;
    totalEarned: string;
    ownedZones: number;
    currentRate: string;
    dailyCapRemaining: string;
  }> {
    // TODO: query from DB + contract
    const blockNumber = await this.provider.getBlockNumber();
    const rate = this._rateAtBlock(blockNumber);
    return {
      totalDistanceMeters: 0,
      totalEarned: "0",
      ownedZones: 0,
      currentRate: ethers.formatEther(rate) + " $MOVE/km",
      dailyCapRemaining: ethers.formatEther(this._dailyCapAtBlock(blockNumber)),
    };
  }

  private _rateAtBlock(block: number): bigint {
    const halvings = BigInt(block) / HALVING_INTERVAL;
    let rate = BASE_RATE;
    for (let i = 0n; i < halvings && i < 20n; i++) rate = rate / 2n;
    return rate;
  }

  private _dailyCapAtBlock(block: number): bigint {
    const halvings = BigInt(block) / HALVING_INTERVAL;
    let cap = DAILY_CAP_INITIAL;
    for (let i = 0n; i < halvings && i < 20n; i++) cap = cap / 2n;
    return cap;
  }
}
