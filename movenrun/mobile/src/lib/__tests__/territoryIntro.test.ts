/**
 * Territory onboarding guards.
 *
 * The regression these exist to catch is not a crash — it is silence. The
 * task-board refactor deleted the only explanation of what territory is, and
 * every suite stayed green, because nothing asserted that a new player is ever
 * told anything. So these tests assert the *presence and correctness of
 * guidance*, the stage boundaries around it, and the claim safety of its words.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CORE_LOOP,
  buildTerritoryIntro,
  territoryStage,
  type TerritoryIntroInput,
} from "../territoryIntro";
import { boardInputFromState, buildTodayBoard } from "../tasks";

const UNTOUCHED: TerritoryIntroInput = { zonesOwned: 0, historyCount: 0, routeTrustCount: 0 };
const input = (over: Partial<TerritoryIntroInput> = {}): TerritoryIntroInput => ({
  ...UNTOUCHED,
  ...over,
});

/* ── stage derivation ─────────────────────────────────────────────────────── */

test("a brand-new player is 'new' and gets the full core-loop walkthrough", () => {
  assert.equal(territoryStage(UNTOUCHED), "new");

  const view = buildTerritoryIntro(UNTOUCHED);
  assert.ok(view, "a player who has never moved must be told what territory is");
  assert.equal(view.stage, "new");
  assert.deepEqual(
    view.steps.map((s) => s.key),
    ["move", "capture", "defend", "own"],
    "the whole loop, in order — this is the explanation that went missing",
  );
  assert.ok(view.title.length > 0 && view.body.length > 0);
});

test("a zero-zone player who HAS moved is 'returning' — a next action, not a tutorial", () => {
  assert.equal(territoryStage(input({ historyCount: 1 })), "returning");
  assert.equal(territoryStage(input({ routeTrustCount: 1 })), "returning");

  const view = buildTerritoryIntro(input({ historyCount: 3 }));
  assert.ok(view, "a returning player with no zones still needs a useful empty state");
  assert.equal(view.stage, "returning");
  assert.equal(view.steps.length, 0, "they already know what moving is");
  assert.ok(view.ctaLabel.length > 0, "and they still need somewhere to go");
});

test("owning ground always wins — an established player never gets beginner education", () => {
  assert.equal(territoryStage(input({ zonesOwned: 1 })), "active");
  assert.equal(buildTerritoryIntro(input({ zonesOwned: 1 })), null);
  // Even with no history at all on record, a held zone is authoritative.
  assert.equal(buildTerritoryIntro({ zonesOwned: 2, historyCount: 0, routeTrustCount: 0 }), null);
});

test("guidance is derived from progress, so a reset restores it rather than stranding the user", () => {
  // "Reset progress" clears history/zones (see useGameStore) and keeps first-run
  // state. Because the stage is derived and not persisted, that lands back on
  // real guidance instead of an empty screen with a stale "already seen" flag.
  assert.equal(buildTerritoryIntro(input({ zonesOwned: 4, historyCount: 9 })), null);
  assert.equal(territoryStage(UNTOUCHED), "new");
  assert.ok(buildTerritoryIntro(UNTOUCHED));
});

/* ── the CTA goes to the real movement flow ───────────────────────────────── */

test("every guidance CTA is the movement action — never a fake capture shortcut", () => {
  for (const state of [UNTOUCHED, input({ historyCount: 1 })]) {
    const view = buildTerritoryIntro(state);
    assert.ok(view);
    assert.equal(view.ctaAction, "move", "capture must be earned by moving, not by a button");
  }
});

test("the territory screen resolves that action to the existing /move route", () => {
  // The action is semantic; the screen owns the route. Assert the screen sends
  // the zero-zone CTA to the movement flow the rest of the app already uses,
  // and that it does not invent a capture path of its own.
  const screen = readFileSync(join(process.cwd(), "app", "territory", "map.tsx"), "utf8");
  assert.match(screen, /router\.push\("\/move"\)/, "zero-zone CTA must start a movement session");
  assert.ok(
    !/captureZone|applyCapture/.test(screen),
    "the territory screen must never award a capture directly",
  );
});

