/**
 * SIMULATION ONLY: rule sets 1001 and 1002 on the same synthetic verified
 * walks (backend/src/gameplay/compare.ts). Prints one row per rule set and
 * seed, then the mean over seeds. Synthetic behaviour assumptions; not
 * evidence about real players.
 *
 *   node --import tsx scripts/compare-rulesets.ts [seeds=3]
 */
import { compareSeed, type CompareRow } from "../src/gameplay/compare.js";

const seeds = Number(process.argv[2] ?? 3);
const all: CompareRow[][] = [];
for (let s = 1; s <= seeds; s++) all.push(compareSeed(s));
const keys = ["attackerHeldKm2", "attackerFlippedKm2", "straddleFlips", "casualHeldKm2", "casualLostToAttackersKm2", "casualWithGround", "casualSessionsWithAccess", "casualSessions", "budgetRefusedCasual", "budgetRefusedAttacker"] as const;
console.log(["seed", "rule set", ...keys].join("\t"));
all.forEach((rows, i) => rows.forEach((r) => console.log([i + 1, r.label, ...keys.map((k) => +r[k].toFixed(3))].join("\t"))));
for (let c = 0; c < all[0]!.length; c++) {
  const mean = keys.map((k) => all.reduce((a, rows) => a + rows[c]![k], 0) / all.length);
  console.log(["mean", all[0]![c]!.label, ...mean.map((m) => +m.toFixed(3))].join("\t"));
}
