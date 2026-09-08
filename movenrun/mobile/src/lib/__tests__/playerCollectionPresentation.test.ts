import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const app = resolve(__dirname, "../../../app");
const screen = (path: string) => readFileSync(resolve(app, path), "utf8");

test("Profile player identity uses persisted XP and collection counts without a financial-looking balance", () => {
  const source = screen("(tabs)/profile.tsx");
  assert.ok(source.includes('totalXp = useGameStore((s) => s.totalXp)'));
  assert.ok(source.includes('<PlayerHud name="Mover" totalXp={totalXp} streak={streak}'));
  assert.ok(source.includes("${collections.unlocked} / ${collections.total} badges"));
  for (const forbidden of ["Locked MOVE", "lockedMovePreview", "City rank #", 'title="City War Board"', 'title="Rival Ghosts"']) assert.ok(!source.includes(forbidden), forbidden);
  assert.ok(source.includes('title="Account"'));
  assert.ok(source.includes('title="Legal"'));
});

test("Deed collectible art stays locked until its real preview is ready and has no ownership identifier", () => {
  const source = screen("deed-showroom.tsx");
  assert.ok(source.includes("buildDeedsView(showroom)"));
  assert.ok(source.includes('label="Preview"'));
  assert.ok(source.includes('locked={!card.ready}'));
  assert.ok(!source.includes("card.id.slice("));
  assert.ok(source.includes("view.hasZones"));
});

test("Collections and passport derive earned versus locked art from their existing real progress", () => {
  const collections = screen("collections.tsx");
  const passport = screen("route/passport.tsx");
  assert.ok(collections.includes("locked={!view.hasProgress}"));
  assert.ok(collections.includes("${view.unlocked} / ${view.total} unlocked"));
  assert.ok(collections.includes("view.unlockedBadges.map"));
  assert.ok(passport.includes("locked={!hasRoutes}"));
  assert.ok(passport.includes("stamps.map"));
  assert.ok(passport.includes('pathname: "/legal"'));
});

test("Club identity shows the selected club and actual contributions without fictional social activity", () => {
  const clubs = screen("(tabs)/clubs.tsx");
  const territory = screen("club-territory.tsx");
  assert.ok(clubs.includes("{club.name}"));
  assert.ok(clubs.includes("value={heroView.contributionLabel}"));
  assert.ok(clubs.includes('mission.kind === "climb" || mission.kind === "hold"'));
  assert.ok(clubs.includes('title={contributionMission ? "Grow your contribution" : mission.title}'));
  for (const forbidden of ["board.rivalSummary.label", "board.cityWarSummary.label", "Club rally · future activity"]) assert.ok(!territory.includes(forbidden), forbidden);
  assert.ok(territory.includes("board.topZones.map"));
});

test("Activity remains a read-only journey of saved summaries, never fabricated map thumbnails", () => {
  const source = screen("route/review-history.tsx");
  assert.ok(source.includes("useGameStore((s) => s.routeTrustHistory)"));
  assert.ok(source.includes("locked={count === 0}"));
  for (const forbidden of ["MapView", "PaintedMap", "DemoTracker", "completeQuest(", "captureZone("]) assert.ok(!source.includes(forbidden), forbidden);
});

test("Profile memoization includes all persisted progression inputs and the current day", () => {
  const source = screen("(tabs)/profile.tsx");
  assert.ok(source.includes("const dayKey = getLocalDateKey()"));
  assert.ok(source.includes("[zones, routeTrustHistory, timesDefended, selectedClubId, selectedClub, viewedRoutePassport, viewedRouteProof, history, streak, totalXp, dayKey]"));
});
