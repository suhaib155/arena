/**
 * Webhook HTTP boundary — real Express over loopback: raw-body handling,
 * disabled-mode fail-closed 503, valid/invalid signatures, oversized body,
 * wrong content type, and idempotent duplicate delivery. No external network.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { AddressInfo } from "node:net";
import { createProviderWebhookRouter } from "./router.js";
import { HmacWebhookVerifier, computeWebhookSignature, WEBHOOK_HEADER_KEY_ID, WEBHOOK_HEADER_SIGNATURE, WEBHOOK_HEADER_TIMESTAMP } from "./hmacVerifier.js";
import { ProviderEventService } from "./eventService.js";
import { InMemoryProviderEventStore } from "./eventStore.memory.js";
import { AuditService } from "../services/audit.service.js";
import { InMemoryAuditEventRepository } from "../repositories/memory.js";

const KEY = { keyId: "k1", secret: "webhook-secret-0123456789abcdef0123456789" };

function buildApp(enabled: boolean) {
  const audit = new AuditService(new InMemoryAuditEventRepository());
  const app = express();
  if (enabled) {
    const verifier = new HmacWebhookVerifier({ provider: "disabled", currentKey: KEY, maxSkewSeconds: 300 });
    const events = new ProviderEventService({ store: new InMemoryProviderEventStore(), audit });
    app.use("/identity/webhooks", createProviderWebhookRouter({ verifier, events, audit }));
  } else {
    app.use("/identity/webhooks", createProviderWebhookRouter({ verifier: null, events: null, audit }));
  }
  // Mirrors index.ts: the app-wide JSON parser mounts AFTER the webhook router.
  app.use(express.json());
  app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: { code: "internal" } });
  });
  return app;
}

let enabledServer: Server;
let disabledServer: Server;
let enabledBase: string;
let disabledBase: string;

before(async () => {
  await new Promise<void>((r) => { enabledServer = buildApp(true).listen(0, "127.0.0.1", r); });
  await new Promise<void>((r) => { disabledServer = buildApp(false).listen(0, "127.0.0.1", r); });
  enabledBase = `http://127.0.0.1:${(enabledServer.address() as AddressInfo).port}`;
  disabledBase = `http://127.0.0.1:${(disabledServer.address() as AddressInfo).port}`;
});
after(() => { enabledServer?.close(); disabledServer?.close(); });

function signedHeaders(body: Buffer, tsOffset = 0): Record<string, string> {
  const ts = String(Math.floor(Date.now() / 1000) + tsOffset);
  return {
    "content-type": "application/json",
    [WEBHOOK_HEADER_KEY_ID]: KEY.keyId,
    [WEBHOOK_HEADER_TIMESTAMP]: ts,
    [WEBHOOK_HEADER_SIGNATURE]: computeWebhookSignature(KEY, ts, body),
  };
}

async function post(base: string, body: Buffer | string, headers: Record<string, string>) {
  const res = await fetch(`${base}/identity/webhooks/provider`, { method: "POST", headers, body });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

test("disabled webhooks fail closed with a stable 503 — even for a validly-signed request", async () => {
  const body = Buffer.from(JSON.stringify({ id: "evt_1", type: "example.event" }));
  const res = await post(disabledBase, body, signedHeaders(body));
  assert.equal(res.status, 503);
  assert.equal(res.json.error.code, "provider_not_configured");
});

test("a validly-signed event is accepted and a duplicate delivery returns idempotent success", async () => {
  const body = Buffer.from(JSON.stringify({ id: "evt_dup", type: "example.event", data: {} }));
  const first = await post(enabledBase, body, signedHeaders(body));
  assert.equal(first.status, 200);
  assert.equal(first.json.received, true);
  assert.equal(first.json.duplicate, false);
  const second = await post(enabledBase, body, signedHeaders(body));
  assert.equal(second.status, 200);
  assert.equal(second.json.duplicate, true);
});

test("a bad signature returns a stable 401 without detail", async () => {
  const body = Buffer.from(JSON.stringify({ id: "evt_bad", type: "example.event" }));
  const headers = signedHeaders(body);
  headers[WEBHOOK_HEADER_SIGNATURE] = "ab".repeat(32);
  const res = await post(enabledBase, body, headers);
  assert.equal(res.status, 401);
  assert.equal(res.json.error.code, "verification_failed");
  assert.equal(Object.keys(res.json.error).length, 1, "no attacker-helpful detail");
});

test("a stale timestamp returns 401", async () => {
  const body = Buffer.from(JSON.stringify({ id: "evt_stale", type: "example.event" }));
  const res = await post(enabledBase, body, signedHeaders(body, -3600));
  assert.equal(res.status, 401);
});

test("a correctly-signed malformed payload returns a stable 400", async () => {
  const body = Buffer.from(JSON.stringify({ nope: true })); // no id/type
  const res = await post(enabledBase, body, signedHeaders(body));
  assert.equal(res.status, 400);
  assert.equal(res.json.error.code, "invalid_request");
});

test("a wrong content type never reaches the verifier", async () => {
  const body = Buffer.from(JSON.stringify({ id: "evt_ct", type: "example.event" }));
  const headers = signedHeaders(body);
  headers["content-type"] = "text/plain";
  const res = await post(enabledBase, body, headers);
  assert.equal(res.status, 415);
});

test("an oversized body is rejected with a stable 413", async () => {
  const big = Buffer.from(JSON.stringify({ id: "evt_big", type: "example.event", data: { pad: "x".repeat(300 * 1024) } }));
  const res = await post(enabledBase, big, signedHeaders(big));
  assert.equal(res.status, 413);
  assert.equal(res.json.error.code, "invalid_request");
});
