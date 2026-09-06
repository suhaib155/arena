import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { transpileModule, ModuleKind, ScriptTarget } from "typescript";
import * as privacy from "../../services/verificationPrivacy";
import { createMapAreaTimings } from "../mapAreaTimings";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const FIX = { coords: { latitude: 12.97, longitude: 77.59, accuracy: 25 }, timestamp: 1700000000000 };
/* Enough ticks to drain the longest attempt: read permission, try the cached
   fix, then the current one, then the race and the finally block. */
const microtasks = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };

/** Run the actual hook. Only React lifecycle, OS location and timer boundaries
 * are supplied; acquisition and privacy guards come from production source.
 *
 * `granted` is what `getForegroundPermissionsAsync` reports without prompting —
 * the automatic path's only input — and `permission` is what the explicit tap's
 * `requestForegroundPermissionsAsync` resolves to. Keeping them separate is how
 * these tests can tell "located without asking" from "asked". */
function mount(
  permission = Promise.resolve({ status: "granted" }),
  fix = Promise.resolve(FIX),
  { granted = "denied", lastKnown = null as typeof FIX | null }: { granted?: string; lastKnown?: typeof FIX | null } = {},
) {
  const filename = resolve(__dirname, "../../hooks/useMapArea.ts");
  const values: unknown[] = [];
  const effects: Array<() => (() => void) | void> = [];
  const cleanup: Array<() => void> = [];
  const timers = new Map<number, () => void>();
  let timerId = 0;
  let blur: (() => void) | undefined;
  let permissionCalls = 0;
  let readCalls = 0;
  let fixCalls = 0;
  let lastKnownCalls = 0;
  let logs = 0;
  let focus: (() => (() => void) | void) | undefined;
  const changes = new Set<(state: string) => void>();
  const appState = { currentState: "active", addEventListener: (_name: string, callback: (state: string) => void) => {
    changes.add(callback); return { remove: () => changes.delete(callback) };
  } };
  const module = { exports: {} as { useMapArea: () => { locate: () => Promise<void> } } };
  runInNewContext(transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, {
    module, exports: module.exports,
    console: { log: () => logs++, error: () => logs++, warn: () => logs++ },
    setTimeout: (callback: () => void, delay: number) => { assert.equal(delay, 20000); timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
    require: (id: string) => {
      if (id === "react") return {
        useState: (value: unknown) => { const index = values.length; values.push(value); return [value, (next: unknown) => { values[index] = next; }]; },
        useRef: (current: unknown) => ({ current }),
        useCallback: (callback: unknown) => callback,
        useEffect: (effect: () => (() => void) | void) => effects.push(effect),
      };
      if (id === "react-native") return { AppState: appState };
      if (id === "expo-router") return { useFocusEffect: (effect: () => () => void) => { focus = effect; } };
      if (id === "expo-location") return {
        Accuracy: { Balanced: "balanced" },
        requestForegroundPermissionsAsync: () => { permissionCalls++; return permission; },
        getForegroundPermissionsAsync: () => { readCalls++; return Promise.resolve({ status: granted }); },
        getLastKnownPositionAsync: (options: { maxAge: number }) => {
          assert.equal(options.maxAge, 120000);
          lastKnownCalls++;
          return Promise.resolve(lastKnown);
        },
        getCurrentPositionAsync: (options: { accuracy: string }) => { assert.equal(options.accuracy, "balanced"); fixCalls++; return fix; },
      };
      if (id === "@/lib/mapAreaTimings") return { mapAreaTimings: createMapAreaTimings(false) };
      if (id === "@/services/verificationPrivacy") return privacy;
      throw new Error(`Unexpected hook dependency: ${id}`);
    },
  }, { filename });
  const hook = module.exports.useMapArea();
  for (const effect of effects) { const off = effect(); if (off) cleanup.push(off); }
  return {
    locate: hook.locate,
    /* Focus is the automatic path's trigger. Held rather than fired at mount so
       a test can assert what happens before the screen is entered. */
    enter: () => { blur = focus?.() ?? undefined; },
    point: () => values[0], status: () => values[1], busy: () => values[2],
    viewportGeneration: () => values[3],
    calls: () => ({ permission: permissionCalls, fix: fixCalls }),
    reads: () => readCalls,
    lastKnown: () => lastKnownCalls,
    blur: () => blur?.(),
    background: () => { appState.currentState = "background"; for (const callback of changes) callback("background"); },
    active: () => { appState.currentState = "active"; for (const callback of changes) callback("active"); },
    timeout: () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } },
    dispose: () => { blur?.(); for (const off of cleanup) off(); assert.equal(logs, 0); },
  };
}

