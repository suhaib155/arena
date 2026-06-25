/**
 * Local city war board — Free Map Beta, on-device only.
 *
 * Combines the existing local previews (districts, rivals, season objectives,
 * weekly recap, club) into a single fictional "season battle" board. It is
 * entirely deterministic and derived on read: **no backend, network, chain,
 * wallet, map SDK, raw GPS, real users, PvP, leaderboards, or rankings**, and
 * **no geography/coordinate/route/location inference**. It is a **local preview
 * only** — not real PvP, rewards, or on-chain activity — and it gates nothing.
 */
import type { Zone } from "@/types";
import type { CityDistrictsOverview } from "@/lib/cityDistricts";
import type { RivalGhostsOverview } from "@/lib/rivalGhosts";
import type { SeasonObjectivesOverview } from "@/lib/seasonObjectives";
import type { WeeklyRecap } from "@/lib/weeklyRecap";

export type WarBalance = "leading" | "close" | "under-pressure" | "rebuilding";
export type BattleStatus = "holding" | "contested" | "pressured";
/** Semantic CTA — resolved to a concrete route by the screen. */
export type WarAction =
  | "districts"
  | "rivals"
  | "alerts"
  | "objectives"
  | "move"
  | "recap"
  | "map";

export interface DistrictBattle {
  id: string;
  name: string;
  /** 0..100. */
  playerControl: number;
  rivalPressure: number;
  status: BattleStatus;
  recommendation: string;
  ctaLabel: string;
  action: WarAction;
}

export interface CityWarBoard {
  seasonTitle: string;
  weekLabel: string;
  playerSideLabel: string;
  rivalSideLabel: string;
  /** 0..100. */
  playerScore: number;
  rivalPressureScore: number;
  balance: WarBalance;
  balanceLabel: string;
  districtBattles: DistrictBattle[];
  topObjective: { label: string; action: WarAction } | null;
  topRivalPressure: { label: string; action: WarAction } | null;
  weeklyMomentum: { label: string; value: number };
  completedObjectives: number;
  totalObjectives: number;
  streak: number;
  /** Highest-impact "turn the tide" action. */
  priorityAction: { label: string; ctaLabel: string; action: WarAction };
  /** Any territory yet (drives the locked/future empty state). */
  hasZones: boolean;
  summaryLine: string;
  previewOnly: true;
}

export interface CityWarInput {
  zones: Zone[];
  city: CityDistrictsOverview;
  rivals: RivalGhostsOverview;
  objectives: SeasonObjectivesOverview;
  recap: WeeklyRecap;
  clubName?: string | null;
  streak: number;
}

const MAX_BATTLES = 6;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

const BALANCE_LABEL: Record<WarBalance, string> = {
  leading: "Leading",
  close: "Close fight",
  "under-pressure": "Under pressure",
  rebuilding: "Rebuilding",
};

