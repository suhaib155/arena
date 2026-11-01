/**
 * Day-close settlement invariants (settlement invariants, item 1), checked
 * exactly in bigint against the server's OWN pinned economy rules, never a
 * rules object a caller hands in.
 *
 * Asserted twice, independently:
 * - at every server day close, on the books and credit lines about to be
 *   written (a violation stores the day as refused, with no lines);
 * - in `verifyDay`'s read-only replay, on the rows actually stored.
 *
 * Units: off-chain credits in integer micro-units. The schema and the shared
 * model call the day's created credits `minted`; that is the source's word
 * for credits created inside the day pool. Nothing here or in the settlement
 * mints, transfers or converts a token.
 *
 * Invariants (every one must hold, else the day is refused):
 *  1. minted + returned = pool, and pool = the season's daily pool;
 *  2. minted = credited + toll paid + burned (credited is the players' own
 *     kept reward; the toll paid is credited to deed holders);
 *  3. toll debits = toll credits (paid = received), in the books and in the lines;
 *  4. no negative amount anywhere; every net balance ≥ 0;
 *  5. lines add up to the books (earned = minted, net = credited + toll
 *     received, charges = burned) and each line's net follows from its parts;
 *  6. caps from the pinned rules: day ceiling per line, toll ≤ 2% of the
 *     day's reward, automatic charges ≤ 60% of it.
 */
import { createHash } from "node:crypto";
import { dailyPoolMicro, economyRulesCanonicalJson, economyRulesFor, type EconomyRules } from "@movenrun/shared/economy-v3";

/**
 * sha256 of each economy rules version's canonical JSON, pinned here. A
 * registry entry whose content no longer matches its pin fails closed: no
 * day settles and no day verifies under it until the pin is reviewed.
 */
export const ECONOMY_RULES_DIGESTS: Readonly<Record<number, string>> = Object.freeze({
  1: "8af5766ce20d7780f14068699f1dfe5d16b6bfaadae0dcab0caf11e972ab76cc",
});

export class PinnedRulesError extends Error {}

/** The registry's economy rules for a version, only if they match the pinned digest. */
export function pinnedEconomyRules(version: number): EconomyRules {
  const json = economyRulesCanonicalJson(version);
  const pin = ECONOMY_RULES_DIGESTS[version];
  if (json === null || pin === undefined) throw new PinnedRulesError(`economy rules version ${version} is not pinned`);
  const actual = createHash("sha256").update(json).digest("hex");
  if (actual !== pin) throw new PinnedRulesError(`economy rules version ${version} do not match their pinned digest`);
  return economyRulesFor(version)!;
}

export interface BooksRow {
  pool: bigint;
  minted: bigint;
  credited: bigint;
  tollPaid: bigint;
  tollReceived: bigint;
  burned: bigint;
  returned: bigint;
  players: bigint;
}

export interface LineRow {
  playerId: string;
  earned: bigint;
  tollPaid: bigint;
  tollReceived: bigint;
  recharge: bigint;
  upkeepTaken: bigint;
  upkeepInCondition: bigint;
  net: bigint;
}

/** Every problem with one settled day's books and lines, or an empty list. */
export function dayInvariantProblems(input: { economyRulesVersion: number; season: number; books: BooksRow; lines: readonly LineRow[] }): string[] {
  let rules: EconomyRules;
  try {
    rules = pinnedEconomyRules(input.economyRulesVersion);
  } catch (err) {
    return [err instanceof Error ? err.message : String(err)];
  }
  const b = input.books;
  const problems: string[] = [];
  for (const [k, v] of Object.entries(b)) if (v < 0n) problems.push(`books: ${k} is negative`);
  let pool: bigint;
  try {
    pool = BigInt(dailyPoolMicro(rules, input.season));
  } catch (err) {
    return [...problems, err instanceof Error ? err.message : String(err)];
  }
  if (b.pool !== pool) problems.push(`pool ${b.pool} is not season ${input.season}'s daily pool ${pool}`);
  if (b.minted > b.pool) problems.push("minted more than the daily pool");
  if (b.minted + b.returned !== b.pool) problems.push("minted + returned is not the pool");
  if (b.credited + b.tollPaid + b.burned !== b.minted) problems.push("minted is not credited + toll credited + burned");
  if (b.tollPaid !== b.tollReceived) problems.push("toll debits and credits differ");

  if (BigInt(input.lines.length) !== b.players) problems.push(`${input.lines.length} lines for ${b.players} players`);
  const sum = { earned: 0n, net: 0n, tollPaid: 0n, tollReceived: 0n, burned: 0n };
  const seen = new Set<string>();
  for (const l of input.lines) {
    const where = `line ${l.playerId}`;
    if (seen.has(l.playerId)) problems.push(`${where}: twice`);
    seen.add(l.playerId);
    for (const [k, v] of Object.entries(l)) if (typeof v === "bigint" && v < 0n) problems.push(`${where}: ${k} is negative`);
    const auto = l.recharge + l.upkeepTaken;
    if (l.earned - l.tollPaid - auto + l.tollReceived !== l.net) problems.push(`${where}: net does not follow from its parts`);
    if (l.earned - l.tollPaid - auto < 0n) problems.push(`${where}: own credit below zero`);
    if (l.earned > BigInt(rules.dayCeilingMicro)) problems.push(`${where}: over the day ceiling`);
    if (l.tollPaid * 10_000n > l.earned * BigInt(rules.tollBasisPoints)) problems.push(`${where}: toll above ${rules.tollBasisPoints / 100}%`);
    if (auto * 10_000n > l.earned * BigInt(rules.autoChargeCapBasisPoints)) problems.push(`${where}: charges above ${rules.autoChargeCapBasisPoints / 100}%`);
    sum.earned += l.earned;
    sum.net += l.net;
    sum.tollPaid += l.tollPaid;
    sum.tollReceived += l.tollReceived;
    sum.burned += auto;
  }
  if (sum.earned !== b.minted) problems.push("lines' earned is not minted");
  if (sum.net !== b.credited + b.tollReceived) problems.push("lines' net is not credited + tolls received");
  if (sum.tollPaid !== b.tollPaid) problems.push("lines' tolls paid are not the books'");
  if (sum.tollReceived !== b.tollReceived) problems.push("lines' tolls received are not the books'");
  if (sum.tollPaid !== sum.tollReceived) problems.push("lines' toll debits and credits differ");
  if (sum.burned !== b.burned) problems.push("lines' charges are not burned");
  return problems;
}

/** A number from the model or a bigint column's text, as bigint; refuses anything inexact. */
export function exact(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^-?\d+$/.test(v)) return BigInt(v);
  throw new RangeError(`not an exact integer amount: ${String(v)}`);
}
