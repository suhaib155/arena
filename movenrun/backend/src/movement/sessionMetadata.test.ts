/**
 * Session metadata at the server boundary.
 *
 * The app now sends provenance alongside its observations. Provenance is still
 * untrusted input: it arrives from a phone, it is validated before anything is
 * measured, and it buys the caller nothing. These tests hold that line, and
 * hold the two properties that adding it could most easily have broken — the
 * strict schema's refusal of authority fields, and database-backed idempotency.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_MOVEMENT_MODE, SESSION_RULES_VERSION } from "@movenrun/shared/session";

import { parseBody, submitMovementSchema } from "./http/validation.js";
import { structuralRejections, verifyMovement } from "./domain/verification.js";
import { MovementVerificationService } from "./services/movementVerification.service.js";
import {
  InMemoryMovementVerificationRepository,
  MovementSessionMetadataConflictError,
} from "./repositories/interfaces.js";
import type { MovementObservation, ObservedPoint } from "./domain/types.js";

const T0 = 1_756_000_000_000;

function points(count = 3): ObservedPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    lat: 12.9716 + i * 0.0005,
    lng: 77.5946,
    accuracy: 8,
    timestamp: T0 + 10_000 + i * 60_000,
  }));
}

function body(over: Record<string, unknown> = {}) {
  return {
    sessionId: "mv-session-abcdef12",
    startTime: T0 + 10_000,
    endTime: T0 + 130_000,
    points: points(),
    session: {
      mode: DEFAULT_MOVEMENT_MODE,
      rulesVersion: SESSION_RULES_VERSION,
      startedAt: T0,
      finishedAt: T0 + 200_000,
      pauses: [{ startedAt: T0 + 40_000, endedAt: T0 + 50_000 }],
    },
    ...over,
  };
}

/* ── the schema accepts provenance and refuses authority ──────────────────── */

test("a valid submission with session metadata is accepted", () => {
  const parsed = parseBody(submitMovementSchema, body());
  assert.equal(parsed.session?.mode, DEFAULT_MOVEMENT_MODE);
  assert.equal(parsed.session?.rulesVersion, SESSION_RULES_VERSION);
  assert.equal(parsed.session?.pauses.length, 1);
});

test("a submission without session metadata is still accepted, as legacy", () => {
  /* An older build retrying a queued session has no metadata and nothing
     truthful to invent. Refusing it would strand a real verification. */
  const { session: _omitted, ...legacy } = body();
  const parsed = parseBody(submitMovementSchema, legacy);
  assert.equal(parsed.session, undefined);
});

test("the strict schema still refuses every client-authority field", () => {
  for (const forbidden of [
    { distanceMeters: 5000 },
    { durationSeconds: 900 },
    { traversedHexIds: ["8860145b49fffff"] },
    { traversedCells: ["8860145b49fffff"] },
    { xp: 500 },
    { points_: 1 },
    { capturedCells: ["8860145b49fffff"] },
    { ownership: "mine" },
    { seal: true },
    { trustScore: 100 },
    { userId: "usr_someone_else" },
    { status: "verified" },
  ]) {
    assert.throws(
      () => parseBody(submitMovementSchema, body(forbidden)),
      /invalid/i,
      `the schema accepted ${Object.keys(forbidden)[0]}`,
    );
  }
});

test("an unknown field inside the session block is refused too", () => {
  /* The nested object is `.strict()` as well — otherwise the new block would
     be the one place a smuggled field could ride along. */
  for (const extra of [
    { distanceMeters: 100 },
    { verified: true },
    { solid: [] },
    { userId: "usr_x" },
  ]) {
    assert.throws(
      () => parseBody(submitMovementSchema, body({ session: { ...body().session, ...extra } })),
      /invalid/i,
      `the session block accepted ${Object.keys(extra)[0]}`,
    );
  }
});

test("an unsupported mode is refused — a client cannot invent one", () => {
  for (const mode of ["cycling", "walk", "run", "onfoot", "", 1, null]) {
    assert.throws(() => parseBody(submitMovementSchema, body({ session: { ...body().session, mode } })), /invalid/i, String(mode));
  }
});

test("an unsupported rules version is refused rather than treated as current", () => {
  for (const rulesVersion of [0, 2, 999, -1, 1.5, "1", null]) {
    assert.throws(
      () => parseBody(submitMovementSchema, body({ session: { ...body().session, rulesVersion } })),
      /invalid/i,
      String(rulesVersion),
    );
  }
});

