import { create } from "zustand";
import { Zone, ZoneChallenge, GPSPoint, GearMultiplier } from "@movenrun/shared";

export interface CurrentPosition {
  lat: number;
  lng: number;
  accuracy: number;
  speed: number;
  timestamp: number;
}

export interface HexEarnActivity {
  hexId: string;
  moveEarned: bigint;
  distanceMeters: number;
}

interface AppStore {
  // User
  walletAddress: string | null;
  moveBalance: bigint;
  stakedBalance: bigint;
  ownedZoneIds: string[];
  gear: GearMultiplier[];
  dailyCapRemaining: bigint;

  // Tracking
  isTracking: boolean;
  currentPosition: CurrentPosition | null;
  currentPoints: GPSPoint[];
  currentDistanceMeters: number;
  earnedThisRun: bigint;
  hexActivity: HexEarnActivity[];

  // Map
  visibleZones: Zone[];
  selectedHexId: string | null;

  // Battles
  activeBattles: ZoneChallenge[];

  // Tracking actions
  startRun: () => void;
  stopRun: () => void;
  addGPSPoint: (point: GPSPoint) => void;
  setCurrentPosition: (pos: CurrentPosition) => void;
  resetRun: () => void;
  setHexActivity: (activity: HexEarnActivity[]) => void;

  // User actions
  setWalletAddress: (address: string | null) => void;
  updateMoveBalance: (balance: bigint) => void;
  setMoveBalance: (balance: bigint) => void;
  setGear: (gear: GearMultiplier[]) => void;
  setDailyCapRemaining: (cap: bigint) => void;
  setOwnedZones: (hexIds: string[]) => void;
  refreshZones: (hexIds: string[]) => void;

  // Map actions
  setVisibleZones: (zones: Zone[]) => void;
  setSelectedHex: (hexId: string | null) => void;
  selectHex: (hexId: string | null) => void;

  // Battle actions
  setActiveBattles: (battles: ZoneChallenge[]) => void;
  loadBattles: (battles: ZoneChallenge[]) => void;

  // Legacy aliases used by existing components
  startTracking: () => void;
  stopTracking: () => void;
}

function haversineMeters(a: GPSPoint, b: GPSPoint): number {
  const R = 6_371_000;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export const useStore = create<AppStore>((set, get) => ({
  // User
  walletAddress: null,
  moveBalance: 0n,
  stakedBalance: 0n,
  ownedZoneIds: [],
  gear: [],
  dailyCapRemaining: 0n,

  // Tracking
  isTracking: false,
  currentPosition: null,
  currentPoints: [],
  currentDistanceMeters: 0,
  earnedThisRun: 0n,
  hexActivity: [],

  // Map
  visibleZones: [],
  selectedHexId: null,

  // Battles
  activeBattles: [],

  startRun: () =>
    set({
      isTracking: true,
      currentPoints: [],
      currentDistanceMeters: 0,
      earnedThisRun: 0n,
      hexActivity: [],
      currentPosition: null,
    }),

  stopRun: () => set({ isTracking: false }),

  addGPSPoint: (point) =>
    set((state) => {
      const prev = state.currentPoints[state.currentPoints.length - 1];
      const added = prev ? haversineMeters(prev, point) : 0;
      return {
        currentPoints: [...state.currentPoints, point],
        currentDistanceMeters: state.currentDistanceMeters + added,
      };
    }),

  setCurrentPosition: (pos) => set({ currentPosition: pos }),

  resetRun: () =>
    set({ currentPoints: [], currentDistanceMeters: 0, earnedThisRun: 0n, hexActivity: [] }),

  setHexActivity: (activity) => set({ hexActivity: activity }),

  setWalletAddress: (address) => set({ walletAddress: address }),
  updateMoveBalance: (balance) => set({ moveBalance: balance }),
  setMoveBalance: (balance) => set({ moveBalance: balance }),
  setGear: (gear) => set({ gear }),
  setDailyCapRemaining: (cap) => set({ dailyCapRemaining: cap }),
  setOwnedZones: (hexIds) => set({ ownedZoneIds: hexIds }),
  refreshZones: (hexIds) => set({ ownedZoneIds: hexIds }),

  setVisibleZones: (zones) => set({ visibleZones: zones }),
  setSelectedHex: (hexId) => set({ selectedHexId: hexId }),
  selectHex: (hexId) => set({ selectedHexId: hexId }),

  setActiveBattles: (battles) => set({ activeBattles: battles }),
  loadBattles: (battles) => set({ activeBattles: battles }),

  // Legacy aliases
  startTracking: () => get().startRun(),
  stopTracking: () => get().stopRun(),
}));
