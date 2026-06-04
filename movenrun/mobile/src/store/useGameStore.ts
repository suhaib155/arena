import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Quest } from "@/types";
import { getLevelInfo } from "@/lib/leveling";
import { dayKey, daysBetween } from "@/lib/date";

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
  streakIncreased: boolean;
  alreadyCompletedToday: boolean;
}

interface GameState {
  totalXp: number;
  streak: number;
  /** Day key of the last day a quest was completed. */
  lastActiveDay: string | null;
  questsCompleted: number;
  history: CompletionRecord[];
  /** Hydration flag so the UI can wait for AsyncStorage before rendering. */
  _hydrated: boolean;

  completeQuest: (quest: Quest) => CompletionOutcome;
  reset: () => void;
}

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      totalXp: 0,
      streak: 0,
      lastActiveDay: null,
      questsCompleted: 0,
      history: [],
      _hydrated: false,

      completeQuest: (quest) => {
        const state = get();
        const today = dayKey();
        const totalXpBefore = state.totalXp;
        const levelBefore = getLevelInfo(totalXpBefore).level;

        // Streak logic: +1 if last active was yesterday, unchanged if already
        // today, otherwise the streak resets to 1.
        let streak = state.streak;
        let streakIncreased = false;
        const alreadyCompletedToday = state.lastActiveDay === today;

        if (!alreadyCompletedToday) {
          const gap =
            state.lastActiveDay === null
              ? Infinity
              : daysBetween(state.lastActiveDay, today);
          if (gap === 1) {
            streak += 1;
          } else {
            streak = 1;
          }
          streakIncreased = true;
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
          streakIncreased,
          alreadyCompletedToday,
        };
      },

      reset: () =>
        set({
          totalXp: 0,
          streak: 0,
          lastActiveDay: null,
          questsCompleted: 0,
          history: [],
        }),
    }),
    {
      name: "movenrun-game-v1",
      storage: createJSONStorage(() => AsyncStorage),
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