/* ── Home discoverability ─────────────────────────────────────────────────── */

const SOURCE = {
  history: [] as { questId: string; completedAt: string; xp: number }[],
  zones: [] as never[],
  dailyQuestTitle: "Sunrise Mobility",
  dailyQuestXp: 40,
  dailyQuestDone: false,
  hasClub: false,
};

test("Home offers a zero-zone player a way into territory", () => {
  // `defend` is the board's other territory task and needs at-risk zones, which
  // a zero-zone player cannot have — so without this, Home never mentions
  // territory to the only audience that has never seen it.
  const board = buildTodayBoard(boardInputFromState(SOURCE));
  const all = [board.focus, ...board.tasks].filter((t) => t !== null);
  const toTerritory = all.filter((t) => t.action === "territory");
  assert.equal(toTerritory.length, 1, "exactly one territory entry point, not zero and not two");
  assert.equal(toTerritory[0].id, "capture");
});

test("the spotlight still starts a move, and no second row duplicates it", () => {
  const board = buildTodayBoard(boardInputFromState(SOURCE));
  assert.equal(board.focus?.id, "move", "movement remains the primary action");
  assert.equal(board.focus?.action, "move");
  const moveRows = board.tasks.filter((t) => t.action === "move");
  assert.deepEqual(moveRows, [], "the spotlight owns the movement CTA by itself");
});

test("the territory entry point leaves the board once a zone is held", () => {
  const withZone = buildTodayBoard({
    hasRecoverableMovement: false,
    movedToday: false,
    atRiskZoneCount: 0,
    zonesOwned: 1,
    dailyQuestTitle: "Sunrise Mobility",
    dailyQuestXp: 40,
    dailyQuestDone: false,
    hasClub: true,
  });
  const all = [withZone.focus, ...withZone.tasks].filter((t) => t !== null);
  assert.ok(!all.some((t) => t.id === "capture"), "beginner guidance is not permanent furniture");
});

/* ── claim safety ─────────────────────────────────────────────────────────── */

test("the core loop makes no mainnet, financial, or live-ownership claim", () => {
  const words = CORE_LOOP.map((s) => `${s.label} ${s.detail}`).join(" ").toLowerCase();
  const forbidden = [
    "mainnet",
    "earn",
    "payout",
    "profit",
    "invest",
    "trade",
    "tradable",
    "sell",
    "buy",
    "mint ",
    "airdrop",
    "guaranteed",
    "worth",
    "wallet required",
  ];
  for (const phrase of forbidden) {
    assert.ok(!words.includes(phrase), `core-loop copy must not say "${phrase.trim()}"`);
  }
});

test("the 'Own' step states the preview/testnet limits rather than implying ownership", () => {
  const own = CORE_LOOP.find((s) => s.key === "own");
  assert.ok(own);
  const detail = own.detail.toLowerCase();
  // Grounded in data/contractStatus.ts (appAccess "Preview only", Zone Deeds
  // "Arrive later") and lib/deedPreview.ts (no ownership, no mint, no value).
  assert.match(detail, /preview/);
  assert.match(detail, /testnet/);
  assert.match(detail, /no wallet/);
  assert.match(detail, /no rewards/);
  assert.match(detail, /no value/);
});

test("'Capture' promises movement, not a guaranteed zone", () => {
  const capture = CORE_LOOP.find((s) => s.key === "capture");
  assert.ok(capture);
  assert.match(
    capture.detail.toLowerCase(),
    /can capture|not every route/,
    "capture is conditional on the route — see app/move/summary.tsx",
  );
});

test("guidance introduces no persisted onboarding flag of its own", () => {
  // A stored "seen it" boolean is a second copy of state that survives a
  // progress reset and strands the user — the exact bug lib/firstRun.ts ended.
  const src = readFileSync(join(process.cwd(), "src", "lib", "territoryIntro.ts"), "utf8");
  const imports = src.match(/^import .*$/gm) ?? [];
  assert.deepEqual(
    imports.filter((line) => !line.includes('from "@/types"')),
    [],
    "territoryIntro must stay a pure derivation — types only, no store or storage",
  );
});
