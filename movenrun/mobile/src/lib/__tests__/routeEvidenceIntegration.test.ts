import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateSealing } from "@movenrun/shared/sealing";
import { evidenceDistance } from "@movenrun/shared/evidence";
import { createSealPreview, sealFinishedRoute } from "../sealPreview";
import * as lifecycle from "../sessionLifecycle";
import { acceptPoint, type TrackPoint } from "../geo";
import { pushPoint, MAX_STORED_POINTS } from "../trackPoints";
import { toSubmission } from "../movementVerification";
import { buildPendingItem, parseQueue, serializeQueue } from "../pendingVerification";

const T = 1_756_000_000_000;
const point = (x: number, y: number, index: number): TrackPoint => ({
  latitude: 12.9716 + y / 111320,
  longitude: 77.5946 + x / (111320 * Math.cos(12.9716 * Math.PI / 180)),
  accuracy: 8, timestamp: T + index * 10_000,
});
const lasso = [[0, 0], [0, 60], [60, 60], [60, 30], [-30, 30]];
const route = () => lasso.map(([x, y], index) => point(x, y, index));

test("immutable Start, route, Pause, Resume, crossing has live/final break parity", () => {
  let current = lifecycle.trackerStarted(lifecycle.requestStart(lifecycle.idleLifecycle()).lifecycle,
    { clientSessionId: "evidence-pause-test", at: T - 1000 }).lifecycle;
  const initialPauses = current.pauses;
  const preview = createSealPreview(1, () => current.pauses)!;
  const points = route();
  points.slice(0, 4).forEach((p) => preview.push(p));
  current = lifecycle.pause(current, T + 31000).lifecycle;
  current = lifecycle.resume(current, T + 39000).lifecycle;
  preview.push(points[4]!);
  current = lifecycle.finish(current, T + 41000).lifecycle;
  const session = lifecycle.sessionMetadata(current)!;
  assert.notEqual(current.pauses, initialPauses, "lifecycle must remain immutable");
  assert.equal(preview.preview.sealedLoops, 0, "the scanner must not retain the old array");
  const final = evaluateSealing({ points: preview.snapshot(), session });
  assert.equal(final.events.filter((event) => event.method === "self_cross").length, 0);
  assert.ok(Math.abs(preview.distanceMeters - evidenceDistance(points, session.pauses)) < 1e-8);
});

for (const count of [2047, 2048, 2049, 5000, 10000]) {
  test(`${count} accepted fixes use canonical evidence independently of display thinning`, () => {
    const preview = createSealPreview(1)!;
    const display: TrackPoint[] = [];
    let previous: TrackPoint | null = null;
    for (let index = 0; index < count; index++) {
      const p = index < lasso.length ? point(...lasso[index]! as [number, number], index) :
        point(-30 - (index - 4) * 3, 30, index);
      assert.equal(acceptPoint(previous, p), true);
      pushPoint(display, p);
      preview.push(p);
      previous = p;
    }
    assert.ok(display.length <= MAX_STORED_POINTS);
    assert.equal(preview.evidenceStatus, "complete");
    assert.equal(preview.preview.sealedLoops, 1);
    const points = preview.snapshot();
    const session = { mode: "onFoot" as const, rulesVersion: 1, startedAt: T - 1000,
      finishedAt: T + count * 10000, pauses: [] };
    const final = sealFinishedRoute({ points, session });
    assert.equal(final?.loops, 1, "a displayed loop cannot vanish in the submitted route");
    assert.ok(Math.abs(preview.distanceMeters - evidenceDistance(points)) < 1e-6);
  });
}

test("a foreground gap survives production submission mapping and durable retry unchanged", () => {
  const points = route();
  points[4] = { ...points[4]!, breakBefore: true };
  const preview = createSealPreview(1)!;
  points.forEach((p) => preview.push(p));
  assert.equal(preview.preview.sealedLoops, 0);
  const submission = toSubmission({ points: preview.snapshot(), durationMs: 50000, finishedAt: T + 50000,
    session: { mode: "onFoot", rulesVersion: 1, startedAt: T, finishedAt: T + 50000, pauses: [] } });
  assert.equal(submission.observations.points[4]!.breakBefore, true);
  const item = buildPendingItem({ ...submission, clientSessionId: "evidence-gap-retry", ownerUserId: "owner-a",
    reason: "offline", now: T + 60000 });
  const restored = parseQueue(serializeQueue([item]));
  assert.deepEqual(restored[0], item);
  assert.equal(serializeQueue(restored), serializeQueue([item]));
  const corrupt = JSON.parse(serializeQueue([item]));
  corrupt.items[0].observations.points[4].breakBefore = "true";
  assert.deepEqual(parseQueue(JSON.stringify(corrupt)), []);
});

test("evidence disposal erases geometry and stale callbacks cannot refill it", () => {
  const preview = createSealPreview(1)!;
  route().forEach((p) => preview.push(p));
  assert.equal(preview.preview.sealedLoops, 1);
  preview.clear();
  route().forEach((p) => preview.push(p));
  assert.deepEqual(preview.snapshot(), []);
  assert.equal(preview.distanceMeters, 0);
  assert.equal(preview.preview.sealedLoops, 0);
});
