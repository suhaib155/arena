/**
 * Territory game rules — the pure state machine.
 *
 * The load-bearing test in this file is "ownership never flips on one ordinary
 * pass". Everything else is balancing; that one is the game.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actionEligibility,
  applyOutcomeScores,
  neutralTerritory,
  relationshipFor,
  resolveCellOutcome,
  TERRITORY_RULES,
  type ActorContext,
} from "./rules.js";
import type { CellClassification, TerritoryRecord, TerritoryState } from "./types.js";

const CELL = "892a1008943ffff";
const RUNNER = "0x1111111111111111111111111111111111111111";
const RIVAL = "0x2222222222222222222222222222222222222222";

/** Build a session-shaped viewer (D2). Identity only ever comes from a verified
 *  session, so tests construct it directly rather than faking a header. */
function viewer(wallet: string | null, clubId: string | null) {
  return wallet
    ? { userId: `user-${wallet.slice(-4)}`, walletAddresses: [wallet.toLowerCase()], clubId, authenticated: true }
    : { userId: null, walletAddresses: [], clubId, authenticated: false };
}


function actor(overrides: Partial<ActorContext> = {}): ActorContext {
  return { walletAddress: RUNNER, userId: "user-1", clubId: null, degradedQuality: false, ...overrides };
}

function territory(overrides: Partial<TerritoryRecord> = {}): TerritoryRecord {
  return { ...neutralTerritory(CELL, 2, 9), ...overrides };
}

function ownedBy(
  wallet: string,
  defence: number,
  extra: Partial<TerritoryRecord> = {},
): TerritoryRecord {
  return territory({
    ownerWalletAddress: wallet,
    ownerUserId: `user-${wallet.slice(-1)}`,
    state: "owned",
    controlScore: 20,
    defenceScore: defence,
    ...extra,
  });
}

// ------------------------------------------------------------------ neutral

test("a valid loop captures neutral ground", () => {
  const outcome = resolveCellOutcome(territory(), "enclosed", actor());
  assert.equal(outcome.eventType, "captured");
  assert.equal(outcome.nextState, "owned");
  assert.equal(outcome.nextOwnerWalletAddress, RUNNER);
  assert.equal(outcome.controlDelta, TERRITORY_RULES.captureControl);
  assert.equal(outcome.defenceDelta, TERRITORY_RULES.captureDefence);
  assert.equal(outcome.rejectionReason, null);
});

test("dormant ground is re-claimable like neutral", () => {
  const outcome = resolveCellOutcome(
    ownedBy(RIVAL, 40, { state: "dormant" }),
    "crossed",
    actor(),
  );
  assert.equal(outcome.eventType, "captured");
  assert.equal(outcome.nextOwnerWalletAddress, RUNNER);
});

// -------------------------------------------------------------- reinforcing

test("running through your own cell reinforces it harder than enclosing it", () => {
  const mine = ownedBy(RUNNER, 30);
  const crossed = resolveCellOutcome(mine, "crossed", actor());
  const enclosed = resolveCellOutcome(mine, "enclosed", actor());
  assert.equal(crossed.eventType, "reinforced");
  assert.equal(enclosed.eventType, "reinforced");
  assert.ok(
    crossed.defenceDelta > enclosed.defenceDelta,
    "presence should count for more than enclosure",
  );
  assert.equal(crossed.nextOwnerWalletAddress, RUNNER, "ownership is unchanged");
});

test("owner matching is case-insensitive on the wallet address", () => {
  const mine = ownedBy(RUNNER.toUpperCase(), 30);
  const outcome = resolveCellOutcome(mine, "crossed", actor());
  assert.equal(outcome.eventType, "reinforced");
});

test("a club member reinforces their club's cell", () => {
  const clubCell = ownedBy(RIVAL, 30, { ownerClubId: "club-a" });
  const outcome = resolveCellOutcome(clubCell, "crossed", actor({ clubId: "club-a" }));
  assert.equal(outcome.eventType, "reinforced");
  assert.equal(outcome.nextOwnerWalletAddress, RIVAL, "the club's owner is unchanged");
});

test("a non-member attacks that same club cell", () => {
  const clubCell = ownedBy(RIVAL, 30, { ownerClubId: "club-a" });
  const outcome = resolveCellOutcome(clubCell, "crossed", actor({ clubId: "club-b" }));
  assert.equal(outcome.eventType, "attacked");
});

// ----------------------------------------------------------------- attacking

test("attacking a rival cell reduces defence without changing ownership", () => {
  const outcome = resolveCellOutcome(ownedBy(RIVAL, 30), "crossed", actor());
  assert.equal(outcome.eventType, "attacked");
  assert.equal(outcome.nextState, "owned");
  assert.equal(outcome.nextOwnerWalletAddress, RIVAL, "ownership must NOT change");
  assert.equal(outcome.defenceDelta, -TERRITORY_RULES.attackCrossed);
  assert.equal(outcome.controlDelta, 0);
});

