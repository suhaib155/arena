import type { Quest, QuestRequestContext } from "@/types";
import { QUESTS } from "@/data/quests";

/**
 * The single access point for quest data in the app.
 *
 * Screens and the store depend on this interface — never on the raw quest
 * arrays. That keeps one clean seam so a future, server-side AI quest source
 * can be dropped in (e.g. an `ApiQuestService` / `AiQuestService` implementing
 * the same interface, prefetched at session start) without touching any screen.
 *
 * Today this is implemented entirely with local mock data — no network, no AI,
 * no keys. Methods are synchronous because the mock resolves instantly; an
 * async implementation would live behind a session-start prefetch (see
 * `@/hooks/useSessionStart`) so screens stay simple.
 */
export interface QuestService {
  /** Today's featured quest. Stable within a local day, rotates day to day. */
  getDailyQuest(ctx?: QuestRequestContext): Quest;
  /** Look up a quest by id, or `null` if it doesn't exist. */
  getQuestById(id: string): Quest | null;
  /** The full quest catalogue. */
  listQuests(ctx?: QuestRequestContext): Quest[];
  /** Quests to surface alongside the daily one (everything except the daily). */
  getRecommendedQuests(ctx?: QuestRequestContext): Quest[];
}

const byId: Record<string, Quest> = Object.fromEntries(
  QUESTS.map((q) => [q.id, q]),
);

/** Days since the Unix epoch in *local* time, so the daily quest rotates at
 *  local midnight (consistent with completed-today logic). */
function localDayNumber(date: Date): number {
  const localMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round(localMidnight.getTime() / 86_400_000);
}

/** Local, mock implementation. The only quest source in the MVP. */
export const localQuestService: QuestService = {
  getDailyQuest(ctx) {
    const date = ctx?.date ?? new Date();
    return QUESTS[localDayNumber(date) % QUESTS.length];
  },

  getQuestById(id) {
    return byId[id] ?? null;
  },

  listQuests() {
    return QUESTS;
  },

  getRecommendedQuests(ctx) {
    const daily = this.getDailyQuest(ctx);
    return QUESTS.filter((q) => q.id !== daily.id);
  },
};

/** The service the app uses. Swap this binding to change the quest source. */
export const questService: QuestService = localQuestService;
