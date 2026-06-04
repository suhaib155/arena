import { useMemo } from "react";
import type { Quest } from "@/types";
import { questService } from "@/services/questService";
import { useGameStore, useCompletedTodayIds } from "@/store/useGameStore";

export interface AppSession {
  /** Persisted state has hydrated from storage. */
  ready: boolean;
  /** Today's featured quest. */
  dailyQuest: Quest;
  /** Quests to show alongside the daily one. */
  recommendedQuests: Quest[];
  /** Quest ids already completed (and awarded) today. */
  completedTodayIds: readonly string[];
  /** Whether today's daily quest has already been completed. */
  dailyCompletedToday: boolean;
}

/**
 * Single place that resolves the data a session needs on load: hydration
 * readiness, today's daily quest, and completed-today state. Screens read from
 * here instead of wiring those pieces together themselves.
 *
 * This is also the seam where a future async quest source would prefetch quests
 * (e.g. `await questService.listQuests()` into a cache) before the UI renders —
 * keeping the screens unchanged.
 */
export function useSessionStart(): AppSession {
  const ready = useGameStore((s) => s._hydrated);
  const completedTodayIds = useCompletedTodayIds();

  // Quests are stable for the session; resolve once.
  const dailyQuest = useMemo(() => questService.getDailyQuest(), []);
  const recommendedQuests = useMemo(() => questService.getRecommendedQuests(), []);

  return {
    ready,
    dailyQuest,
    recommendedQuests,
    completedTodayIds,
    dailyCompletedToday: completedTodayIds.includes(dailyQuest.id),
  };
}
