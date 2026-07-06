/**
 * Local district mastery — Free Map Beta, on-device only.
 *
 * A read-only, deterministic, clock-free view of long-term *local progress* for
 * each fictional city district, blending capture, defense, activity, signal,
 * club presence, and rival pressure. It is **local progress only** — **not
 * ownership, real land, deeds, tradability, market/rarity value, rewards,
 * rankings, real members, backend, chain, wallet, map SDK, or raw GPS** — and
 * **no geography/coordinate/route/location inference**. Callers pass already-
 * built local overviews. It gates nothing. ("Mastery" = local progress, never
 * an owned asset.)
 */
import type { CityDistrictsOverview } from "@/lib/cityDistricts";
import type { CityWarBoard } from "@/lib/cityWarBoard";

export type MasteryLevel = "locked" | "discovered" | "rising" | "fortified" | "signature";
/** Semantic CTA — resolved to a concrete route by the screen. */
export type MasteryAction =
  | "districts"
  | "move"
  | "alerts"
  | "map"
  | "crew"
  | "objectives"
  | "signal"
  | "rivals"
  | "club";

export interface DistrictMastery {
  id: string;
  name: string;
  level: MasteryLevel;
  /** 0..100. */
  masteryScore: number;
  /** 0..100 toward the next level. */
  nextLevelProgress: number;
  controlContribution: number;
  defenseContribution: number;
  activityContribution: number;
  signalContribution: number;
  clubBonus: number;
  pressurePenalty: number;
  recommendation: string;
  ctaLabel: string;
  action: MasteryAction;
  priority: number;
  accent: string;
  previewOnly: true;
}

export interface DistrictMasteryOverview {
  districts: DistrictMastery[];
  /** signature count. */
  mastered: number;
  rising: number;
  fortified: number;
  locked: number;
  /** Strongest district, or null. */
  topDistrict: DistrictMastery | null;
  /** Active district with the most room to grow, or null. */
  nextToImprove: DistrictMastery | null;
  hasZones: boolean;
  summaryLine: string;
}

export interface DistrictMasteryInput {
  hasZones: boolean;
  city: CityDistrictsOverview;
  war: CityWarBoard;
  /** Club Territory presence (0..100). */
  clubPresence: number;
  momentum: number;
  streak: number;
  objectivesProgress: number;
  missionsComplete: number;
  missionsTotal: number;
  /** Average route-trust score (0..100). */
  avgTrust: number;
}

const PALETTE = {
  baseBlue: "#246BFE",
  pulseGreen: "#18C987",
  moveGold: "#F7B955",
  heatCoral: "#FF6B4A",
  deedViolet: "#7657FF",
  silverTrail: "#A3AAB8",
} as const;

const LEVEL_ACCENT: Record<MasteryLevel, string> = {
  locked: PALETTE.silverTrail,
  discovered: PALETTE.silverTrail,
  rising: PALETTE.moveGold,
  fortified: PALETTE.pulseGreen,
  signature: PALETTE.deedViolet,
};

