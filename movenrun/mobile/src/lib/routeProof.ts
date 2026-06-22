/**
 * Route Proof — Free Map Beta, local share preview only.
 *
 * Builds a privacy-safe, shareable summary of a completed route from scalar
 * summary fields only. It deliberately contains **no raw GPS, coordinates,
 * polyline/path, map image, location names, or start/end points** — nothing
 * that can reconstruct where the user went. It is a *local preview*, not an
 * on-chain or oracle-verified proof, and it does not affect rewards, capture,
 * defend, or ownership. Generated on demand; nothing new is persisted.
 */
import type { RouteOutcome } from "@/lib/routeTrust";

export interface RouteProofInput {
  /** ISO timestamp of the route (optional; affects only the proof id + date). */
  createdAt?: string;
  distanceMeters: number;
  durationSeconds: number;
  trustScore: number;
  trustLabel: string;
  routeOutcome: RouteOutcome;
  zonesTouched?: number;
  defendedCount?: number;
  /** Selected club name, if any (display badge only). */
  clubName?: string | null;
  /** Route Signal Passport label, if available (display badge only). */
  passportLabel?: string | null;
}

export interface RouteProof extends RouteProofInput {
  /** Local, non-cryptographic id like "MR-LOCAL-8F3A2C". */
  proofId: string;
  /** Plain-text summary for the OS share sheet (no location data). */
  shareText: string;
}

const OUTCOME_LABEL: Record<RouteOutcome, string> = {
  saved: "Saved",
  captured: "Captured",
  defended: "Defended",
  "summary-only": "Saved",
};

/** Small deterministic FNV-1a hash → 6-char base36, for display ids only. */
function shortHash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).toUpperCase().padStart(6, "0").slice(0, 6);
}

export function outcomeLabel(outcome: RouteOutcome): string {
  return OUTCOME_LABEL[outcome];
}

/** "0.0 km" / "320 m" — distance only, never a location. */
function fmtKm(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

function fmtDuration(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Human run-title line, e.g. "Free Run · Captured". */
export function runTitle(outcome: RouteOutcome): string {
  if (outcome === "captured") return "Territory Captured";
  if (outcome === "defended") return "Zone Defended";
  return "Free Run";
}

/**
 * Build a route proof from safe summary fields. Deterministic: the same input
 * yields the same proof id and text.
 */
export function buildProof(input: RouteProofInput): RouteProof {
  const key = [
    Math.round(input.trustScore),
    Math.round(input.distanceMeters),
    Math.round(input.durationSeconds),
    input.routeOutcome,
    input.createdAt ?? "",
  ].join("|");
  const proofId = `MR-LOCAL-${shortHash(key)}`;

  const zones = input.zonesTouched ?? 0;
  const lines = [
    "MovenRun Route Proof Preview",
    `Free Run · ${outcomeLabel(input.routeOutcome)}`,
    `Distance: ${fmtKm(input.distanceMeters)}`,
    `Duration: ${fmtDuration(input.durationSeconds)}`,
    `Trust: ${input.trustLabel} · ${Math.round(input.trustScore)}`,
  ];
  if (input.zonesTouched != null) {
    lines.push(`Territory: ${zones} zone${zones === 1 ? "" : "s"} touched`);
  }
  lines.push(`Proof: ${proofId}`, "", "No raw GPS. No route path.", "Local preview only · not on-chain.");
  const shareText = lines.join("\n");

  return { ...input, proofId, shareText };
}
