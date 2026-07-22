/**
 * Clubs presentation view — offline node tests. Verifies mission selection,
 * honest rank/contribution labels, the local-preview flag, and (as a guard)
 * that the underlying `rankClubs` logic is unchanged and still blends the
 * player's contribution into their club.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildClubHeroView,
  contributionLabel,
  rankLabel,
  selectClubMission,
  type ClubMissionInput,
} from "../clubsView";
import { rankClubs, userContribution } from "../clubs";
import type { Club } from "../../types";

function missionInput(p: Partial<ClubMissionInput> = {}): ClubMissionInput {
  return { hasClub: true, userContribution: 100, rank: 2, zonesOwned: 3, atRiskZones: 0, ...p };
}

test("no club → join mission", () => {
  const m = selectClubMission(missionInput({ hasClub: false }));
  assert.equal(m.kind, "join");
  assert.equal(m.action, "clubs");
});

test("at-risk zones take priority → defend mission", () => {
  const m = selectClubMission(missionInput({ atRiskZones: 2 }));
  assert.equal(m.kind, "defend");
  assert.match(m.title, /2 zones/);
});

test("no zones → capture mission", () => {
  const m = selectClubMission(missionInput({ zonesOwned: 0, atRiskZones: 0 }));
  assert.equal(m.kind, "capture");
});

test("zero contribution → first-contribution mission", () => {
  const m = selectClubMission(missionInput({ userContribution: 0, zonesOwned: 2 }));
  assert.equal(m.kind, "first-contribution");
});

test("ranked below #1 → climb; rank unavailable also climbs", () => {
  assert.equal(selectClubMission(missionInput({ rank: 3 })).kind, "climb");
  assert.equal(selectClubMission(missionInput({ rank: null })).kind, "climb");
});

test("rank #1 → hold", () => {
  assert.equal(selectClubMission(missionInput({ rank: 1 })).kind, "hold");
});

test("labels are honest for unavailable rank and zero contribution", () => {
  assert.equal(rankLabel(null), "Unranked");
  assert.equal(rankLabel(4), "#4");
  assert.equal(contributionLabel(0), "No contribution yet");
  assert.equal(contributionLabel(120), "+120");
});

test("hero view marks local preview and reflects availability", () => {
  const v = buildClubHeroView(null);
  assert.equal(v.localPreview, true);
  assert.equal(v.rankAvailable, false);
  assert.equal(v.hasContribution, false);
  assert.equal(v.rankLabel, "Unranked");
});

// ---- regression guard: ranking logic unchanged -----------------------------

test("rankClubs still blends the player's contribution into their club", () => {
  const clubs: Club[] = [
    { id: "a", name: "A", shortName: "A", color: "#246BFE", motto: "", memberCount: 1, weeklyDistanceKm: 0, zonesOwned: 0, zonesDefended: 0, territoryScore: 100, cityRank: 1, isUserClub: false },
    { id: "b", name: "B", shortName: "B", color: "#18C987", motto: "", memberCount: 1, weeklyDistanceKm: 0, zonesOwned: 0, zonesDefended: 0, territoryScore: 120, cityRank: 2, isUserClub: false },
  ];
  const stats = { zonesOwned: 5, timesDefended: 2, totalXp: 200, streak: 3, sessionsThisWeek: 2 };
  const ranked = rankClubs(clubs, "a", stats);
  const mine = ranked.find((r) => r.isUserClub)!;
  assert.equal(mine.userContribution, userContribution(stats));
  assert.equal(mine.score, 100 + userContribution(stats));
});
