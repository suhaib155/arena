/**
 * Weekly Recap presentation view — pure, platform-free, testable.
 *
 * Chooses the single dominant metric for the editorial recap hero from the
 * existing `WeeklyRecap` (which stays the source of truth). It never fabricates
 * a previous-week comparison, percentage improvement, or trend — the recap
 * model has none, so this view exposes none. It only picks the strongest real
 * metric to feature and leaves the rest as supporting stats.
 */
import type { WeeklyRecap } from "@/lib/weeklyRecap";
import { recapFormat } from "@/lib/weeklyRecap";

export type DominantMetricKind = "distance" | "routes" | "xp" | "duration";

export interface DominantMetric {
  kind: DominantMetricKind;
  value: string;
  label: string;
}

/**
 * Pick the dominant recap metric: distance when there's real distance,
 * otherwise the strongest other real metric. Returns null only when there is
 * genuinely nothing to feature (the empty state handles that case).
 */
export function pickDominantMetric(recap: WeeklyRecap): DominantMetric | null {
  if (recap.distanceMeters > 0) {
    return { kind: "distance", value: recapFormat.fmtKm(recap.distanceMeters), label: "distance this week" };
  }
  if (recap.routes > 0) {
    return { kind: "routes", value: `${recap.routes}`, label: recap.routes === 1 ? "route this week" : "routes this week" };
  }
  if (recap.xpGained > 0) {
    return { kind: "xp", value: `+${recap.xpGained}`, label: "XP this week" };
  }
  if (recap.durationSeconds > 0) {
    return { kind: "duration", value: recapFormat.fmtDuration(recap.durationSeconds), label: "active time this week" };
  }
  return null;
}

export interface SupportingMetric {
  value: string;
  label: string;
}

/** The supporting metrics row — real values only, excluding whichever metric is
 *  already featured as dominant. */
export function supportingMetrics(recap: WeeklyRecap, dominant: DominantMetricKind | null): SupportingMetric[] {
  const out: SupportingMetric[] = [];
  if (dominant !== "routes") out.push({ value: `${recap.routes}`, label: recap.routes === 1 ? "route" : "routes" });
  if (dominant !== "duration") out.push({ value: recapFormat.fmtDuration(recap.durationSeconds), label: "active" });
  if (recap.zonesCaptured > 0) out.push({ value: `${recap.zonesCaptured}`, label: "captured" });
  if (recap.defends > 0) out.push({ value: `${recap.defends}`, label: "defends" });
  if (dominant !== "xp") out.push({ value: `+${recap.xpGained}`, label: "XP" });
  return out.slice(0, 3);
}

export interface RecapView {
  hasActivity: boolean;
  dominant: DominantMetric | null;
  supporting: SupportingMetric[];
  /** The single next recommended action line (from the recap). */
  nextFocus: string;
  /** The week's highlight (from the recap). */
  topAchievement: string;
  /** Always true — the recap is a local, on-device preview. */
  localPreview: true;
}

export function buildRecapView(recap: WeeklyRecap): RecapView {
  const dominant = pickDominantMetric(recap);
  return {
    hasActivity: recap.hasActivity,
    dominant,
    supporting: dominant ? supportingMetrics(recap, dominant.kind) : [],
    nextFocus: recap.nextFocus,
    topAchievement: recap.topAchievement,
    localPreview: true,
  };
}
