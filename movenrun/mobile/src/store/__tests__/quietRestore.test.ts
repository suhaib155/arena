/**
 * A player who opened the app offline and chose to continue locally is asked
 * about again, quietly, when the app returns to the foreground. Without this the
 * session stayed `unknown` until they found Retry, and nothing they saved was
 * queued for verification even after the phone was back online.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSecureSessionStore } from "../../lib/secureSession";
import { createTestSecureBackend } from "../../lib/secureSession.testBackend";
import { IdentityApiClient } from "../../services/identityApi";
import { resetAuthBootstrapForTests, shouldResumeRestoreQuietly, useAuthStore } from "../useAuthStore";

const FUTURE = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const TOKENS = () => ({
  accessToken: "access-1",
  accessTokenExpiresAt: FUTURE(),
  refreshToken: "refresh-1",
  refreshTokenExpiresAt: FUTURE(),
});
function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}
const state = () => useAuthStore.getState();

const offline = {
  status: "unknown" as const,
  restoreErrorCode: "service_unavailable" as const,
  restoreErrorAcknowledged: true,
  operation: "idle" as const,
};

test("only an acknowledged unreachable-service start is asked about again", () => {
  assert.equal(shouldResumeRestoreQuietly(offline), true);
  assert.equal(shouldResumeRestoreQuietly({ ...offline, restoreErrorAcknowledged: false }), false,
    "the error screen is still up: the player's own Retry owns it");
  assert.equal(shouldResumeRestoreQuietly({ ...offline, restoreErrorCode: "secure_storage_unavailable" }), false,
    "asking again cannot fix an unreadable keystore");
  assert.equal(shouldResumeRestoreQuietly({ ...offline, restoreErrorCode: null }), false);
  for (const status of ["signedIn", "signedOut", "restoring"] as const) {
    assert.equal(shouldResumeRestoreQuietly({ ...offline, status }), false);
  }
  assert.equal(shouldResumeRestoreQuietly({ ...offline, operation: "signingIn" as const }), false,
    "never races an auth request");
});

async function offlineStart(online: () => boolean) {
  const store = createSecureSessionStore(createTestSecureBackend());
  await store.save(TOKENS());
  let calls = 0;
  globalThis.fetch = (async (input: string) => {
    calls += 1;
    if (!online()) throw new TypeError("Network request failed");
    const url = String(input);
    if (url.endsWith("/identity/me")) {
      return json(200, { user: { id: "usr_1", status: "active", createdAt: FUTURE() }, session: {}, identities: [] });
    }
    if (url.endsWith("/identity/wallets")) return json(200, { wallets: [] });
    return json(404, {});
  }) as typeof fetch;
  resetAuthBootstrapForTests();
  useAuthStore.setState({
    status: "unknown", operation: "idle", lastRestore: null, authErrorCode: null,
    restoreErrorCode: null, restoreErrorAcknowledged: false, user: null, identities: [], wallets: [],
    client: new IdentityApiClient({ baseUrl: "https://identity.test", store }),
  });
  await state().initialize();
  assert.equal(state().restoreErrorCode, "service_unavailable");
  return { calls: () => calls };
}

test("back online, a foreground return restores the session without showing the error screen", async () => {
  let online = false;
  await offlineStart(() => online);
  state().acknowledgeRestoreError();
  online = true;

  await state().resumeRestoreQuietly();

  assert.equal(state().status, "signedIn");
  assert.equal(state().restoreErrorCode, null);
});

test("still offline, the quiet attempt never shows a spinner or re-raises the error screen", async () => {
  await offlineStart(() => false);
  state().acknowledgeRestoreError();
  const seen: string[] = [];
  const unsub = useAuthStore.subscribe((s) => { seen.push(s.status); });

  await state().resumeRestoreQuietly();
  unsub();

  assert.ok(!seen.includes("restoring"), "no restoring flash");
  assert.equal(state().status, "unknown", "no false signed-out claim");
  assert.equal(state().restoreErrorAcknowledged, true, "the player is not sent back to the error screen");
  assert.equal(state().restoreErrorCode, "service_unavailable");
});

test("before the player acknowledged the error, a foreground return asks nothing", async () => {
  let online = false;
  const net = await offlineStart(() => online);
  online = true;
  const before = net.calls();

  await state().resumeRestoreQuietly();

  assert.equal(net.calls(), before);
  assert.equal(state().status, "unknown");
});

test("the root navigator resumes the restore when the app returns to the foreground", () => {
  const s = readFileSync(join(process.cwd(), "app/_layout.tsx"), "utf8");
  assert.match(s, /AppState\.addEventListener\("change"[\s\S]{0,120}next === "active"\) void resumeRestoreQuietly\(\)/);
});

test("a sign-in that starts during a slow quiet restore waits for it, so its tokens survive", async () => {
  /* The old stored refresh token is dead; the restore answers only after the
     sign-in has begun. Without the wait, the rejected restore would discard
     the credentials the sign-in just saved and leave the player signed out. */
  const store = createSecureSessionStore(createTestSecureBackend());
  await store.save(TOKENS());
  let releaseRestore: () => void = () => {};
  const restoreGate = new Promise<void>((r) => { releaseRestore = r; });
  let phase: "offline" | "slow" | "online" = "offline";
  globalThis.fetch = (async (input: string) => {
    if (phase === "offline") throw new TypeError("Network request failed");
    if (phase === "slow") {
      await restoreGate;
      return json(401, { error: { code: "session_expired" } });
    }
    const url = String(input);
    if (url.endsWith("/identity/me")) {
      return json(200, { user: { id: "usr_new", status: "active", createdAt: FUTURE() }, session: {}, identities: [] });
    }
    if (url.endsWith("/identity/wallets")) return json(200, { wallets: [] });
    return json(404, {});
  }) as typeof fetch;
  resetAuthBootstrapForTests();
  const client = new IdentityApiClient({ baseUrl: "https://identity.test", store });
  useAuthStore.setState({
    status: "unknown", operation: "idle", lastRestore: null, authErrorCode: null,
    restoreErrorCode: null, restoreErrorAcknowledged: false, user: null, identities: [], wallets: [], client,
  });
  await state().initialize();
  state().acknowledgeRestoreError();
  phase = "slow";

  const quiet = state().resumeRestoreQuietly();
  let obtainedWhileRestoring = false;
  const signIn = state().signInWith(async () => {
    obtainedWhileRestoring = restoreRunning;
    phase = "online";
    const fresh = { ...TOKENS(), accessToken: "access-new", refreshToken: "refresh-new" };
    await store.save(fresh);
    return { user: { id: "usr_new", status: "active", createdAt: FUTURE() } } as never;
  });
  let restoreRunning = true;
  releaseRestore();
  await quiet;
  restoreRunning = false;
  await signIn;

  assert.equal(obtainedWhileRestoring, false, "the sign-in waited for the restore to settle");
  assert.equal(state().status, "signedIn");
  assert.equal(state().user?.id, "usr_new");
  const kept = await store.load();
  assert.equal(kept?.refreshToken, "refresh-new", "the new sign-in's credentials were not discarded");
});
