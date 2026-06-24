/**
 * Local territory alerts — Free Map Beta, on-device only.
 *
 * Derives in-app reminder cards from existing local zone state (status, decay,
 * defend/fortify timestamps) plus a little scalar context. Everything is
 * read-only and computed on demand: no push notifications, no notification
 * permissions, no background tasks, no backend/network/chain/wallet, no raw
 * GPS/coordinates/path/location. Alerts are suggestions — they gate nothing.
 */
import type { Zone } from "@/types";
import { AT_RISK_DEFENSE, fortifiedToday, zoneStatus } from "@/lib/territory";

export type AlertSeverity = "info" | "caution" | "urgent" | "success";
export type AlertCategory = "defend" | "fortify" | "dormant" | "healthy" | "progress";
/** Semantic CTA — resolved to a concrete route by the screen. */
export type AlertAction = "zone" | "move" | "map" | "today";

export interface TerritoryAlert {
  id: string;
  zoneId?: string;
  title: string;
  description: string;
  severity: AlertSeverity;
  category: AlertCategory;
  ctaLabel: string;
  action: AlertAction;
  /** Higher = more important; drives ordering and the top recommended action. */
  priority: number;
}

export interface AlertsSummary {
  alerts: TerritoryAlert[];
  urgent: number;
  caution: number;
  /** success + info (calm / progress) count. */
  positive: number;
  /** Highest-priority alert, or null when there are none. */
  topAction: TerritoryAlert | null;
}

export interface AlertsInput {
  zones: Zone[];
  streak: number;
  /** Saved a route / completed something today (drives "build your streak"). */
  hasRecentActivity: boolean;
  now?: number;
}

/** Keep the list focused. */
const MAX_ALERTS = 8;

/** Deterministically derive the local territory alerts. */
export function buildTerritoryAlerts(input: AlertsInput): AlertsSummary {
  const now = input.now ?? Date.now();
  const { zones } = input;
  const alerts: TerritoryAlert[] = [];

  if (zones.length === 0) {
    alerts.push({
      id: "first-capture",
      title: "Capture your first zone",
      description: "Start a move and save a route to capture local territory.",
      severity: "info",
      category: "progress",
      ctaLabel: "Start Move",
      action: "move",
      priority: 80,
    });
    return summarize(alerts);
  }

  let actionable = 0;
  for (const zone of zones) {
    const status = zoneStatus(zone, now);
    if (status.health === "dormant") {
      actionable++;
      alerts.push({
        id: `dormant-${zone.id}`,
        zoneId: zone.id,
        title: `${zone.name} is dormant`,
        description: "Low activity — move through it soon to bring it back.",
        severity: "urgent",
        category: "dormant",
        ctaLabel: "Open zone",
        action: "zone",
        priority: 90 + status.risk,
      });
    } else if (status.health !== "yours" || status.defense < AT_RISK_DEFENSE) {
      actionable++;
      const urgent = status.defense < 12;
      alerts.push({
        id: `defend-${zone.id}`,
        zoneId: zone.id,
        title: `Defend ${zone.name} soon`,
        description: `Defense ${status.defense}% — move through it to refresh.`,
        severity: urgent ? "urgent" : "caution",
        category: "defend",
        ctaLabel: "Open zone",
        action: "zone",
        priority: 70 + status.risk,
      });
    } else if (!fortifiedToday(zone, now)) {
      alerts.push({
        id: `fortify-${zone.id}`,
        zoneId: zone.id,
        title: `Fortify ${zone.name}`,
        description: "Healthy — fortify today to build a buffer.",
        severity: "info",
        category: "fortify",
        ctaLabel: "Open zone",
        action: "zone",
        priority: 40,
      });
    }
  }

  if (actionable === 0) {
    alerts.push({
      id: "healthy",
      title: "Territory healthy",
      description: "All your zones look stable. Keep moving to hold them.",
      severity: "success",
      category: "healthy",
      ctaLabel: "View Territory Map",
      action: "map",
      priority: 30,
    });
  }

  if (input.hasRecentActivity && input.streak > 0) {
    alerts.push({
      id: "streak",
      title: `Keep your ${input.streak}-day streak`,
      description: "Move today to keep your streak and strengthen your territory.",
      severity: "success",
      category: "progress",
      ctaLabel: "Start Move",
      action: "move",
      priority: 25,
    });
  }

  if (zones.length >= 3) {
    alerts.push({
      id: "review-map",
      title: "Review your map",
      description: `You hold ${zones.length} zones — check the board at a glance.`,
      severity: "info",
      category: "progress",
      ctaLabel: "View Territory Map",
      action: "map",
      priority: 20,
    });
  }

  return summarize(alerts);
}

function summarize(alerts: TerritoryAlert[]): AlertsSummary {
  const sorted = [...alerts]
    .sort((a, b) => b.priority - a.priority)
    .slice(0, MAX_ALERTS);
  return {
    alerts: sorted,
    urgent: sorted.filter((a) => a.severity === "urgent").length,
    caution: sorted.filter((a) => a.severity === "caution").length,
    positive: sorted.filter((a) => a.severity === "success" || a.severity === "info").length,
    topAction: sorted[0] ?? null,
  };
}
