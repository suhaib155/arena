/**
 * Home mission priority selector — offline node tests.
 *
 * Locks the product priority order, the three adaptive hero states, the
 * single-primary-CTA invariant (no duplicated Start/Resume Move), and the
 * capped, data-gated "Up Next" list.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildUpNext,
  countPrimaryMoveCtas,
  missionHasOwnCta,
  resolveHeroState,
  selectHomeMission,
  UP_NEXT_CAP,
  type HomeMissionInput,
} from "../homeMission";

/** A settled returning player with nothing urgent — the terminal fallback. */
function base(): HomeMissionInput {
  return {
    hasRecoverableMovement: false,
    atRiskZoneCount: 0,
    topRiskZoneName: null,
    currentObjectiveTitle: null,
    hasMovedEver: true,
    zonesOwned: 3,
    weeklyObjectiveTitle: "Move 3 times this week",
  };
}

// ---- priority order ---------------------------------------------------------

test("priority 1: recoverable movement wins over everything else", () => {
  const m = selectHomeMission({
    ...base(),
    hasRecoverableMovement: true,
    atRiskZoneCount: 5,
    currentObjectiveTitle: "Some objective",
    hasMovedEver: false,
    zonesOwned: 0,
  });
  assert.equal(m.kind, "resume");
  assert.equal(m.action, "resume-move");
});

test("priority 2: territory defence warning beats objectives and weekly", () => {
  const m = selectHomeMission({
    ...base(),
    atRiskZoneCount: 2,
    topRiskZoneName: "Harbor Line",
    currentObjectiveTitle: "Save a route",
  });
  assert.equal(m.kind, "defend");
  assert.equal(m.tone, "danger");
  assert.match(m.title, /2 zones/);
});

test("priority 2: single at-risk zone names the zone", () => {
  const m = selectHomeMission({ ...base(), atRiskZoneCount: 1, topRiskZoneName: "Harbor Line" });
  assert.equal(m.kind, "defend");
  assert.match(m.title, /Harbor Line/);
});

test("priority 3: current objective beats first-move/zone/weekly", () => {
  const m = selectHomeMission({ ...base(), currentObjectiveTitle: "Fortify a zone" });
  assert.equal(m.kind, "objective");
  assert.equal(m.title, "Fortify a zone");
});

test("priority 4: a brand-new user (no objective passed) gets first movement", () => {
  const m = selectHomeMission({
    ...base(),
    currentObjectiveTitle: null,
    hasMovedEver: false,
    zonesOwned: 0,
  });
  assert.equal(m.kind, "first-move");
  assert.equal(m.action, "move");
});

test("priority 5: has moved but owns no zones → first zone capture", () => {
  const m = selectHomeMission({ ...base(), hasMovedEver: true, zonesOwned: 0 });
  assert.equal(m.kind, "first-zone");
});

test("priority 6: settled player falls through to the weekly objective", () => {
  const m = selectHomeMission(base());
  assert.equal(m.kind, "weekly");
  assert.equal(m.title, "Move 3 times this week");
  assert.equal(m.action, "weekly");
});

test("priority 6: weekly with no title still yields a valid move mission", () => {
  const m = selectHomeMission({ ...base(), weeklyObjectiveTitle: null });
  assert.equal(m.kind, "weekly");
  assert.equal(m.action, "move");
});

// ---- adaptive hero states ---------------------------------------------------

test("hero state: recoverable → Resume Move", () => {
  const h = resolveHeroState({ ...base(), hasRecoverableMovement: true });
  assert.equal(h.kind, "recoverable");
  assert.equal(h.ctaLabel, "Resume Move");
  assert.equal(h.action, "resume-move");
});

test("hero state: never moved → Start First Move", () => {
  const h = resolveHeroState({ ...base(), hasMovedEver: false });
  assert.equal(h.kind, "new");
  assert.equal(h.ctaLabel, "Start First Move");
});

test("hero state: returning → Start Move", () => {
  const h = resolveHeroState(base());
  assert.equal(h.kind, "returning");
  assert.equal(h.ctaLabel, "Start Move");
});

// ---- single primary CTA invariant ------------------------------------------

test("no duplicated primary CTA: hero + mission never both show Start/Resume Move", () => {
  // Exhaustively sweep the meaningful input space.
  const bools = [true, false];
  for (const hasRecoverableMovement of bools) {
    for (const atRiskZoneCount of [0, 1, 3]) {
      for (const currentObjectiveTitle of [null, "Objective X"]) {
        for (const hasMovedEver of bools) {
          for (const zonesOwned of [0, 2]) {
            for (const weeklyObjectiveTitle of [null, "Weekly Y"]) {
              const input: HomeMissionInput = {
                hasRecoverableMovement,
                atRiskZoneCount,
                topRiskZoneName: atRiskZoneCount > 0 ? "Zone" : null,
                currentObjectiveTitle,
                hasMovedEver,
                zonesOwned,
                weeklyObjectiveTitle,
              };
              const hero = resolveHeroState(input);
              const mission = selectHomeMission(input);
              assert.equal(
                countPrimaryMoveCtas(hero, mission),
                1,
                `expected exactly one primary move CTA for ${JSON.stringify(input)}`,
              );
            }
          }
        }
      }
    }
  }
});

test("missionHasOwnCta: a move-family mission under a move hero is button-less", () => {
  const input = { ...base(), hasMovedEver: false, currentObjectiveTitle: null, zonesOwned: 0 };
  const hero = resolveHeroState(input); // move
  const mission = selectHomeMission(input); // first-move (move)
  assert.equal(missionHasOwnCta(mission, hero), false);
});

test("missionHasOwnCta: a defend mission always shows its own button", () => {
  const input = { ...base(), atRiskZoneCount: 1, topRiskZoneName: "Zone" };
  const hero = resolveHeroState(input);
  const mission = selectHomeMission(input);
  assert.equal(missionHasOwnCta(mission, hero), true);
});

// ---- Up Next: capped and data-gated ----------------------------------------

function upNextBase() {
  return {
    missionKind: "weekly" as const,
    hasSeasonObjective: true,
    seasonObjectiveSubtitle: "Next · x",
    hasWeeklyActivity: true,
    weeklyRecapSubtitle: "2 routes",
    hasClub: true,
    clubSubtitle: "City rank #4",
    questlineComplete: false,
    questlineSubtitle: "Next · start",
    hasZones: true,
    citySubtitle: "1/2 controlled",
  };
}

test("Up Next is capped at UP_NEXT_CAP rows", () => {
  const rows = buildUpNext(upNextBase());
  assert.ok(rows.length <= UP_NEXT_CAP);
  assert.equal(rows.length, UP_NEXT_CAP);
});

test("Up Next omits rows whose data is absent (no fabricated rows)", () => {
  const rows = buildUpNext({
    ...upNextBase(),
    hasSeasonObjective: false,
    hasWeeklyActivity: false,
    hasZones: false,
    questlineComplete: true,
  });
  // Only the club row remains.
  assert.deepEqual(
    rows.map((r) => r.id),
    ["club"],
  );
});

test("Up Next does not repeat the mission's own source directly beneath it", () => {
  const rows = buildUpNext({ ...upNextBase(), missionKind: "objective" });
  assert.ok(!rows.some((r) => r.id === "objectives"));
});
