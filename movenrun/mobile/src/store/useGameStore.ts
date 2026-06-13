import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Quest, Zone } from "@/types";
import { applyDefend, applyFortify, fortifiedToday } from "@/lib/territory";
import { getLevelInfo } from "@/lib/leveling";
import { getLocalDateKey, daysBetween } from "@/lib/date";

const EMPTY_IDS: readonly string[] = [];

export interface CompletionRecord {
  questId: string;
  questTitle: string;
  xp: number;
  /** ISO timestamp of when it was completed. */
  completedAt: string;
}

/** Outcome of a zone capture attempt. */
export interface CaptureOutcome {
  /** True when the zone was newly added to the portfolio. */
  captured: boolean;
  /** True when the zone was already owned (touch refreshed instead). */
  alreadyOwned: boolean;
  zone: Zone;
}

/** Result returned to the UI so the Result screen can show what happened. */
export interface CompletionOutcome {
  xpGained: number;
  totalXpBefore: number;
  totalXpAfter: number;
  levelBefore: number;
  levelAfter: number;
  leveledUp: boolean;
  streak: number;
  /** True when this completion was the first quest of the day (streak bumped). */
  streakIncreased: boolean;
  /** True when this quest was already completed today, so no XP was awarded. */
  alreadyAwarded: boolean;
}

interface GameState {
  totalXp: number;
  streak: number;
  /** Day key of the last day a quest was completed. */
  lastActiveDay: string | null;
  /** Quest ids already completed (and awarded) on `lastActiveDay`. Used to
   *  prevent earning XP twice for the same quest on the same local day. */
  completedQuestIds: string[];
  questsCompleted: number;
  history: CompletionRecord[];
  /** Captured common zones (Free Map Beta — local simulation only). */
  zones: Zone[];
  /** Total defend/fortify actions, for the Profile territory card. */
  timesDefended: number;
  /** Chosen club (Free Map Beta — local preview; clubs sync later).
   *  Treated as identity like `hasOnboarded`, so "Reset progress" keeps it. */
  selectedClubId: string | null;
  /** Whether the user has seen the onboarding flow. */
  hasOnboarded: boolean;
  /** Hydration flag so the UI can wait for AsyncStorage before rendering. */
  _hydrated: boolean;

