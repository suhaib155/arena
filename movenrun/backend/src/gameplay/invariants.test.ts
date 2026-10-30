/**
 * Day-close invariants (invariants.ts), pure: each one refuses a day that
 * breaks it, against the pinned economy rules.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { economyRulesCanonicalJson } from "@movenrun/shared/economy-v3";
import { dayInvariantProblems, ECONOMY_RULES_DIGESTS, exact, pinnedEconomyRules, type BooksRow, type LineRow } from "./invariants.js";

const POOL = 100_000_000_000n; // season one's daily pool, micro
const line = (playerId: string, over: Partial<LineRow> = {}): LineRow => {
  const l = { playerId, earned: 20_000_000n, tollPaid: 0n, tollReceived: 0n, recharge: 5_000_000n, upkeepTaken: 0n, upkeepInCondition: 0n, net: 0n, ...over };
  if (over.net === undefined) l.net = l.earned - l.tollPaid - l.recharge - l.upkeepTaken + l.tollReceived;
  return l;
};
function day(lines: LineRow[], over: Partial<BooksRow> = {}) {
  const minted = lines.reduce((a, l) => a + l.earned, 0n);
  const tollPaid = lines.reduce((a, l) => a + l.tollPaid, 0n);
  const burned = lines.reduce((a, l) => a + l.recharge + l.upkeepTaken, 0n);
  const books: BooksRow = { pool: POOL, minted, credited: minted - tollPaid - burned, tollPaid, tollReceived: tollPaid, burned, returned: POOL - minted, players: BigInt(lines.length), ...over };
  return { economyRulesVersion: 1, season: 1, books, lines };
}

test("the economy rules are pinned by digest; an unknown version fails closed", () => {
  assert.equal(createHash("sha256").update(economyRulesCanonicalJson(1)!).digest("hex"), ECONOMY_RULES_DIGESTS[1]);
  assert.equal(pinnedEconomyRules(1).tollBasisPoints, 200);
  assert.throws(() => pinnedEconomyRules(2), /not pinned/);
  assert.deepEqual(dayInvariantProblems({ ...day([line("a")]), economyRulesVersion: 2 }), ["economy rules version 2 is not pinned"]);
});

test("a clean day, with a toll moved between two players, passes", () => {
  const lines = [line("a", { earned: 18_000_000n, tollPaid: 360_000n, recharge: 4_500_000n }), line("o", { tollReceived: 360_000n })];
  assert.deepEqual(dayInvariantProblems(day(lines)), []);
});

test("each invariant refuses the day that breaks it", () => {
  const has = (problems: string[], re: RegExp) => assert.ok(problems.some((p) => re.test(p)), `${re} not in ${JSON.stringify(problems)}`);
  const lines = [line("a"), line("b")];
  has(dayInvariantProblems(day(lines, { returned: POOL })), /minted \+ returned is not the pool/);
  has(dayInvariantProblems(day(lines, { pool: POOL * 2n, returned: POOL * 2n - 40_000_000n })), /daily pool/);
  has(dayInvariantProblems(day(lines, { credited: 1n })), /minted is not credited \+ toll credited \+ burned/);
  has(dayInvariantProblems(day(lines, { tollReceived: 7n })), /toll debits and credits differ/);
  has(dayInvariantProblems(day([line("a", { net: -1n, earned: 0n, recharge: 1n })])), /negative/);
  has(dayInvariantProblems(day([line("a", { net: 1n })])), /net does not follow/);
  has(dayInvariantProblems(day([line("a", { earned: 20_000_001n })])), /day ceiling/);
  has(dayInvariantProblems(day([line("a", { tollPaid: 400_001n, recharge: 0n })])), /toll above 2%/);
  has(dayInvariantProblems(day([line("a", { recharge: 12_000_001n })])), /charges above 60%/);
  has(dayInvariantProblems(day(lines, { players: 3n })), /2 lines for 3 players/);
  has(dayInvariantProblems({ ...day(lines), lines: [line("a"), line("b", { earned: 19_000_000n })] }), /lines' earned is not minted/);
  has(dayInvariantProblems({ ...day(lines), lines: [line("a"), line("a")] }), /twice/);
});

test("amounts are read exactly or refused", () => {
  assert.equal(exact("9007199254740993"), 9_007_199_254_740_993n);
  assert.equal(exact(5), 5n);
  for (const bad of [1.5, 2 ** 53, "1e3", Number.NaN, null]) assert.throws(() => exact(bad), RangeError);
});
