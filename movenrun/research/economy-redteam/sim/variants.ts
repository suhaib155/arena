/**
 * Rule variants of the scenario lab.
 *
 * R1001 and R1002 are the server's own frozen rule objects, used by
 * reference and never copied or edited: `PILOT_PROPOSAL` (holding rules
 * version 1001) and `SIM_PILOT_2_PROPOSAL` (holding rules version 1002) from
 * backend/src/gameplay/rules.ts. Every other variant is a lab intervention,
 * built by spreading one of them and changing exactly the fields its id
 * names. None of them is a server rule set; where the holding rules change,
 * the lab stamps a lab-local version (8100–8199) so its ledger entries never
 * carry a server version for a rule the server does not run.
 */
import { DEFAULT_UNIT_BUDGET } from "../../../backend/src/gameplay/capacity.ts";
import { VERIFIED_STEPS_V1 } from "../../../backend/src/gameplay/path.ts";
import { PILOT_PROPOSAL, SIM_PILOT_2_PROPOSAL, type GameplayRules } from "../../../backend/src/gameplay/rules.ts";

export type Rules = Readonly<Omit<GameplayRules, "seasonOneStartDay">>;

export interface Variant {
  id: string;
  rules: Rules;
  /** Which units a session pushes: the 1001 stored resolution 8 cells or the resolution 10 verified-steps path. */
  unitSource: "res8-stored" | "res10-path";
  /** Whether interpolated path units push (the path rule's `pushInterpolated`). */
  pushInterpolated: boolean;
  /** The server's per-walker daily unit budget (capacity guard, not a game rule). */
  unitBudget: number;
  /** Fields changed from the base rule object, for the manifest and the tests. */
  changed: string[];
}

const S2 = SIM_PILOT_2_PROPOSAL;
const tk2 = S2.takeover as Extract<GameplayRules["takeover"], { policyVersion: 2 }>;

function pathRuleOf(r: Rules) {
  return r.units.source?.kind === "session-path" ? r.units.source.rule : null;
}

function from1002(id: string, changed: string[], patch: Partial<Rules>, extra: Partial<Variant> = {}): Variant {
  const rules = Object.freeze({ ...S2, ...patch }) as Rules;
  const pr = pathRuleOf(rules);
  return { id, rules, unitSource: "res10-path", pushInterpolated: pr ? pr.pushInterpolated : true, unitBudget: DEFAULT_UNIT_BUDGET, changed, ...extra };
}

export const VARIANTS: readonly Variant[] = Object.freeze([
  { id: "R1001", rules: PILOT_PROPOSAL, unitSource: "res8-stored", pushInterpolated: false, unitBudget: DEFAULT_UNIT_BUDGET, changed: [] },
  { id: "R1001-res10", rules: PILOT_PROPOSAL, unitSource: "res10-path", pushInterpolated: VERIFIED_STEPS_V1.pushInterpolated, unitBudget: DEFAULT_UNIT_BUDGET, changed: ["(unit source only: resolution 10 path)"] },
  { id: "R1002", rules: S2, unitSource: "res10-path", pushInterpolated: pathRuleOf(S2)!.pushInterpolated, unitBudget: DEFAULT_UNIT_BUDGET, changed: [] },
  from1002("R1002-nogap", ["takeover"], {
    takeover: { name: "two-day-challenge", policyVersion: 1, windowDays: tk2.windowDays, floor: tk2.floor, immediateBelowStrength: tk2.immediateBelowStrength },
  }),
  from1002("R1002-gap24", ["takeover.secondPush.minElapsedMs"], {
    takeover: { ...tk2, secondPush: { ...tk2.secondPush, minElapsedMs: 24 * 3_600_000 } },
  }),
  from1002("R1002-win2", ["takeover.windowDays", "holding.takeover.challenge.windowDays", "holding.rulesVersion"], {
    takeover: { ...tk2, windowDays: 2 },
    holding: { ...S2.holding, rulesVersion: 8102, takeover: { challenge: { ...S2.holding.takeover!.challenge!, windowDays: 2 }, maxFlipsPerUnitPerDay: null } },
  }),
  from1002("R1002-b5", ["takeBudget.perWalkerPerDay"], { takeBudget: { ...S2.takeBudget!, perWalkerPerDay: 5 } }),
  from1002("R1002-b20", ["takeBudget.perWalkerPerDay"], { takeBudget: { ...S2.takeBudget!, perWalkerPerDay: 20 } }),
  from1002("R1002-unitorder", ["takeBudget.order"], { takeBudget: { perWalkerPerDay: S2.takeBudget!.perWalkerPerDay, counting: "takes-v1" } }),
  from1002("R1002-stepped", ["units.source.rule.pushInterpolated"], {
    units: { ...S2.units, source: { kind: "session-path", rule: { ...VERIFIED_STEPS_V1, pushInterpolated: false } } },
  }),
  from1002("R1002-ub150", ["(capacity guard) unitBudget"], {}, { unitBudget: 150 }),
  from1002("R1002-ub450", ["(capacity guard) unitBudget"], {}, { unitBudget: 450 }),
]);

export function variant(id: string): Variant {
  const v = VARIANTS.find((x) => x.id === id);
  if (!v) throw new Error(`unknown variant ${id}`);
  return v;
}
