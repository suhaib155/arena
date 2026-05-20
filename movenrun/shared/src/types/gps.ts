export interface GPSPoint {
  lat: number;
  lng: number;
  accuracy: number;
  altitude?: number;
  timestamp: number;
}

export interface GPSRoute {
  id: string;
  userId: string;
  walletAddress: string;
  points: GPSPoint[];
  startTime: number;
  endTime: number;
  distanceMeters: number;
  hexIds: string[];
  status: RouteStatus;
}

export enum RouteStatus {
  Pending = "PENDING",
  Processing = "PROCESSING",
  Verified = "VERIFIED",
  Rejected = "REJECTED",
  Submitted = "SUBMITTED",
}

export interface RouteProof {
  routeId: string;
  routeHash: string;
  walletAddress: string;
  distanceMeters: number;
  hexIds: string[];
  earnedAmount: bigint;
  oracleSig: string;
  timestamp: number;
}

export interface HexActivity {
  hexId: string;
  weeklyMoverCount: number;
  monthlyMoverCount: number;
  totalDistanceMeters: number;
  topMover: string;
  topMoverDistanceMeters: number;
  lastActivityAt: number;
}

export interface AnomalyResult {
  isAnomaly: boolean;
  reasons: string[];
  confidence: number;
}