test("area mount never requests location; explicit tap obtains one balanced foreground fix", async () => {
  const area = mount();
  try {
    assert.deepEqual(area.calls(), { permission: 0, fix: 0 });
    assert.equal(area.reads(), 0, "mounting reads no permission and asks for none");
    await area.locate();
    assert.deepEqual(area.calls(), { permission: 1, fix: 1 });
    assert.equal(JSON.stringify(area.point()), JSON.stringify({ latitude: 12.97, longitude: 77.59, timestamp: FIX.timestamp, accuracy: 25 }));
    assert.equal(area.busy(), false);
    assert.equal(area.status(), "Your area");
    area.background();
    assert.equal(area.point(), null);
    await area.locate();
    assert.deepEqual(area.calls(), { permission: 1, fix: 1 });
  } finally { area.dispose(); }
});

test("duplicate taps cannot create concurrent native location requests", async () => {
  const pending = deferred<typeof FIX>();
  const area = mount(Promise.resolve({ status: "granted" }), pending.promise);
  try {
    const first = area.locate();
    await microtasks();
    await area.locate();
    assert.deepEqual(area.calls(), { permission: 1, fix: 1 });
    pending.resolve(FIX);
    await first;
  } finally { area.dispose(); }
});

test("permission denial and native failure settle the button without publishing coordinates", async () => {
  const denied = mount(Promise.resolve({ status: "denied" }));
  try {
    await denied.locate();
    assert.equal(denied.status(), "Location permission needed");
    assert.equal(denied.busy(), false);
    assert.equal(denied.calls().fix, 0);
  } finally { denied.dispose(); }
  const pending = deferred<typeof FIX>();
  const failed = mount(Promise.resolve({ status: "granted" }), pending.promise);
  try {
    const work = failed.locate();
    pending.reject(new Error("Native failure"));
    await work;
    assert.equal(failed.point(), null);
    assert.equal(failed.busy(), false);
  } finally { failed.dispose(); }
});

test("permission or fix timeout releases UI and ignores late native completions", async () => {
  for (const duringPermission of [true, false]) {
    const permission = deferred<{ status: string }>();
    const fix = deferred<typeof FIX>();
    const area = mount(duringPermission ? permission.promise : Promise.resolve({ status: "granted" }), fix.promise);
    try {
      const work = area.locate();
      await microtasks();
      assert.equal(area.busy(), true);
      area.timeout();
      await work;
      assert.equal(area.busy(), false);
      assert.equal(area.status(), "Area unavailable · try again");
      permission.resolve({ status: "granted" });
      fix.resolve(FIX);
      await microtasks();
      assert.equal(area.point(), null);
      assert.equal(area.calls().fix, duringPermission ? 0 : 1);
    } finally { area.dispose(); }
  }
});

test("privacy reset, blur, background and unmount invalidate pending fixes", async () => {
  for (const boundary of ["privacy", "blur", "background", "unmount"]) {
    const pending = deferred<typeof FIX>();
    const area = mount(Promise.resolve({ status: "granted" }), pending.promise);
    area.enter();
    await microtasks();
    const work = area.locate();
    await microtasks();
    if (boundary === "privacy") privacy.invalidateVerificationPrivacy();
    else if (boundary === "blur") area.blur();
    else if (boundary === "background") area.background();
    else area.dispose();
    pending.resolve(FIX);
    await work;
    assert.equal(area.point(), null, boundary);
    assert.equal(area.busy(), false, boundary);
    if (boundary !== "unmount") area.dispose();
  }
});

test("reset erases an already displayed point and does not restart acquisition", async () => {
  const area = mount();
  try {
    await area.locate();
    assert.ok(area.point());
    assert.equal(area.viewportGeneration(), 0, "fix acquisition must not remount native map");
    privacy.invalidateVerificationPrivacy();
    assert.equal(area.point(), null);
    assert.notEqual(area.viewportGeneration(), 0, "privacy reset must clear the native viewport as well as React point");
    assert.deepEqual(area.calls(), { permission: 1, fix: 1 });
  } finally { area.dispose(); }
});

test("invalid native coordinates, timestamp or accuracy cannot reach the map", async () => {
  for (const fix of [
    { ...FIX, coords: { ...FIX.coords, latitude: NaN } },
    { ...FIX, coords: { ...FIX.coords, longitude: 181 } },
    { ...FIX, timestamp: NaN },
    { ...FIX, coords: { ...FIX.coords, accuracy: -1 } },
  ]) {
    const area = mount(Promise.resolve({ status: "granted" }), Promise.resolve(fix));
    try { await area.locate(); assert.equal(area.point(), null); assert.equal(area.busy(), false); }
    finally { area.dispose(); }
  }
});

