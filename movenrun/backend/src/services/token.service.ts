import { ethers } from "ethers";
import { getConfig } from "../config.js";
import { BASE_RATE, HALVING_INTERVAL, DAILY_CAP_INITIAL } from "@movenrun/shared";
import { decimalToFixed18, FIXED18_ONE } from "@movenrun/shared/credit-units";

/**
 * 18-decimal units earned for a distance at a per-km rate and a gear
 * multiplier. Exact: the multiplier becomes fixed point by its written
 * decimal (never `Math.round(x * 1e18)`, which turns 1.1 into
 * 1.1000000000000001), and the one division floors.
 */
export function earningFor(distanceMeters: number, rate: bigint, gearMultiplier = 1.0): bigint {
  if (!Number.isSafeInteger(distanceMeters) || distanceMeters < 0) throw new RangeError("distanceMeters must be a non-negative safe integer");
  if (rate < 0n) throw new RangeError("rate must be non-negative");
  return (BigInt(distanceMeters) * rate * decimalToFixed18(gearMultiplier)) / (1000n * FIXED18_ONE);
}

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
    return earningFor(distanceMeters, rate, gearMultiplier);
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
