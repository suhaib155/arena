import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Quest } from "@/types";
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
  /** Whether the user has seen the onboarding flow. */
  hasOnboarded: boolean;
  /** Hydration flag so the UI can wait for AsyncStorage before rendering. */
  _hydrated: boolean;

  completeQuest: (quest: Quest) => CompletionOutcome;
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

      completeOnboarding: () => set({ hasOnboarded: true }),

      // Resets progress only — keeps the user past onboarding.
      reset: () =>
        set({
          totalXp: 0,
          streak: 0,
          lastActiveDay: null,
          completedQuestIds: [],
          questsCompleted: 0,
          history: [],
        }),
    }),
    {
      name: "movenrun-game-v1",
      storage: createJSONStorage(() => AsyncStorage),
      version: 2,
      // Older persisted state (PR #3) has no `completedQuestIds`. Backfill it so
      // upgrading users don't crash and aren't wrongly blocked from quests.
      migrate: (persisted, _version) => {
        const state = (persisted ?? {}) as Partial<GameState>;
        if (!Array.isArray(state.completedQuestIds)) {
          state.completedQuestIds = [];
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