/** Deterministically build the city war board from existing local previews. */
export function buildCityWarBoard(input: CityWarInput): CityWarBoard {
  const { zones, city, rivals, objectives, recap } = input;
  const clubName = input.clubName ?? null;
  const hasZones = zones.length > 0;

  // Aggregate safe counts from the district overview (no zone re-derivation).
  const active = city.activeDistricts;
  const totalHealthy = city.districts.reduce((s, d) => s + d.healthy, 0);
  const totalAtRisk = city.districts.reduce((s, d) => s + d.atRisk, 0);
  const totalDormant = city.districts.reduce((s, d) => s + d.dormant, 0);
  const totalZones = zones.length;

  const controlledRatio = active > 0 ? city.controlledDistricts / active : 0;
  const healthyRatio = totalZones > 0 ? totalHealthy / totalZones : 0;
  const avgTrust = recap.averageTrustScore ?? 0;

  // Player score — normalized 0..100 blend of safe progress signals.
  const playerScore = hasZones
    ? clamp(
        Math.round(
          controlledRatio * 100 * 0.3 +
            healthyRatio * 100 * 0.25 +
            objectives.progressPct * 0.2 +
            recap.momentum * 0.15 +
            avgTrust * 0.1,
        ),
        0,
        100,
      )
    : 0;

  // Rival pressure — normalized 0..100 blend of safe threat signals.
  const atRiskRatio = totalZones > 0 ? totalAtRisk / totalZones : 0;
  const dormantRatio = totalZones > 0 ? totalDormant / totalZones : 0;
  const contestedDistricts = city.districts.filter(
    (d) => d.status === "contested" || d.status === "dormant",
  ).length;
  const contestedRatio = active > 0 ? contestedDistricts / active : 0;
  const rivalPressureScore = hasZones
    ? clamp(
        Math.round(
          (Math.min(rivals.highPressure, 5) / 5) * 100 * 0.4 +
            contestedRatio * 100 * 0.3 +
            atRiskRatio * 100 * 0.2 +
            dormantRatio * 100 * 0.1,
        ),
        0,
        100,
      )
    : 0;

  const balance: WarBalance = !hasZones
    ? "rebuilding"
    : playerScore - rivalPressureScore >= 15
      ? "leading"
      : rivalPressureScore - playerScore >= 15
        ? "under-pressure"
        : "close";

  const districtBattles = buildDistrictBattles(city);

  const topObjective = objectives.nextObjective
    ? { label: objectives.nextObjective.title, action: "objectives" as WarAction }
    : null;
  const topRivalPressure = rivals.topResponse
    ? { label: rivals.topResponse.recommendation, action: "rivals" as WarAction }
    : null;

  const priorityAction = pickPriority({
    hasZones,
    balance,
    rivalPressureScore,
    topPressured: districtBattles.find((b) => b.status === "pressured") ?? null,
    hasObjective: Boolean(topObjective),
  });

  return {
    seasonTitle: "Local City War",
    weekLabel: recap.rangeLabel,
    playerSideLabel: clubName ?? "Your Crew",
    rivalSideLabel: "Ghost Crews",
    playerScore,
    rivalPressureScore,
    balance,
    balanceLabel: BALANCE_LABEL[balance],
    districtBattles,
    topObjective,
    topRivalPressure,
    weeklyMomentum: { label: recap.momentumLabel, value: recap.momentum },
    completedObjectives: objectives.completed,
    totalObjectives: objectives.total,
    streak: input.streak,
    priorityAction,
    hasZones,
    summaryLine: hasZones
      ? `${clubName ?? "Your Crew"} ${playerScore} · Ghost Crews ${rivalPressureScore} · ${BALANCE_LABEL[balance]}`
      : "Capture zones to unlock your local city war preview.",
    previewOnly: true,
  };
}

function buildDistrictBattles(city: CityDistrictsOverview): DistrictBattle[] {
  const battles: DistrictBattle[] = [];
  for (const d of city.districts) {
    if (d.zoneCount === 0) continue;
    const playerControl = clamp(Math.round(d.controlPct), 0, 100);
    const rivalPressure = clamp(
      Math.round(
        (100 - d.defensePct) * 0.4 +
          (100 - d.controlPct) * 0.2 +
          (d.atRisk + d.dormant) * 20,
      ),
      0,
      100,
    );

    const status: BattleStatus =
      rivalPressure >= 60 ? "pressured" : rivalPressure >= 35 ? "contested" : "holding";

    let recommendation: string;
    let ctaLabel: string;
    let action: WarAction;
    if (status === "pressured") {
      recommendation = `${d.name} is under heavy rival pressure — defend it.`;
      ctaLabel = "Defend";
      action = "alerts";
    } else if (status === "contested") {
      recommendation = `${d.name} is contested — keep moving through it.`;
      ctaLabel = "View District";
      action = "districts";
    } else {
      recommendation = `${d.name} is holding — keep it strong.`;
      ctaLabel = "View Map";
      action = "map";
    }

    battles.push({
      id: d.id,
      name: d.name,
      playerControl,
      rivalPressure,
      status,
      recommendation,
      ctaLabel,
      action,
    });
  }
  // Most-pressured first.
  return battles.sort((a, b) => b.rivalPressure - a.rivalPressure).slice(0, MAX_BATTLES);
}

function pickPriority(a: {
  hasZones: boolean;
  balance: WarBalance;
  rivalPressureScore: number;
  topPressured: DistrictBattle | null;
  hasObjective: boolean;
}): { label: string; ctaLabel: string; action: WarAction } {
  if (!a.hasZones) {
    return { label: "Capture your first zone to enter the city war.", ctaLabel: "Start Move", action: "move" };
  }
  if (a.topPressured) {
    return {
      label: `Turn the tide — defend ${a.topPressured.name}.`,
      ctaLabel: "View Alerts",
      action: "alerts",
    };
  }
  if (a.balance === "under-pressure") {
    return { label: "Rivals are pressing — move to push them back.", ctaLabel: "Start Move", action: "move" };
  }
  if (a.hasObjective) {
    return { label: "Push your lead — complete a season objective.", ctaLabel: "View Objectives", action: "objectives" };
  }
  return { label: "Keep moving to grow your city lead.", ctaLabel: "Start Move", action: "move" };
}
