/**
 * What a finished session's map resolves to, for every route shape.
 *
 * A 0 m / 0:28 session showed a world-scale basemap with no route on it. The
 * numbers were right and the map was a map of nowhere, which is the one reading
 * a summary must never offer: it says the app lost the walk.
 *
 * The states are enumerated here rather than trusted to render order, because
 * the bug was precisely that the empty case had no state — the summary handed
 * an empty point array to the map and the provider chose the viewport.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { routeMapState, hasDrawableRoute } from "../routeMapState";
import { toSubmission } from "../movementVerification";
import type { TrackPoint } from "../geo";

const epoch = 1_700_000_000_000;
const at = (offset: number, latitude = 26.1445): TrackPoint =>
  ({ latitude, longitude: 91.7362, timestamp: epoch + offset, accuracy: 5 });

test("a route with two or more observed fixes leads with the route", () => {
  const state = routeMapState({ points: [at(0), at(4000, 26.1455)] });
  assert.equal(state.kind, "route");
  assert.equal(state.drawsRoute, true);
  assert.equal(state.currentLocation, null, "a drawn route needs no separate marker position");
  assert.equal(state.message, null);
  assert.equal(hasDrawableRoute([at(0), at(4000, 26.1455)]), true);
});

test("a session with no route but a display seed shows the player's own ground", () => {
  const seed = at(28_000);
  const state = routeMapState({ points: [], displaySeed: seed });
  /* The physical case: half a minute standing still. Every fix was correctly
     rejected as movement, so there is no route — and the app still knew the
     ground to within a few metres. */
  assert.equal(state.kind, "seed");
  assert.equal(state.drawsRoute, false, "no line is drawn for a route that does not exist");
  assert.equal(state.currentLocation, seed);
  assert.equal(state.message, null);
});

test("a single recorded fix is a position, not a route", () => {
  const only = at(1000);
  const state = routeMapState({ points: [only] });
  assert.equal(state.kind, "seed");
  assert.equal(state.drawsRoute, false, "one point is not a line");
  assert.equal(state.currentLocation, only);
  assert.equal(hasDrawableRoute([only]), false);
});

test("the later seed wins over a stale single route point", () => {
  const seed = at(9000, 26.20);
  const state = routeMapState({ points: [at(1000)], displaySeed: seed });
  assert.equal(state.currentLocation, seed);
});

test("a route broken into single fixes draws no line and falls back to a position", () => {
  /* Two fixes with an evidence break between them are two positions. Drawing
     them as a line would bridge ground the player was never observed on —
     `routeSegments` is the same function the polyline uses, so this decision
     and the drawing cannot disagree. */
  const broken = [at(0), { ...at(600_000, 26.30), breakBefore: true }];
  assert.equal(hasDrawableRoute(broken), false);
  const state = routeMapState({ points: broken });
  assert.equal(state.kind, "seed");
  assert.equal(state.drawsRoute, false);
  assert.equal(state.currentLocation, broken[1]);

  /* A pause between the only two fixes is the same story. */
  const paused = routeMapState({
    points: [at(0), at(60_000, 26.15)],
    pauses: [{ startedAt: epoch + 1000, endedAt: epoch + 59_000 }],
  });
  assert.equal(paused.drawsRoute, false);

  /* …while three fixes with a break in the middle still contain a drawable
     span, so the route leads and the line breaks where the evidence did. */
  assert.equal(hasDrawableRoute([at(0), at(4000, 26.1455), { ...at(600_000, 26.30), breakBefore: true }]), true);
});

test("no route and no position resolves to a stated panel, never a default view", () => {
  const state = routeMapState({ points: [], displaySeed: null });
  assert.equal(state.kind, "none");
  assert.equal(state.currentLocation, null, "there is no fabricated fallback coordinate");
  assert.equal(state.drawsRoute, false);
  assert.match(state.message ?? "", /Not enough movement/);
});

test("a build with no basemap says that, and does not also claim there was no route", () => {
  const state = routeMapState({ points: [at(0), at(4000, 26.1455)], mapAvailable: false });
  assert.equal(state.kind, "none");
  assert.equal(state.drawsRoute, false);
  assert.match(state.message ?? "", /Map unavailable/);
  assert.equal(state.currentLocation, null);
});

test("no state ever yields a coordinate the session did not observe", () => {
  for (const input of [
    { points: [] },
    { points: [], displaySeed: null },
    { points: [at(0)] },
    { points: [at(0), at(4000, 26.1455)] },
    { points: [], displaySeed: at(0) },
    { points: [at(0)], mapAvailable: false },
  ]) {
    const state = routeMapState(input);
    if (state.currentLocation === null) continue;
    const observed = [...input.points, ...("displaySeed" in input && input.displaySeed ? [input.displaySeed] : [])];
    assert.ok(observed.includes(state.currentLocation), "the marker is always an observed fix");
  }
});

test("the display seed reaches the summary and cannot reach the server", () => {
  const seed = at(28_000);
  /* `toSubmission` names the fields it sends. The seed is display-only state on
     the same object, so this is the assertion that it stays that way. */
  const submission = toSubmission({
    points: [at(0), at(4000, 26.1455)],
    durationMs: 28_000,
    finishedAt: epoch + 28_000,
    displaySeed: seed,
  } as Parameters<typeof toSubmission>[0] & { displaySeed: TrackPoint });
  assert.ok(!JSON.stringify(submission).includes(String(seed.timestamp)),
    "a display seed must never be submitted as evidence");

  const handoff = readFileSync(resolve(__dirname, "../../services/moveSession.ts"), "utf8");
  /* Erased with the rest of the geometry, not left behind after a privacy
     reset clears the route. */
  assert.match(handoff, /last\.displaySeed = null;/);

  const builder = readFileSync(resolve(__dirname, "../movementVerification.ts"), "utf8");
  assert.ok(!builder.includes("displaySeed"), "the request builder does not know this field exists");
});

test("the summary renders the decision rather than making one of its own", () => {
  const screen = readFileSync(resolve(__dirname, "../../../app/move/summary.tsx"), "utf8");
  assert.match(screen, /routeMapState\(\{/);
  assert.match(screen, /mapAvailable: mapBasemapAvailable\(\)/);
  assert.match(screen, /<RouteMapPanel/);
  /* The map is no longer handed raw points directly — that is what produced a
     world view for an empty route. */
  assert.ok(!/<MovenMap[\s\S]*?points=\{session\.points\}/.test(screen),
    "the summary must not mount a map straight from the route array");

  const panel = readFileSync(resolve(__dirname, "../../components/RouteMapPanel.tsx"), "utf8");
  assert.match(panel, /state\.drawsRoute \? points : EMPTY_POINTS/);
  assert.match(panel, /currentLocation=\{state\.currentLocation\}/);
  assert.match(panel, /state\.kind === "none"/);

  /* The empty state's art is an emblem, not geography. */
  const motif = readFileSync(resolve(__dirname, "../../components/RouteMotif.tsx"), "utf8");
  for (const forbidden of ["road", "Polyline", "MovenMap", "latitude", "longitude"]) {
    assert.ok(!motif.includes(forbidden), `the empty-state motif must not name ${forbidden}`);
  }
});