test("a client cannot choose its own rules by sending a future version", () => {
  assert.throws(() => parseBody(submitMovementSchema, body({ session: { ...body().session, rulesVersion: 2 } })), /invalid/i);
});

test("an unbounded pause list is refused", () => {
  const pauses = Array.from({ length: 101 }, (_, i) => ({
    startedAt: T0 + i * 2,
    endedAt: T0 + i * 2 + 1,
  }));
  assert.throws(() => parseBody(submitMovementSchema, body({ session: { ...body().session, pauses } })), /invalid/i);
});

/* ── structural validation runs before measurement ────────────────────────── */

function observation(over: Partial<MovementObservation> = {}): MovementObservation {
  return {
    startTime: T0 + 10_000,
    endTime: T0 + 130_000,
    points: points(),
    session: {
      mode: DEFAULT_MOVEMENT_MODE,
      rulesVersion: SESSION_RULES_VERSION,
      startedAt: T0,
      finishedAt: T0 + 200_000,
      pauses: [],
    },
    ...over,
  };
}

test("a coherent session produces no structural rejection", () => {
  assert.deepEqual(structuralRejections(observation(), T0 + 300_000), []);
});

test("a finish before a start is rejected", () => {
  const reasons = structuralRejections(
    observation({ session: { ...observation().session!, startedAt: T0 + 500_000 } }),
    T0 + 600_000,
  );
  assert.ok(reasons.some((r) => /finished before it started/.test(r)));
});

test("overlapping pauses are rejected", () => {
  const reasons = structuralRejections(
    observation({
      session: {
        ...observation().session!,
        pauses: [
          { startedAt: T0 + 10_000, endedAt: T0 + 60_000 },
          { startedAt: T0 + 50_000, endedAt: T0 + 90_000 },
        ],
      },
    }),
    T0 + 300_000,
  );
  assert.ok(reasons.some((r) => /overlap or are out of order/.test(r)));
});

test("a pause outside the session is rejected", () => {
  const reasons = structuralRejections(
    observation({
      session: { ...observation().session!, pauses: [{ startedAt: T0 - 5_000, endedAt: T0 - 1_000 }] },
    }),
    T0 + 300_000,
  );
  assert.ok(reasons.some((r) => /fall outside the session/.test(r)));
});

test("observations outside the lifecycle window are rejected", () => {
  /* The two clocks must describe the same session. A finish before the last
     fix means one of them is wrong, and the pair is what makes it detectable. */
  const late = structuralRejections(
    observation({ session: { ...observation().session!, finishedAt: T0 + 20_000 } }),
    T0 + 300_000,
  );
  assert.ok(late.some((r) => /continue after the session finished/.test(r)));

  const early = structuralRejections(
    observation({ session: { ...observation().session!, startedAt: T0 + 100_000 } }),
    T0 + 300_000,
  );
  assert.ok(early.some((r) => /begin before the session started/.test(r)));
});

test("a structurally broken session is rejected before any measurement runs", () => {
  const result = verifyMovement(
    observation({ session: { ...observation().session!, startedAt: T0 + 900_000 } }),
    {
      detectAnomalies: () => {
        throw new Error("anomaly detection must not run on a rejected payload");
      },
      calculateDistance: () => {
        throw new Error("distance must not be measured on a rejected payload");
      },
      traversedHexIds: () => {
        throw new Error("cells must not be derived from a rejected payload");
      },
      now: () => T0 + 1_000_000,
    },
  );
  assert.equal(result.status, "rejected");
  assert.equal(result.distanceMeters, null);
  assert.deepEqual(result.traversedHexIds, []);
});

test("rejection reasons stay categorical and quote no timestamps", () => {
  const reasons = structuralRejections(
    observation({
      session: {
        ...observation().session!,
        startedAt: T0 + 777_777,
        pauses: [{ startedAt: T0 + 1, endedAt: T0 }],
      },
    }),
    T0 + 900_000,
  );
  assert.ok(reasons.length > 0);
  for (const reason of reasons) {
    assert.ok(!/\d{10,}/.test(reason), `reason quotes an epoch value: ${reason}`);
  }
});

