/**
 * HMAC webhook verifier — the full negative matrix: missing/malformed/wrong
 * signatures, stale/future timestamps, unknown/expired key versions, previous-
 * key overlap, and body tampering. Signature verification runs on RAW bytes
 * before parsing. Offline, deterministic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeWebhookSignature,
  HmacWebhookVerifier,
  WEBHOOK_HEADER_KEY_ID,
  WEBHOOK_HEADER_SIGNATURE,
  WEBHOOK_HEADER_TIMESTAMP,
} from "./hmacVerifier.js";
import { WebhookVerificationError } from "./types.js";

const CURRENT = { keyId: "k2", secret: "current-secret-0123456789abcdef0123456789" };
const PREVIOUS = { keyId: "k1", secret: "previous-secret-0123456789abcdef012345678", expiresAt: new Date("2026-08-01T00:00:00Z") };
const NOW = new Date("2026-07-17T12:00:00Z");

function makeVerifier() {
  return new HmacWebhookVerifier({ provider: "disabled", currentKey: CURRENT, previousKey: PREVIOUS, maxSkewSeconds: 300 });
}

function signedRequest(opts: { key?: typeof CURRENT; body?: unknown; tsOffsetSeconds?: number; mutate?: (h: Record<string, string | undefined>) => void }) {
  const key = opts.key ?? CURRENT;
  const body = Buffer.from(JSON.stringify(opts.body ?? { id: "evt_1", type: "example.event", data: { a: 1 } }));
  const ts = String(Math.floor(NOW.getTime() / 1000) + (opts.tsOffsetSeconds ?? 0));
  const headers: Record<string, string | undefined> = {
    [WEBHOOK_HEADER_KEY_ID]: key.keyId,
    [WEBHOOK_HEADER_TIMESTAMP]: ts,
    [WEBHOOK_HEADER_SIGNATURE]: computeWebhookSignature(key, ts, body),
  };
  opts.mutate?.(headers);
  return { rawBody: body, headers, now: NOW };
}

async function expectReject(input: ReturnType<typeof signedRequest>, reason: string) {
  await assert.rejects(makeVerifier().verify(input), (e: unknown) => {
    assert.ok(e instanceof WebhookVerificationError, `expected WebhookVerificationError, got ${String(e)}`);
    assert.equal(e.reason, reason);
    // The failure message carries the reason class only — never the payload.
    assert.ok(!e.message.includes("evt_1"));
    return true;
  });
}

test("a valid current-key signature verifies and yields a typed event with digest", async () => {
  const event = await makeVerifier().verify(signedRequest({}));
  assert.equal(event.providerEventId, "evt_1");
  assert.equal(event.eventType, "example.event");
  assert.equal(event.keyId, "k2");
  assert.match(event.payloadDigest, /^[0-9a-f]{64}$/);
  assert.deepEqual(event.data, { a: 1 });
});

test("missing signature is rejected", async () => {
  await expectReject(signedRequest({ mutate: (h) => delete h[WEBHOOK_HEADER_SIGNATURE] }), "missing_signature");
});

test("malformed (non-hex) signature is rejected", async () => {
  await expectReject(signedRequest({ mutate: (h) => (h[WEBHOOK_HEADER_SIGNATURE] = "not-hex!") }), "malformed_signature");
});

test("an incorrect signature is rejected", async () => {
  await expectReject(
    signedRequest({ mutate: (h) => (h[WEBHOOK_HEADER_SIGNATURE] = "ab".repeat(32)) }),
    "bad_signature"
  );
});

test("a stale timestamp beyond max skew is rejected", async () => {
  await expectReject(signedRequest({ tsOffsetSeconds: -301 }), "stale_timestamp");
});

test("a future timestamp beyond max skew is rejected", async () => {
  await expectReject(signedRequest({ tsOffsetSeconds: 301 }), "future_timestamp");
});

test("a missing timestamp is rejected", async () => {
  await expectReject(signedRequest({ mutate: (h) => delete h[WEBHOOK_HEADER_TIMESTAMP] }), "missing_timestamp");
});

test("an unknown key version is rejected", async () => {
  await expectReject(
    signedRequest({ mutate: (h) => (h[WEBHOOK_HEADER_KEY_ID] = "k99") }),
    "unknown_key_version"
  );
});

test("the previous key verifies during its bounded overlap window", async () => {
  const event = await makeVerifier().verify(signedRequest({ key: PREVIOUS }));
  assert.equal(event.keyId, "k1");
});

test("the previous key is rejected after its expiry (no unlimited historical keys)", async () => {
  const late = signedRequest({ key: PREVIOUS });
  const afterExpiry = new Date("2026-08-02T00:00:00Z");
  // Keep the timestamp within skew of the new "now" so only key expiry trips.
  const ts = String(Math.floor(afterExpiry.getTime() / 1000));
  late.headers[WEBHOOK_HEADER_TIMESTAMP] = ts;
  late.headers[WEBHOOK_HEADER_SIGNATURE] = computeWebhookSignature(PREVIOUS, ts, late.rawBody);
  await assert.rejects(
    makeVerifier().verify({ ...late, now: afterExpiry }),
    (e: unknown) => e instanceof WebhookVerificationError && e.reason === "expired_key"
  );
});

test("body tampering after signing is rejected", async () => {
  const req = signedRequest({});
  const tampered = Buffer.from(req.rawBody.toString("utf8").replace('"a":1', '"a":2'));
  await assert.rejects(
    makeVerifier().verify({ ...req, rawBody: tampered }),
    (e: unknown) => e instanceof WebhookVerificationError && e.reason === "bad_signature"
  );
});

test("a correctly-signed but non-JSON body is rejected only AFTER signature verification", async () => {
  const body = Buffer.from("this is not json");
  const ts = String(Math.floor(NOW.getTime() / 1000));
  const headers = {
    [WEBHOOK_HEADER_KEY_ID]: CURRENT.keyId,
    [WEBHOOK_HEADER_TIMESTAMP]: ts,
    [WEBHOOK_HEADER_SIGNATURE]: computeWebhookSignature(CURRENT, ts, body),
  };
  await assert.rejects(
    makeVerifier().verify({ rawBody: body, headers, now: NOW }),
    (e: unknown) => e instanceof WebhookVerificationError && e.reason === "malformed_payload"
  );
});

test("an envelope without id/type is rejected as malformed", async () => {
  await expectReject(signedRequest({ body: { type: "x" } }), "malformed_payload");
  await expectReject(signedRequest({ body: { id: "evt_2" } }), "malformed_payload");
});
