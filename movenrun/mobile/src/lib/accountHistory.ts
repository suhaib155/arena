/**
 * What a signed-in account already holds on the server, in words.
 *
 * Verified sessions are stored with the account, so a reinstalled app (or a
 * new phone) can show them even though local XP and streaks start over. Only
 * `verified` sessions count; pending, rejected and not-eligible results are
 * never presented as progress.
 */
export interface AccountHistorySummary {
  verifiedCount: number;
  totalDistanceMeters: number;
  /** One line for the Account screen. */
  label: string;
}

export function summarizeAccountHistory(
  verifications: readonly { status: string; distanceMeters: number | null }[],
): AccountHistorySummary {
  const verified = verifications.filter((v) => v.status === "verified");
  const totalDistanceMeters = verified.reduce((sum, v) => sum + Math.max(0, v.distanceMeters ?? 0), 0);
  const count = verified.length;
  const km = totalDistanceMeters / 1000;
  const distance = km >= 10 ? `${Math.round(km)} km` : `${(Math.round(km * 10) / 10).toFixed(1)} km`;
  const label =
    count === 0
      ? "No verified sessions saved to this account yet."
      : `${count} verified session${count === 1 ? "" : "s"} saved to this account · ${distance}`;
  return { verifiedCount: count, totalDistanceMeters, label };
}