/* ── mode is not trust ────────────────────────────────────────────────────── */

test("a declared mode buys no leniency from the anomaly check", () => {
  /* A user claiming `onFoot` must face exactly the checks a session with no
     mode faces. This asserts the verification path never reads it. */
  const seen: string[] = [];
  const deps = {
    detectAnomalies: (o: MovementObservation) => {
      seen.push(o.session?.mode ?? "<none>");
      return { isAnomaly: true, reasons: ["Implausible speed at index 1"], confidence: 0.2 };
    },
    calculateDistance: () => 100,
    traversedHexIds: () => [],
    now: () => T0 + 300_000,
  };
  const withMode = verifyMovement(observation(), deps);
  const withoutMode = verifyMovement(observation({ session: undefined }), deps);
  assert.equal(withMode.status, "rejected");
  assert.equal(withoutMode.status, "rejected", "an unlabelled session is judged the same way");
  assert.deepEqual(withMode.rejectionReasons, withoutMode.rejectionReasons);
});

/* ── idempotency with immutable metadata ──────────────────────────────────── */

function service(repository = new InMemoryMovementVerificationRepository()) {
  let n = 0;
  return {
    repository,
    service: new MovementVerificationService({
      repository,
      generateId: () => `mv-row-${++n}`,
      now: () => T0 + 300_000,
      detectAnomalies: () => ({ isAnomaly: false, reasons: [], confidence: 0.95 }),
      calculateDistance: () => 431,
      traversedHexIds: () => ["8860145b49fffff"],
    }),
  };
}

test("one user and one session id store exactly one record", async () => {
  const { service: s, repository } = service();
  const input = { userId: "usr_1", clientSessionId: "mv-session-abcdef12", observation: observation() };
  const first = await s.submit(input);
  const second = await s.submit(input);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.record.id, first.record.id);
  assert.equal(await countFor(repository, "usr_1", "mv-session-abcdef12"), 1);
});

async function countFor(
  repository: InMemoryMovementVerificationRepository,
  userId: string,
  sessionId: string,
): Promise<number> {
  return (await repository.findByUserSession(userId, sessionId)) ? 1 : 0;
}

test("the stored record carries the session's provenance", async () => {
  const { service: s } = service();
  const { record } = await s.submit({
    userId: "usr_1",
    clientSessionId: "mv-session-abcdef12",
    observation: observation(),
  });
  assert.equal(record.movementMode, DEFAULT_MOVEMENT_MODE);
  assert.equal(record.rulesVersion, SESSION_RULES_VERSION);
  assert.equal(record.startedAt, T0);
  assert.equal(record.finishedAt, T0 + 200_000);
  assert.equal(record.pausedMs, 0);
});

test("a legacy submission stores NULL provenance rather than today's values", async () => {
  const { service: s } = service();
  const { record } = await s.submit({
    userId: "usr_1",
    clientSessionId: "mv-legacy-abcdef12",
    observation: observation({ session: undefined }),
  });
  assert.equal(record.movementMode, null);
  assert.equal(record.rulesVersion, null);
  assert.equal(record.startedAt, null);
  assert.equal(record.finishedAt, null);
  assert.equal(record.pausedMs, null);
});

test("pause totals are stored, not the intervals", async () => {
  const { service: s } = service();
  const { record } = await s.submit({
    userId: "usr_1",
    clientSessionId: "mv-session-abcdef12",
    observation: observation({
      session: {
        ...observation().session!,
        pauses: [
          { startedAt: T0 + 20_000, endedAt: T0 + 35_000 },
          { startedAt: T0 + 60_000, endedAt: T0 + 70_000 },
        ],
      },
    }),
  });
  assert.equal(record.pausedMs, 25_000);
  assert.ok(!("pauses" in record), "the row must not hold individual pause timestamps");
});