test("crossing a rival cell hits harder than merely enclosing it", () => {
  const rivalCell = ownedBy(RIVAL, 30);
  const crossed = resolveCellOutcome(rivalCell, "crossed", actor());
  const enclosed = resolveCellOutcome(rivalCell, "enclosed", actor());
  assert.ok(crossed.defenceDelta < enclosed.defenceDelta, "crossing should do more damage");
});

test("OWNERSHIP NEVER FLIPS ON ONE ORDINARY PASS", () => {
  // A well-defended rival cell, attacked repeatedly. It must reach `contested`
  // and stop there — no single pass, and no number of passes without a
  // separate qualifying action, may transfer it.
  let defence = 50;
  let passes = 0;
  for (; passes < 20; passes++) {
    const outcome = resolveCellOutcome(ownedBy(RIVAL, defence), "crossed", actor());
    assert.notEqual(
      outcome.eventType,
      "transferred",
      `pass ${passes + 1} transferred ownership directly — it must go through 'contested'`,
    );
    assert.equal(
      outcome.nextOwnerWalletAddress,
      RIVAL,
      `pass ${passes + 1} changed the owner without a contested step`,
    );
    if (outcome.eventType === "contested") break;
    defence += outcome.defenceDelta;
  }
  assert.ok(passes > 0, "a 50-defence cell must survive at least one pass");
});

test("defence reaching zero moves a cell to contested, not to the attacker", () => {
  const outcome = resolveCellOutcome(ownedBy(RIVAL, 3), "crossed", actor());
  assert.equal(outcome.eventType, "contested");
  assert.equal(outcome.nextState, "contested");
  assert.equal(outcome.nextOwnerWalletAddress, RIVAL, "the incumbent still holds it");
  assert.equal(outcome.defenceDelta, -3, "defence is zeroed, never driven negative");
});

// ---------------------------------------------------------------- contested

test("a contested cell transfers to the next qualifying attacker", () => {
  const contested = ownedBy(RIVAL, 0, { state: "contested", controlScore: 60 });
  const outcome = resolveCellOutcome(contested, "crossed", actor());
  assert.equal(outcome.eventType, "transferred");
  assert.equal(outcome.nextState, "owned");
  assert.equal(outcome.nextOwnerWalletAddress, RUNNER);
});

test("a transferred cell starts fresh rather than inheriting the loser's score", () => {
  const contested = ownedBy(RIVAL, 0, { state: "contested", controlScore: 60 });
  const outcome = resolveCellOutcome(contested, "crossed", actor());
  const scores = applyOutcomeScores(contested, outcome);
  assert.equal(scores.controlScore, TERRITORY_RULES.captureControl);
  assert.equal(scores.defenceScore, TERRITORY_RULES.captureDefence);
});

test("the incumbent can re-secure their own contested cell", () => {
  const contested = ownedBy(RUNNER, 0, { state: "contested" });
  const outcome = resolveCellOutcome(contested, "crossed", actor());
  assert.equal(outcome.eventType, "reinforced");
  assert.equal(outcome.nextState, "owned");
  assert.equal(outcome.nextOwnerWalletAddress, RUNNER);
});

// --------------------------------------------------- protected / restricted

test("protected ground absorbs every action unchanged", () => {
  const guarded = ownedBy(RIVAL, 40, { state: "protected" });
  for (const touch of ["crossed", "enclosed"] as const) {
    const outcome = resolveCellOutcome(guarded, touch, actor());
    assert.equal(outcome.rejectionReason, "protectedTerritory");
    assert.equal(outcome.controlDelta, 0);
    assert.equal(outcome.defenceDelta, 0);
    assert.equal(outcome.nextOwnerWalletAddress, RIVAL);
  }
});

test("restricted ground can never be captured", () => {
  const outcome = resolveCellOutcome(
    territory({ state: "restricted", classification: "restricted" }),
    "crossed",
    actor(),
  );
  assert.equal(outcome.rejectionReason, "restrictedClassification");
  assert.equal(outcome.nextOwnerWalletAddress, null);
});

test("every non-capturable classification blocks capture", () => {
  for (const classification of ["restricted", "water", "private", "dangerous"] as CellClassification[]) {
    const outcome = resolveCellOutcome(territory({ classification }), "crossed", actor());
    assert.equal(
      outcome.rejectionReason,
      "restrictedClassification",
      `${classification} should not be capturable`,
    );
  }
});

test("park and landmark ground stays playable", () => {
  for (const classification of ["park", "landmark", "eventOnly"] as CellClassification[]) {
    const outcome = resolveCellOutcome(territory({ classification }), "crossed", actor());
    assert.equal(outcome.eventType, "captured", `${classification} should be capturable`);
  }
});

// ------------------------------------------------------------ quality damping

