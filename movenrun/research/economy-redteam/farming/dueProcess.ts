/**
 * Due-process model for a linked-account review (proposal, research only).
 * Pure functions. Hard limits encoded here and tested:
 *  - no automatic restriction: a case opens a human review and nothing else;
 *  - verified XP, streaks, achievements and already settled credits are never touched;
 *  - proximity alone never opens a case (a case needs a link edge AND repeated co-walks);
 *  - a decision is prospective only; an overturn restores the future allowance and mints nothing;
 *  - notifications never name another person and never use accusing words.
 */

export type CaseState = "open" | "cleared" | "upheld" | "appeal_open" | "appeal_cleared" | "appeal_upheld" | "expired";

export interface CaseEvidence {
  /** Reason codes only; no route, no coordinates, no names. */
  reasonCodes: ("LINKED_ACCOUNTS" | "REPEATED_SAME_TIME_SAME_ROUTE")[];
  /** Counts shown to the reviewer. */
  coWalkDays: number;
  windowDays: number;
  linkedAccountCount: number;
  /** Salted hashes of the stored co-walk records the counts come from. */
  recordHashes: string[];
}

export interface ReviewCase {
  caseId: string;
  accountIds: string[];
  openedDay: number;
  state: CaseState;
  evidence: CaseEvidence;
  /** Reviewer pseudonyms; the appeal reviewer must differ. */
  reviewer?: string;
  appealReviewer?: string;
  decisionDay?: number;
  /** What a decision changes. Always prospective. */
  effect: null | { kind: "linked_group_earns_as_one"; fromDay: number };
  /** Credits created or restored by any step of this case: always 0. */
  mintedMicro: 0;
  /** Exemption from re-review after a clear, in days from the decision. */
  exemptUntilDay?: number;
}

export interface Policy { reviewDelayDays: number; appealDays: number; clearedExemptDays: number; maxOpenDays: number }
export const DEFAULT_POLICY: Policy = { reviewDelayDays: 3, appealDays: 30, clearedExemptDays: 90, maxOpenDays: 21 };

export type OpenResult = { ok: true; case: ReviewCase } | { ok: false; reason: string };

/** A case may open only on a link edge plus repeated co-walks. Proximity without a link edge is refused by design. */
export function openCase(input: { caseId: string; accountIds: string[]; day: number; linkedEdgeCount: number; coWalkDays: number; threshold: number; windowDays: number; recordHashes: string[]; exemptUntilDay?: number }): OpenResult {
  if (input.linkedEdgeCount < 1) return { ok: false, reason: "no link edge: proximity alone is never evidence" };
  if (input.coWalkDays < input.threshold) return { ok: false, reason: "below threshold" };
  if (input.exemptUntilDay !== undefined && input.day < input.exemptUntilDay) return { ok: false, reason: "group cleared recently and exempt" };
  return {
    ok: true,
    case: {
      caseId: input.caseId, accountIds: [...input.accountIds].sort(), openedDay: input.day, state: "open",
      evidence: { reasonCodes: ["LINKED_ACCOUNTS", "REPEATED_SAME_TIME_SAME_ROUTE"], coWalkDays: input.coWalkDays, windowDays: input.windowDays, linkedAccountCount: input.accountIds.length, recordHashes: input.recordHashes },
      effect: null, mintedMicro: 0,
    },
  };
}

export function decide(c: ReviewCase, day: number, reviewer: string, outcome: "clear" | "uphold", p: Policy = DEFAULT_POLICY): ReviewCase {
  if (c.state !== "open") throw new Error(`cannot decide a case in state ${c.state}`);
  if (outcome === "clear") return { ...c, state: "cleared", reviewer, decisionDay: day, effect: null, exemptUntilDay: day + p.clearedExemptDays };
  return { ...c, state: "upheld", reviewer, decisionDay: day, effect: { kind: "linked_group_earns_as_one", fromDay: day + p.reviewDelayDays } };
}

export function fileAppeal(c: ReviewCase, day: number, p: Policy = DEFAULT_POLICY): ReviewCase {
  if (c.state !== "upheld" || c.decisionDay === undefined) throw new Error("only an upheld case can be appealed");
  if (day > c.decisionDay + p.appealDays) throw new Error("appeal window closed");
  return { ...c, state: "appeal_open" };
}

