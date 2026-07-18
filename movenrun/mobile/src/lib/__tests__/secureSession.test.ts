/**
 * Secure session storage — offline node tests over the platform-free core
 * (src/lib/secureSession.ts) with the TEST-ONLY in-memory backend. The
 * production expo-secure-store adapter shares this exact core, so every rule
 * proven here (validation, expiry, malformed deletion, fail-closed behavior)
 * is the production behavior; only the key-value backend differs.
 *
 * Also enforces the storage security guards by scanning the source tree:
 * no production import of the test backend, and no AsyncStorage / persisted-
 * Zustand usage in any credential-handling module.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  createSecureSessionStore,
  getSecureSessionStore,
  setSecureSessionStore,
  SESSION_STORAGE_KEY,
  type SecureSessionTokens,
} from "../secureSession";
import { createTestSecureBackend } from "../secureSession.testBackend";
import { IdentityApiClient } from "../../services/identityApi";

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const TOKENS: SecureSessionTokens = {
  accessToken: "at-1",
  accessTokenExpiresAt: FUTURE,
  refreshToken: "rt-1",
  refreshTokenExpiresAt: FUTURE,
};

test("write/read round trip returns exactly what was saved", async () => {
  const backend = createTestSecureBackend();
  const store = createSecureSessionStore(backend);
  await store.save(TOKENS);
  assert.deepEqual(await store.load(), TOKENS);
});

test("clear removes the stored session", async () => {
  const backend = createTestSecureBackend();
  const store = createSecureSessionStore(backend);
  await store.save(TOKENS);
  await store.clear();
  assert.equal(await store.load(), null);
  assert.equal(backend.map.size, 0);
});

test("malformed stored data is deleted and never returned", async () => {
  const backend = createTestSecureBackend();
  backend.map.set(SESSION_STORAGE_KEY, "{not valid json");
  const store = createSecureSessionStore(backend);
  assert.equal(await store.load(), null);
  assert.equal(backend.map.has(SESSION_STORAGE_KEY), false, "corrupt value deleted");
  // Structurally-invalid JSON (missing fields / extra fields) too.
  backend.map.set(SESSION_STORAGE_KEY, JSON.stringify({ accessToken: "x" }));
  assert.equal(await store.load(), null);
  assert.equal(backend.map.has(SESSION_STORAGE_KEY), false);
  backend.map.set(SESSION_STORAGE_KEY, JSON.stringify({ ...TOKENS, extraField: "reject-me" }));
  assert.equal(await store.load(), null);
  assert.equal(backend.map.has(SESSION_STORAGE_KEY), false, "only minimum session material may persist");
});

test("an expired session is deleted on load", async () => {
  const backend = createTestSecureBackend();
  const past = new Date(Date.now() - 1000).toISOString();
  backend.map.set(SESSION_STORAGE_KEY, JSON.stringify({ ...TOKENS, refreshTokenExpiresAt: past }));
  const store = createSecureSessionStore(backend);
  assert.equal(await store.load(), null);
  assert.equal(backend.map.has(SESSION_STORAGE_KEY), false, "expired session removed");
});

test("storage unavailable on read fails closed as no-session (never a guess, never a fallback)", async () => {
  const backend = createTestSecureBackend({ failGet: true });
  const store = createSecureSessionStore(backend);
  assert.equal(await store.load(), null);
});

test("a write failure propagates — a failed persist is never silent", async () => {
  const backend = createTestSecureBackend({ failSet: true });
  const store = createSecureSessionStore(backend);
  await assert.rejects(store.save(TOKENS), /write failure/);
});

test("a clear failure propagates — a failed credential wipe is never silent", async () => {
  const backend = createTestSecureBackend();
  const store = createSecureSessionStore(backend);
  await store.save(TOKENS);
  backend.options.failDelete = true;
  await assert.rejects(store.clear(), /delete failure/);
});

test("restart restore: a NEW store instance over the same backend restores only valid structured data", async () => {
  const backend = createTestSecureBackend();
  await createSecureSessionStore(backend).save(TOKENS);
  // "Restart": fresh store instance, same durable backend.
  const restored = await createSecureSessionStore(backend).load();
  assert.deepEqual(restored, TOKENS);
});

test("the registry has no insecure fallback: uninstalled access throws", () => {
  setSecureSessionStore(null as never); // reset
  assert.throws(() => getSecureSessionStore(), /not installed/);
});

test("sign-out clears the secure store even when the revoke API call fails", async () => {
  const backend = createTestSecureBackend();
  const store = createSecureSessionStore(backend);
  await store.save(TOKENS);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { code: "session_invalid" } }), { status: 401 })) as typeof fetch;
  try {
    const client = new IdentityApiClient({ baseUrl: "http://127.0.0.1:9", store });
    await client.signOut().catch(() => undefined); // API failure is surfaced...
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(await store.load(), null, "...but local credentials are cleared regardless");
});

test("revoke-all (sign out everywhere) calls the server then clears the secure store", async () => {
  const backend = createTestSecureBackend();
  const store = createSecureSessionStore(backend);
  await store.save(TOKENS);
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ revoked: 2 }), { status: 200 });
  }) as typeof fetch;
  try {
    const client = new IdentityApiClient({ baseUrl: "http://127.0.0.1:9", store });
    await client.signOutEverywhere();
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.ok(calls.some((c) => c.includes("/identity/session/revoke-all")));
  assert.equal(await store.load(), null);
});

// ---- source-tree guards ----------------------------------------------------

// The package test script runs from movenrun/mobile, so cwd anchors src/.
const SRC_ROOT = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

test("production code never imports the test-only in-memory backend", () => {
  const offenders = walk(SRC_ROOT)
    .filter((f) => !f.includes("__tests__"))
    .filter((f) => readFileSync(f, "utf8").includes("secureSession.testBackend"));
  assert.deepEqual(offenders, [], `test backend imported by: ${offenders.join(", ")}`);
});

test("no credential-handling module touches AsyncStorage or persisted Zustand", () => {
  const credentialModules = [
    join(SRC_ROOT, "lib", "secureSession.ts"),
    join(SRC_ROOT, "lib", "secureSessionExpo.ts"),
    join(SRC_ROOT, "services", "identityApi.ts"),
    join(SRC_ROOT, "store", "useAuthStore.ts"),
  ];
  for (const file of credentialModules) {
    const src = readFileSync(file, "utf8");
    assert.ok(!/@react-native-async-storage/.test(src), `${file} must not import AsyncStorage`);
    assert.ok(!/zustand\/middleware/.test(src), `${file} must not use zustand persistence middleware`);
    assert.ok(!/\bpersist\s*\(/.test(src), `${file} must not persist store state`);
  }
});
