/**
 * Territory surface guards — offline, source-level.
 *
 * These follow the same pattern as the existing `phaseNGuards` tests: the map,
 * the run screens and the location service are React/native modules that can't
 * be rendered under `node --test`, so their invariants are locked at the source
 * level instead. That is weaker than a render test and is not pretending
 * otherwise — but it does catch the regressions that actually matter here, all
 * of which are "someone deleted the honest state" rather than "the layout
 * shifted by 2px".
 *
 * What is locked:
 *  1. The map never statically imports MapLibre (that crashes Expo Go).
 *  2. The map has loading, error and native-unavailable states.
 *  3. No territory screen renders a coordinate.
 *  4. No run screen claims a capture the server hasn't confirmed.
 *  5. The recorder handles both permission denials and session restoration.
 *  6. No production code logs a coordinate.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const APP = join(ROOT, "app");
const SRC = join(ROOT, "src");

function read(...parts: string[]): string {
  return readFileSync(join(...parts), "utf8");
}

const MAP_COMPONENT = read(SRC, "components", "map", "MovenRunMap.tsx");
const LIVE_MAP = read(APP, "territory", "live-map.tsx");
const DETAIL = read(APP, "territory", "[cellId].tsx");
const PORTFOLIO = read(APP, "territory", "portfolio.tsx");
const DEFENCE = read(APP, "territory", "defence.tsx");
const SESSION = read(APP, "move", "session.tsx");
const SUMMARY = read(APP, "move", "summary.tsx");
const RUN_SERVICE = read(SRC, "services", "location", "activeRunService.ts");
const LOCATION_TASK = read(SRC, "services", "location", "locationTask.ts");

// ------------------------------------------------------------ Expo Go safety

test("MovenRunMap never statically imports the native MapLibre module", () => {
  // A static `import ... from "@maplibre/maplibre-react-native"` evaluates at
  // bundle load and throws in Expo Go, taking the whole app down before any
  // error boundary can run. Only a type-only import and a guarded require are
  // acceptable.
  const staticValueImport =
    /^\s*import\s+(?!type\b)[^;]*from\s+["']@maplibre\/maplibre-react-native["']/m;
  assert.ok(
    !staticValueImport.test(MAP_COMPONENT),
    "MovenRunMap must resolve MapLibre lazily, not with a static value import",
  );
  assert.match(
    MAP_COMPONENT,
    /import type \* as MapLibreTypes from "@maplibre\/maplibre-react-native"/,
    "a type-only import is expected, and is erased at build time",
  );
  assert.match(MAP_COMPONENT, /require\("@maplibre\/maplibre-react-native"\)/);
});

test("the lazy MapLibre resolution is wrapped in a try/catch", () => {
  const loader = MAP_COMPONENT.slice(
    MAP_COMPONENT.indexOf("export function loadMapLibre"),
    MAP_COMPONENT.indexOf("export function isRealMapAvailable"),
  );
  assert.ok(loader.includes("try {"), "loadMapLibre must not let the require throw");
  assert.ok(loader.includes("catch"), "loadMapLibre must swallow the Expo Go failure");
});

test("no other module statically imports MapLibre either", () => {
  const staticValueImport =
    /^\s*import\s+(?!type\b)[^;]*from\s+["']@maplibre\/maplibre-react-native["']/m;
  for (const [name, source] of Object.entries({ LIVE_MAP, DETAIL, PORTFOLIO, DEFENCE })) {
    assert.ok(!staticValueImport.test(source), `${name} must not import MapLibre directly`);
  }
});

// ---------------------------------------------------------------- map states

test("the map exposes a loading state", () => {
  assert.match(MAP_COMPONENT, /accessibilityLabel="Loading map"/);
  assert.match(MAP_COMPONENT, /ActivityIndicator/);
});

test("the map exposes an error state that explains itself", () => {
  assert.match(MAP_COMPONENT, /accessibilityLabel="Map failed to load"/);
  assert.match(MAP_COMPONENT, /onDidFailLoadingMap/);
  assert.match(MAP_COMPONENT, /EXPO_PUBLIC_MAP_STYLE_URL/);
});

test("the map exposes a native-unavailable state instead of crashing", () => {
  assert.match(MAP_COMPONENT, /export function MapUnavailable/);
  assert.match(MAP_COMPONENT, /can't run in Expo Go/);
  assert.match(MAP_COMPONENT, /development build/);
});

test("territory refresh never blanks the map", () => {
  // The loading pill renders alongside the map, not instead of it.
  assert.match(MAP_COMPONENT, /accessibilityLabel="Loading territory"/);
  assert.match(LIVE_MAP, /applyError/, "an error keeps previously loaded cells");
});

test("the map renders territory through native layers, not a component per cell", () => {
  // One ShapeSource + FillLayer/LineLayer pair; a `.map(` over cells rendering
  // components would be the performance regression this guards against.
  assert.match(MAP_COMPONENT, /<ShapeSource[\s\S]*movenrun-territories/);
  assert.match(MAP_COMPONENT, /<FillLayer/);
  assert.match(MAP_COMPONENT, /<LineLayer/);
  assert.ok(
    !/territories[\s\S]{0,80}\.features\.map\(/.test(MAP_COMPONENT),
    "territory features must not be mapped to React components",
  );
});

// -------------------------------------------------------------- viewport use

test("the live map debounces viewport changes and drops stale responses", () => {
  assert.match(LIVE_MAP, /VIEWPORT_RULES\.debounceMs/);
  assert.match(LIVE_MAP, /RequestSequence/);
  assert.match(LIVE_MAP, /sequence\.isCurrent\(token\)/);
  assert.match(LIVE_MAP, /ViewportCache/);
  assert.match(LIVE_MAP, /shouldRefetch/);
});

test("the live map cancels in-flight work when it unmounts", () => {
  assert.match(LIVE_MAP, /sequence\.cancelAll\(\)/);
  assert.match(LIVE_MAP, /clearTimeout\(debounceRef\.current\)/);
});

// ------------------------------------------------------------ no coordinates

test("no territory screen renders a coordinate", () => {
  const screens = { LIVE_MAP, DETAIL, PORTFOLIO, DEFENCE };
  for (const [name, source] of Object.entries(screens)) {
    // Strip comments first: the prose in these files legitimately discusses
    // coordinates while the rendered output never contains one.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const forbidden of [/\blatitude\b/, /\blongitude\b/, /\.lat\b/, /\.lng\b/]) {
      assert.ok(
        !forbidden.test(code),
        `${name} must not surface ${forbidden} — territory is identified by cell id`,
      );
    }
  }
});

test("the detail screen shows a truncated owner, never a full address", () => {
  assert.match(DETAIL, /owner\?\.displayAddress/);
  assert.ok(
    !/ownerWalletAddress|walletAddress/.test(DETAIL),
    "the detail screen must use the API's truncated owner summary",
  );
});

// --------------------------------------------------- honest capture language

test("the live run screen never claims a capture", () => {
  const code = SESSION.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  // "Capture preview" and "capture requirements" are fine; a bare claim is not.
  assert.ok(
    !/Territory captured|Zone captured|You captured/i.test(code),
    "the run screen must not assert a capture before the server verifies it",
  );
  assert.match(SESSION, /buildLivePreview/, "live copy must come from the tested state machine");
  assert.match(SESSION, /Server verified after you finish/);
});

test("the summary marks loop capture as pending server verification", () => {
  assert.match(SUMMARY, /Pending server verification/);
  assert.match(SUMMARY, /before any territory is awarded/);
});

test("the summary explains why a capture probably will not land", () => {
  assert.match(SUMMARY, /describeRejections/);
  assert.match(SUMMARY, /localBlockers/);
});

test("client-side thresholds are named after the backend variables they mirror", () => {
  const source = read(SRC, "lib", "territory", "capturePreview.ts");
  for (const variable of [
    "TERRITORY_MAX_CLOSURE_DISTANCE_METERS",
    "TERRITORY_MIN_ROUTE_DISTANCE_METERS",
    "TERRITORY_MIN_DURATION_SECONDS",
    "TERRITORY_MIN_AREA_SQUARE_METERS",
  ]) {
    assert.ok(source.includes(variable), `capturePreview should name ${variable}`);
  }
});

// ------------------------------------------------------------- run recording

test("the recorder handles a denied foreground permission without starting", () => {
  assert.match(RUN_SERVICE, /reason: "foregroundDenied"/);
  assert.match(RUN_SERVICE, /reason: "servicesDisabled"/);
});

test("a denied background permission downgrades the run rather than blocking it", () => {
  assert.match(RUN_SERVICE, /requestBackgroundPermission/);
  // Background is requested only after foreground is granted (iOS auto-denies
  // otherwise), and its absence never returns a failure from start().
  assert.match(RUN_SERVICE, /foreground\.status !== "granted"\) return "denied"/);
  assert.ok(
    !/reason: "backgroundDenied"/.test(RUN_SERVICE),
    "a run must still start without background permission",
  );
});

test("the recorder can restore an interrupted session", () => {
  assert.match(RUN_SERVICE, /async restoreInterruptedSession/);
  assert.match(RUN_SERVICE, /isRecoverable\(session\)/);
  assert.match(RUN_SERVICE, /chunkKey\(session\.id, index\)/);
});

test("the recorder always tears down background updates when it stops", () => {
  assert.match(RUN_SERVICE, /stopLocationUpdatesAsync\(LOCATION_TASK_NAME\)/);
  assert.match(RUN_SERVICE, /setBackgroundBatchHandler\(null\)/);
});

test("persistence goes through the bounded chunk plan, never a whole-route write", () => {
  assert.match(RUN_SERVICE, /planBufferFlush/);
  assert.match(RUN_SERVICE, /chunkKey\(plan\.session\.id, chunk\.index\)/);
  assert.ok(
    !/setItem\(\s*SESSION_KEY,\s*JSON\.stringify\(this\.classified/.test(RUN_SERVICE),
    "the full sample array must never be written to the session key",
  );
});

test("the background task is defined at module scope", () => {
  // Not nested inside a function/component — the OS looks the task up by name
  // in a fresh runtime on relaunch, so a definition that only runs when some
  // component mounts silently drops background batches.
  //
  // The module doc-comment also mentions `TaskManager.defineTask`, so match the
  // real call site (the one passing the task name) rather than the first
  // textual occurrence.
  const definition = /^([ \t]*)TaskManager\.defineTask\(LOCATION_TASK_NAME/m.exec(LOCATION_TASK);
  assert.ok(definition, "locationTask must call TaskManager.defineTask(LOCATION_TASK_NAME, ...)");
  // At most one level of indentation: the `if (!isTaskDefined(...))` re-entry
  // guard is fine; being inside a function body is not.
  assert.ok(
    definition[1].length <= 2,
    `defineTask must be at module scope, found ${definition[1].length} spaces of indentation`,
  );
  // And nothing may open a function between the file start and the definition.
  const preamble = LOCATION_TASK.slice(0, definition.index);
  const lastFunctionOpen = Math.max(
    preamble.lastIndexOf("\nfunction "),
    preamble.lastIndexOf("\nexport function "),
  );
  const lastFunctionClose = preamble.lastIndexOf("\n}");
  assert.ok(
    lastFunctionOpen < lastFunctionClose,
    "defineTask appears to be inside a function body",
  );
});

test("the task is registered once by the root layout, for its side effect", () => {
  const layout = read(APP, "_layout.tsx");
  assert.match(layout, /import "@\/services\/location\/locationTask"/);
  assert.match(LOCATION_TASK, /isTaskDefined\(LOCATION_TASK_NAME\)/);
});

// -------------------------------------------------------------- no GPS logs

test("no location module logs a coordinate", () => {
  const locationDir = join(SRC, "services", "location");
  const files = readdirSync(locationDir).filter((f) => f.endsWith(".ts"));
  assert.ok(files.length >= 2, "expected the location service and its task");

  for (const file of files) {
    const source = readFileSync(join(locationDir, file), "utf8");
    const logCalls = source.match(/console\.\w+\([^)]*\)/g) ?? [];
    for (const call of logCalls) {
      for (const forbidden of ["latitude", "longitude", "coords", "sample.lat", ".lng"]) {
        assert.ok(
          !call.includes(forbidden),
          `${file} logs "${forbidden}": ${call}`,
        );
      }
    }
  }
});

// ------------------------------------------------------------- reachability

test("every new territory screen is reachable from the territory board", () => {
  const board = read(APP, "territory", "map.tsx");
  for (const route of ["/territory/live-map", "/territory/portfolio", "/territory/defence"]) {
    assert.ok(board.includes(route), `${route} must be reachable from the territory board`);
  }
});

test("the real map offers the local board as a fallback when unavailable", () => {
  assert.match(LIVE_MAP, /router\.replace\("\/territory\/map"\)/);
});
