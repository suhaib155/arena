/**
 * The identity transition tables against the stores and services that write
 * those states. Each test drives a real flow over the in-memory stores (which
 * mirror the database's conditional UPDATEs) and checks every observed move
 * is an edge of its table, and that the stores refuse the moves the table
 * forbids.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { canTransition, reachableFrom, terminalStates, type TransitionTable } from "@movenrun/shared/state-machine";
import {
  PROVIDER_EVENT_TRANSITIONS,
  PROVISIONING_TRANSITIONS,
  SESSION_STATUS_TRANSITIONS,
  USER_STATUS_TRANSITIONS,
  WALLET_OWNERSHIP_TRANSITIONS,
} from "./transitions.js";
import { PROVIDER_EVENT_STATES, type ProviderEventHandler } from "../webhooks/types.js";
import { InMemorySessionRepository, InMemoryAuditEventRepository } from "../repositories/memory.js";
import { InMemoryProviderEventStore } from "../webhooks/eventStore.memory.js";
import { ProviderEventService } from "../webhooks/eventService.js";
import { AuditService } from "../services/audit.service.js";
import { createHarness } from "../testDoubles/harness.js";
import { EmbeddedWalletProviderDouble } from "../testDoubles/index.js";
import { EMBEDDED_WALLET_SOURCE } from "../services/authOrchestrator.service.js";

function assertPath<S extends string>(table: TransitionTable<S>, path: S[]): void {
  for (let i = 1; i < path.length; i++) {
    assert.ok(canTransition(table, path[i - 1], path[i]), `${path[i - 1]} -> ${path[i]} is not in the table`);
  }
}

test("terminal states are the ones the code treats as final", () => {
  assert.deepEqual(terminalStates(SESSION_STATUS_TRANSITIONS), ["revoked"]);
  assert.deepEqual(terminalStates(PROVISIONING_TRANSITIONS).sort(), ["active", "failed_terminal"]);
  assert.deepEqual(terminalStates(WALLET_OWNERSHIP_TRANSITIONS), ["revoked"]);
  assert.deepEqual(terminalStates(USER_STATUS_TRANSITIONS), ["disabled"]);
  assert.deepEqual(terminalStates(PROVIDER_EVENT_TRANSITIONS).sort(), ["ignored", "processed", "terminal_failure"]);
});

test("every state is reachable from its initial state", () => {
  assert.equal(reachableFrom(SESSION_STATUS_TRANSITIONS, "active").size, 3);
  assert.equal(reachableFrom(PROVISIONING_TRANSITIONS, "requested").size, 5);
  assert.equal(reachableFrom(WALLET_OWNERSHIP_TRANSITIONS, "unverified").size, 3);
  assert.equal(reachableFrom(PROVIDER_EVENT_TRANSITIONS, "received").size, 6);
});

test("the provider-event table covers exactly the states the database CHECK allows", () => {
  assert.deepEqual(Object.keys(PROVIDER_EVENT_TRANSITIONS).sort(), [...PROVIDER_EVENT_STATES].sort());
});

/* ── sessions ─────────────────────────────────────────────────────────────── */

async function sessionRepo() {
  const repo = new InMemorySessionRepository(() => new Date("2026-01-01T00:00:00Z"));
  let n = 0;
  const make = (familyId: string) => repo.create({
    id: `ses_${++n}`,
    userId: "usr_1",
    familyId,
    assuranceLevel: "aal1",
    refreshTokenHash: `hash_${n}`,
    securityVersion: 1,
    expiresAt: new Date("2026-02-01T00:00:00Z"),
    lastAuthenticatedAt: new Date("2026-01-01T00:00:00Z"),
  } as Parameters<typeof repo.create>[0]);
  return { repo, make };
}

test("session refresh and family revoke follow active -> rotated -> revoked", async () => {
  const { repo, make } = await sessionRepo();
  const first = await make("fam_1");
  const second = await make("fam_1");
  const path: string[] = [first.status];
  path.push((await repo.markRotated(first.id, new Date()))!.status);
  await repo.revokeFamily("fam_1", "refresh_replay", new Date());
  path.push((await repo.findById(first.id))!.status);
  assertPath(SESSION_STATUS_TRANSITIONS, path as never[]);
  assert.deepEqual(path, ["active", "rotated", "revoked"]);
  assert.equal((await repo.findById(second.id))!.status, "revoked", "active -> revoked");
});

test("the session store refuses the moves the table forbids", async () => {
  const { repo, make } = await sessionRepo();
  const s = await make("fam_2");
  const at = new Date("2026-01-01T00:05:00Z");
  await repo.revoke(s.id, "user_logout", at);
  assert.equal(await repo.markRotated(s.id, new Date()), null, "revoked -> rotated is refused");
  const again = await repo.revoke(s.id, "revoke_all", new Date("2026-01-02T00:00:00Z"));
  assert.equal(again!.revokedAt!.getTime(), at.getTime(), "a second revoke does not rewrite history");
  assert.equal(again!.revocationReason, "user_logout");
});

/* ── provider events ──────────────────────────────────────────────────────── */

