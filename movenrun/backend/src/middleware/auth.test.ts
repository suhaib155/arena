/**
 * requireWalletAuth() unit tests — pure mock req/res, no real Express app, no
 * DB/Redis/oracle key needed (chainId/maxAgeSeconds are passed explicitly so
 * getConfig() is never invoked). This is the same hermetic-testing approach
 * used throughout backend/src/services/*.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import {
  requireWalletAuth,
  buildAuthHeaders,
  AUTH_HEADER_ADDRESS,
  AUTH_HEADER_SIGNATURE,
  AUTH_HEADER_NONCE,
  AUTH_HEADER_ISSUED_AT,
  _resetNonceCacheForTests,
} from "./auth.js";

const TEST_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const WALLET = new ethers.Wallet(TEST_PK);
const OTHER_WALLET = ethers.Wallet.createRandom();
const CHAIN_ID = 84532n;
const MAX_AGE = 300;

function mockReqRes(headers: Record<string, string>, body: unknown, overrides: Partial<{ method: string; path: string }> = {}) {
  const lowerHeaders = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const res = {
    statusCode: null as number | null,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  const req = {
    header: (name: string) => lowerHeaders[name.toLowerCase()],
    body: body ?? {},
    rawBody: Buffer.from(JSON.stringify(body ?? {})),
    method: overrides.method ?? "POST",
    originalUrl: overrides.path ?? "/gps/submit",
    path: overrides.path ?? "/gps/submit",
    movenrunAuth: undefined as { address: string } | undefined,
  };
  return { req, res };
}

async function runMiddleware(req: ReturnType<typeof mockReqRes>["req"], res: ReturnType<typeof mockReqRes>["res"]) {
  let nextCalled = false;
  const middleware = requireWalletAuth({ maxAgeSeconds: MAX_AGE, chainId: CHAIN_ID });
  middleware(req as never, res as never, () => {
    nextCalled = true;
  });
  return nextCalled;
}

test("valid signed request passes auth and attaches the verified address", async () => {
  _resetNonceCacheForTests();
  const body = { walletAddress: WALLET.address, points: [] };
  const headers = await buildAuthHeaders({ wallet: WALLET, method: "POST", path: "/gps/submit", body, chainId: CHAIN_ID });
  const { req, res } = mockReqRes(headers, body);

  const nextCalled = await runMiddleware(req, res);

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
  assert.equal(req.movenrunAuth?.address, WALLET.address.toLowerCase());
});

test("rejects a request missing auth headers", async () => {
  _resetNonceCacheForTests();
  const { req, res } = mockReqRes({}, { walletAddress: WALLET.address });

  const nextCalled = await runMiddleware(req, res);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test("rejects a bad signature", async () => {
  _resetNonceCacheForTests();
  const body = { walletAddress: WALLET.address };
  const headers = await buildAuthHeaders({ wallet: WALLET, method: "POST", path: "/gps/submit", body, chainId: CHAIN_ID });
  headers[AUTH_HEADER_SIGNATURE] = headers[AUTH_HEADER_SIGNATURE].slice(0, -4) + "dead";
  const { req, res } = mockReqRes(headers, body);

  const nextCalled = await runMiddleware(req, res);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test("rejects a signature that recovers to a different address than claimed", async () => {
  _resetNonceCacheForTests();
  const body = { walletAddress: WALLET.address };
  // Signed by OTHER_WALLET but claims to be WALLET.
  const headers = await buildAuthHeaders({ wallet: OTHER_WALLET, method: "POST", path: "/gps/submit", body, chainId: CHAIN_ID });
  headers[AUTH_HEADER_ADDRESS] = WALLET.address;
  const { req, res } = mockReqRes(headers, body);

  const nextCalled = await runMiddleware(req, res);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.match((res.body as { error: string }).error, /does not match claimed address/);
});

test("rejects an expired issuedAt", async () => {
  _resetNonceCacheForTests();
  const body = { walletAddress: WALLET.address };
  const staleIssuedAt = Date.now() - (MAX_AGE + 60) * 1000;
  const headers = await buildAuthHeaders({
    wallet: WALLET,
    method: "POST",
    path: "/gps/submit",
    body,
    chainId: CHAIN_ID,
    issuedAt: staleIssuedAt,
  });
  const { req, res } = mockReqRes(headers, body);

  const nextCalled = await runMiddleware(req, res);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.match((res.body as { error: string }).error, /expired|out of range/);
});

test("rejects an issuedAt too far in the future", async () => {
  _resetNonceCacheForTests();
  const body = { walletAddress: WALLET.address };
  const futureIssuedAt = Date.now() + 60_000;
  const headers = await buildAuthHeaders({
    wallet: WALLET,
    method: "POST",
    path: "/gps/submit",
    body,
    chainId: CHAIN_ID,
    issuedAt: futureIssuedAt,
  });
  const { req, res } = mockReqRes(headers, body);

  const nextCalled = await runMiddleware(req, res);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test("rejects a replayed nonce even with an otherwise-valid signature", async () => {
  _resetNonceCacheForTests();
  const body = { walletAddress: WALLET.address };
  const headers = await buildAuthHeaders({ wallet: WALLET, method: "POST", path: "/gps/submit", body, chainId: CHAIN_ID });

  const first = mockReqRes(headers, body);
  const firstNext = await runMiddleware(first.req, first.res);
  assert.equal(firstNext, true, "first use of the nonce should succeed");

  const second = mockReqRes(headers, body);
  const secondNext = await runMiddleware(second.req, second.res);
  assert.equal(secondNext, false, "replayed nonce must be rejected");
  assert.equal(second.res.statusCode, 401);
  assert.match((second.res.body as { error: string }).error, /Nonce already used/);
});

test("a garbage signature does not burn the nonce (so the real request can still succeed)", async () => {
  _resetNonceCacheForTests();
  const body = { walletAddress: WALLET.address };
  const nonce = "shared-nonce-1";
  const badHeaders = await buildAuthHeaders({ wallet: WALLET, method: "POST", path: "/gps/submit", body, chainId: CHAIN_ID, nonce });
  badHeaders[AUTH_HEADER_SIGNATURE] = "0x" + "00".repeat(65);

  const bad = mockReqRes(badHeaders, body);
  const badNext = await runMiddleware(bad.req, bad.res);
  assert.equal(badNext, false);
  assert.equal(bad.res.statusCode, 401);

  const goodHeaders = await buildAuthHeaders({ wallet: WALLET, method: "POST", path: "/gps/submit", body, chainId: CHAIN_ID, nonce });
  const good = mockReqRes(goodHeaders, body);
  const goodNext = await runMiddleware(good.req, good.res);
  assert.equal(goodNext, true, "the real signed request with the same nonce should still succeed");
});

test("rejects a malformed claimed address", async () => {
  _resetNonceCacheForTests();
  const body = { walletAddress: WALLET.address };
  const headers = await buildAuthHeaders({ wallet: WALLET, method: "POST", path: "/gps/submit", body, chainId: CHAIN_ID });
  headers[AUTH_HEADER_ADDRESS] = "not-an-address";
  const { req, res } = mockReqRes(headers, body);

  const nextCalled = await runMiddleware(req, res);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test("a signature over a different path does not verify (binds the signed message to the request)", async () => {
  _resetNonceCacheForTests();
  const body = { walletAddress: WALLET.address };
  // Signed for /zones/mint but sent to /gps/submit.
  const headers = await buildAuthHeaders({ wallet: WALLET, method: "POST", path: "/zones/mint", body, chainId: CHAIN_ID });
  const { req, res } = mockReqRes(headers, body, { path: "/gps/submit" });

  const nextCalled = await runMiddleware(req, res);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test("a signature over a different body does not verify (binds the signed message to the body)", async () => {
  _resetNonceCacheForTests();
  const signedBody = { walletAddress: WALLET.address, points: [1, 2, 3] };
  const headers = await buildAuthHeaders({ wallet: WALLET, method: "POST", path: "/gps/submit", body: signedBody, chainId: CHAIN_ID });
  const tamperedBody = { walletAddress: WALLET.address, points: [4, 5, 6] };
  const { req, res } = mockReqRes(headers, tamperedBody);

  const nextCalled = await runMiddleware(req, res);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test("a trailing slash on the request path still verifies against a signature for the slash-less path", async () => {
  _resetNonceCacheForTests();
  const body = { walletAddress: WALLET.address };
  // Client signs "/gps/submit"; the request actually arrives at "/gps/submit/"
  // — Express's default non-strict routing treats these as the same route.
  const headers = await buildAuthHeaders({ wallet: WALLET, method: "POST", path: "/gps/submit", body, chainId: CHAIN_ID });
  const { req, res } = mockReqRes(headers, body, { path: "/gps/submit/" });

  const nextCalled = await runMiddleware(req, res);

  assert.equal(nextCalled, true, "trailing-slash normalization should make these verify identically");
});

test("rejects a nonce longer than the allowed length", async () => {
  _resetNonceCacheForTests();
  const body = { walletAddress: WALLET.address };
  const nonce = "a".repeat(129);
  const headers = await buildAuthHeaders({ wallet: WALLET, method: "POST", path: "/gps/submit", body, chainId: CHAIN_ID, nonce });
  const { req, res } = mockReqRes(headers, body);

  const nextCalled = await runMiddleware(req, res);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.match((res.body as { error: string }).error, /Invalid nonce/);
});

test("rejects a nonce with disallowed characters", async () => {
  _resetNonceCacheForTests();
  const body = { walletAddress: WALLET.address };
  const nonce = "not a valid nonce!";
  const headers = await buildAuthHeaders({ wallet: WALLET, method: "POST", path: "/gps/submit", body, chainId: CHAIN_ID, nonce });
  const { req, res } = mockReqRes(headers, body);

  const nextCalled = await runMiddleware(req, res);

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.match((res.body as { error: string }).error, /Invalid nonce/);
});

test("accepts a nonce at the maximum allowed length using the allowed charset", async () => {
  _resetNonceCacheForTests();
  const body = { walletAddress: WALLET.address };
  const nonce = "Az09_-".repeat(21) + "AB"; // 128 chars, letters/digits/_/- only
  assert.equal(nonce.length, 128);
  const headers = await buildAuthHeaders({ wallet: WALLET, method: "POST", path: "/gps/submit", body, chainId: CHAIN_ID, nonce });
  const { req, res } = mockReqRes(headers, body);

  const nextCalled = await runMiddleware(req, res);

  assert.equal(nextCalled, true);
});
