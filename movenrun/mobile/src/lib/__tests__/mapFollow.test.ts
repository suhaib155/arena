/**
 * D4 regression — "Recentre on my location" must use the device location.
 *
 * ## The defect
 * The control computed the centre of the *last fetched viewport* and moved the
 * camera there. That is wherever the user had already panned to, so pressing it
 * did nothing visible — and the accessibility label said "Recentre on my
 * location", telling a screen-reader user the button did something it
 * demonstrably did not.
 *
 * ## What is asserted
 *  - a press asks the device, and a fix moves the camera and starts following;
 *  - a map gesture always ends follow, including one that lands mid-request;
 *  - permission refused, location services off and no-fix are three distinct,
 *    named outcomes, each with its own message;
 *  - the accessibility label is derived from the state, so it can never
 *    over-promise;
 *  - the location request's decision order (services → permission → fix) and
 *    its timeout. The expo-location adapter is a four-line binding over this;
 *    it imports the native module and so cannot load here.
 *
 * The screen wiring itself is React and cannot render under `node --test`; the
 * source-level guards at the end cover what the reducer cannot.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  followLabel,
  followMessage,
  followReducer,
  INITIAL_FOLLOW_STATE,
  isFollowing,
  isLocating,
  type FollowAction,
  type FollowState,
} from "../territory/mapFollow";
import { requestDeviceLocation, type LocationBackend } from "../territory/deviceLocation";

const HERE: [number, number] = [-0.1, 51.5];

/** Run a sequence of actions from the initial state. */
function run(...actions: FollowAction[]): FollowState {
  return actions.reduce(followReducer, INITIAL_FOLLOW_STATE);
}

// ------------------------------------------------------- the happy path

test("D4: pressing recentre asks for a fix, and a fix starts following", () => {
  const locating = run({ type: "recenterPressed" });
  assert.equal(locating.status, "locating");
  assert.equal(isLocating(locating), true);
  assert.equal(isFollowing(locating), false, "nothing may follow before a fix arrives");

  const following = followReducer(locating, {
    type: "locationResolved",
    outcome: { kind: "fix", coordinate: HERE },
  });
  assert.equal(following.status, "following");
  assert.deepEqual(following.coordinate, HERE, "the camera target is the device position");
  assert.equal(isFollowing(following), true);
  assert.equal(followMessage(following), null);
});

test("D4: pressing while already following does nothing", () => {
  const following = run(
    { type: "recenterPressed" },
    { type: "locationResolved", outcome: { kind: "fix", coordinate: HERE } },
  );
  assert.equal(followReducer(following, { type: "recenterPressed" }), following);
});

test("D4: pressing twice does not fire a second request", () => {
  const locating = run({ type: "recenterPressed" });
  assert.equal(followReducer(locating, { type: "recenterPressed" }), locating);
});

// ------------------------------------------------------------- gestures

test("D4: panning the map ends follow", () => {
  const following = run(
    { type: "recenterPressed" },
    { type: "locationResolved", outcome: { kind: "fix", coordinate: HERE } },
  );
  const panned = followReducer(following, { type: "userGesture" });
  assert.equal(panned.status, "idle");
  assert.equal(isFollowing(panned), false, "a camera that fights the user's pan is worse than none");
});

test("D4: pressing recentre after a pan restores follow", () => {
  const state = run(
    { type: "recenterPressed" },
    { type: "locationResolved", outcome: { kind: "fix", coordinate: HERE } },
    { type: "userGesture" },
    { type: "recenterPressed" },
    { type: "locationResolved", outcome: { kind: "fix", coordinate: [-0.2, 51.6] } },
  );
  assert.equal(state.status, "following");
  assert.deepEqual(state.coordinate, [-0.2, 51.6]);
});

test("D4: a fix that arrives after the user panned away does not yank the camera back", () => {
  const state = run(
    { type: "recenterPressed" },
    { type: "userGesture" },
    { type: "locationResolved", outcome: { kind: "fix", coordinate: HERE } },
  );
  assert.equal(state.status, "idle");
  assert.equal(isFollowing(state), false);
  assert.equal(state.coordinate, null, "a cancelled request must not record a position");
});

test("D4: a gesture while idle changes nothing", () => {
  assert.equal(followReducer(INITIAL_FOLLOW_STATE, { type: "userGesture" }), INITIAL_FOLLOW_STATE);
});

// ----------------------------------------------------- the failure states

