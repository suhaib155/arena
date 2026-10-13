/**
 * Play v1 release scope guards.
 *
 * Play v1 ships the Movement Game only. Clubs, competition, Deeds and wallets
 * are deferred, and these tests keep them unreachable: no tab, no profile row,
 * no task, objective, badge or questline step that points at them, and a root
 * guard that sends any stray deep link home.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  FEATURE_ROUTES,
  RELEASE_FEATURES,
  SIGN_IN_METHODS,
  deferredFeatureFor,
  isFeatureInRelease,
  isRouteInRelease,
  isSignInMethodEnabled,
  type ReleaseFeature,
} from "../releaseScope";
import { buildTodayBoard, type TodayBoardInput } from "../tasks";
import { buildSeasonObjectives } from "../seasonObjectives";
import { buildCollections } from "../zoneCollections";
import { buildQuestline } from "../onboardingQuestline";

const ROOT = process.cwd();
const APP = join(ROOT, "app");
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Expo Router pathname for an app/ file. */
function pathnameOf(file: string): string {
  const route = relative(APP, file).split(sep).join("/").replace(/\.tsx$/, "");
  const path = "/" + route.replace(/^\(tabs\)\//, "").replace(/(^|\/)index$/, "");
  return path === "/" ? "/" : path.replace(/\/$/, "");
}

const ALL_DEFERRED: string[] = Object.values(FEATURE_ROUTES).flat();

test("Play v1 ships none of the deferred features", () => {
  assert.deepEqual(
    { ...RELEASE_FEATURES },
    { clubs: false, competition: false, deeds: false, wallets: false },
  );
  for (const feature of Object.keys(RELEASE_FEATURES) as ReleaseFeature[]) {
    assert.equal(isFeatureInRelease(feature), false, feature);
  }
});

test("every deferred route is a real screen, so the guard is not checking typos", () => {
  const screens = new Set(walk(APP).map(pathnameOf));
  for (const route of ALL_DEFERRED) {
    assert.ok(screens.has(route), `${route} is listed as deferred but no screen exists for it`);
  }
});

test("pathname matching tolerates query strings, trailing slashes and case", () => {
  assert.equal(deferredFeatureFor("/clubs"), "clubs");
  assert.equal(deferredFeatureFor("/clubs/"), "clubs");
  assert.equal(deferredFeatureFor("/City-War?from=link"), "competition");
  assert.equal(deferredFeatureFor("/deed-showroom#top"), "deeds");
  assert.equal(deferredFeatureFor("/account/wallets"), "wallets");
  assert.equal(deferredFeatureFor("/network/status"), "wallets");
});

test("the Movement Game itself is never caught by the guard", () => {
  for (const path of [
    "/",
    "/move",
    "/move/session",
    "/move/summary",
    "/quests",
    "/quest/daily-1",
    "/territory/map",
    "/zone/abc",
    "/route/passport",
    "/collections",
    "/account",
    "/account/security",
    "/legal",
    "/help",
    "/settings/technical",
    "/profile",
    // A shipped route that merely starts with the same letters as a deferred one.
    "/clubsfoo",
  ]) {
    assert.ok(isRouteInRelease(path), `${path} must stay reachable`);
  }
});

test("the root layout redirects deferred routes home", () => {
  const layout = read("app", "_layout.tsx");
  assert.match(layout, /import \{ isRouteInRelease \} from "@\/lib\/releaseScope"/);
  assert.match(layout, /function useReleaseRouteGuard\(\)/);
  assert.match(layout, /if \(!navigatorReady \|\| isRouteInRelease\(pathname\)\) return;\s*router\.replace\("\/"\)/);
  assert.match(layout, /\n  useReleaseRouteGuard\(\);\n/);
});

test("the tab bar only shows Clubs when clubs ship", () => {
  const bar = read("src", "components", "MovenTabBar.tsx");
  assert.match(bar, /\{isFeatureInRelease\("clubs"\) \? \(\s*<TabButton\s+label="Clubs"/);
});

test("shipped screens only link to deferred routes behind the release scope", () => {
  // These screens route semantic actions ("clubs") produced by builders that
  // the tests below prove never emit that action in v1.
  const actionRouters = new Set(["app/(tabs)/index.tsx", "app/season-objectives.tsx", "app/questline.tsx"]);
  const offenders: string[] = [];
  for (const file of walk(APP)) {
    const rel = relative(ROOT, file).split(sep).join("/");
    if (!isRouteInRelease(pathnameOf(file))) continue;
    if (actionRouters.has(rel)) continue;
    const src = readFileSync(file, "utf8");
    const linksDeferred = ALL_DEFERRED.some((route) => new RegExp(`["'\`]${route}["'\`?]`).test(src));
    if (linksDeferred && !/from "@\/lib\/releaseScope"/.test(src)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `ungated links to deferred features in: ${offenders.join(", ")}`);
});

test("the profile hides club, competition and deed entry points", () => {
  const profile = read("app", "(tabs)", "profile.tsx");
  for (const [feature, route] of [
    ["clubs", "/clubs"],
    ["competition", "/district-mastery"],
    ["competition", "/city-districts"],
    ["clubs", "/club-territory"],
    ["clubs", "/crew-missions"],
    ["deeds", "/deed-showroom"],
  ] as const) {
    const at = profile.indexOf(`go("${route}")`);
    assert.ok(at > 0, `${route} entry exists`);
    const gate = profile.lastIndexOf(`isFeatureInRelease("${feature}")`, at);
    assert.ok(gate > 0 && at - gate < 800, `${route} is gated by ${feature}`);
  }
});

test("the account screen shows no wallet copy in v1", () => {
  const account = read("app", "account", "index.tsx");
  assert.match(account, /const walletsInRelease = isFeatureInRelease\("wallets"\);/);
  assert.match(account, /\{walletsInRelease \? <View style=\{styles\.card\}>\s*<SectionHeader title="Active wallet"/);
  assert.match(account, /\{walletsInRelease \? <Button label="Manage wallets"/);
});

const BOARD: TodayBoardInput = {
  hasRecoverableMovement: false,
  movedToday: false,
  atRiskZoneCount: 0,
  zonesOwned: 0,
  dailyQuestTitle: "Sunrise Mobility",
  dailyQuestXp: 40,
  dailyQuestDone: false,
  hasClub: false,
};

test("a brand new v1 player is never asked to pick a club", () => {
  const board = buildTodayBoard(BOARD);
  const all = [...(board.focus ? [board.focus] : []), ...board.tasks];
  assert.ok(all.length > 0);
  assert.ok(all.every((t) => t.action !== "clubs" && t.id !== "club"));
});

test("season objectives, collections and the questline carry no club items in v1", () => {
  const objectives = buildSeasonObjectives({
    routesThisWeek: 0,
    savedRoutes: 0,
    hasStrongTrust: false,
    zonesOwned: 0,
    atRiskOrWorse: 0,
    timesDefended: 0,
    fortifyCount: 0,
    hasClub: false,
    streak: 0,
    viewedPassport: false,
    viewedProof: false,
    weeklyActive: false,
    collectionsUnlocked: 0,
  });
  assert.ok(objectives.total > 0);
  assert.ok(objectives.groups.every((g) => g.key !== "club"));
  assert.ok(objectives.groups.flatMap((g) => g.objectives).every((o) => o.action !== "clubs"));

  const collections = buildCollections({
    savedRoutes: 0,
    cleanRoutes: 0,
    hasStrongTrust: false,
    zonesCaptured: 0,
    atRiskOrWorse: 0,
    timesDefended: 0,
    fortifyCount: 0,
    hasClub: true,
    viewedPassport: false,
    viewedProof: false,
  });
  assert.ok(collections.total > 0);
  assert.ok(collections.collections.every((c) => c.name !== "Club Starter"));
  // A club picked in an earlier preview build earns no badge in v1.
  assert.equal(collections.unlocked, 0);

  const questline = buildQuestline({
    hasHistory: false,
    savedRoutes: 0,
    zonesOwned: 0,
    timesDefended: 0,
    hasClub: false,
    hasTrust: false,
    viewedPassport: false,
    viewedProof: false,
  });
  assert.ok(questline.steps.length > 0);
  assert.ok(questline.steps.every((s) => s.action !== "clubs"));
});

test("no deferred screen file was deleted to get here", () => {
  for (const route of ALL_DEFERRED) {
    const candidates = [
      join(APP, `${route.slice(1)}.tsx`),
      join(APP, route.slice(1), "index.tsx"),
      join(APP, "(tabs)", `${route.slice(1)}.tsx`),
    ];
    assert.ok(candidates.some(existsSync), `${route} screen is preserved for post-v1`);
  }
});

test("both owner-requested sign-in methods are on, and the wallet switch is honoured everywhere it matters", () => {
  assert.deepEqual({ ...SIGN_IN_METHODS }, { google: true, wallet: true });
  assert.equal(isSignInMethodEnabled("wallet"), true);
  // The fallback for WALLET_LOGIN_BLOCKED must hide the button and disarm the return link.
  const options = readFileSync(join(ROOT, "src/components/SignInOptions.tsx"), "utf8");
  assert.match(options, /isSignInMethodEnabled\("wallet"\)/);
  assert.match(options, /\{walletAvailable \? \(\s*<Button\s+label="Continue with Wallet"/);
  const walletReturn = readFileSync(join(APP, "auth/wallet.tsx"), "utf8");
  assert.match(walletReturn, /!isSignInMethodEnabled\("wallet"\)/);
});
