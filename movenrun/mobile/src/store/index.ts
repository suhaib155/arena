import { create } from "zustand";
import { Zone, ZoneChallenge } from "@movenrun/shared";
import { GPSPoint } from "@movenrun/shared";

interface TrackingState {
  isTracking: boolean;
  currentPoints: GPSPoint[];
  currentDistanceMeters: number;
  earnedThisRun: bigint;
}

interface UserState {
  walletAddress: string | null;
  moveBalance: bigint;
  stakedBalance: bigint;
  ownedZoneIds: string[];
}

interface ZoneState {
  visibleZones: Zone[];
  selectedHexId: string | null;
  activeBattles: ZoneChallenge[];
}

interface AppStore extends TrackingState, UserState, ZoneState {
  // Tracking actions
  startTracking: () => void;
  stopTracking: () => void;
  addGPSPoint: (point: GPSPoint) => void;
  resetRun: () => void;

  // User actions
  setWalletAddress: (address: string | null) => void;
  setMoveBalance: (balance: bigint) => void;

  // Zone actions
  setVisibleZones: (zones: Zone[]) => void;
  selectHex: (hexId: string | null) => void;
  setActiveBattles: (battles: ZoneChallenge[]) => void;
}

export const useStore = create<AppStore>((set, get) => ({
  // Tracking
  isTracking: false,
  currentPoints: [],
  currentDistanceMeters: 0,
  earnedThisRun: 0n,

  // User
  walletAddress: null,
  moveBalance: 0n,
  stakedBalance: 0n,
  ownedZoneIds: [],

  // Zones
  visibleZones: [],
  selectedHexId: null,
  activeBattles: [],

  startTracking: () => set({ isTracking: true, currentPoints: [], currentDistanceMeters: 0, earnedThisRun: 0n }),
  stopTracking: () => set({ isTracking: false }),
  addGPSPoint: (point) =>
    set((state) => ({
      currentPoints: [...state.currentPoints, point],
    })),
  resetRun: () => set({ currentPoints: [], currentDistanceMeters: 0, earnedThisRun: 0n }),

  setWalletAddress: (address) => set({ walletAddress: address }),
  setMoveBalance: (balance) => set({ moveBalance: balance }),

  setVisibleZones: (zones) => set({ visibleZones: zones }),
  selectHex: (hexId) => set({ selectedHexId: hexId }),
  setActiveBattles: (battles) => set({ activeBattles: battles }),
}));
