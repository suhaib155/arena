/**
 * Movement verification client — protocol boundary, trust boundary, secrecy.
 *
 * The properties under test are not "it calls fetch". They are: the client
 * cannot assert authority, it cannot be talked into a verified state by a
 * malformed response, a rejected verdict is a RESULT and not a transport
 * error, and neither the bearer token nor a single GPS coordinate escapes into
 * an error message.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { AuthedJsonTransport } from "../authedTransport";
import {
  MovementApiClient,
  MovementApiError,
  type SubmitMovementRequest,
} from "../movementApi";
import type { RefreshOutcome } from "../../lib/authLifecycle";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TOKEN = "access-token-super-secret-value";
const START = 1_700_000_000_000;
const END = 1_700_000_300_000;

const request: SubmitMovementRequest = {
  sessionId: "session-abcdef01",
  startTime: START,
  endTime: END,
  points: [
    { lat: 51.500123, lng: -0.120456, accuracy: 6, timestamp: START + 1_000 },
    { lat: 51.500987, lng: -0.120111, accuracy: 6, timestamp: START + 120_000 },
  ],
};

const verifiedBody = {
  sessionId: "session-abcdef01",
  status: "verified",
  distanceMeters: 412,
  durationSeconds: 300,
  traversedHexIds: ["8a1fb46622dffff"],
  rejectionReasons: [] as string[],
  verifiedAt: "2026-08-18T06:00:00.000Z",
};

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function harness(
  responder: (call: Call, n: number) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>,
  opts: { token?: string | null; refresh?: () => Promise<RefreshOutcome> } = {},
) {
  const calls: Call[] = [];
  let refreshes = 0;
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body as string | undefined,
    };
    calls.push(call);
    const { status, body } = await responder(call, calls.length);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (body === undefined) throw new Error("no body");
        return body;
      },
    } as unknown as Response;
  }) as typeof fetch;

  const transport = new AuthedJsonTransport({
    baseUrl: "https://api.test",
    loadAccessToken: async () => (opts.token === undefined ? TOKEN : opts.token),
    performRefresh: async () => {
      refreshes += 1;
      return opts.refresh ? opts.refresh() : { kind: "refreshed" };
    },
    error: (status, code) => Object.assign(new Error(code), { status, code }),
  });

  return {
    client: new MovementApiClient(transport),
    transport,
    calls,
    refreshCount: () => refreshes,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/* ── wire contract ────────────────────────────────────────────────────────── */

test("submit posts to the exact path with the bearer attached", async () => {
  const h = harness(() => ({ status: 201, body: verifiedBody }));
  try {
    await h.client.submit(request);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].url, "https://api.test/movement/verify");
    assert.equal(h.calls[0].method, "POST");
    assert.equal(h.calls[0].headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(h.calls[0].headers["content-type"], "application/json");
  } finally {
    h.restore();
  }
});

test("the serialized payload carries observations and nothing else", async () => {
  const h = harness(() => ({ status: 201, body: verifiedBody }));
  try {
    await h.client.submit(request);
    const sent = JSON.parse(h.calls[0].body as string);
    assert.deepEqual(Object.keys(sent).sort(), ["endTime", "points", "sessionId", "startTime"]);
    assert.deepEqual(Object.keys(sent.points[0]).sort(), ["accuracy", "lat", "lng", "timestamp"]);
    assert.equal(sent.sessionId, "session-abcdef01");
    assert.equal(sent.points.length, 2);
  } finally {
    h.restore();
  }
});

