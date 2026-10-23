/**
 * The provider-deletion queue (`pending_auth_user_deletions`).
 *
 * A Supabase user is removed at the provider when its MovenRun account is
 * erased, refused at the cap, or abandoned. The provider call can fail, so
 * the subject is queued and retried. These tests cover what happens when the
 * person comes back while a deletion is still pending, when a response is
 * lost, when the provider cannot be read, and when many rows are stuck.
 *
 * Policy (docs/security/A2_DELETION_QUEUE.md): a provider user that is mapped
 * to an active MovenRun account, or that signed in again after the deletion
 * was requested, is never deleted by the queue. The queue row is retired
 * instead, and an unmapped user is left to the orphan sweep.
 *
 * Every scenario runs on the in-memory stores and on PostgreSQL. The database
 * half is skipped, loudly, when MOVENRUN_TEST_DATABASE_URL is not set, and
 * builds into a database of its own. All ids are synthetic.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Db } from "../../db/client.js";
import { createInMemoryStores } from "../repositories/memory.js";
import { createDrizzleStores } from "../repositories/drizzle/stores.js";
import { createDrizzleSignInStores, createInMemorySignInStores, type SignInStores } from "../repositories/signInStores.js";
import type { IdentityStores } from "../repositories/interfaces.js";
import { EoaSignatureVerifier } from "../providers/eoaVerifier.js";
import { SupabaseAuthError, type ProviderUserSummary } from "../providers/supabaseAuth.js";
import { isIdentityError } from "../domain/errors.js";
import { SupabaseSignInService } from "./supabaseSignIn.service.js";

const DATABASE_URL = process.env.MOVENRUN_TEST_DATABASE_URL;
const DATABASE = "movenrun_test_deletion_queue";
const BACKEND = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const T0 = new Date("2026-10-13T12:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;

/** Synthetic Supabase user ids. */
const sub = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${n.toString(16).padStart(12, "0")}`;

/** A stand-in for the provider's admin API. */
function fakeProvider(now: () => Date) {
  const users = new Map<string, { createdAt: Date; lastSignInAt: Date | null }>();
  const deleted: string[] = [];
  const failDelete = new Set<string>();
  const failLookup = new Set<string>();
  const hooks: { onLookup?: (subject: string) => Promise<void>; afterDelete?: (subject: string) => Promise<void> } = {};
  return {
    users,
    deleted,
    failDelete,
    failLookup,
    hooks,
    create(subject: string, at = now()) { users.set(subject, { createdAt: at, lastSignInAt: at }); },
    signIn(subject: string, at = now()) { users.get(subject)!.lastSignInAt = at; },
    auth: {
      async signInWithEthereum(): Promise<{ accessToken: string }> { throw new Error("not used"); },
      async deleteUser(subject: string) {
        if (failDelete.has(subject)) throw new SupabaseAuthError("unavailable");
        deleted.push(subject);
        users.delete(subject);
        await hooks.afterDelete?.(subject);
      },
      async listUsers(page: number, perPage: number): Promise<ProviderUserSummary[]> {
        if (failLookup.has("*list*")) throw new SupabaseAuthError("unavailable");
        return [...users.entries()].map(([id, u]) => ({ id, ...u })).slice((page - 1) * perPage, page * perPage);
      },
      async getUser(subject: string): Promise<ProviderUserSummary | null> {
        await hooks.onLookup?.(subject);
        if (failLookup.has(subject)) throw new SupabaseAuthError("unavailable");
        const u = users.get(subject);
        return u ? { id: subject, ...u } : null;
      },
    },
  };
}

interface Backend {
  name: string;
  skip: string | false;
  make(now: () => Date): Promise<{ stores: IdentityStores; signIn: SignInStores; queued(): Promise<string[]> }>;
}

let pool: pg.Pool | null = null;
let db: Db | null = null;

const backends: Backend[] = [
  {
    name: "memory",
    skip: false,
    async make(now) {
      const stores = createInMemoryStores(now, { maxAccounts: 1000, maxNewPerHour: 1000 });
      const signIn = createInMemorySignInStores();
      const far = new Date(T0.getTime() + 10_000 * 24 * HOUR);
      return { stores, signIn, queued: async () => (await signIn.pendingAuthDeletions.due(far, 0, 10_000)).sort() };
    },
  },
  {
    name: "postgres",
    skip: DATABASE_URL ? false : "MOVENRUN_TEST_DATABASE_URL is not set — the PostgreSQL path was NOT verified",
    async make() {
      await pool!.query("truncate pending_auth_user_deletions, auth_identities, auth_sessions, security_audit_events, users cascade");
      await pool!.query("update account_capacity set max_accounts = 1000, max_new_per_hour = 1000");
      return {
        stores: createDrizzleStores(db!),
        signIn: createDrizzleSignInStores(db!),
        queued: async () => (await pool!.query("select subject from pending_auth_user_deletions order by subject")).rows.map((r) => r.subject as string),
      };
    },
  },
];

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

before(async () => {
  if (!DATABASE_URL) return;
  const admin = new pg.Pool({ connectionString: DATABASE_URL });
  await admin.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DATABASE}`);
  await admin.end();
  pool = new pg.Pool({ connectionString: withDatabase(DATABASE_URL, DATABASE) });
  const journal = JSON.parse(readFileSync(join(BACKEND, "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] };
  for (const entry of journal.entries) {
    const sqlText = readFileSync(join(BACKEND, "drizzle", `${entry.tag}.sql`), "utf8");
    for (const statement of sqlText.split("--> statement-breakpoint")) if (statement.trim()) await pool.query(statement);
  }
  db = drizzle(pool) as unknown as Db;
});

after(async () => {
  await pool?.end();
});

async function harness(backend: Backend) {
  let clock = T0;
  const now = () => clock;
  const { stores, signIn, queued } = await backend.make(now);
  const provider = fakeProvider(now);
  const logs: string[] = [];
  const service = new SupabaseSignInService({
    tokens: { async verify() { throw new Error("not used"); } },
    auth: provider.auth,
    stores,
    signIn,
    eoaVerifier: new EoaSignatureVerifier(),
    config: { authDomain: "movenrun.test", chainId: 8453 },
    now,
    log: { warn: (line: string) => { logs.push(line); }, info: (line: string) => { logs.push(line); } },
  } as ConstructorParameters<typeof SupabaseSignInService>[0]);
  /** A new MovenRun account mapped to `subject`, as a sign-in creates one. */
  const mapAccount = (subject: string) =>
    stores.createUserWithIdentity({ userId: randomUUID(), identity: { id: randomUUID(), provider: "supabase", providerSubject: subject, assuranceLevel: "aal2" } });
  return { service, stores, signIn, provider, queued, logs, mapAccount, advance: (ms: number) => { clock = new Date(clock.getTime() + ms); }, now };
}

async function errorCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (isIdentityError(err)) return err.code;
    throw err;
  }
  return "ok";
}

