/**
 * In-memory hand-off for a finished movement session, so the summary screen
 * can read the full route without serializing it through router params.
 * Intentionally not persisted: raw GPS points live only as long as the user
 * is looking at the summary. Saving a session stores derived stats only
 * (distance/time → XP record) via the existing game store.
 */
import type { TrackPoint } from "@/lib/geo";
import type { TrackerMode } from "./moveTracker";

export interface FinishedSession {
  mode: TrackerMode;
  points: TrackPoint[];
  distanceM: number;
  durationMs: number;
  finishedAt: number;
}

let last: FinishedSession | null = null;

export function setLastSession(session: FinishedSession): void {
  last = session;
}

export function getLastSession(): FinishedSession | null {
  return last;
}

export function clearLastSession(): void {
  last = null;
}

/**
 * XP preview for a session: 60 XP per km + 3 XP per minute, floored at 25 and
 * capped at 300 so long sessions can't be farmed for unbounded XP. Display
 * math only — awarding still goes through the store's once-per-day gate.
 */
export function sessionXp(distanceM: number, durationMs: number): number {
  const km = distanceM / 1000;
  const minutes = durationMs / 60_000;
  const xp = Math.round(km * 60 + minutes * 3);
  return Math.max(25, Math.min(300, xp));
}

/** Minimum to count as a real session (avoids junk saves). */
export function isSaveable(distanceM: number, durationMs: number): boolean {
  return distanceM >= 200 || durationMs >= 5 * 60_000;
}
