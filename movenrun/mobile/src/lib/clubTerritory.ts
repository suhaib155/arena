/**
 * Local club territory dashboard — Free Map Beta, on-device only.
 *
 * A read-only, deterministic command layer that connects the locally-selected
 * club (preview only) to the user's captured zones, districts, rivals, and city
 * war. It is built entirely from existing local overviews + safe scalar zone
 * stats — there are **no real members/users/accounts/contacts, no chat/invites,
 * no multiplayer/PvP, no leaderboards/rankings, no backend, network, chain,
 * wallet, map SDK, raw GPS, rewards, or payments**, and **no
 * geography/coordinate/route/location inference**. Pure and clock-free (no
 * `Date.now()` / no `Math.random`): callers pass already-derived overviews. It
 * gates nothing.
 */
import type { CityDistrictsOverview } from "@/lib/cityDistricts";
import type { RivalGhostsOverview } from "@/lib/rivalGhosts";
import type { CityWarBoard, BattleStatus } from "@/lib/cityWarBoard";

export type ClubStance = "expanding" | "defending" | "rebuilding" | "holding";
/** Semantic CTA — resolved to a concrete route by the screen. */
export type ClubAction =
  | "districts"
  | "rivals"
  | "war"
  | "alerts"
  | "map"
  | "events"
  | "objectives"
  | "move"
  | "clubs"
  | "zone";

/** Safe scalar stats for one captured zone (no coords/path/location). */
export interface ZoneStat {
  id: string;
  name: string;
  control: number;
  defense: number;
  healthy: boolean;
}

export interface ClubDistrictPresence {
  id: string;
  name: string;
  /** 0..100. */
  presencePct: number;
  pressurePct: number;
  status: BattleStatus;
  action: ClubAction;
}

export interface ClubZoneContribution {
  id: string;
  name: string;
  control: number;
  defense: number;
  /** "Anchor zone" / "Solid hold" / "Needs defending". */
  label: string;
  action: ClubAction;
}

export interface ClubTerritory {
  clubLabel: string;
  hasClub: boolean;
  hasZones: boolean;
  stance: ClubStance;
  stanceLabel: string;
  /** 0..100. */
  territoryScore: number;
  defenseScore: number;
  activityScore: number;
  districts: ClubDistrictPresence[];
  topZones: ClubZoneContribution[];
  rivalSummary: { label: string; action: ClubAction };
  cityWarSummary: { label: string; action: ClubAction };
  recommendedAction: { label: string; ctaLabel: string; action: ClubAction };
  summaryLine: string;
  previewOnly: true;
}

export interface ClubTerritoryInput {
  clubName: string | null;
  hasZones: boolean;
  city: CityDistrictsOverview;
  rivals: RivalGhostsOverview;
  war: CityWarBoard;
  /** Safe per-zone scalar stats, precomputed by the screen (clock-free model). */
  zoneStats: ZoneStat[];
  momentum: number;
  objectivesProgress: number;
  streak: number;
  /** Average route-trust score (0..100), or 0. */
  avgTrust: number;
}