test("entering an already-permitted screen centres the map without a tap or a prompt", async () => {
  const area = mount(Promise.resolve({ status: "granted" }), Promise.resolve(FIX), { granted: "granted" });
  try {
    area.enter();
    await microtasks();
    /* The device failure on Home: permission already granted, and the map still
       showed a random continent until the player found `Locate me`. */
    assert.equal(JSON.stringify(area.point()), JSON.stringify({ latitude: 12.97, longitude: 77.59, timestamp: FIX.timestamp, accuracy: 25 }));
    assert.equal(area.status(), "Your area");
    assert.equal(area.busy(), false);
    /* Located, and never asked. The automatic path reads permission; only the
       button requests it. */
    assert.equal(area.calls().permission, 0, "entering a screen must never raise a permission prompt");
    assert.equal(area.reads(), 1);
    assert.equal(area.calls().fix, 1);
  } finally { area.dispose(); }
});

test("a cached fix shows the player's own area while the current one is acquired", async () => {
  const SEED = { coords: { latitude: 12.90, longitude: 77.50, accuracy: 40 }, timestamp: FIX.timestamp - 60_000 };
  const pending = deferred<typeof FIX>();
  const area = mount(Promise.resolve({ status: "granted" }), pending.promise, { granted: "granted", lastKnown: SEED });
  try {
    area.enter();
    await microtasks();
    /* Between opening the screen and a cold GPS fix there is a window that ran
       to twenty seconds on the phone. It is filled with the player's real
       recent area rather than with a world view. */
    assert.equal(area.lastKnown(), 1);
    assert.equal((area.point() as { latitude: number }).latitude, 12.90);
    assert.equal(area.status(), "Your area");
    pending.resolve(FIX);
    await microtasks();
    assert.equal((area.point() as { latitude: number }).latitude, 12.97, "the current fix replaces the seed");
  } finally { area.dispose(); }
});

test("an unpermitted screen locates nothing, says nothing, and does not re-prompt on every visit", async () => {
  const area = mount(Promise.resolve({ status: "granted" }), Promise.resolve(FIX), { granted: "denied" });
  try {
    for (let visit = 0; visit < 3; visit++) { area.enter(); await microtasks(); area.blur(); }
    assert.equal(area.calls().permission, 0, "an ungranted device is never nagged by a screen it merely opened");
    assert.equal(area.calls().fix, 0);
    assert.equal(area.point(), null);
    assert.equal(area.status(), "Find your area", "no error is shown for a permission that was never requested");
    /* The button still works, and is still the only thing that asks. */
    await area.locate();
    assert.equal(area.calls().permission, 1);
  } finally { area.dispose(); }
});

test("a failed refresh keeps geography already on screen rather than replacing it with an error", async () => {
  const SEED = { coords: { latitude: 12.90, longitude: 77.50, accuracy: 40 }, timestamp: FIX.timestamp - 60_000 };
  const pending = deferred<typeof FIX>();
  const area = mount(Promise.resolve({ status: "granted" }), pending.promise, { granted: "granted", lastKnown: SEED });
  try {
    area.enter();
    await microtasks();
    area.timeout();
    await microtasks();
    assert.equal((area.point() as { latitude: number }).latitude, 12.90, "correct geography survives a failed refresh");
    assert.equal(area.status(), "Your area");
    assert.equal(area.busy(), false);
  } finally { area.dispose(); }
});

test("map-area source has no tracking/storage/logging path and memoizes render geometry", () => {
  const root = resolve(__dirname, "../..");
  const hook = readFileSync(resolve(root, "hooks/useMapArea.ts"), "utf8");
  const component = readFileSync(resolve(root, "components/AreaMap.tsx"), "utf8");
  assert.ok(hook.includes("captureVerificationScope(null)"));
  for (const forbidden of ["watchPositionAsync", "requestBackgroundPermissions", "AsyncStorage", "console.", "advanceQuest", "useMoveStore"]) assert.ok(!hook.includes(forbidden), forbidden);
  /* The position reaches the map as a position, never as a one-point route:
     the marker, camera and waiting overlay must not hang off route evidence. */
  assert.ok(component.includes("currentLocation={area.point}"));
  assert.ok(!/\bpoints=\{/.test(component), "an area map draws no route");
  assert.ok(component.includes("areaCells(cells, area.point)"));
  assert.ok(component.includes("[cells, cellKey]"));
  assert.ok(component.includes("onPress={() => void area.locate()}"));
  assert.ok(component.includes("key={area.viewportGeneration}"));
  /* The automatic path may only read permission. `requestForegroundPermissionsAsync`
     appears exactly once, in the explicit-tap branch. */
  assert.equal(hook.split("requestForegroundPermissionsAsync").length - 1, 1);
  assert.ok(hook.includes("getForegroundPermissionsAsync"));
});
