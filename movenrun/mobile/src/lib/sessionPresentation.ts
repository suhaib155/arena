/**
 * Session inventory presentation — platform-free logic behind the Account
 * Security screen, extracted so the exact production rules (grouping, control
 * visibility, status wording, timestamp formatting) run under node tests.
 *
 * The SERVER is authoritative for everything here: `isCurrent`, status, and
 * ordering all come from the API response. These helpers only group and label —
 * they never reorder across groups, never promote a session to "current", and
 * never synthesize sessions locally.
 */
import type { PublicSessionSummary } from "../services/identityApi";

export interface SessionGroups {
  /** The caller's own session, as flagged by the server. */
  current: PublicSessionSummary | null;
  /** Other active sessions, in server order (most recently used first). */
  otherActive: PublicSessionSummary[];
  /** Recently revoked/expired sessions, in server order. */
  recentlyEnded: PublicSessionSummary[];
}

/** Group the server-ordered inventory for display. Server order is preserved
 *  within each group. */
export function groupSessions(sessions: PublicSessionSummary[]): SessionGroups {
  const groups: SessionGroups = { current: null, otherActive: [], recentlyEnded: [] };
  for (const s of sessions) {
    if (s.isCurrent) {
      // Server-authoritative: first current wins; duplicates never render two
      // "current" cards.
      if (!groups.current) groups.current = s;
      else groups.recentlyEnded.push(s);
    } else if (s.status === "active") {
      groups.otherActive.push(s);
    } else {
      groups.recentlyEnded.push(s);
    }
  }
  return groups;
}

/** The per-session revoke control exists ONLY for other active sessions —
 *  never for the current session, never for settled ones. */
export function canRevokeSession(s: PublicSessionSummary): boolean {
  return !s.isCurrent && s.status === "active";
}

export function sessionStatusLabel(s: PublicSessionSummary): string {
  switch (s.status) {
    case "active":
      return s.isCurrent ? "This device" : "Active";
    case "revoked":
      return "Signed out";
    case "expired":
      return "Expired";
    default:
      return "Unknown";
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Compact "12 Jul, 14:03" formatting; null-safe and invalid-safe. */
export function formatSessionTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${hh}:${mm}`;
}

/** One caption line per session: when it started, when it was last used or
 *  when it ended. Only privacy-preserving timestamps — nothing else. */
export function sessionCaption(s: PublicSessionSummary): string {
  const parts: string[] = [];
  const issued = formatSessionTime(s.issuedAt);
  if (issued) parts.push(`Signed in ${issued}`);
  if (s.status === "revoked") {
    const revoked = formatSessionTime(s.revokedAt);
    if (revoked) parts.push(`signed out ${revoked}`);
  } else if (s.status === "expired") {
    const expired = formatSessionTime(s.expiresAt);
    if (expired) parts.push(`expired ${expired}`);
  } else {
    const lastUsed = formatSessionTime(s.lastUsedAt);
    if (lastUsed) parts.push(`last used ${lastUsed}`);
  }
  return parts.join(" · ");
}
