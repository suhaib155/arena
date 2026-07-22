/**
 * Signal-quality classification — pure, platform-free, testable off-device.
 *
 * Centralizes the single rule the movement session already used inline
 * (accuracy worse than ~25 m ⇒ weak) so the Start readiness chip and the
 * Active Move chip classify GPS the same way. This is presentation only: it
 * does NOT change GPS sampling, route validation, anti-cheat, or which points
 * the tracker accepts — those remain in `lib/geo.ts` and the session logic.
 */

export type SignalQuality = "searching" | "locked" | "weak";

/** Accuracy (metres) at or below which a fix is considered strong. Matches the
 *  historical session threshold (a reading > 25 m is "weak"). */
export const STRONG_ACCURACY_M = 25;

/**
 * Classify a GPS accuracy reading.
 * - `null`/unknown → "searching" (no usable fix yet)
 * - ≤ STRONG_ACCURACY_M → "locked"
 * - otherwise → "weak"
 */
export function signalFromAccuracy(accuracyM: number | null | undefined): SignalQuality {
  if (accuracyM == null || !Number.isFinite(accuracyM)) return "searching";
  return accuracyM <= STRONG_ACCURACY_M ? "locked" : "weak";
}

export interface SignalVisual {
  label: string;
  /** Semantic tone the screen maps to a token colour. Not colour-only: the
   *  label text always states the status too. */
  tone: "neutral" | "ok" | "warning";
  icon: string;
}

/** Display label/tone/icon for a signal state. Demo sessions are labelled
 *  separately by the caller (they are not real GPS). */
export function signalVisual(q: SignalQuality): SignalVisual {
  switch (q) {
    case "locked":
      return { label: "GPS locked", tone: "ok", icon: "navigate" };
    case "weak":
      return { label: "Weak signal", tone: "warning", icon: "warning-outline" };
    default:
      return { label: "Searching…", tone: "neutral", icon: "ellipsis-horizontal" };
  }
}