function eventService(handler: ProviderEventHandler | null, maxAttempts = 2) {
  let clock = new Date("2026-01-01T00:00:00Z");
  const now = () => new Date(clock.getTime());
  const store = new InMemoryProviderEventStore(now);
  let n = 0;
  const service = new ProviderEventService({
    store,
    audit: new AuditService(new InMemoryAuditEventRepository(now)),
    handlers: handler ? new Map([["example.event", handler]]) : new Map(),
    maxAttempts,
    leaseSeconds: 60,
    now,
    idGen: () => `pe_${++n}`,
  });
  const advance = (s: number) => { clock = new Date(clock.getTime() + s * 1000); };
  const ingest = () => service.ingest({
    provider: "disabled",
    providerEventId: `evt_${n + 1}`,
    eventType: "example.event",
    eventVersion: "1",
    providerCreatedAt: null,
    payloadDigest: "d".repeat(64),
    keyId: "k1",
    data: {},
  });
  return { service, store, advance, ingest };
}

test("processed, ignored, retried and exhausted events all stay inside the table", async () => {
  for (const [label, handler, expected] of [
    ["processed", { handle: async () => ({ kind: "processed" as const }) }, "processed"],
    ["terminal", { handle: async () => ({ kind: "terminal" as const, errorClass: "bad" }) }, "terminal_failure"],
    ["ignored", null, "ignored"],
  ] as const) {
    const { service, ingest } = eventService(handler);
    const { record } = await ingest();
    const settled = await service.process(record.id);
    assertPath(PROVIDER_EVENT_TRANSITIONS, [record.state, "processing", settled!.state]);
    assert.equal(settled!.state, expected, label);
    assert.equal(await service.process(record.id), null, `${label} is final`);
  }

  const { service, ingest, store } = eventService({ handle: async () => ({ kind: "retry" as const, errorClass: "busy" }) });
  const { record } = await ingest();
  const path = [record.state];
  for (let i = 0; i < 2; i++) {
    path.push("processing", (await service.process(record.id))!.state);
  }
  assertPath(PROVIDER_EVENT_TRANSITIONS, path);
  assert.deepEqual(path, ["received", "processing", "retryable_failure", "processing", "terminal_failure"]);
  assert.equal((await store.findById(record.id))!.state, "terminal_failure", "the retry budget ends in a terminal state");
});

/* ── embedded-wallet provisioning ─────────────────────────────────────────── */

/** Records every provisioning and ownership state the service writes. */
function provisioningHarness(embeddedProvider?: EmbeddedWalletProviderDouble) {
  const h = createHarness(embeddedProvider ? { embeddedProvider } : {});
  const provisioning: string[] = [];
  const ownership: string[] = [];
  const update = h.stores.wallets.update.bind(h.stores.wallets);
  h.stores.wallets.update = async (id, patch) => {
    if (patch.provisioningState) provisioning.push(patch.provisioningState);
    if (patch.ownershipStatus) ownership.push(patch.ownershipStatus);
    return update(id, patch);
  };
  return { h, provisioning, ownership };
}

async function requestedWallet(h: ReturnType<typeof createHarness>) {
  const user = await h.identity.authenticate({ provider: "google", providerSubject: `p-${Math.random()}` });
  return h.provisioning.request(user.user.id, EMBEDDED_WALLET_SOURCE);
}

test("provisioning success, transient retry and terminal failure follow PROVISIONING_TRANSITIONS", async () => {
  {
    const { h, provisioning, ownership } = provisioningHarness();
    const w = await requestedWallet(h);
    await h.provisioning.provision(w.id);
    assertPath(PROVISIONING_TRANSITIONS, ["requested", ...provisioning] as never[]);
    assert.deepEqual(provisioning, ["provisioning", "active"]);
    assertPath(WALLET_OWNERSHIP_TRANSITIONS, ["unverified", ...ownership] as never[]);
  }
  {
    const { h, provisioning } = provisioningHarness(new EmbeddedWalletProviderDouble({ transientFailures: 1 }));
    const w = await requestedWallet(h);
    await h.provisioning.provision(w.id).catch(() => {});
    await h.provisioning.retry(w.id);
    assert.deepEqual(provisioning, ["provisioning", "failed_transient", "provisioning", "active"]);
    assertPath(PROVISIONING_TRANSITIONS, ["requested", ...provisioning] as never[]);
  }
  {
    const { h, provisioning } = provisioningHarness(new EmbeddedWalletProviderDouble({ terminal: true }));
    const w = await requestedWallet(h);
    await h.provisioning.provision(w.id).catch(() => {});
    await h.provisioning.retry(w.id).catch(() => {});
    assert.deepEqual(provisioning, ["provisioning", "failed_terminal"], "a terminal failure is not retried");
    assertPath(PROVISIONING_TRANSITIONS, ["requested", ...provisioning] as never[]);
  }
});

test("an attempt that never settled is re-entered as provisioning -> provisioning", async () => {
  const { h, provisioning } = provisioningHarness();
  const w = await requestedWallet(h);
  await h.stores.wallets.update(w.id, { provisioningState: "provisioning" });
  await h.provisioning.provision(w.id);
  assert.deepEqual(provisioning, ["provisioning", "provisioning", "active"]);
  assertPath(PROVISIONING_TRANSITIONS, ["requested", ...provisioning] as never[]);
});