for (const backend of backends) {
  const t = (name: string, fn: () => Promise<void>) => test(`[${backend.name}] ${name}`, { skip: backend.skip }, fn);

  t("a person who signs back in before a pending deletion finishes keeps the new account and the row does not stay due", async () => {
    const h = await harness(backend);
    const S = sub(1);
    h.provider.create(S);
    // Account erased; the provider is down, so the deletion is queued.
    h.provider.failDelete.add(S);
    assert.deepEqual(await h.service.removeProviderUsers([S]), { removed: [], pending: [S] });
    assert.deepEqual(await h.queued(), [S]);
    // Before the retry, the same Google account signs in again: the provider
    // user still exists, and a new MovenRun account is mapped to it.
    h.advance(2 * MIN);
    h.provider.signIn(S);
    await h.mapAccount(S);
    h.provider.failDelete.delete(S);
    for (let i = 0; i < 6; i++) {
      h.advance(30 * MIN);
      await h.service.retryPendingDeletions();
    }
    assert.deepEqual(h.provider.deleted, [], "the newly established account's provider user was deleted");
    assert.deepEqual(await h.queued(), [], "the superseded row is still queued and due on every run");
  });

  t("a provider sign-in after the request, not yet mapped, is not deleted by the queue", async () => {
    const h = await harness(backend);
    const S = sub(2);
    h.provider.create(S);
    h.provider.failDelete.add(S);
    await h.service.removeProviderUsers([S]);
    h.provider.failDelete.delete(S);
    // The person is signing in right now: Supabase has the new sign-in, the
    // API has not mapped the account yet.
    h.advance(11 * MIN);
    h.provider.signIn(S);
    await h.service.retryPendingDeletions();
    assert.deepEqual(h.provider.deleted, []);
    // Retired from the queue; an abandoned sign-in is the orphan sweep's job.
    assert.deepEqual(await h.queued(), []);
  });

  t("a sign-in that arrives while a deletion is in flight is refused, and one that arrives first retires the row", async () => {
    const h = await harness(backend);
    const S = sub(3);
    h.provider.create(S);
    h.provider.failDelete.add(S);
    await h.service.removeProviderUsers([S]);
    h.provider.failDelete.delete(S);
    h.advance(11 * MIN);
    // The retry owns the row while it talks to the provider; a sign-in that
    // lands in that window must not establish an account on a user about to go.
    let during = "";
    h.provider.hooks.onLookup = async () => {
      h.provider.hooks.onLookup = undefined;
      during = await errorCode(h.service.adoptPendingDeletion(S));
    };
    assert.equal(await h.service.retryPendingDeletions(), 1);
    assert.equal(during, "provisioning_failed");
    assert.deepEqual(h.provider.deleted, [S]);
    assert.deepEqual(await h.queued(), []);

    // A sign-in that reaches the API first takes the subject over: the row is
    // retired before the account is mapped and the retry finds nothing.
    const R = sub(4);
    h.provider.create(R);
    h.provider.failDelete.add(R);
    await h.service.removeProviderUsers([R]);
    h.provider.failDelete.delete(R);
    assert.equal(await errorCode(h.service.adoptPendingDeletion(R)), "ok");
    await h.mapAccount(R);
    h.advance(11 * MIN);
    assert.equal(await h.service.retryPendingDeletions(), 0);
    assert.deepEqual(h.provider.deleted, [S]);
    assert.deepEqual(await h.queued(), []);
    // Idempotent: adopting a subject with nothing queued is a no-op.
    assert.equal(await errorCode(h.service.adoptPendingDeletion(R)), "ok");
  });

  t("an expired wallet code does not delete a wallet that is signing in directly right now", async () => {
    const h = await harness(backend);
    const S = sub(9);
    // The wallet signed in for a browser handoff and the code was never collected.
    h.provider.create(S);
    await h.signIn.walletHandoffs.create({ codeHash: "a".repeat(64), codeChallenge: "c".repeat(43), subject: S, expiresAt: new Date(h.now().getTime() + 5 * MIN) });
    // Six minutes on, the same wallet signs in directly in the app. Supabase has
    // the sign-in, the API has passed adoption and is creating the account.
    h.advance(6 * MIN);
    h.provider.signIn(S);
    assert.equal(await errorCode(h.service.adoptPendingDeletion(S)), "ok");
    // Maintenance runs before that account is committed.
    await h.service.expireHandoffs();
    await h.mapAccount(S);
    assert.deepEqual(h.provider.deleted, [], "the provider user behind a sign-in in progress was deleted");
  });

  t("a lost response after the provider deleted the user converges without a second account effect", async () => {
    const h = await harness(backend);
    const S = sub(5);
    h.provider.create(S);
    // The provider deletes the user, but the response never reaches us.
    h.provider.hooks.afterDelete = async () => {
      h.provider.hooks.afterDelete = undefined;
      throw new SupabaseAuthError("unavailable");
    };
    assert.deepEqual(await h.service.removeProviderUsers([S]), { removed: [], pending: [S] });
    assert.deepEqual(await h.queued(), [S]);
    // Same subject is never handed to a new account (Supabase ids are not
    // reused), so the retry may confirm the deletion idempotently.
    h.advance(11 * MIN);
    assert.equal(await h.service.retryPendingDeletions(), 1);
    assert.deepEqual(await h.queued(), []);
    // A worker that died after taking the row is recovered after its lease.
    const D = sub(6);
    h.provider.create(D);
    await h.signIn.pendingAuthDeletions.add([D], h.now());
    assert.ok(await h.signIn.pendingAuthDeletions.claim(D, h.now(), { leaseMs: 10 * MIN }));
    h.advance(5 * MIN);
    assert.equal(await h.service.retryPendingDeletions(), 0, "a live lease was taken over");
    h.advance(30 * MIN);
    assert.equal(await h.service.retryPendingDeletions(), 1);
    assert.deepEqual(await h.queued(), []);
  });

  t("two workers retrying at once: one owns the row, the provider is called once", async () => {
    const h = await harness(backend);
    const subjects = [sub(401), sub(402), sub(403)];
    for (const s of subjects) {
      h.provider.create(s);
      h.provider.failDelete.add(s);
      await h.service.removeProviderUsers([s]);
      h.provider.failDelete.delete(s);
    }
    h.advance(11 * MIN);
    let lookups = 0;
    h.provider.hooks.onLookup = async () => { lookups += 1; await new Promise((r) => setTimeout(r, 20)); };
    const [a, b] = await Promise.all([h.service.retryPendingDeletions(), h.service.retryPendingDeletions()]);
    assert.equal(a + b, 3);
    assert.equal(lookups, 3);
    assert.deepEqual([...h.provider.deleted].sort(), subjects);
    assert.deepEqual(await h.queued(), []);
  });

  t("the queue and the orphan sweep fail closed when the provider cannot be read", async () => {
    const h = await harness(backend);
    const S = sub(7);
    h.provider.create(S);
    h.provider.failDelete.add(S);
    await h.service.removeProviderUsers([S]);
    h.provider.failDelete.delete(S);
    h.provider.failLookup.add(S);
    h.advance(11 * MIN);
    assert.equal(await h.service.retryPendingDeletions(), 0);
    assert.deepEqual(h.provider.deleted, [], "deleted without reading the provider user");
    assert.deepEqual(await h.queued(), [S]);
    h.provider.failLookup.delete(S);
    h.advance(30 * MIN);
    assert.equal(await h.service.retryPendingDeletions(), 1);

    // Orphan sweep: an old, unmapped provider user whose re-read fails is kept.
    const O = sub(8);
    h.provider.create(O, new Date(h.now().getTime() - 3 * HOUR));
    h.provider.failLookup.add(O);
    await assert.rejects(h.service.sweepOrphanProviderUsers({ graceMs: HOUR }));
    assert.ok(!(h.provider.deleted as string[]).includes(O));
    // A failed listing deletes nothing either.
    h.provider.failLookup.delete(O);
    h.provider.failLookup.add("*list*");
    await assert.rejects(h.service.sweepOrphanProviderUsers({ graceMs: HOUR }));
    assert.ok(!(h.provider.deleted as string[]).includes(O));
    h.provider.failLookup.delete("*list*");
    assert.equal(await h.service.sweepOrphanProviderUsers({ graceMs: HOUR }), 1);
  });

  t("more than 50 stuck rows cannot starve a new deletion", async () => {
    const h = await harness(backend);
    // 60 rows superseded by a new account (the A-2 case) and 60 rows the
    // provider keeps refusing, all older than one genuine deletion.
    for (let i = 0; i < 60; i++) {
      const s = sub(100 + i);
      h.provider.create(s, new Date(T0.getTime() - 2 * HOUR));
      h.provider.failDelete.add(s);
      await h.service.removeProviderUsers([s]);
      h.provider.failDelete.delete(s);
      h.provider.signIn(s, new Date(T0.getTime() - 2 * HOUR));
      await h.mapAccount(s);
    }
    for (let i = 0; i < 60; i++) {
      const s = sub(200 + i);
      h.provider.create(s, new Date(T0.getTime() - 2 * HOUR));
      h.provider.failDelete.add(s);
      await h.service.removeProviderUsers([s]);
    }
    const G = sub(999);
    h.provider.create(G, new Date(T0.getTime() - 2 * HOUR));
    h.provider.failDelete.add(G);
    h.advance(MIN);
    await h.service.removeProviderUsers([G]);
    h.provider.failDelete.delete(G);
    // The maintenance cadence: every five minutes, a batch of 50.
    for (let i = 0; i < 12 && !h.provider.deleted.includes(G); i++) {
      h.advance(5 * MIN);
      await h.service.retryPendingDeletions(50);
    }
    assert.ok(h.provider.deleted.includes(G), "the genuine deletion never got a slot in the batch");
    assert.equal(h.provider.deleted.filter((s) => s.startsWith("aaaaaaaa") && Number.parseInt(s.slice(-12), 16) < 200).length, 0);
    // The refused rows keep being retried, but with a growing back-off.
    assert.equal((await h.queued()).length, 60);
  });

  t("an aggregate count of rows pending over 24 hours is reported without ids", async () => {
    const h = await harness(backend);
    const subjects = [sub(301), sub(302), sub(303)];
    for (const s of subjects) {
      h.provider.create(s);
      h.provider.failDelete.add(s);
      await h.service.removeProviderUsers([s]);
    }
    h.advance(20 * HOUR);
    const fresh = sub(304);
    h.provider.create(fresh);
    h.provider.failDelete.add(fresh);
    await h.service.removeProviderUsers([fresh]);
    h.advance(5 * HOUR);
    const report = await h.service.reportPendingDeletions();
    assert.deepEqual(report, { pending: 4, overdue: 3, inFlight: 0 });
    assert.equal(h.logs.length, 1);
    assert.match(h.logs[0], /3/);
    for (const s of [...subjects, fresh]) assert.ok(!h.logs.join("\n").includes(s));
    // Nothing overdue, nothing logged.
    h.logs.length = 0;
    for (const s of [...subjects, fresh]) h.provider.failDelete.delete(s);
    h.advance(24 * HOUR);
    for (let i = 0; i < 3; i++) { await h.service.retryPendingDeletions(); h.advance(HOUR); }
    assert.deepEqual(await h.service.reportPendingDeletions(), { pending: 0, overdue: 0, inFlight: 0 });
    assert.equal(h.logs.length, 0);
  });
}
