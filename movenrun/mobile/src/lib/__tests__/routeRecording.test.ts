/**
 * Sample classification and bounded local storage — offline, no Expo runtime.
 *
 * Two invariants matter most here:
 *
 *  1. A client-rejected sample is *labelled*, never deleted. The server needs
 *     the full raw evidence to recompute distance/cells/closure and to detect
 *     fabricated routes.
 *  2. Local storage is bounded. One write per full chunk, uploaded chunks
 *     removed, and a hard session ceiling past which recording continues in
 *     memory but persistence stops.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyRouteSample,
  gpsQuality,
  isValidCoordinate,
  sampleDistanceMeters,
  summarizeRoute,
  type ClassifiedSample,
  type RouteSample,
} from "../geo/routeSample";
import {
  activeDurationMs,
  chunkKey,
  createSession,
  CHUNK_SIZE,
  isRecoverable,
  markChunksUploaded,
  MAX_PENDING_CHUNKS,
  MAX_SESSION_SAMPLES,
  parseChunkKey,
  pauseSession,
  planBufferFlush,
  resumeSession,
} from "../geo/runStorage";

function sample(overrides: Partial<RouteSample> = {}): RouteSample {
  return {
    latitude: 51.5,
    longitude: -0.1,
    timestamp: 1_700_000_000_000,
    accuracy: 8,
    altitude: null,
    altitudeAccuracy: null,
    speed: null,
    heading: null,
    mocked: null,
    ...overrides,
  };
}

function classified(count: number): ClassifiedSample[] {
  return Array.from({ length: count }, (_, i) => ({
    sample: sample({ timestamp: 1_700_000_000_000 + i * 1000 }),
    decision: "accepted" as const,
    reasons: [],
  }));
}

// ------------------------------------------------------------ classification

test("the first valid sample of a session is accepted", () => {
  const result = classifyRouteSample(null, sample());
  assert.equal(result.decision, "accepted");
  assert.deepEqual(result.reasons, []);
});

test("an out-of-range coordinate is rejected and short-circuits other checks", () => {
  const result = classifyRouteSample(null, sample({ latitude: 120 }));
  assert.equal(result.decision, "rejected");
  assert.deepEqual(result.reasons, ["invalidCoordinate"]);
});

test("poor accuracy is flagged", () => {
  const result = classifyRouteSample(null, sample({ accuracy: 120 }));
  assert.equal(result.decision, "rejected");
  assert.ok(result.reasons.includes("poorAccuracy"));
});

test("a backwards timestamp is flagged", () => {
  const previous = sample({ timestamp: 2000, latitude: 51.5 });
  const next = sample({ timestamp: 1000, latitude: 51.5005 });
  const result = classifyRouteSample(previous, next);
  assert.ok(result.reasons.includes("timestampReversal"));
});

test("a teleport is flagged as impossible speed", () => {
  const previous = sample({ timestamp: 0 });
  // ~11 km away one second later.
  const next = sample({ timestamp: 1000, latitude: 51.6 });
  const result = classifyRouteSample(previous, next);
  assert.ok(result.reasons.includes("impossibleSpeed"));
});

test("standing still is flagged as a duplicate point, not as movement", () => {
  const previous = sample({ timestamp: 0 });
  const next = sample({ timestamp: 2000 });
  const result = classifyRouteSample(previous, next);
  assert.equal(result.decision, "rejected");
  assert.ok(result.reasons.includes("duplicatePoint"));
});

test("a rejected sample keeps its raw payload intact — evidence is never destroyed", () => {
  const raw = sample({ latitude: 51.5, accuracy: 300, altitude: 12, speed: 3.2, mocked: true });
  const result = classifyRouteSample(null, raw);
  assert.equal(result.decision, "rejected");
  assert.deepEqual(result.sample, raw, "the raw sample must survive rejection unchanged");
});

test("summary counts raw and accepted separately and surfaces the mocked flag", () => {
  const entries: ClassifiedSample[] = [
    { sample: sample({ timestamp: 0, latitude: 51.5 }), decision: "accepted", reasons: [] },
    { sample: sample({ timestamp: 1000, accuracy: 300, mocked: true }), decision: "rejected", reasons: ["poorAccuracy"] },
    { sample: sample({ timestamp: 60_000, latitude: 51.51 }), decision: "accepted", reasons: [] },
  ];
  const summary = summarizeRoute(entries);
  assert.equal(summary.rawCount, 3);
  assert.equal(summary.acceptedCount, 2);
  assert.equal(summary.durationMs, 60_000);
  assert.ok(summary.distanceMeters > 1000);
  assert.equal(summary.sawMockedLocation, true, "a mocked raw sample must still be reported");
});

test("distance is haversine, symmetric, and zero for identical points", () => {
  const a = { latitude: 51.5, longitude: -0.1 };
  const b = { latitude: 51.51, longitude: -0.1 };
  assert.equal(sampleDistanceMeters(a, a), 0);
  assert.equal(
    Math.round(sampleDistanceMeters(a, b)),
    Math.round(sampleDistanceMeters(b, a)),
  );
});

test("gps quality reflects accuracy and starts at waiting", () => {
  assert.equal(gpsQuality(null), "waiting");
  assert.equal(gpsQuality(sample({ accuracy: 5 })), "strong");
  assert.equal(gpsQuality(sample({ accuracy: 25 })), "fair");
  assert.equal(gpsQuality(sample({ accuracy: 90 })), "weak");
  assert.equal(gpsQuality(sample({ accuracy: null })), "fair");
});

test("coordinate validation is shared between geo modules", () => {
  assert.ok(isValidCoordinate(0, 0));
  assert.ok(!isValidCoordinate(0, 200));
});

// -------------------------------------------------------------- storage plan

test("nothing is persisted until a whole chunk has accumulated", () => {
  const session = createSession("run-1", 1000);
  const plan = planBufferFlush(session, [], classified(CHUNK_SIZE - 1));
  assert.deepEqual(plan.chunksToWrite, []);
  assert.equal(plan.remainingBuffer.length, CHUNK_SIZE - 1);
  assert.equal(plan.session.recordedCount, CHUNK_SIZE - 1);
  assert.equal(plan.session.persistedCount, 0);
});

test("a full buffer is written as exactly one chunk", () => {
  const session = createSession("run-1", 1000);
  const plan = planBufferFlush(session, [], classified(CHUNK_SIZE));
  assert.equal(plan.chunksToWrite.length, 1);
  assert.equal(plan.chunksToWrite[0].index, 0);
  assert.equal(plan.chunksToWrite[0].samples.length, CHUNK_SIZE);
  assert.deepEqual(plan.remainingBuffer, []);
  assert.deepEqual(plan.session.pendingChunkIndexes, [0]);
});

test("a large batch splits into whole chunks and keeps the remainder buffered", () => {
  const session = createSession("run-1", 1000);
  const plan = planBufferFlush(session, [], classified(CHUNK_SIZE * 2 + 7));
  assert.equal(plan.chunksToWrite.length, 2);
  assert.deepEqual(
    plan.chunksToWrite.map((c) => c.index),
    [0, 1],
  );
  assert.equal(plan.remainingBuffer.length, 7);
  assert.equal(plan.session.persistedCount, CHUNK_SIZE * 2);
});

test("chunk indexes continue across successive flushes", () => {
  let session = createSession("run-1", 1000);
  let plan = planBufferFlush(session, [], classified(CHUNK_SIZE));
  session = plan.session;
  plan = planBufferFlush(session, plan.remainingBuffer, classified(CHUNK_SIZE));
  assert.equal(plan.chunksToWrite[0].index, 1);
  assert.deepEqual(plan.session.pendingChunkIndexes, [0, 1]);
});

test("persistence stops at the session ceiling but recording keeps counting", () => {
  let session = createSession("run-1", 1000);
  session = {
    ...session,
    persistedCount: MAX_SESSION_SAMPLES,
    lastChunkIndex: MAX_SESSION_SAMPLES / CHUNK_SIZE - 1,
  };
  const plan = planBufferFlush(session, [], classified(CHUNK_SIZE * 3));
  assert.deepEqual(plan.chunksToWrite, [], "must not persist past the ceiling");
  assert.equal(plan.session.truncated, true);
  assert.equal(
    plan.session.recordedCount,
    CHUNK_SIZE * 3,
    "recording still counts every sample",
  );
  assert.ok(
    plan.remainingBuffer.length <= CHUNK_SIZE,
    "the in-memory buffer stays bounded once truncated",
  );
});

test("an unsynced backlog drops the oldest chunks rather than growing forever", () => {
  let session = createSession("run-1", 1000);
  // Fill the pending list to the cap.
  for (let i = 0; i < MAX_PENDING_CHUNKS; i++) {
    const plan = planBufferFlush(session, [], classified(CHUNK_SIZE));
    session = plan.session;
  }
  assert.equal(session.pendingChunkIndexes.length, MAX_PENDING_CHUNKS);

  const plan = planBufferFlush(session, [], classified(CHUNK_SIZE));
  assert.equal(plan.session.pendingChunkIndexes.length, MAX_PENDING_CHUNKS);
  assert.deepEqual(plan.chunkIndexesToDrop, [0], "the oldest chunk is dropped");
  assert.equal(plan.session.truncated, true);
});

test("uploaded chunks leave the pending list", () => {
  let session = createSession("run-1", 1000);
  session = planBufferFlush(session, [], classified(CHUNK_SIZE * 3)).session;
  assert.deepEqual(session.pendingChunkIndexes, [0, 1, 2]);
  session = markChunksUploaded(session, [0, 1]);
  assert.deepEqual(session.pendingChunkIndexes, [2]);
});

test("chunk keys round-trip, including session ids containing dots", () => {
  assert.equal(chunkKey("run-1", 4), "movenrun.run.chunk.run-1.4");
  assert.deepEqual(parseChunkKey("movenrun.run.chunk.run-1.4"), {
    sessionId: "run-1",
    index: 4,
  });
  assert.deepEqual(parseChunkKey("movenrun.run.chunk.run.a.b.12"), {
    sessionId: "run.a.b",
    index: 12,
  });
  assert.equal(parseChunkKey("movenrun.run.session"), null);
  assert.equal(parseChunkKey("movenrun.run.chunk.run-1.notanumber"), null);
});

// ------------------------------------------------------------ pause / resume

test("paused time is excluded from the active duration", () => {
  let session = createSession("run-1", 0);
  assert.equal(activeDurationMs(session, 10_000), 10_000);

  session = pauseSession(session, 10_000);
  // Still paused at t=30s: duration frozen at the moment of the pause.
  assert.equal(activeDurationMs(session, 30_000), 10_000);

  session = resumeSession(session, 30_000);
  assert.equal(session.pausedMs, 20_000);
  assert.equal(activeDurationMs(session, 40_000), 20_000);
});

test("pause and resume are idempotent in the wrong state", () => {
  const session = createSession("run-1", 0);
  assert.equal(resumeSession(session, 5_000), session, "resuming a live run is a no-op");
  const paused = pauseSession(session, 5_000);
  assert.equal(pauseSession(paused, 9_000), paused, "pausing twice is a no-op");
});

test("only a session with persisted evidence is worth recovering", () => {
  const fresh = createSession("run-1", 0);
  assert.equal(isRecoverable(fresh), false);
  const withChunks = planBufferFlush(fresh, [], classified(CHUNK_SIZE)).session;
  assert.equal(isRecoverable(withChunks), true);
});
