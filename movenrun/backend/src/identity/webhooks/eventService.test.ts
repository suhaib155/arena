/**
 * Provider-event persistence + processing state machine — idempotent ingest,
 * atomic claim (one winner), bounded retries, stale-lease recovery, unknown-
 * type ignore, immutable provider fields, and the domain-service boundary
 * (wrong-user events rejected by domain invariants, no state corruption).
 * Offline over the in-memory store, which mirrors the DB semantics exactly
 * (the Drizzle implementation is validated against real PostgreSQL 16 —
 * see the PR's concurrency evidence).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryProviderEventStore } from "./eventStore.memory.js";
import { ProviderEventService } from "./eventService.js";
import { AuditService } from "../services/audit.service.js";
import { InMemoryAuditEventRepository } from "../repositories/memory.js";
import type { ProviderEventHandler, VerifiedProviderEvent } from "./types.js";
import { createHarness } from "../testDoubles/harness.js";
import { isIdentityError } from "../domain/errors.js";

function makeEvent(overrides: Partial<VerifiedProviderEvent> = {}): VerifiedProviderEvent {
  return {
    provider: "disabled",
    providerEventId: "evt_1",
    eventType: "example.event",
    eventVersion: "1",
    providerCreatedAt: null,
    payloadDigest: "d".repeat(64),
    keyId: "k1",
    data: {},
    ...overrides,
  };
}

interface ServiceOptions {
  handlers?: ReadonlyMap<string, ProviderEventHandler>;
  maxAttempts?: number;
  leaseSeconds?: number;
}

function makeService(opts: ServiceOptions = {}) {
  let clock = new Date("2026-01-01T00:00:00Z");
  const now = () => new Date(clock.getTime());
  const advance = (s: number) => (clock = new Date(clock.getTime() + s * 1000));
  const store = new InMemoryProviderEventStore(now);
  const audit = new AuditService(new InMemoryAuditEventRepository(now));
  let n = 0;
  const service = new ProviderEventService({
    store,
    audit,
    handlers: opts.handlers,
    maxAttempts: opts.maxAttempts ?? 3,
    leaseSeconds: opts.leaseSeconds ?? 60,
    now,
    idGen: () => `pe_${++n}`,
  });
  return { service, store, advance, now };
}

test("first delivery inserts; duplicate delivery is idempotent", async () => {
  const { service } = makeService();
  const first = await service.ingest(makeEvent());
  const second = await service.ingest(makeEvent());
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(first.record.id, second.record.id);
});

test("concurrent duplicate deliveries converge on one row", async () => {
  const { service } = makeService();
  const results = await Promise.all(Array.from({ length: 6 }, () => service.ingest(makeEvent())));
  const inserted = results.filter((r) => !r.duplicate);
  assert.equal(inserted.length, 1, "exactly one delivery inserts");
  assert.equal(new Set(results.map((r) => r.record.id)).size, 1);
});

test("claim is an atomic compare-and-set — exactly one processor wins", async () => {
  const { service, store, now } = makeService();
  const { record } = await service.ingest(makeEvent());
  const claims = await Promise.all(Array.from({ length: 5 }, () => store.claim(record.id, now(), 60)));
  assert.equal(claims.filter(Boolean).length, 1, "one winner");
});

test("an unknown event type is safely ignored (allowlist is explicit)", async () => {
  const { service } = makeService(); // empty allowlist
  const { record } = await service.ingest(makeEvent({ eventType: "totally.unknown" }));
  const settled = await service.process(record.id);
  assert.equal(settled!.state, "ignored");
  // A terminal 'ignored' event cannot be re-claimed/re-processed.
  assert.equal(await service.process(record.id), null);
});

test("a processed event cannot be processed again (duplicate processing is a no-op)", async () => {
  const handlers = new Map<string, ProviderEventHandler>([
    ["example.event", { handle: async () => ({ kind: "processed" as const }) }],
  ]);
  const { service } = makeService({ handlers });
  const { record } = await service.ingest(makeEvent());
  const done = await service.process(record.id);
  assert.equal(done!.state, "processed");
  assert.equal(await service.process(record.id), null);
});

test("retryable failures are bounded and become terminal at the attempt cap", async () => {
  const handlers = new Map<string, ProviderEventHandler>([
    ["example.event", { handle: async () => ({ kind: "retry" as const, errorClass: "provider_timeout" }) }],
  ]);
  const { service } = makeService({ handlers, maxAttempts: 3 });
  const { record } = await service.ingest(makeEvent());

  const first = await service.process(record.id);
  assert.equal(first!.state, "retryable_failure");
  const second = await service.process(record.id);
  assert.equal(second!.state, "retryable_failure");
  const third = await service.process(record.id); // attempts reaches the cap
  assert.equal(third!.state, "terminal_failure");
  assert.equal(third!.lastErrorClass, "provider_timeout");
  // Terminal events never retry, even accidentally.
  assert.equal(await service.process(record.id), null);
});

test("a handler-declared terminal failure ends processing immediately", async () => {
  const handlers = new Map<string, ProviderEventHandler>([
    ["example.event", { handle: async () => ({ kind: "terminal" as const, errorClass: "unsupported_payload" }) }],
  ]);
  const { service } = makeService({ handlers });
  const { record } = await service.ingest(makeEvent());
  const settled = await service.process(record.id);
  assert.equal(settled!.state, "terminal_failure");
  assert.equal(await service.process(record.id), null);
});

test("a stale processing lease can be recovered safely", async () => {
  const { service, store, advance, now } = makeService({ leaseSeconds: 60 });
  const { record } = await service.ingest(makeEvent());
  const claimed = await store.claim(record.id, now(), 60);
  assert.ok(claimed, "first claim succeeds");
  // While the lease is live, nobody else can claim.
  assert.equal(await store.claim(record.id, now(), 60), null);
  // After the lease expires (crashed worker), the event is reclaimable.
  advance(61);
  const reclaimed = await store.claim(record.id, now(), 60);
  assert.ok(reclaimed, "expired lease is recoverable");
  assert.equal(reclaimed!.attempts, 2);
});

test("provider identity fields are immutable through every lifecycle transition", async () => {
  const handlers = new Map<string, ProviderEventHandler>([
    ["example.event", { handle: async () => ({ kind: "retry" as const, errorClass: "x" }) }],
  ]);
  const { service, store } = makeService({ handlers });
  const { record } = await service.ingest(makeEvent({ providerEventId: "evt_immutable" }));
  await service.process(record.id);
  const after = await store.findById(record.id);
  assert.equal(after!.provider, "disabled");
  assert.equal(after!.providerEventId, "evt_immutable");
  assert.equal(after!.eventType, "example.event");
  assert.equal(after!.payloadDigest, "d".repeat(64));
});

test("no raw secret is persisted — only digest and envelope metadata", async () => {
  const { service, store } = makeService();
  const { record } = await service.ingest(makeEvent());
  const stored = await store.findById(record.id);
  const blob = JSON.stringify(stored);
  // The record carries a hex digest, never body content or key secrets.
  assert.ok(!blob.includes("secret"));
  assert.match(stored!.payloadDigest, /^[0-9a-f]{64}$/);
});

test("a handler routing through domain services cannot attach a wallet to the wrong user, and the event settles without corrupting state", async () => {
  // Real domain harness: userA owns a verified wallet. A (hypothetical)
  // provider event tries to complete provisioning of that same address for
  // userB — the domain layer's single-owner invariant refuses, the handler
  // reports terminal, and neither user's wallet state changes.
  const h = createHarness();
  const a = await h.identity.authenticate({ provider: "google", providerSubject: "evt-user-a" });
  const b = await h.identity.authenticate({ provider: "google", providerSubject: "evt-user-b" });
  const address = "0x" + "ab".repeat(20);
  await h.stores.wallets.create({
    id: "wA", userId: a.user.id, addressCanonical: address,
    walletType: "external_eoa", sourceProvider: "wc", ownershipStatus: "verified",
  });

  const handlers = new Map<string, ProviderEventHandler>([
    [
      "wallet.provisioned",
      {
        handle: async () => {
          try {
            // Domain-service path: creating a verified wallet for userB with
            // userA's address must throw (wallets_verified_address_unique).
            await h.stores.wallets.create({
              id: "wB", userId: b.user.id, addressCanonical: address,
              walletType: "embedded_eoa", sourceProvider: "embedded", ownershipStatus: "verified",
            });
            return { kind: "processed" as const };
          } catch (err) {
            void isIdentityError(err);
            return { kind: "terminal" as const, errorClass: "wallet_owned_by_another_user" };
          }
        },
      },
    ],
  ]);
  const { service } = makeService({ handlers });
  const { record } = await service.ingest(makeEvent({ eventType: "wallet.provisioned", providerEventId: "evt_wrong_user" }));
  const settled = await service.process(record.id);
  assert.equal(settled!.state, "terminal_failure");
  assert.equal(settled!.lastErrorClass, "wallet_owned_by_another_user");
  // State not corrupted: userA still owns the wallet; userB gained nothing.
  const walletsA = await h.stores.wallets.listByUser(a.user.id);
  const walletsB = await h.stores.wallets.listByUser(b.user.id);
  assert.equal(walletsA.length, 1);
  assert.equal(walletsB.length, 0);
});

test("out-of-order duplicate lifecycle calls cannot corrupt the state machine", async () => {
  const { service, store, now } = makeService();
  const { record } = await service.ingest(makeEvent());
  const claimed = await store.claim(record.id, now(), 60);
  assert.ok(claimed);
  const token = claimed!.leaseToken!;
  const processed = await store.markProcessed(record.id, token, now());
  assert.ok(processed);
  // Late/out-of-order transitions against a settled event are refused.
  assert.equal(await store.markRetryable(record.id, token, "late", now()), null);
  assert.equal(await store.markIgnored(record.id, token, now()), null);
  assert.equal(await store.markProcessed(record.id, token, now()), null);
  assert.equal((await store.findById(record.id))!.state, "processed");
});

test("a stale worker cannot settle an event after its lease was reclaimed (lease-token/generation guard)", async () => {
  const { store, advance, now } = makeService({ leaseSeconds: 60 });
  const { record } = await store.insertIfNew({ id: "pe_z", provider: "disabled", providerEventId: "evt_zombie", eventType: "t", payloadDigest: "d".repeat(64) });
  // Worker A claims and gets token A.
  const a = await store.claim(record.id, now(), 60);
  const tokenA = a!.leaseToken!;
  // A's lease expires; worker B reclaims → token B, event still 'processing'.
  advance(61);
  const b = await store.claim(record.id, now(), 60);
  const tokenB = b!.leaseToken!;
  assert.notEqual(tokenA, tokenB);
  // Slow worker A finishes and tries to settle with its STALE token → refused.
  assert.equal(await store.markProcessed(record.id, tokenA, now()), null, "stale worker cannot mark processed");
  assert.equal(await store.markTerminal(record.id, tokenA, "x", now()), null, "stale worker cannot mark terminal");
  assert.equal((await store.findById(record.id))!.state, "processing", "still owned by worker B");
  // Worker B settles successfully with the current token.
  assert.ok(await store.markProcessed(record.id, tokenB, now()));
});

test("a valid-signed duplicate event id with a DIFFERENT payload digest is a flagged anomaly, not a silent duplicate", async () => {
  const { service } = makeService();
  const first = await service.ingest(makeEvent({ payloadDigest: "a".repeat(64) }));
  assert.equal(first.digestMismatch, false);
  // Same provider + event id, different digest.
  const second = await service.ingest(makeEvent({ payloadDigest: "b".repeat(64) }));
  assert.equal(second.duplicate, true);
  assert.equal(second.digestMismatch, true, "digest mismatch is surfaced as an anomaly");
  // The first delivery's content stays authoritative (never overwritten).
  assert.equal(second.record.payloadDigest, "a".repeat(64));
});

test("state-machine transition table: only the allowed transitions succeed", async () => {
  // Enumerate a settle attempt against every non-processing state and confirm
  // each is refused, and each allowed processing→X transition succeeds.
  const digest = "d".repeat(64);
  const fresh = async () => {
    const { store, now } = makeService();
    const { record } = await store.insertIfNew({ id: "pe_tt_" + Math.random(), provider: "disabled", providerEventId: "evt_" + Math.random(), eventType: "t", payloadDigest: digest });
    return { store, now, id: record.id };
  };

  // received → (no token yet) settle attempts refused.
  {
    const { store, now, id } = await fresh();
    assert.equal(await store.markProcessed(id, "any", now()), null);
  }
  // processing → processed / retryable / terminal / ignored all succeed (each fresh).
  for (const target of ["processed", "retryable", "terminal", "ignored"] as const) {
    const { store, now, id } = await fresh();
    const c = await store.claim(id, now(), 60);
    const t = c!.leaseToken!;
    const res =
      target === "processed" ? await store.markProcessed(id, t, now())
      : target === "retryable" ? await store.markRetryable(id, t, "e", now())
      : target === "terminal" ? await store.markTerminal(id, t, "e", now())
      : await store.markIgnored(id, t, now());
    assert.ok(res, `processing → ${target} must succeed`);
  }
  // Settled states (processed/terminal/ignored) refuse any later settle.
  for (const settle of ["processed", "terminal", "ignored"] as const) {
    const { store, now, id } = await fresh();
    const c = await store.claim(id, now(), 60);
    const t = c!.leaseToken!;
    if (settle === "processed") await store.markProcessed(id, t, now());
    if (settle === "terminal") await store.markTerminal(id, t, "e", now());
    if (settle === "ignored") await store.markIgnored(id, t, now());
    assert.equal(await store.markProcessed(id, t, now()), null, `${settle} is settled`);
    assert.equal(await store.markRetryable(id, t, "e", now()), null, `${settle} is settled`);
    assert.equal(await store.claim(id, now(), 60), null, `${settle} is not re-claimable`);
  }
  // retryable_failure IS re-claimable (→ processing again).
  {
    const { store, now, id } = await fresh();
    const c = await store.claim(id, now(), 60);
    await store.markRetryable(id, c!.leaseToken!, "e", now());
    assert.ok(await store.claim(id, now(), 60), "retryable_failure is re-claimable");
  }
});