test("D4: a refused permission is its own state, with its own message", () => {
  const state = run({ type: "recenterPressed" }, { type: "locationResolved", outcome: { kind: "denied" } });
  assert.equal(state.status, "denied");
  assert.match(followMessage(state) ?? "", /permission/i);
  assert.match(followMessage(state) ?? "", /Settings/i, "the user must be told what to do");
  assert.equal(isFollowing(state), false);
  assert.equal(isLocating(state), false, "the spinner must stop");
});

test("D4: location services being off is distinct from permission being refused", () => {
  const state = run(
    { type: "recenterPressed" },
    { type: "locationResolved", outcome: { kind: "servicesDisabled" } },
  );
  assert.equal(state.status, "disabled");
  assert.notEqual(followMessage(state), followMessage(run(
    { type: "recenterPressed" },
    { type: "locationResolved", outcome: { kind: "denied" } },
  )));
});

test("D4: a failed fix is recoverable — pressing again retries", () => {
  const failed = run(
    { type: "recenterPressed" },
    { type: "locationResolved", outcome: { kind: "unavailable", reason: "timeout" } },
  );
  assert.equal(failed.status, "unavailable");
  const retry = followReducer(failed, { type: "recenterPressed" });
  assert.equal(retry.status, "locating");
  assert.equal(followMessage(retry), null, "the stale error must clear on retry");
});

test("D4: reset returns to idle without discarding the last known position", () => {
  const following = run(
    { type: "recenterPressed" },
    { type: "locationResolved", outcome: { kind: "fix", coordinate: HERE } },
  );
  const reset = followReducer(following, { type: "reset" });
  assert.equal(reset.status, "idle");
  assert.deepEqual(reset.coordinate, HERE);
});

// ---------------------------------------------------- accessible labelling

test("D4: the label never promises what the state cannot deliver", () => {
  const labels: Record<string, string> = {
    idle: followLabel(INITIAL_FOLLOW_STATE),
    locating: followLabel(run({ type: "recenterPressed" })),
    following: followLabel(
      run({ type: "recenterPressed" }, { type: "locationResolved", outcome: { kind: "fix", coordinate: HERE } }),
    ),
    denied: followLabel(run({ type: "recenterPressed" }, { type: "locationResolved", outcome: { kind: "denied" } })),
    disabled: followLabel(
      run({ type: "recenterPressed" }, { type: "locationResolved", outcome: { kind: "servicesDisabled" } }),
    ),
    unavailable: followLabel(
      run({ type: "recenterPressed" }, { type: "locationResolved", outcome: { kind: "unavailable" } }),
    ),
  };

  // Every state says something different.
  assert.equal(new Set(Object.values(labels)).size, 6);
  // And each one is honest about what a press will do.
  assert.match(labels.idle, /my location/i);
  assert.match(labels.locating, /finding/i);
  assert.match(labels.following, /following/i);
  assert.match(labels.following, /pan/i, "the user must be told how to stop following");
  assert.match(labels.denied, /denied/i);
  assert.match(labels.disabled, /off/i);
  assert.match(labels.unavailable, /unavailable/i);
  for (const label of Object.values(labels)) {
    assert.ok(label.length > 8 && !label.endsWith(" "), `a poor label: "${label}"`);
  }
});

// ------------------------------------------------------- the location adapter

function backend(overrides: Partial<LocationBackend> = {}): LocationBackend {
  return {
    async hasServicesEnabledAsync() {
      return true;
    },
    async getForegroundPermissionsAsync() {
      return { status: "granted" };
    },
    async requestForegroundPermissionsAsync() {
      return { status: "granted" };
    },
    async getCurrentPositionAsync() {
      return { coords: { longitude: HERE[0], latitude: HERE[1] } };
    },
    ...overrides,
  };
}

test("D4: a granted permission returns the device coordinate", async () => {
  const outcome = await requestDeviceLocation(backend());
  assert.deepEqual(outcome, { kind: "fix", coordinate: HERE });
});

test("D4: location services off is reported before any permission prompt", async () => {
  let prompted = false;
  const outcome = await requestDeviceLocation(
    backend({
      async hasServicesEnabledAsync() {
        return false;
      },
      async requestForegroundPermissionsAsync() {
        prompted = true;
        return { status: "granted" };
      },
    }),
  );
  assert.deepEqual(outcome, { kind: "servicesDisabled" });
  assert.equal(prompted, false, "prompting for permission with the radio off is pointless");
});

test("D4: an undetermined permission is requested once, then used", async () => {
  let requests = 0;
  const outcome = await requestDeviceLocation(
    backend({
      async getForegroundPermissionsAsync() {
        return { status: "undetermined" };
      },
      async requestForegroundPermissionsAsync() {
        requests += 1;
        return { status: "granted" };
      },
    }),
  );
  assert.deepEqual(outcome, { kind: "fix", coordinate: HERE });
  assert.equal(requests, 1);
});