test("a degraded-quality run earns damped deltas but is never a silent no-op", () => {
  const clean = resolveCellOutcome(territory(), "crossed", actor());
  const degraded = resolveCellOutcome(territory(), "crossed", actor({ degradedQuality: true }));
  assert.ok(degraded.defenceDelta < clean.defenceDelta);
  assert.ok(degraded.defenceDelta > 0, "a damped reward must still be a reward");
});

test("a damped attack still removes at least one point of defence", () => {
  const outcome = resolveCellOutcome(
    ownedBy(RIVAL, 50),
    "enclosed",
    actor({ degradedQuality: true }),
  );
  assert.ok(outcome.defenceDelta <= -1, `expected damage, got ${outcome.defenceDelta}`);
});

// ------------------------------------------------------------------- scores

test("scores are clamped to the configured ceilings", () => {
  const strong = ownedBy(RUNNER, TERRITORY_RULES.maxDefence, {
    controlScore: TERRITORY_RULES.maxControl,
  });
  const outcome = resolveCellOutcome(strong, "crossed", actor());
  const scores = applyOutcomeScores(strong, outcome);
  assert.equal(scores.defenceScore, TERRITORY_RULES.maxDefence);
  assert.equal(scores.controlScore, TERRITORY_RULES.maxControl);
});

test("scores never go negative", () => {
  const weak = ownedBy(RIVAL, 1);
  const outcome = resolveCellOutcome(weak, "crossed", actor());
  const scores = applyOutcomeScores(weak, outcome);
  assert.ok(scores.defenceScore >= 0);
  assert.ok(scores.controlScore >= 0);
});

// ------------------------------------------------------------- relationship

test("relationship is computed per viewer, not stored", () => {
  const cell = ownedBy(RUNNER, 30);
  assert.equal(relationshipFor(cell, viewer(RUNNER, null)), "mine");
  assert.equal(relationshipFor(cell, viewer(RIVAL, null)), "rival");
  // D2: an anonymous viewer gets `claimed`, not `rival` — see relationshipFor.
  assert.equal(relationshipFor(cell, viewer(null, null)), "claimed");
});

test("relationship reports club, contested, protected, restricted and neutral", () => {
  const clubCell = ownedBy(RIVAL, 30, { ownerClubId: "club-a" });
  assert.equal(relationshipFor(clubCell, viewer(RUNNER, "club-a")), "club");

  const cases: [Partial<TerritoryRecord>, string][] = [
    [{ state: "contested" as TerritoryState, ownerWalletAddress: RIVAL }, "contested"],
    [{ state: "protected" as TerritoryState, ownerWalletAddress: RIVAL }, "protected"],
    [{ state: "restricted" as TerritoryState }, "restricted"],
    [{ classification: "water" as CellClassification }, "restricted"],
    [{}, "neutral"],
  ];
  for (const [overrides, expected] of cases) {
    assert.equal(
      relationshipFor(territory(overrides), viewer(RUNNER, null)),
      expected,
      `expected ${expected}`,
    );
  }
});

// -------------------------------------------------------- action eligibility

test("action eligibility matches the relationship", () => {
  assert.deepEqual(actionEligibility(territory(), viewer(RUNNER, null)), {
    canCapture: true,
    canReinforce: false,
    canAttack: false,
  });
  assert.deepEqual(actionEligibility(ownedBy(RUNNER, 30), viewer(RUNNER, null)), {
    canCapture: false,
    canReinforce: true,
    canAttack: false,
  });
  assert.deepEqual(actionEligibility(ownedBy(RIVAL, 30), viewer(RUNNER, null)), {
    canCapture: false,
    canReinforce: false,
    canAttack: true,
  });
});

test("nothing is actionable on protected or restricted ground", () => {
  for (const state of ["protected", "restricted"] as TerritoryState[]) {
    assert.deepEqual(
      actionEligibility(territory({ state, ownerWalletAddress: RIVAL }), viewer(RUNNER, null)),
      { canCapture: false, canReinforce: false, canAttack: false },
      `${state} should offer no actions`,
    );
  }
});

// ------------------------------------------------------------------ defaults

test("a never-touched cell defaults to neutral, unowned and unscored", () => {
  const fresh = neutralTerritory(CELL, 2, 9);
  assert.equal(fresh.state, "neutral");
  assert.equal(fresh.ownerWalletAddress, null);
  assert.equal(fresh.controlScore, 0);
  assert.equal(fresh.defenceScore, 0);
  assert.equal(fresh.version, 0);
  assert.equal(fresh.gridVersion, 2);
  assert.equal(fresh.h3Resolution, 9);
});

test("a never-touched cell on non-playable ground defaults to restricted", () => {
  assert.equal(neutralTerritory(CELL, 2, 9, "water").state, "restricted");
  assert.equal(neutralTerritory(CELL, 2, 9, "park").state, "neutral");
});
