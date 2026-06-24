/**
 * Local zone command model — Free Map Beta, on-device only.
 *
 * Derives a deterministic "command center" summary for one captured zone from
 * existing local zone state (status/control/defense/timestamps/fortify). No raw
 * GPS, coordinates, route paths, or location names; no backend, chain, or
 * wallet. It only describes state and recommends a local next action — it gates
 * nothing.
 */
import type { Zone } from "@/types";
import {
  AT_RISK_DEFENSE,
  HEALTH_LABEL,
  riskLabel,
  zoneStatus,
} from "@/lib/territory";

/** Which local action the command center recommends. */
export type ZoneActionKind = "fortify" | "move" | "healthy" | "reclaim";

export type DefenseReadiness = "Strong" | "Holding" | "Low" | "Critical";
export type ControlTrend = "rising" | "holding" | "slipping";

export interface ZoneStatCard {
  label: string;
  value: string;
}

export interface ZoneCommand {
  title: string;
  displayId: string;
  healthLabel: string;
  control: number;
  defense: number;
  risk: number;
  riskLevel: "Low" | "Elevated" | "High";
  defenseReadiness: DefenseReadiness;
  controlTrend: ControlTrend;
  /** Recommended local next action. */
  action: { kind: ZoneActionKind; label: string; cta: string };
  /** One-line non-financial strategy recommendation. */
  strategy: string;
  /** Compact stat grid (scalar, no location). */
  stats: ZoneStatCard[];
}

const DAY_MS = 86_400_000;

function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  return Math.floor((now - new Date(iso).getTime()) / DAY_MS);
}

function relativeWhen(iso: string | null, now: number): string {
  const d = daysSince(iso, now);
  if (d == null) return "never";
  if (d <= 0) return "today";
  if (d === 1) return "1d ago";
  return `${d}d ago`;
}

function readiness(defense: number): DefenseReadiness {
  if (defense >= 70) return "Strong";
  if (defense >= AT_RISK_DEFENSE) return "Holding";
  if (defense > 0) return "Low";
  return "Critical";
}

/** Build the deterministic command summary for a zone. */
export function buildZoneCommand(zone: Zone, now: number = Date.now()): ZoneCommand {
  const status = zoneStatus(zone, now);
  const defenseReadiness = readiness(status.defense);
  const recentlyDefended = (daysSince(zone.lastDefendedAt, now) ?? 99) <= 1;

  let controlTrend: ControlTrend;
  if (status.health === "dormant" || status.health === "atRisk" || status.health === "contestedPreview") {
    controlTrend = "slipping";
  } else if (recentlyDefended) {
    controlTrend = "rising";
  } else {
    controlTrend = "holding";
  }

  let action: ZoneCommand["action"];
  let strategy: string;
  if (status.health === "dormant") {
    action = { kind: "reclaim", label: "Dormant zone", cta: "Reclaim soon" };
    strategy = "This zone went dormant. Move through it soon to bring it back.";
  } else if (status.health !== "yours" || status.defense < AT_RISK_DEFENSE) {
    action = { kind: "move", label: "Defend next", cta: "Start Move to defend" };
    strategy = "Defense is low — defend soon by moving through this zone.";
  } else if (defenseReadiness !== "Strong") {
    action = { kind: "fortify", label: "Fortify zone", cta: "Fortify zone" };
    strategy = "Healthy for now. Fortify to build a buffer, or move to defend.";
  } else {
    action = { kind: "healthy", label: "Keep healthy", cta: "Start Move to hold" };
    strategy = "Strong and healthy. Keep moving to hold your territory.";
  }

  const ageDays = daysSince(zone.capturedAt, now);
  const stats: ZoneStatCard[] = [
    { label: "Control", value: `${status.control}%` },
    { label: "Defense", value: `${status.defense}%` },
    { label: "Readiness", value: defenseReadiness },
    { label: "Fortify level", value: `×${zone.fortifyCount}` },
    { label: "Last defended", value: relativeWhen(zone.lastDefendedAt, now) },
    { label: "Captured", value: ageDays == null ? "—" : ageDays <= 0 ? "today" : `${ageDays}d ago` },
  ];

  return {
    title: zone.name,
    displayId: zone.id,
    healthLabel: HEALTH_LABEL[status.health],
    control: status.control,
    defense: status.defense,
    risk: status.risk,
    riskLevel: riskLabel(status.risk),
    defenseReadiness,
    controlTrend,
    action,
    strategy,
    stats,
  };
}