test("an authority field cannot reach the wire even from untyped input", async () => {
  const h = harness(() => ({ status: 201, body: verifiedBody }));
  try {
    // Simulates the field arriving from untyped code or an `as` cast — the
    // type alone cannot stop that, so serialisation PICKS known fields.
    const smuggled = {
      ...request,
      userId: "usr_someone_else",
      walletAddress: "0x" + "a".repeat(40),
      distanceMeters: 99_000,
      durationSeconds: 1,
      traversedHexIds: ["8a1fb46622dffff"],
      capturedZones: ["8a1fb46622dffff"],
      xp: 5_000,
      lockedMove: "1000",
      trustScore: 1,
      verified: true,
      status: "verified",
      points: [{ ...request.points[0], captured: true, speed: 99 }],
    } as unknown as SubmitMovementRequest;

    await h.client.submit(smuggled);
    const sent = JSON.parse(h.calls[0].body as string);
    for (const forbidden of [
      "userId", "walletAddress", "distanceMeters", "durationSeconds", "traversedHexIds",
      "capturedZones", "xp", "lockedMove", "trustScore", "verified", "status",
    ]) {
      assert.ok(!(forbidden in sent), `payload leaked authority field ${forbidden}`);
    }
    assert.deepEqual(Object.keys(sent.points[0]).sort(), ["accuracy", "lat", "lng", "timestamp"]);
  } finally {
    h.restore();
  }
});

/* ── decoding ─────────────────────────────────────────────────────────────── */

test("a valid verified response decodes, and 201 vs 200 distinguishes a replay", async () => {
  const fresh = harness(() => ({ status: 201, body: verifiedBody }));
  try {
    const result = await fresh.client.submit(request);
    assert.equal(result.replayed, false);
    assert.equal(result.verification.status, "verified");
    assert.equal(result.verification.distanceMeters, 412);
    assert.deepEqual(result.verification.traversedHexIds, ["8a1fb46622dffff"]);
  } finally {
    fresh.restore();
  }

  const replay = harness(() => ({ status: 200, body: verifiedBody }));
  try {
    const result = await replay.client.submit(request);
    assert.equal(result.replayed, true, "an idempotent replay is a success, not an error");
    // The replay body is the ORIGINAL verdict, field for field.
    assert.equal(result.verification.status, "verified");
    assert.equal(result.verification.sessionId, verifiedBody.sessionId);
    assert.equal(result.verification.distanceMeters, verifiedBody.distanceMeters);
    assert.deepEqual(result.verification.traversedHexIds, verifiedBody.traversedHexIds);
  } finally {
    replay.restore();
  }
});

test("a rejected verdict is a RESULT, not a transport error", async () => {
  const rejected = {
    ...verifiedBody,
    status: "rejected",
    distanceMeters: null,
    durationSeconds: 300,
    traversedHexIds: [] as string[],
    rejectionReasons: ["Implausible speed at index 1"],
  };
  const h = harness(() => ({ status: 201, body: rejected }));
  try {
    const result = await h.client.submit(request);
    assert.equal(result.verification.status, "rejected");
    assert.deepEqual(result.verification.rejectionReasons, ["Implausible speed at index 1"]);
    assert.equal(result.verification.distanceMeters, null);
  } finally {
    h.restore();
  }
});

test("malformed responses fail closed instead of becoming a verification", async () => {
  const malformed: [string, unknown][] = [
    ["not an object", "verified"],
    ["an array", []],
    ["missing sessionId", { ...verifiedBody, sessionId: undefined }],
    ["empty sessionId", { ...verifiedBody, sessionId: "" }],
    ["unknown status", { ...verifiedBody, status: "pending" }],
    ["non-finite distance", { ...verifiedBody, distanceMeters: Number.POSITIVE_INFINITY }],
    ["string distance", { ...verifiedBody, distanceMeters: "412" }],
    ["hexes not an array", { ...verifiedBody, traversedHexIds: "8a1fb46622dffff" }],
    ["hexes containing a non-string", { ...verifiedBody, traversedHexIds: [1] }],
    ["unparseable timestamp", { ...verifiedBody, verifiedAt: "not-a-date" }],
    ["verified WITH rejection reasons", { ...verifiedBody, rejectionReasons: ["nope"] }],
    ["rejected WITH a distance", { ...verifiedBody, status: "rejected", distanceMeters: 412 }],
    ["an ownership claim", { ...verifiedBody, capturedZones: ["8a1fb46622dffff"] }],
    ["a reward claim", { ...verifiedBody, xp: 100 }],
  ];

  for (const [label, body] of malformed) {
    const h = harness(() => ({ status: 201, body }));
    try {
      await assert.rejects(
        () => h.client.submit(request),
        (err: unknown) =>
          err instanceof MovementApiError && err.kind === "malformed_response",
        `${label} was accepted`,
      );
    } finally {
      h.restore();
    }
  }
});