  completeQuest: (quest: Quest) => CompletionOutcome;
  /** Add a captured zone (or refresh it when already owned). Demo zones are
   *  rejected here as a final guard — they must never persist. */
  captureZone: (zone: Zone) => CaptureOutcome;
  /** Movement defend: a saved session's route touched these owned zones.
   *  Refreshes defense/control and the decay clock. Returns refreshed count. */
  defendZones: (zoneIds: string[]) => number;
  /** Fortify a zone (Locked MOVE *preview* — nothing is spent). Once per
   *  zone per local day. Returns the updated zone, or null when on cooldown
   *  or unknown. */
  fortifyZone: (zoneId: string) => Zone | null;
  /** Pick (or switch) the local club. Switching stays allowed in beta. */
  selectClub: (clubId: string) => void;
  completeOnboarding: () => void;
  reset: () => void;
}

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      totalXp: 0,
      streak: 0,
      lastActiveDay: null,
      completedQuestIds: [],
      questsCompleted: 0,
      history: [],
      zones: [],
      timesDefended: 0,
      selectedClubId: null,
      hasOnboarded: false,
      _hydrated: false,

      completeQuest: (quest) => {
        const state = get();
        const today = getLocalDateKey();
        const isNewDay = state.lastActiveDay !== today;
        // Ids completed *today* (yesterday's list is stale on a new day).
        const todaysIds = isNewDay ? [] : state.completedQuestIds;

        const totalXpBefore = state.totalXp;
        const levelBefore = getLevelInfo(totalXpBefore).level;

        // Anti-farming: a quest awards XP at most once per local day. A replay
        // is idempotent — no XP, no streak change, no history entry.
        if (todaysIds.includes(quest.id)) {
          return {
            xpGained: 0,
            totalXpBefore,
            totalXpAfter: totalXpBefore,
            levelBefore,
            levelAfter: levelBefore,
            leveledUp: false,
            streak: state.streak,
            streakIncreased: false,
            alreadyAwarded: true,
          };
        }

        // Streak: +1 if the previous active day was yesterday, otherwise reset
        // to 1. Only the first completion of a new day moves the streak.
        let streak = state.streak;
        if (isNewDay) {
          const gap =
            state.lastActiveDay === null
              ? Infinity
              : daysBetween(state.lastActiveDay, today);
          streak = gap === 1 ? streak + 1 : 1;
        }

        const totalXpAfter = totalXpBefore + quest.xpReward;
        const levelAfter = getLevelInfo(totalXpAfter).level;

        const record: CompletionRecord = {
          questId: quest.id,
          questTitle: quest.title,
          xp: quest.xpReward,
          completedAt: new Date().toISOString(),
        };

        set({
          totalXp: totalXpAfter,
          streak,
          lastActiveDay: today,
          completedQuestIds: [...todaysIds, quest.id],
          questsCompleted: state.questsCompleted + 1,
          history: [record, ...state.history].slice(0, 50),
        });

        return {
          xpGained: quest.xpReward,
          totalXpBefore,
          totalXpAfter,
          levelBefore,
          levelAfter,
          leveledUp: levelAfter > levelBefore,
          streak,
          streakIncreased: isNewDay,
          alreadyAwarded: false,
        };
      },

      captureZone: (zone) => {
        const state = get();
        const existing = state.zones.find((z) => z.id === zone.id);
        if (zone.isDemo) {
          // Demo zones are display-only; never enter the portfolio.
          return { captured: false, alreadyOwned: Boolean(existing), zone: existing ?? zone };
        }
        if (existing) {
          const touched: Zone = {
            ...existing,
            lastTouchedAt: new Date().toISOString(),
            controlPercent: Math.min(100, existing.controlPercent + 10),
          };
          set({ zones: state.zones.map((z) => (z.id === zone.id ? touched : z)) });
          return { captured: false, alreadyOwned: true, zone: touched };
        }
        set({ zones: [zone, ...state.zones].slice(0, 100) });
        return { captured: true, alreadyOwned: false, zone };
      },

      defendZones: (zoneIds) => {
        const state = get();
        const now = Date.now();
        let defended = 0;
        const zones = state.zones.map((z) => {
          if (!zoneIds.includes(z.id)) return z;
          defended += 1;
          return applyDefend(z, now);
        });
        if (defended > 0) {
          set({ zones, timesDefended: state.timesDefended + defended });
        }
        return defended;
      },

      fortifyZone: (zoneId) => {
        const state = get();
        const zone = state.zones.find((z) => z.id === zoneId);
        if (!zone || fortifiedToday(zone)) return null;
        const updated = applyFortify(zone);
        set({
          zones: state.zones.map((z) => (z.id === zoneId ? updated : z)),
          timesDefended: state.timesDefended + 1,
        });
        return updated;
      },

      selectClub: (clubId) => set({ selectedClubId: clubId }),

      completeOnboarding: () => set({ hasOnboarded: true }),

      // Resets progress AND the local club selection. Club choice is still
      // local beta state (clubs sync later), so a progress reset returns the
      // user to the "choose your club" state. Onboarding is preserved.
      reset: () =>
        set({
          totalXp: 0,
          streak: 0,
          lastActiveDay: null,
          completedQuestIds: [],
          questsCompleted: 0,
          history: [],
          zones: [],
          timesDefended: 0,
          selectedClubId: null,
        }),
    }),
    {
      name: "movenrun-game-v1",
      storage: createJSONStorage(() => AsyncStorage),
      version: 5,
      // Older persisted state (PR #3) has no `completedQuestIds`; pre-territory
      // state (v2) has no `zones`; pre-defend state (v3) zones lack the defend
      // fields and shipped with defense 0. Backfill everything so upgrades
      // never crash and v3 zones arrive healthy instead of instantly decayed.
      migrate: (persisted, _version) => {
        const state = (persisted ?? {}) as Partial<GameState>;
        if (!Array.isArray(state.completedQuestIds)) {
          state.completedQuestIds = [];
        }
        if (!Array.isArray(state.zones)) {
          state.zones = [];
        }
        state.zones = state.zones.map((z) => ({
          ...z,
          lastDefendedAt: z.lastDefendedAt ?? z.capturedAt ?? new Date().toISOString(),
          lastFortifiedAt: z.lastFortifiedAt ?? null,
          fortifyCount: typeof z.fortifyCount === "number" ? z.fortifyCount : 0,
          defensePercent:
            typeof z.defensePercent === "number" && z.defensePercent > 0
              ? z.defensePercent
              : 40,
        }));
        if (typeof state.timesDefended !== "number") {
          state.timesDefended = 0;
        }
        if (typeof state.selectedClubId === "undefined") {
          state.selectedClubId = null;
        }
        return state as GameState;
      },
      // Don't persist the transient hydration flag.
      partialize: ({ _hydrated, ...rest }) => rest,
      // Flip the hydration flag once AsyncStorage has loaded so screens can
      // avoid a flash of empty (zeroed) data on cold start.
      onRehydrateStorage: () => () => {
        useGameStore.setState({ _hydrated: true });
      },
    },
  ),
);

/** Has the user finished *any* quest today (drives the "you've moved" banner)? */
export function useCompletedToday(): boolean {
  return useGameStore((s) => s.lastActiveDay === getLocalDateKey());
}

/** Quest ids the user has already completed (and been awarded XP for) today. */
export function useCompletedTodayIds(): readonly string[] {
  return useGameStore((s) =>
    s.lastActiveDay === getLocalDateKey() ? s.completedQuestIds : EMPTY_IDS,
  );
}

/** Has this specific quest already been completed today (no more XP today)? */
export function useIsCompletedToday(questId: string): boolean {
  return useGameStore(
    (s) =>
      s.lastActiveDay === getLocalDateKey() &&
      s.completedQuestIds.includes(questId),
  );
}
