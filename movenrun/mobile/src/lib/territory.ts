/**
 * Local defend/fortify simulation — Free Map Beta, on-device only.
 *
 * Decay is deterministic and computed on read (no background jobs, no
 * timers): meters drain as a pure function of how long a zone has been
 * neglected, so the same zone at the same moment always shows the same
 * numbers. Stored values only change on explicit actions (capture, defend,
 * fortify, reset).
 *
 * The rules, in plain words:
 * - Defense drains 12 points per day since the last defend/fortify.
 * - Control only starts draining (6 points per day) after defense is fully
 *   depleted — defended zones never lose control.
 * - Defense below 25 → the zone is AT RISK.
 * - Defense empty for ~6+ days of neglect → CONTESTED (local preview state).
 * - Control under 35, or ~12+ days of neglect → DORMANT.
 */
import type { Zone } from "@/types";

export const DEFENSE_DECAY_PER_DAY = 12;
export const CONTROL_DECAY_PER_DAY = 6;
export const AT_RISK_DEFENSE = 25;
export const CONTESTED_NEGLECT_DAYS = 6;
export const DORMANT_CONTROL = 35;
export const DORMANT_NEGLECT_DAYS = 12;

/** Effect sizes for the two defend actions. */
export const DEFEND_DEFENSE_GAIN = 40;
export const DEFEND_CONTROL_GAIN = 10;
export const FORTIFY_DEFENSE_GAIN = 25;

/** Capture baseline (Free Map Beta tuning). */
export const CAPTURE_CONTROL = 100;
export const CAPTURE_DEFENSE = 40;

export type ZoneHealth = "yours" | "atRisk" | "contestedPreview" | "dormant";

export interface ZoneStatus {
  /** Decayed, displayable meters (0..100). */
  defense: number;
  control: number;
  /** Derived health, worst-first precedence: dormant > contested > atRisk. */
  health: ZoneHealth;
  /** 0..100 — how urgently this zone needs a defend. */
  risk: number;
  /** Whole days since the last defend/fortify touch. */
  daysNeglected: number;
}

function daysBetweenMs(fromIso: string, now: number): number {
  const from = new Date(fromIso).getTime();
  if (!isFinite(from)) return 0;
  return Math.max(0, (now - from) / 86_400_000);
}

/** The moment the decay clock last reset: defend or fortify, whichever is later. */
export function lastDefenseTouch(zone: Zone): string {
  const a = zone.lastDefendedAt ?? zone.capturedAt;
  const b = zone.lastFortifiedAt;
  return b && b > a ? b : a;
}

/** Pure, deterministic status for a zone at `now`. */
export function zoneStatus(zone: Zone, now: number = Date.now()): ZoneStatus {
  const neglect = daysBetweenMs(lastDefenseTouch(zone), now);
  const defense = Math.max(0, Math.round(zone.defensePercent - DEFENSE_DECAY_PER_DAY * neglect));
  /* Control drains only for the days after defense ran out. */
  const daysShielded = zone.defensePercent / DEFENSE_DECAY_PER_DAY;
  const overrunDays = Math.max(0, neglect - daysShielded);
  const control = Math.max(0, Math.round(zone.controlPercent - CONTROL_DECAY_PER_DAY * overrunDays));

  let health: ZoneHealth = "yours";
  if (control < DORMANT_CONTROL || neglect >= DORMANT_NEGLECT_DAYS) health = "dormant";
  else if (defense === 0 && neglect >= CONTESTED_NEGLECT_DAYS) health = "contestedPreview";
  else if (defense < AT_RISK_DEFENSE) health = "atRisk";

  const risk = Math.max(0, Math.min(100, Math.round(100 - (defense * 0.6 + control * 0.4))));
  return { defense, control, health, risk, daysNeglected: Math.floor(neglect) };
}

export const HEALTH_LABEL: Record<ZoneHealth, string> = {
  yours: "Yours",
  atRisk: "At Risk",
  contestedPreview: "Contested · preview",
  dormant: "Dormant",
};

export function riskLabel(risk: number): "Low" | "Elevated" | "High" {
  return risk < 35 ? "Low" : risk < 65 ? "Elevated" : "High";
}

/** Apply a movement defend to a zone (route touched it in a saved session). */
export function applyDefend(zone: Zone, now: number = Date.now()): Zone {
  const status = zoneStatus(zone, now);
  return {
    ...zone,
    defensePercent: Math.min(100, status.defense + DEFEND_DEFENSE_GAIN),
    controlPercent: Math.min(100, status.control + DEFEND_CONTROL_GAIN),
    lastDefendedAt: new Date(now).toISOString(),
    lastTouchedAt: new Date(now).toISOString(),
  };
}

/** Apply a fortify (Locked MOVE *preview* — nothing is spent yet). */
export function applyFortify(zone: Zone, now: number = Date.now()): Zone {
  const status = zoneStatus(zone, now);
  return {
    ...zone,
    defensePercent: Math.min(100, status.defense + FORTIFY_DEFENSE_GAIN),
    controlPercent: status.control,
    lastFortifiedAt: new Date(now).toISOString(),
    lastTouchedAt: new Date(now).toISOString(),
    fortifyCount: (zone.fortifyCount ?? 0) + 1,
  };
}

/** Same-local-day check for the fortify cooldown. */
export function fortifiedToday(zone: Zone, now: number = Date.now()): boolean {
  if (!zone.lastFortifiedAt) return false;
  const a = new Date(zone.lastFortifiedAt);
  const b = new Date(now);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Sort helper: most urgent first (highest risk). */
export function byRisk(a: Zone, b: Zone, now: number = Date.now()): number {
  return zoneStatus(b, now).risk - zoneStatus(a, now).risk;
}