/* ── auth: reuse of the existing single-flight refresh ────────────────────── */

test("a 401 triggers exactly one refresh and retries once", async () => {
  const h = harness((_call, n) => (n === 1 ? { status: 401, body: {} } : { status: 201, body: verifiedBody }));
  try {
    const result = await h.client.submit(request);
    assert.equal(result.verification.status, "verified");
    assert.equal(h.refreshCount(), 1);
    assert.equal(h.calls.length, 2, "one original call plus one retry");
  } finally {
    h.restore();
  }
});

test("concurrent 401s across BOTH domains share one refresh — no storm", async () => {
  // The reason movement takes the shared transport rather than building its
  // own: two transports would mean two single-flight slots, and the rotating
  // refresh token would be presented twice.
  let gate: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    gate = resolve;
  });
  let refreshes = 0;
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string) => {
    const url = String(input);
    calls.push(url);
    const first = calls.filter((u) => u === url).length === 1;
    if (first) return { ok: false, status: 401, json: async () => ({}) } as unknown as Response;
    return { ok: true, status: 201, json: async () => verifiedBody } as unknown as Response;
  }) as typeof fetch;

  const transport = new AuthedJsonTransport({
    baseUrl: "https://api.test",
    loadAccessToken: async () => TOKEN,
    performRefresh: async () => {
      refreshes += 1;
      await opened;
      return { kind: "refreshed" };
    },
    error: (status, code) => Object.assign(new Error(code), { status, code }),
  });

  try {
    const movement = new MovementApiClient(transport);
    // Two different endpoints on the SAME transport, both 401 before either
    // refresh completes.
    const both = Promise.all([
      movement.submit(request),
      transport.request<unknown>("/identity/me", { auth: true }),
    ]);
    gate();
    await both;
    assert.equal(refreshes, 1, "both domains must await the SAME refresh");
  } finally {
    globalThis.fetch = original;
  }
});

test("a second 401 after refresh surfaces as unauthorized rather than looping", async () => {
  const h = harness(() => ({ status: 401, body: {} }));
  try {
    await assert.rejects(
      () => h.client.submit(request),
      (err: unknown) => err instanceof MovementApiError && err.kind === "unauthorized",
    );
    assert.equal(h.refreshCount(), 1, "exactly one refresh attempt");
    assert.equal(h.calls.length, 2, "original plus one retry, then stop");
  } finally {
    h.restore();
  }
});

test("a refresh that cannot run reports unavailability, not a dead session", async () => {
  const h = harness(() => ({ status: 401, body: {} }), {
    refresh: async () => ({ kind: "unavailable", code: "service_unavailable" }),
  });
  try {
    await assert.rejects(
      () => h.client.submit(request),
      (err: unknown) => err instanceof MovementApiError && err.kind === "network_unavailable",
    );
  } finally {
    h.restore();
  }
});

test("no stored session is unauthorized without any network call", async () => {
  const h = harness(() => ({ status: 201, body: verifiedBody }), { token: null });
  try {
    await assert.rejects(
      () => h.client.submit(request),
      (err: unknown) => err instanceof MovementApiError && err.kind === "unauthorized",
    );
    assert.equal(h.calls.length, 0, "a route must not be sent without a bearer");
  } finally {
    h.restore();
  }
});

