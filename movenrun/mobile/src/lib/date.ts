/** Local calendar day key, e.g. "2026-06-04". Uses local time (not UTC), so day
 *  boundaries match the user's wall clock. Used for streaks + completed-today. */
export function getLocalDateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Backwards-compatible alias. Prefer {@link getLocalDateKey} in new code. */
export const dayKey = getLocalDateKey;

/** Whole-day difference between two day keys (b - a). */
export function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00`).getTime();
  const db = new Date(`${b}T00:00:00`).getTime();
  return Math.round((db - da) / 86_400_000);
}
