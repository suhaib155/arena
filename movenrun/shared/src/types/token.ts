export interface TokenAmount {
  raw: bigint;
  formatted: string;
  decimals: number;
}

export interface EmissionRate {
  baseRate: bigint;
  halvingNumber: number;
  effectiveRate: bigint;
  dailyCap: bigint;
  weeklyMint: bigint;
  weeklyBurn: bigint;
  burnMintRatio: number;
}

export interface GearMultiplier {
  tokenId: bigint;
  multiplier: bigint;
  slot: GearSlot;
}

export enum GearSlot {
  Shoes = "SHOES",
  Jacket = "JACKET",
  Watch = "WATCH",
  Headband = "HEADBAND",
}

export interface DailyCapState {
  address: string;
  minted: bigint;
  cap: bigint;
  resetAt: number;
}