test("D4: a permanently denied permission is not re-prompted", async () => {
  let prompted = false;
  const outcome = await requestDeviceLocation(
    backend({
      async getForegroundPermissionsAsync() {
        return { status: "denied", canAskAgain: false };
      },
      async requestForegroundPermissionsAsync() {
        prompted = true;
        return { status: "denied" };
      },
    }),
  );
  assert.deepEqual(outcome, { kind: "denied" });
  assert.equal(prompted, false, "re-requesting a permanently denied permission just nags");
});

test("D4: a refused request is reported as denied, not as a failure", async () => {
  const outcome = await requestDeviceLocation(
    backend({
      async getForegroundPermissionsAsync() {
        return { status: "undetermined" };
      },
      async requestForegroundPermissionsAsync() {
        return { status: "denied" };
      },
    }),
  );
  assert.deepEqual(outcome, { kind: "denied" });
});

test("D4: a hardware failure is `unavailable`, never a thrown error", async () => {
  const outcome = await requestDeviceLocation(
    backend({
      async getCurrentPositionAsync() {
        throw new Error("location provider unavailable");
      },
    }),
  );
  assert.equal(outcome.kind, "unavailable");
});

test("D4: a nonsense fix is rejected rather than moving the camera to null island", async () => {
  const outcome = await requestDeviceLocation(
    backend({
      async getCurrentPositionAsync() {
        return { coords: { longitude: NaN, latitude: NaN } };
      },
    }),
  );
  assert.deepEqual(outcome, { kind: "unavailable", reason: "invalidFix" });
});

test("D4: a hung fix times out instead of spinning forever", async () => {
  const outcome = await requestDeviceLocation(
    backend({
      getCurrentPositionAsync() {
        return new Promise(() => {});
      },
    }),
    30,
  );
  assert.deepEqual(outcome, { kind: "unavailable", reason: "timeout" });
});

test("D4: an unreadable services check does not blame the user's settings", async () => {
  const outcome = await requestDeviceLocation(
    backend({
      async hasServicesEnabledAsync() {
        throw new Error("not implemented on this platform");
      },
    }),
  );
  assert.deepEqual(outcome, { kind: "fix", coordinate: HERE }, "it must try anyway");
});

// --------------------------------------------------------- source-level guards

const LIVE_MAP = readFileSync(join(process.cwd(), "app", "territory", "live-map.tsx"), "utf8");

test("D4: the recentre control no longer centres on the last fetched viewport", () => {
  // The exact defect: averaging the viewport bounds and calling that "my
  // location".
  assert.ok(
    !/recenter\(\[\s*\(centre\.west/.test(LIVE_MAP),
    "the viewport-centre recentre must be gone",
  );
  assert.ok(LIVE_MAP.includes("getCurrentLocation"), "recentre must ask the device");
});

test("D4: the screen binds follow mode and the gesture handler to the map", () => {
  assert.match(LIVE_MAP, /followUser=\{isFollowing\(follow\)\}/);
  assert.match(LIVE_MAP, /onUserGesture=\{onUserGesture\}/);
  assert.match(LIVE_MAP, /accessibilityLabel=\{followLabel\(follow\)\}/);
  assert.match(LIVE_MAP, /busy=\{isLocating\(follow\)\}/);
});

test("D4: the map only treats a real user interaction as a gesture", () => {
  const map = readFileSync(
    join(process.cwd(), "src", "components", "map", "MovenRunMap.tsx"),
    "utf8",
  );
  // Without the isUserInteraction check, `recenter` would report a gesture and
  // immediately cancel its own follow.
  assert.match(map, /isUserInteraction\s*\)\s*onUserGesture/);
});

test("D4: the device fix is used for the camera and nothing else", () => {
  const adapter = [
    readFileSync(join(process.cwd(), "src", "services", "location", "currentLocation.ts"), "utf8"),
    readFileSync(join(process.cwd(), "src", "lib", "territory", "deviceLocation.ts"), "utf8"),
  ].join("\n");
  const code = adapter.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const forbidden of ["fetch(", "AsyncStorage", "console.log", "SecureStore"]) {
    assert.ok(!code.includes(forbidden), `a one-shot fix must not reach ${forbidden}`);
  }
  // And the screen does not persist it either.
  const screen = LIVE_MAP.replace(/\/\*\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/coordinate[\s\S]{0,40}(AsyncStorage|setItem|fetch\()/.test(screen));
});