export function decideAppeal(c: ReviewCase, day: number, appealReviewer: string, outcome: "overturn" | "confirm", p: Policy = DEFAULT_POLICY): ReviewCase {
  if (c.state !== "appeal_open") throw new Error("no open appeal");
  if (appealReviewer === c.reviewer) throw new Error("a different reviewer must decide the appeal");
  if (outcome === "overturn") {
    // Prospective only: the allowance is restored from the next settlement. Days already settled are not re-settled, nothing is minted.
    return { ...c, state: "appeal_cleared", appealReviewer, effect: null, exemptUntilDay: day + p.clearedExemptDays };
  }
  return { ...c, state: "appeal_upheld", appealReviewer };
}

/** Reviewer queue that cannot sit forever: an open case past maxOpenDays expires with no effect. */
export function expireStale(c: ReviewCase, day: number, p: Policy = DEFAULT_POLICY): ReviewCase {
  return c.state === "open" && day - c.openedDay > p.maxOpenDays ? { ...c, state: "expired", effect: null } : c;
}

/* ── notification wording ─────────────────────────────────────────────────── */
export const FORBIDDEN_WORDS = ["cheat", "cheater", "fraud", "fake", "ban", "banned", "suspend", "suspended", "freeze", "frozen", "guilty", "bot", "farming", "farm", "spoof", "violation", "punish", "penalty", "partner", "friend", "sibling", "household"];

export function notificationFor(c: ReviewCase, appealDays = DEFAULT_POLICY.appealDays): { title: string; body: string } {
  switch (c.state) {
    case "open":
      return { title: "A routine check on linked accounts", body: "Some accounts that are connected to yours were active together often over the last two weeks. This is an automatic prompt for a person to take a look. Nothing about your account has changed, and your XP, streaks and past credits are not affected. You can add context if you like." };
    case "cleared": case "appeal_cleared":
      return { title: "Check complete", body: "A person looked at this and no change is needed. We will not run this check on the same accounts again for a while." };
    case "upheld":
      return { title: "Update on a check", body: `After a person looked, connected accounts that are active together will share one daily allowance from a set date. Your XP, streaks and past credits are not affected. You can ask for a different person to look again within ${appealDays} days.` };
    case "appeal_open":
      return { title: "We are taking another look", body: "A different person will review this. Nothing changes while they do." };
    case "appeal_upheld":
      return { title: "Second look complete", body: "The earlier decision stands. Your XP, streaks and past credits are not affected." };
    case "expired":
      return { title: "Check closed", body: "This check was closed without any change to your account." };
  }
}

export function wordingProblems(text: string): string[] {
  const t = text.toLowerCase();
  return FORBIDDEN_WORDS.filter((w) => new RegExp(`\\b${w}\\b`).test(t));
}

/* ── data inventory and retention (proposal) ──────────────────────────────── */
export interface DataItem { item: string; purpose: string; retentionDays: number | "season+30" | "decision date only"; rawLocation: false; reviewerSees: boolean }
export const RETENTION: DataItem[] = [
  { item: "Link edge: salted hash of shared install or device identifier between two pseudonymous accounts (edge only, no identifier value)", purpose: "limits co-walk checks to accounts already known to be connected", retentionDays: 90, rawLocation: false, reviewerSees: true },
  { item: "Co-walk record for a linked pair: day, 15-minute start bucket, salted route-fingerprint match flag, optional tight-trace flag", purpose: "count repeated co-walks inside the window", retentionDays: 14, rawLocation: false, reviewerSees: true },
  { item: "Open case file: reason codes, counts, record hashes", purpose: "review and appeal", retentionDays: "season+30", rawLocation: false, reviewerSees: true },
  { item: "Cleared case: 'cleared' and date", purpose: "exemption from re-review", retentionDays: "decision date only", rawLocation: false, reviewerSees: true },
  { item: "Append-only decision log: case id, reviewer pseudonym, reason code, effective day", purpose: "audit and blind re-review sample", retentionDays: 365, rawLocation: false, reviewerSees: false },
];
