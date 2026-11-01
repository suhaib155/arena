/**
 * Sealing v2 fairness measurement (docs/g34/SEALING_V2_28OCT.md).
 *
 *   node --import tsx scripts/seal-v2-fairness.ts [seeds]
 *
 * For every synthetic fixture (src/gameplay/sealLoopFixtures.ts): whether the
 * movement pipeline's sealing engine (rules version 1) seals it, and how
 * often the territory seal (enclosed-loop v1) accepts it at several GPS error
 * levels; then the same counts as each threshold moves alone. Pure, local,
 * deterministic; synthetic geometry only.
 */
import { evaluateSealing } from "@movenrun/shared/sealing";
import { DEFAULT_MOVEMENT_MODE, SESSION_RULES_VERSION } from "@movenrun/shared/session";
import { ENCLOSED_LOOP_V1, evaluateSealLoop, type SealLoopRule } from "../src/gameplay/sealLoop.js";
import { fixtureFixes, SEAL_FIXTURES, type SealFixture } from "../src/gameplay/sealLoopFixtures.js";

const SEEDS = Number(process.argv[2] ?? 20);
const SIGMAS = [0, 5, 10, 15, 25];

function v1(f: SealFixture): boolean {
  const fixes = fixtureFixes(f, 0, 1);
  const e = evaluateSealing({
    session: { mode: DEFAULT_MOVEMENT_MODE, rulesVersion: SESSION_RULES_VERSION, startedAt: fixes[0]!.timestamp - 1000, finishedAt: fixes[fixes.length - 1]!.timestamp + 1000, pauses: [] },
    points: fixes.map((p) => ({ latitude: p.lat, longitude: p.lng, timestamp: p.timestamp, ...(p.breakBefore ? { breakBefore: true } : {}) })),
    heldCells: null,
  });
  return e.events.length > 0;
}

function rate(f: SealFixture, rule: SealLoopRule, sigma: number): number {
  if (sigma === 0) return evaluateSealLoop(fixtureFixes(f, 0, 1), [], rule).sealed ? 1 : 0;
  let n = 0;
  for (let s = 1; s <= SEEDS; s++) if (evaluateSealLoop(fixtureFixes(f, sigma, s), [], rule).sealed) n += 1;
  return n / SEEDS;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const fmt = (x: number | undefined) => (x === undefined || Number.isNaN(x) ? "-" : String(Math.round(x)));

console.log(`## Fixture acceptance (seeds per noisy cell: ${SEEDS}; noise = AR(1) per-axis sigma, rho 0.9)\n`);
console.log(`| fixture | fair? | v1 seals | v2 reason (sigma 0) | area m2 | width m | retraced | ${SIGMAS.map((s) => `v2 s=${s}`).join(" | ")} |`);
console.log(`|---|---|---|---|---|---|---|${SIGMAS.map(() => "---").join("|")}|`);
const started = Date.now();
for (const f of SEAL_FIXTURES) {
  const r = evaluateSealLoop(fixtureFixes(f, 0, 1), [], ENCLOSED_LOOP_V1);
  const fair = f.shouldSeal === null ? "owner" : f.shouldSeal ? "yes" : "no";
  console.log(`| ${f.name} | ${fair} | ${v1(f) ? "yes" : "no"} | ${r.reason} | ${fmt(r.best?.areaM2)} | ${fmt(r.best?.widthMeters)} | ${r.best ? (Number.isNaN(r.best.retracedShare) ? "-" : r.best.retracedShare.toFixed(2)) : "-"} | ${SIGMAS.map((s) => pct(rate(f, ENCLOSED_LOOP_V1, s))).join(" | ")} |`);
}
console.error(`fixture table: ${Date.now() - started} ms`);
if (process.argv[3] === "table") process.exit(0);

type Knob = keyof Pick<SealLoopRule, "minAreaM2" | "minWidthMeters" | "maxRetracedShare" | "retraceMeters" | "maxClosureMeters" | "maxStepMeters" | "simplifyMeters"
  | "widthPerAccuracy" | "retracePerAccuracy" | "simplifyPerAccuracy">;
const KNOBS: [Knob, number[]][] = [
  ["minAreaM2", [1000, 1500, 2000, 3000, 5000]],
  ["minWidthMeters", [8, 12, 15, 20, 25]],
  ["maxRetracedShare", [0.3, 0.4, 0.5, 0.7, 1]],
  ["retraceMeters", [0, 10, 15, 20, 30]],
  ["maxClosureMeters", [0, 25, 50]],
  ["maxStepMeters", [30, 50, 100, 200]],
  ["simplifyMeters", [0, 5, 10, 20]],
  ["widthPerAccuracy", [0, 1, 1.5, 2, 3]],
  ["retracePerAccuracy", [0, 1, 2, 3]],
  ["simplifyPerAccuracy", [0, 0.5, 1, 2]],
];

const fair = SEAL_FIXTURES.filter((f) => f.shouldSeal === true);
const unfair = SEAL_FIXTURES.filter((f) => f.shouldSeal === false);
const owner = SEAL_FIXTURES.filter((f) => f.shouldSeal === null);
const SENS_SIGMAS = [0, 10];

console.log(`\n## Sensitivity (one threshold moved, the rest at enclosed-loop v1)\n`);
console.log(`Fair: ${fair.length} fixtures that should seal; abuse: ${unfair.length} that should not; owner: ${owner.length} boundary cases. Cells are mean acceptance over the group (sigma 10 over ${SEEDS} seeds).\n`);
console.log(`| threshold | value | ${SENS_SIGMAS.map((s) => `fair s=${s} | abuse s=${s} | owner s=${s}`).join(" | ")} |`);
console.log(`|---|---|${SENS_SIGMAS.map(() => "---|---|---").join("|")}|`);
for (const [knob, values] of KNOBS) {
  for (const v of values) {
    let rule: SealLoopRule = { ...ENCLOSED_LOOP_V1, [knob]: v };
    if (knob === "maxStepMeters" && rule.maxClosureMeters > v) rule = { ...rule, maxClosureMeters: v };
    const cells = SENS_SIGMAS.map((s) => {
      const mean = (g: SealFixture[]) => g.reduce((a, f) => a + rate(f, rule, s), 0) / g.length;
      return `${pct(mean(fair))} | ${pct(mean(unfair))} | ${pct(mean(owner))}`;
    });
    const mark = (ENCLOSED_LOOP_V1 as Record<string, unknown>)[knob] === v ? " (v1)" : "";
    console.log(`| ${knob} | ${v}${mark} | ${cells.join(" | ")} |`);
  }
}
console.error(`total: ${Date.now() - started} ms`);
