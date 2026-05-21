import { create } from "zustand";
import { Zone, ZoneChallenge, GearSlot } from "@movenrun/shared";
import { GPSPoint } from "@movenrun/shared";

interface TrackingState {
  isTracking: boolean;
  currentPoints: GPSPoint[];
  currentDistanceMeters: number;
  earnedThisRun: bigint;
  lastRunResult: RunResult | null;
}

interface RunResult {
  baseEarn: bigint;
  gearBonus: bigint;
  zoneTaxEarned: bigint;
  totalEarned: bigint;
  distanceKm: number;
  hexesCaptured: string[];
  hexesContributed: string[];
}

export interface StakingPosition {
  stakedAmount: bigint;
  unlockDate: number;
  earnedZone: bigint;
  lockDays: 90 | 180 | 365;
}

export interface GearNFT {
  tokenId: bigint;
  slot: GearSlot;
  name: string;
  multiplier: number;
  moveUpgradeCost: bigint;
  yieldImprovement: number;
}

export interface RunRecord {
  id: string;
  date: number;
  distanceKm: number;
  moveEarned: bigint;
}

export interface BattleRecord {
  hexId: string;
  date: number;
  result: "win" | "loss";
  opponentAddress: string;
  myScore: number;
  opponentScore: number;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  earned: boolean;
  earnedAt?: number;
}

interface UserState {
  walletAddress: string | null;
  moveBalance: bigint;
  zoneBalance: bigint;
  stakedBalance: bigint;
  stakingPosition: StakingPosition | null;
  ownedZoneIds: string[];
  ownedZones: Zone[];
  gearNFTs: GearNFT[];
  runHistory: RunRecord[];
  battleHistory: BattleRecord[];
  achievements: Achievement[];
  seasonRank: number | null;
  seasonPoints: number;
}

interface ZoneState {
  visibleZones: Zone[];
  selectedHexId: string | null;
  activeBattles: ZoneChallenge[];
  nearbyBattles: ZoneChallenge[];
}

interface AppStore extends TrackingState, UserState, ZoneState {
  startTracking: () => void;
  stopTracking: () => void;
  addGPSPoint: (point: GPSPoint) => void;
  resetRun: () => void;
  setLastRunResult: (result: RunResult | null) => void;

  setWalletAddress: (address: string | null) => void;
  setMoveBalance: (balance: bigint) => void;
  setZoneBalance: (balance: bigint) => void;
  setStakingPosition: (position: StakingPosition | null) => void;
  setOwnedZones: (zones: Zone[]) => void;
  setGearNFTs: (gear: GearNFT[]) => void;
  setRunHistory: (history: RunRecord[]) => void;
  setBattleHistory: (history: BattleRecord[]) => void;
  setAchievements: (achievements: Achievement[]) => void;
  setSeasonRank: (rank: number | null) => void;
  setSeasonPoints: (points: number) => void;

  setVisibleZones: (zones: Zone[]) => void;
  selectHex: (hexId: string | null) => void;
  setActiveBattles: (battles: ZoneChallenge[]) => void;
  setNearbyBattles: (battles: ZoneChallenge[]) => void;
}

export const useStore = create<AppStore>((set) => ({
  // Tracking
  isTracking: false,
  currentPoints: [],
  currentDistanceMeters: 0,
  earnedThisRun: 0n,
  lastRunResult: null,

  // User
  walletAddress: null,
  moveBalance: 0n,
  zoneBalance: 0n,
  stakedBalance: 0n,
  stakingPosition: null,
  ownedZoneIds: [],
  ownedZones: [],
  gearNFTs: [],
  runHistory: [],
  battleHistory: [],
  achievements: [],
  seasonRank: null,
  seasonPoints: 0,

  // Zones
  visibleZones: [],
  selectedHexId: null,
  activeBattles: [],
  nearbyBattles: [],

  startTracking: () => set({ isTracking: true, currentPoints: [], currentDistanceMeters: 0, earnedThisRun: 0n }),
  stopTracking: () => set({ isTracking: false }),
  addGPSPoint: (point) => set((state) => ({ currentPoints: [...state.currentPoints, point] })),
  resetRun: () => set({ currentPoints: [], currentDistanceMeters: 0, earnedThisRun: 0n, lastRunResult: null }),
  setLastRunResult: (result) => set({ lastRunResult: result }),

  setWalletAddress: (address) => set({ walletAddress: address }),
  setMoveBalance: (balance) => set({ moveBalance: balance }),
  setZoneBalance: (balance) => set({ zoneBalance: balance }),
  setStakingPosition: (position) => set({ stakingPosition: position }),
  setOwnedZones: (zones) => set({ ownedZones: zones, ownedZoneIds: zones.map((z) => z.hexId) }),
  setGearNFTs: (gear) => set({ gearNFTs: gear }),
  setRunHistory: (history) => set({ runHistory: history }),
  setBattleHistory: (history) => set({ battleHistory: history }),
  setAchievements: (achievements) => set({ achievements }),
  setSeasonRank: (rank) => set({ seasonRank: rank }),
  setSeasonPoints: (points) => set({ seasonPoints: points }),

  setVisibleZones: (zones) => set({ visibleZones: zones }),
  selectHex: (hexId) => set({ selectedHexId: hexId }),
  setActiveBattles: (battles) => set({ activeBattles: battles }),
  setNearbyBattles: (battles) => set({ nearbyBattles: battles }),
}));
