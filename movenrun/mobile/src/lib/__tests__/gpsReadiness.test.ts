import test from "node:test";
import assert from "node:assert/strict";
import { AcquiredForegroundWatch } from "../acquiredForegroundWatch";
import { acquisitionFixState, acquisitionLabel, createGpsTimings } from "../gpsAcquisitionState";
import type { TrackPoint } from "../geo";

const epoch = 1_700_000_000_000;
const point = (offset: number, accuracy: number | null = 5): TrackPoint => ({ latitude: 26, longitude: 91,
  timestamp: epoch + offset, accuracy });

test("received poor or unknown fixes improve GPS without pretending readiness", () => {
  assert.equal(acquisitionLabel("locating"), "Finding GPS");
  for (const accuracy of [null, 40, 21]) assert.equal(acquisitionFixState(point(0, accuracy), epoch), "improving");
  assert.equal(acquisitionFixState(point(0), epoch), "evaluating");
  assert.equal(acquisitionFixState(point(0), epoch + 60_000), "improving");
  assert.equal(acquisitionLabel("improving"), "Improving GPS…");
});

test("accepted burst starts promptly without waiting for replacement watch and retains continuity", async () => {
  let now = epoch;
  const callbacks: Array<(p: TrackPoint) => void> = [];
  let completeReplacement!: (sub: {remove(): void}) => void;
  let removedAcquisition = 0, removedSession = 0;
  const states: string[] = [], delivered: TrackPoint[] = [];
  const watch = new AcquiredForegroundWatch({ now: () => now, watch: async (acquiring, callback) => {
    callbacks.push(callback);
    if (acquiring) return { remove() { removedAcquisition++; } };
    return new Promise(resolve => { completeReplacement = resolve; });
  } });
  let ready = false;
  const started = watch.start(p => delivered.push(p), undefined, s => states.push(s)).then(() => { ready = true; });
  await Promise.resolve();
  callbacks[0](point(0, 60));
  assert.equal(states.at(-1), "improving");
  callbacks[0](point(0));
  now = epoch + 4000; callbacks[0](point(4000));
  await Promise.resolve();
  assert.equal(ready, false, "one/two fixes cannot bypass the three-fix eight-second policy");
  now = epoch + 8000; callbacks[0](point(8000));
  await Promise.resolve();
  assert.equal(ready, true, "already active acquisition watch must not wait for native re-registration");
  await started;
  assert.equal(states.at(-1), "ready");
  assert.equal(delivered.length, 0, "warm-up evidence must not enter a session");
  callbacks[0](point(9000));
  assert.equal(delivered.length, 1, "keep foreground continuity while replacement attaches");
  completeReplacement({remove() { removedSession++; }});
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(removedAcquisition, 1);
  callbacks[0](point(10000));
  assert.equal(delivered.length, 1, "old watch cannot deliver after replacement");
  callbacks[1](point(10000));
  assert.equal(delivered.length, 2);
  watch.stop();
  assert.equal(removedSession, 1);
  callbacks[1](point(11000));
  assert.equal(delivered.length, 2);
});

test("cancellation removes subscriptions that resolve late and never announces ready", async () => {
  let attach!: (sub: {remove(): void}) => void;
  let callback!: (p: TrackPoint) => void;
  let removed = 0;
  const states: string[] = [];
  const watch = new AcquiredForegroundWatch({watch: async (_, cb) => {
    callback = cb; return new Promise(resolve => { attach = resolve; });
  }});
  const result = watch.start(() => assert.fail("cancelled fix"), undefined, state => states.push(state));
  watch.stop();
  await assert.rejects(result, /cancelled/);
  attach({remove() { removed++; }});
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  callback(point(0));
  assert.equal(removed, 1);
  assert.deepEqual(states, ["locating"]);
});

test("GPS timing probe holds only bounded durations and is inert outside development", () => {
  let now = 0;
  const timing = createGpsTimings(true, () => now);
  timing.permission(); now = 100; timing.state("improving"); now = 8100; timing.state("ready"); now = 8110; timing.live();
  assert.deepEqual(timing.snapshot(), {permissionToFirstFixMs: 100, firstToAcceptedFixMs: 8000, acceptedToLiveUiMs: 10});
  const production = createGpsTimings(false, () => now);
  production.permission(); production.state("ready"); production.live();
  assert.deepEqual(production.snapshot(), {permissionToFirstFixMs: null, firstToAcceptedFixMs: null, acceptedToLiveUiMs: null});
});