const STANCE_LABEL: Record<ClubStance, string> = {
  expanding: "Expanding",
  defending: "Defending",
  rebuilding: "Rebuilding",
  holding: "Holding",
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function contributionLabel(control: number, defense: number): string {
  const strength = control * 0.6 + defense * 0.4;
  if (strength >= 70) return "Anchor zone";
  if (strength >= 40) return "Solid hold";
  return "Needs defending";
}

/** Deterministically build the club territory dashboard from local overviews. */
export function buildClubTerritory(input: ClubTerritoryInput): ClubTerritory {
  const { city, rivals, war } = input;
  const clubLabel = input.clubName ?? "Your Crew";
  const hasClub = input.clubName != null;
  const hasZones = input.hasZones;

  const totalZones = input.zoneStats.length;
  const totalHealthy = city.districts.reduce((s, d) => s + d.healthy, 0);
  const totalAtRisk = city.districts.reduce((s, d) => s + d.atRisk, 0);
  const totalDormant = city.districts.reduce((s, d) => s + d.dormant, 0);
  const avgDefense =
    totalZones > 0 ? input.zoneStats.reduce((s, z) => s + z.defense, 0) / totalZones : 0;

  // Territory score — how much of the city the club holds.
  const controlledRatio = city.activeDistricts > 0 ? city.controlledDistricts / city.activeDistricts : 0;
  const territoryScore = hasZones
    ? clamp(
        Math.round(
          controlledRatio * 100 * 0.4 +
            (Math.min(totalZones, 12) / 12) * 100 * 0.4 +
            (Math.min(city.activeDistricts, 8) / 8) * 100 * 0.2,
        ),
        0,
        100,
      )
    : 0;

  // Defense score — healthy + defended, minus at-risk/dormant pressure.
  const defenseScore = hasZones
    ? clamp(
        Math.round(
          (totalHealthy / Math.max(1, totalZones)) * 100 * 0.6 +
            avgDefense * 0.4 -
            ((totalAtRisk + totalDormant) / Math.max(1, totalZones)) * 30,
        ),
        0,
        100,
      )
    : 0;

  // Activity score — momentum + streak + objectives + trust.
  const activityScore = clamp(
    Math.round(
      input.momentum * 0.4 +
        (Math.min(input.streak, 7) / 7) * 100 * 0.2 +
        input.objectivesProgress * 0.2 +
        input.avgTrust * 0.2,
    ),
    0,
    100,
  );

  const stance: ClubStance = !hasZones
    ? "rebuilding"
    : rivals.highPressure > 0 || defenseScore < 40
      ? "defending"
      : activityScore >= 60 && territoryScore < 80
        ? "expanding"
        : "holding";

  // District presence — reuse the city-war battle rows (control vs pressure).
  const districts: ClubDistrictPresence[] = war.districtBattles.map((b) => ({
    id: b.id,
    name: b.name,
    presencePct: b.playerControl,
    pressurePct: b.rivalPressure,
    status: b.status,
    action: "districts",
  }));

  // Top zone contributions — strongest holds first.
  const topZones: ClubZoneContribution[] = [...input.zoneStats]
    .sort((a, b) => b.control + b.defense - (a.control + a.defense))
    .slice(0, 4)
    .map((z) => ({
      id: z.id,
      name: z.name,
      control: z.control,
      defense: z.defense,
      label: contributionLabel(z.control, z.defense),
      action: "zone",
    }));

  const rivalSummary = {
    label: rivals.hasPressure
      ? `${rivals.highPressure} high-pressure rival${rivals.highPressure === 1 ? "" : "s"} · ${rivals.topResponse?.name ?? "circling"}`
      : "No active rival pressure",
    action: "rivals" as ClubAction,
  };
  const cityWarSummary = {
    label: `${war.playerSideLabel} ${war.playerScore} · Ghost Crews ${war.rivalPressureScore} · ${war.balanceLabel}`,
    action: "war" as ClubAction,
  };

  const recommendedAction = pickAction(stance, hasZones);

  return {
    clubLabel,
    hasClub,
    hasZones,
    stance,
    stanceLabel: STANCE_LABEL[stance],
    territoryScore,
    defenseScore,
    activityScore,
    districts,
    topZones,
    rivalSummary,
    cityWarSummary,
    recommendedAction,
    summaryLine: hasZones
      ? `${clubLabel} · ${STANCE_LABEL[stance]} · territory ${territoryScore}`
      : "Capture zones to build your club territory preview.",
    previewOnly: true,
  };
}

function pickAction(
  stance: ClubStance,
  hasZones: boolean,
): { label: string; ctaLabel: string; action: ClubAction } {
  if (!hasZones) {
    return { label: "Capture your first zone to build club territory.", ctaLabel: "Start Move", action: "move" };
  }
  switch (stance) {
    case "defending":
      return { label: "Rivals are pressing — defend your contested districts.", ctaLabel: "View Alerts", action: "alerts" };
    case "expanding":
      return { label: "Momentum is high — capture new ground for the club.", ctaLabel: "Start Move", action: "move" };
    case "rebuilding":
      return { label: "Rebuild your hold — capture and defend zones.", ctaLabel: "Start Move", action: "move" };
    default:
      return { label: "Territory is steady — keep moving to hold it.", ctaLabel: "View Map", action: "map" };
  }
}