/* ── error classification ─────────────────────────────────────────────────── */

test("HTTP statuses classify into intentional kinds", async () => {
  const cases: [number, string][] = [
    [400, "invalid_request"],
    [403, "forbidden"],
    [404, "not_found"],
    [422, "invalid_request"],
    [500, "server_error"],
    [503, "server_error"],
  ];
  for (const [status, kind] of cases) {
    const h = harness(() => ({ status, body: { error: { code: "invalid_request" } } }));
    try {
      await assert.rejects(
        () => h.client.submit(request),
        (err: unknown) => err instanceof MovementApiError && err.kind === kind,
        `status ${status} should classify as ${kind}`,
      );
    } finally {
      h.restore();
    }
  }
});

test("a transport failure normalises to network_unavailable", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new TypeError("Network request failed");
  }) as typeof fetch;
  const transport = new AuthedJsonTransport({
    baseUrl: "https://api.test",
    loadAccessToken: async () => TOKEN,
    performRefresh: async () => ({ kind: "refreshed" }),
    error: (status, code) => Object.assign(new Error(code), { status, code }),
  });
  try {
    await assert.rejects(
      () => new MovementApiClient(transport).submit(request),
      (err: unknown) => err instanceof MovementApiError && err.kind === "network_unavailable",
    );
  } finally {
    globalThis.fetch = original;
  }
});

/* ── secrecy ──────────────────────────────────────────────────────────────── */

test("no error carries the token, a coordinate, or the request body", async () => {
  const probes: (() => ReturnType<typeof harness>)[] = [
    () => harness(() => ({ status: 500, body: { error: { code: "boom" } } })),
    () => harness(() => ({ status: 201, body: { nonsense: true } })),
    () => harness(() => ({ status: 401, body: {} })),
  ];
  for (const build of probes) {
    const h = build();
    try {
      await h.client.submit(request).then(
        () => assert.fail("expected a failure"),
        (err: unknown) => {
          const text = `${String(err)} ${(err as Error).stack ?? ""} ${JSON.stringify(err)}`;
          assert.ok(!text.includes(TOKEN), "token leaked into an error");
          assert.ok(!text.includes("51.500123"), "a GPS coordinate leaked into an error");
          assert.ok(!text.includes("-0.120456"), "a GPS coordinate leaked into an error");
          assert.ok(!text.includes("session-abcdef01"), "the session id leaked into an error");
        },
      );
    } finally {
      h.restore();
    }
  }
});

test("the client module contains no logging at all", () => {
  for (const file of ["movementApi.ts", "authedTransport.ts"]) {
    const src = readFileSync(join(process.cwd(), "src", "services", file), "utf8");
    assert.ok(!/console\.(log|warn|error|info|debug)/.test(src), `${file} logs`);
  }
});

/* ── owner-scoped read ────────────────────────────────────────────────────── */

test("the read is owner-scoped by the bearer — no user id on the wire", async () => {
  const h = harness(() => ({ status: 200, body: verifiedBody }));
  try {
    await h.client.get("session-abcdef01");
    assert.equal(h.calls[0].url, "https://api.test/movement/verify/session-abcdef01");
    assert.equal(h.calls[0].method, "GET");
    assert.equal(h.calls[0].headers.authorization, `Bearer ${TOKEN}`);
    assert.ok(!h.calls[0].url.includes("user"), "no user id appears in the URL");
    assert.equal(h.calls[0].body, undefined, "a GET sends no body");
  } finally {
    h.restore();
  }
});

test("another user's session id simply does not resolve", async () => {
  const h = harness(() => ({ status: 404, body: { error: { code: "not_found" } } }));
  try {
    await assert.rejects(
      () => h.client.get("session-someoneelse"),
      (err: unknown) => err instanceof MovementApiError && err.kind === "not_found",
    );
  } finally {
    h.restore();
  }
});