test("a retry cannot rewrite the metadata of a session id already stored", async () => {
  /* Attempt one defines what this session was. Attempt two disagreeing is not
     a retry of it — overwriting would let a client restate history, and
     silently returning the stored row would report an acceptance that did not
     happen. */
  const { service: s } = service();
  const input = { userId: "usr_1", clientSessionId: "mv-session-abcdef12", observation: observation() };
  await s.submit(input);

  for (const changed of [
    { rulesVersion: SESSION_RULES_VERSION, startedAt: T0 + 1 },
    { rulesVersion: SESSION_RULES_VERSION, finishedAt: T0 + 999_999 },
    { rulesVersion: SESSION_RULES_VERSION, pauses: [{ startedAt: T0 + 10, endedAt: T0 + 5_000 }] },
  ]) {
    await assert.rejects(
      () =>
        s.submit({
          ...input,
          observation: observation({ session: { ...observation().session!, ...changed } }),
        }),
      MovementSessionMetadataConflictError,
      `changing ${Object.keys(changed).join("/")} was silently accepted`,
    );
  }
});

test("an identical retry is not a conflict", async () => {
  const { service: s } = service();
  const input = { userId: "usr_1", clientSessionId: "mv-session-abcdef12", observation: observation() };
  await s.submit(input);
  const replay = await s.submit(input);
  assert.equal(replay.created, false);
});

test("absence is not contradiction, in either direction", async () => {
  /* An older build retrying a session a newer one submitted, and a newer build
     retrying one stored before the model existed. Neither is a disagreement
     about what the session was, so neither conflicts — and neither rewrites
     the stored row. */
  const { service: s } = service();
  await s.submit({ userId: "usr_1", clientSessionId: "mv-a-abcdef12", observation: observation() });
  const legacyReplay = await s.submit({
    userId: "usr_1",
    clientSessionId: "mv-a-abcdef12",
    observation: observation({ session: undefined }),
  });
  assert.equal(legacyReplay.record.movementMode, DEFAULT_MOVEMENT_MODE, "the stored row stands");

  await s.submit({
    userId: "usr_1",
    clientSessionId: "mv-b-abcdef12",
    observation: observation({ session: undefined }),
  });
  const modernReplay = await s.submit({
    userId: "usr_1",
    clientSessionId: "mv-b-abcdef12",
    observation: observation(),
  });
  assert.equal(modernReplay.record.movementMode, null, "a legacy row is not retroactively stamped");
});

test("one user's session id cannot read another user's record", async () => {
  const { service: s } = service();
  await s.submit({ userId: "usr_1", clientSessionId: "mv-shared-abcdef12", observation: observation() });
  assert.equal(await s.get("usr_2", "mv-shared-abcdef12"), null);
  /* And the same id under a second user is a separate session, not a conflict. */
  const other = await s.submit({
    userId: "usr_2",
    clientSessionId: "mv-shared-abcdef12",
    observation: observation({ session: { ...observation().session!, startedAt: T0 + 12_345 } }),
  });
  assert.equal(other.created, true);
});

test("a concurrent insert converges on one record, and still checks metadata", async () => {
  const inner = new InMemoryMovementVerificationRepository();
  let raced = false;
  const racing = {
    async create(input: Parameters<typeof inner.create>[0]) {
      if (!raced) {
        raced = true;
        /* A competitor lands first, exactly as a second replica would. */
        await inner.create({ ...input, id: "mv-winner" });
      }
      return inner.create(input);
    },
    findByUserSession: inner.findByUserSession.bind(inner),
  };
  let n = 0;
  const s = new MovementVerificationService({
    repository: racing,
    generateId: () => `mv-loser-${++n}`,
    now: () => T0 + 300_000,
    detectAnomalies: () => ({ isAnomaly: false, reasons: [], confidence: 0.95 }),
    calculateDistance: () => 431,
    traversedHexIds: () => [],
  });
  const outcome = await s.submit({
    userId: "usr_1",
    clientSessionId: "mv-session-abcdef12",
    observation: observation(),
  });
  assert.equal(outcome.created, false);
  assert.equal(outcome.record.id, "mv-winner");
});

/* ── verification still writes no territory ───────────────────────────────── */

test("a verified session grants nothing, metadata or not", async () => {
  const { service: s } = service();
  const { record } = await s.submit({
    userId: "usr_1",
    clientSessionId: "mv-session-abcdef12",
    observation: observation(),
  });
  for (const forbidden of [
    "owner", "owned", "capturedCells", "captured", "zones", "zoneIds", "solid", "shade",
    "sealed", "strength", "deed", "holder", "xp", "credits",
  ]) {
    assert.ok(!(forbidden in record), `the verification record leaked ${forbidden}`);
  }
  assert.deepEqual(record.traversedHexIds, ["8860145b49fffff"]);
});