export const MASTERY_LEVEL_LABEL: Record<MasteryLevel, string> = {
  locked: "Locked",
  discovered: "Discovered",
  rising: "Rising",
  fortified: "Fortified",
  signature: "Signature",
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function levelFor(score: number): MasteryLevel {
  if (score >= 85) return "signature";
  if (score >= 65) return "fortified";
  if (score >= 35) return "rising";
  return "discovered";
}

/** Progress (0..100) toward the next level band. */
function nextProgress(level: MasteryLevel, score: number): number {
  switch (level) {
    case "discovered":
      return clamp(Math.round((score / 35) * 100), 0, 100);
    case "rising":
      return clamp(Math.round(((score - 35) / 30) * 100), 0, 100);
    case "fortified":
      return clamp(Math.round(((score - 65) / 20) * 100), 0, 100);
    case "signature":
      return 100;
    default:
      return 0;
  }
}

/** Deterministically build district mastery from local overviews. */
export function buildDistrictMastery(input: DistrictMasteryInput): DistrictMasteryOverview {
  const { city, war } = input;

  // Per-district rival pressure from the city-war battle rows.
  const pressureById = new Map<string, number>();
  for (const b of war.districtBattles) pressureById.set(b.id, b.rivalPressure);

  // Shared activity factor (global signals applied per active district).
  const activity = clamp(
    Math.round(
      input.momentum * 0.4 +
        (Math.min(input.streak, 7) / 7) * 100 * 0.2 +
        input.objectivesProgress * 0.2 +
        (input.missionsTotal > 0 ? (input.missionsComplete / input.missionsTotal) * 100 : 0) * 0.2,
    ),
    0,
    100,
  );

  const districts: DistrictMastery[] = city.districts.map((d) => {
    if (d.zoneCount === 0) {
      return {
        id: d.id,
        name: d.name,
        level: "locked",
        masteryScore: 0,
        nextLevelProgress: 0,
        controlContribution: 0,
        defenseContribution: 0,
        activityContribution: 0,
        signalContribution: 0,
        clubBonus: 0,
        pressurePenalty: 0,
        recommendation: `Capture a zone to discover ${d.name}.`,
        ctaLabel: "Start Move",
        action: "move",
        priority: 0,
        accent: LEVEL_ACCENT.locked,
        previewOnly: true,
      };
    }

    const controlContribution = Math.round(d.controlPct * 0.3);
    const defenseContribution = Math.round(d.defensePct * 0.25);
    const activityContribution = Math.round(activity * 0.2);
    const signalContribution = Math.round(clamp(input.avgTrust, 0, 100) * 0.15);
    const clubBonus = Math.round(clamp(input.clubPresence, 0, 100) * 0.1);
    const pressurePenalty = Math.round((pressureById.get(d.id) ?? 0) * 0.15);

    const masteryScore = clamp(
      controlContribution +
        defenseContribution +
        activityContribution +
        signalContribution +
        clubBonus -
        pressurePenalty,
      0,
      100,
    );
    const level = levelFor(masteryScore);
    const { recommendation, ctaLabel, action } = pickAction(d.name, {
      control: d.controlPct,
      defense: d.defensePct,
      activity,
      signal: input.avgTrust,
      pressure: pressureById.get(d.id) ?? 0,
    });

    return {
      id: d.id,
      name: d.name,
      level,
      masteryScore,
      nextLevelProgress: nextProgress(level, masteryScore),
      controlContribution,
      defenseContribution,
      activityContribution,
      signalContribution,
      clubBonus,
      pressurePenalty,
      recommendation,
      ctaLabel,
      action,
      priority: masteryScore + (level === "signature" ? 100 : 0),
      accent: LEVEL_ACCENT[level],
      previewOnly: true,
    };
  });

  const active = districts.filter((d) => d.level !== "locked");
  const mastered = districts.filter((d) => d.level === "signature").length;
  const rising = districts.filter((d) => d.level === "rising").length;
  const fortified = districts.filter((d) => d.level === "fortified").length;
  const locked = districts.filter((d) => d.level === "locked").length;
  const topDistrict =
    [...active].sort((a, b) => b.masteryScore - a.masteryScore)[0] ?? null;
  const nextToImprove =
    [...active].sort((a, b) => a.masteryScore - b.masteryScore)[0] ?? null;

  return {
    districts,
    mastered,
    rising,
    fortified,
    locked,
    topDistrict,
    nextToImprove,
    hasZones: input.hasZones,
    summaryLine: input.hasZones
      ? `${mastered} signature · ${fortified} fortified · ${rising} rising`
      : "Capture zones to begin district mastery.",
  };
}

function pickAction(
  name: string,
  s: { control: number; defense: number; activity: number; signal: number; pressure: number },
): { recommendation: string; ctaLabel: string; action: MasteryAction } {
  if (s.pressure >= 55) {
    return { recommendation: `Defend ${name} from rival pressure.`, ctaLabel: "View Alerts", action: "alerts" };
  }
  // Recommend improving the weakest contribution.
  const weakest = Math.min(s.control, s.defense, s.activity, s.signal);
  if (weakest === s.control) {
    return { recommendation: `Capture more ground in ${name}.`, ctaLabel: "Start Move", action: "move" };
  }
  if (weakest === s.defense) {
    return { recommendation: `Strengthen defense across ${name}.`, ctaLabel: "View Map", action: "map" };
  }
  if (weakest === s.activity) {
    return { recommendation: `Run crew missions to lift ${name}.`, ctaLabel: "View Missions", action: "crew" };
  }
  return { recommendation: `Build cleaner route signal for ${name}.`, ctaLabel: "View Route Review", action: "signal" };
}
