export enum ZoneStatus {
  Unminted = "UNMINTED",
  Active = "ACTIVE",
  Dormant = "DORMANT",
  UnderChallenge = "UNDER_CHALLENGE",
}

export interface Zone {
  hexId: string;
  tokenId: bigint;
  owner: string;
  status: ZoneStatus;
  ownershipStart: number;
  lastActivity: number;
  weeklyMoverCount: number;
  accumulatedZoneYield: bigint;
}

export interface ZoneChallenge {
  hexId: string;
  challenger: string;
  defender: string;
  challengeStart: number;
  challengeEnd: number;
  challengerScore: bigint;
  defenderScore: bigint;
  defenderBaseScore: bigint;
  strongholdBoostExpiry: number;
  strongholdBoostMultiplier: number;
  timeExtensionUsed: boolean;
  resolved: boolean;
  winner?: string;
}

export interface ZoneMintEligibility {
  hexId: string;
  isEligible: boolean;
  topMover: string;
  weeklyMoverCount: number;
  mintCost: bigint;
  oracleSig: string;
}

export interface ZoneActivity {
  hexId: string;
  uniqueUsers: number;
  topMover: string;
  topMoverDistance: number;
  totalDistance: number;
}

export interface HexData {
  hexId: string;
  status: ZoneStatus;
  owner?: string;
  totalDistanceMeters?: number;
}

export interface MintEligibility {
  hexId: string;
  eligible: boolean;
  isTopMover: boolean;
  hasEnoughUsers: boolean;
  mintCost: bigint;
  oracleSig?: string;
  reason?: string;
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}
