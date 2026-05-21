import Anthropic from "@anthropic-ai/sdk";
import type { GPSPoint } from "@movenrun/shared";

export interface AntiCheatResult {
  suspicious: boolean;
  confidence: number;
  reasons: string[];
  action: "approve" | "manual_review" | "reject";
}

const ANTI_CHEAT_SYSTEM_PROMPT =
  "You are a GPS anti-cheat system for a fitness app. Analyse GPS route data " +
  "to detect fake routes. A legitimate route has: realistic speed variation (not " +
  "constant speed), natural GPS drift/noise, reasonable acceleration curves, " +
  "and elevation changes consistent with terrain. Respond ONLY in JSON. " +
  '{ "suspicious": boolean, "confidence": 0-1, "reasons": string[] }';

let anthropicClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic();
  }
  return anthropicClient;
}

function buildRouteSummary(points: GPSPoint[]): string {
  if (points.length < 2) return "Route stats: insufficient data";

  const startTime = points[0].timestamp;
  const endTime = points[points.length - 1].timestamp;
  const durationMin = (endTime - startTime) / 60_000;

  // Compute per-segment speeds (m/s → km/h)
  const speeds: number[] = [];
  let totalDistanceM = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const dtSec = (curr.timestamp - prev.timestamp) / 1000;
    if (dtSec <= 0) continue;
    const distM = haversineMeters(prev.lat, prev.lng, curr.lat, curr.lng);
    totalDistanceM += distM;
    speeds.push((distM / dtSec) * 3.6); // m/s → km/h
  }

  const distanceKm = (totalDistanceM / 1000).toFixed(2);
  const avgSpeedKmh = durationMin > 0 ? (totalDistanceM / 1000 / (durationMin / 60)).toFixed(1) : "0";
  const minSpeed = speeds.length ? Math.min(...speeds).toFixed(1) : "0";
  const maxSpeed = speeds.length ? Math.max(...speeds).toFixed(1) : "0";

  const accuracies = points.map((p) => p.accuracy);
  const minAcc = Math.min(...accuracies).toFixed(1);
  const maxAcc = Math.max(...accuracies).toFixed(1);

  // Sample every 10th point for the coordinate set
  const sample = points
    .filter((_, i) => i % 10 === 0)
    .map((p) => [parseFloat(p.lat.toFixed(5)), parseFloat(p.lng.toFixed(5))]);

  return (
    `Route stats: ${distanceKm}km over ${durationMin.toFixed(1)}min, ` +
    `avg speed ${avgSpeedKmh}km/h, ` +
    `speed variance: [${minSpeed},${maxSpeed}], ` +
    `GPS accuracy range: [${minAcc},${maxAcc}]m, ` +
    `coordinate set (sample every 10th point): ${JSON.stringify(sample)}`
  );
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function analyseRoute(gpsPoints: GPSPoint[]): Promise<AntiCheatResult> {
  const client = getClient();
  const routeSummary = buildRouteSummary(gpsPoints);

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    system: [
      {
        type: "text",
        text: ANTI_CHEAT_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" }, // Cache this — 90% cost saving on repeat calls
      },
    ],
    messages: [{ role: "user", content: routeSummary }],
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "{}";

  let parsed: { suspicious?: boolean; confidence?: number; reasons?: string[] };
  try {
    // Extract JSON even if Claude wraps it in a code block
    const match = text.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : {};
  } catch {
    parsed = {};
  }

  const suspicious = parsed.suspicious ?? false;
  const confidence = parsed.confidence ?? 0;
  const reasons = parsed.reasons ?? [];

  let action: AntiCheatResult["action"];
  if (suspicious && confidence > 0.8) {
    action = "reject";
  } else if (suspicious && confidence > 0.5) {
    // Low confidence flags go to manual review, not auto-reject
    action = "manual_review";
  } else {
    action = "approve";
  }

  return { suspicious, confidence, reasons, action };
}
