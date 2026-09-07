import type { Quest } from "../types";
import type { CompletionOutcome } from "../store/useGameStore";

/** One bounded, install-local timed attempt. Contains no location or credentials. */
export interface QuestAttempt {
  id: string;
  questId: string;
  activeMs: number;
  status: "active" | "paused" | "completed" | "abandoned";
  outcome: CompletionOutcome | null;
}

export function questCompletionSatisfied(attempt: QuestAttempt | null, quest: Quest, attemptId?: string): boolean {
  return Boolean(attempt && attempt.id === attemptId && attempt.questId === quest.id &&
    (attempt.status === "active" || attempt.status === "paused") &&
    Number.isFinite(attempt.activeMs) && attempt.activeMs >= quest.durationSeconds * 1000);
}

export function advanceQuestAttempt(attempt: QuestAttempt, elapsedMs: number, quest: Quest): QuestAttempt {
  if (attempt.status !== "active" || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return attempt;
  return { ...attempt, activeMs: Math.min(quest.durationSeconds * 1000, attempt.activeMs + elapsedMs) };
}
