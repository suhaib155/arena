/**
 * D2 regression — a runner's own territory must not render as `rival`.
 *
 * ## The defect
 * `resolveViewer` defaulted to reading the unverified `x-movenrun-address`
 * header. The mobile client never sent it, so `walletAddress` was always null,
 * `relationshipFor` fell through to `rival`, and every cell a runner had
 * captured came back in rival colours. The header was also spoofable: anyone
 * could claim to be any wallet and see that wallet's cells labelled `mine`.
 *
 * ## What is asserted here
 *  - identity comes from a verified session and only from a verified session;
 *  - owner / rival / club member each get the correct label end-to-end;
 *  - an unauthenticated caller gets `claimed` (defined, safe) — never `rival`
 *    for everything, and never `mine` for anyone;
 *  - an expired, revoked or malformed token degrades to anonymous, not to a
 *    500 and not to a blank map;
 *  - every spoof route (identity headers, query parameters, body fields) is
 *    inert.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import {
  createSessionViewerResolver,
  readBearerToken,
  FORBIDDEN_IDENTITY_SOURCES,
  type ViewerIdentityServices,
} from "./viewer.js";
import { createTerritoryRouter } from "./router.js";
import { TERRITORY_DEFAULTS } from "../config.js";
import { InMemoryTerritoryRepository } from "../repository.js";
import { TerritoryOwnershipService } from "../ownership.service.js";
import { latLngToCell, TERRITORY_H3_RESOLUTION_V2 } from "../h3.js";
import { ANONYMOUS_VIEWER } from "../rules.js";

const RES = TERRITORY_H3_RESOLUTION_V2;
const GRID = 2;
const RUNNER = "0x1111111111111111111111111111111111111111";
const RIVAL = "0x2222222222222222222222222222222222222222";
const CELL = latLngToCell(51.5, -0.1, RES)!;
/** A viewport comfortably around CELL. */
const BOUNDS = { west: -0.105, south: 51.495, east: -0.095, north: 51.505 };

/**
 * A stand-in identity stack. `tokens` maps a valid access token to a user;
 * anything else throws, exactly as `SessionService.verifyAccess` does for an
 * expired, revoked or malformed token.
 */
function identityStack(options: {
  tokens?: Record<string, string>;
  wallets?: Record<string, string[]>;
  clubs?: Record<string, string>;
  onVerify?: (token: string) => void;
}): ViewerIdentityServices {
  const tokens = options.tokens ?? {};
  const wallets = options.wallets ?? {};
  const services: ViewerIdentityServices = {
    async verifyAccessToken(token: string) {
      options.onVerify?.(token);
      const userId = tokens[token];
      if (!userId) throw new Error("session_invalid");
      return { userId };
    },
    async listWalletAddresses(userId: string) {
      return wallets[userId] ?? [];
    },
  };
  if (options.clubs) {
    services.findClubId = async (userId: string) => options.clubs![userId] ?? null;
  }
  return services;
}

function request(overrides: Partial<Record<string, unknown>> = {}): Request {
  const { headers = {}, query = {}, body = {}, ...rest } = overrides as {
    headers?: Record<string, string>;
    query?: Record<string, string>;
    body?: unknown;
  };
  return {
    method: "GET",
    url: "/territories/map",
    originalUrl: "/territories/map",
    params: {},
    on() {
      return this;
    },
    ...rest,
    // After `rest`, so a caller's extra keys can never blank out the viewport
    // or the header accessor the resolver depends on.
    query: {
      west: String(BOUNDS.west),
      south: String(BOUNDS.south),
      east: String(BOUNDS.east),
      north: String(BOUNDS.north),
      ...query,
    },
    body,
    headers,
    header(name: string) {
      return headers[name.toLowerCase()];
    },
  } as unknown as Request;
}

/** Drive GET /territories/map through the real router and resolver. */
async function getMap(
  repository: InMemoryTerritoryRepository,
  services: ViewerIdentityServices,
  reqOverrides: Partial<Record<string, unknown>> = {},
): Promise<{ status: number; body: any }> {
  const router = createTerritoryRouter({
    repository,
    config: TERRITORY_DEFAULTS,
    resolveViewer: createSessionViewerResolver(services),
  });
  const captured: { status: number; body: any } = { status: 200, body: undefined };
  const res = {
    status(c: number) {
      captured.status = c;
      return this;
    },
    json(b: unknown) {
      captured.body = b;
      return this;
    },
    setHeader() {
      return this;
    },
    write() {
      return true;
    },
    end() {
      return this;
    },
    flushHeaders() {},
  } as unknown as Response;

  await new Promise<void>((resolve) => {
    (router as any)(request(reqOverrides), res, () => resolve());
    setImmediate(resolve);
  });
  await new Promise((resolve) => setImmediate(resolve));
  return captured;
}

/** A repository holding exactly one cell, captured by `wallet`. */
async function repositoryOwnedBy(wallet: string, clubId: string | null = null) {
  const repository = new InMemoryTerritoryRepository();
  await new TerritoryOwnershipService(repository).applyCapture({
    routeId: `route-${wallet.slice(-4)}`,
    walletAddress: wallet,
    userId: `user-${wallet.slice(-4)}`,
    clubId,
    gridVersion: GRID,
    resolution: RES,
    traversedHexIds: [CELL],
    capturedHexIds: [CELL],
  });
  return repository;
}

function relationshipOf(body: any): string {
  assert.equal(body.features.length, 1, "expected exactly one feature");
  return body.features[0].properties.relationship;
}

// ------------------------------------------------------------ bearer parsing

test("a bearer token is read from the Authorization header", () => {
  assert.equal(readBearerToken(request({ headers: { authorization: "Bearer abc" } })), "abc");
  assert.equal(readBearerToken(request({ headers: { authorization: "bearer abc" } })), "abc");
});

test("anything that is not a bearer token reads as no token", () => {
  const cases = ["", "Bearer", "Bearer ", "Basic abc", "abc", "Token abc"];
  for (const authorization of cases) {
    assert.equal(
      readBearerToken(request({ headers: { authorization } })),
      null,
      `"${authorization}" must not yield a token`,
    );
  }
  assert.equal(readBearerToken(request({ headers: {} })), null);
});

// ------------------------------------------------------------- the six cases

test("D2: the owner sees their own cell as `mine`, not `rival`", async () => {
  const repository = await repositoryOwnedBy(RUNNER);
  const services = identityStack({
    tokens: { "token-runner": "user-runner" },
    wallets: { "user-runner": [RUNNER] },
  });

  const result = await getMap(repository, services, {
    headers: { authorization: "Bearer token-runner" },
  });
  assert.equal(result.status, 200);
  assert.equal(relationshipOf(result.body), "mine");
});

test("D2: the owner is matched case-insensitively across every linked wallet", async () => {
  const repository = await repositoryOwnedBy(RUNNER);
  // A user with several linked wallets, the owning one stored checksummed and
  // listed second — neither should matter.
  const services = identityStack({
    tokens: { "token-runner": "user-runner" },
    wallets: { "user-runner": [RIVAL, RUNNER.toUpperCase().replace("0X", "0x")] },
  });

  const result = await getMap(repository, services, {
    headers: { authorization: "Bearer token-runner" },
  });
  assert.equal(relationshipOf(result.body), "mine");
});

test("D2: a different authenticated user sees the cell as `rival`", async () => {
  const repository = await repositoryOwnedBy(RUNNER);
  const services = identityStack({
    tokens: { "token-rival": "user-rival" },
    wallets: { "user-rival": [RIVAL] },
  });

  const result = await getMap(repository, services, {
    headers: { authorization: "Bearer token-rival" },
  });
  assert.equal(relationshipOf(result.body), "rival");
});

test("D2: a club mate sees the cell as `club`, not `rival`", async () => {
  const repository = await repositoryOwnedBy(RUNNER, "club-north");
  const services = identityStack({
    tokens: { "token-mate": "user-mate" },
    wallets: { "user-mate": [RIVAL] },
    clubs: { "user-mate": "club-north" },
  });

  const result = await getMap(repository, services, {
    headers: { authorization: "Bearer token-mate" },
  });
  assert.equal(relationshipOf(result.body), "club");
});

test("D2: a member of a different club is still a rival", async () => {
  const repository = await repositoryOwnedBy(RUNNER, "club-north");
  const services = identityStack({
    tokens: { "token-other": "user-other" },
    wallets: { "user-other": [RIVAL] },
    clubs: { "user-other": "club-south" },
  });

  const result = await getMap(repository, services, {
    headers: { authorization: "Bearer token-other" },
  });
  assert.equal(relationshipOf(result.body), "rival");
});

test("D2: an unauthenticated caller sees `claimed` — the map is public, the label is honest", async () => {
  const repository = await repositoryOwnedBy(RUNNER);
  const services = identityStack({ tokens: {}, wallets: {} });

  const result = await getMap(repository, services);
  assert.equal(result.status, 200, "a public read must not 401");
  const feature = result.body.features[0];
  assert.equal(feature.properties.relationship, "claimed");
  // Same data, only the label differs — an anonymous caller is not given a
  // degraded map.
  assert.equal(feature.properties.cellId, CELL);
  assert.equal(feature.properties.controlScore > 0, true);
  assert.equal(feature.geometry.type, "Polygon");
});

test("D2: an expired or revoked session degrades to anonymous, never to an error or `mine`", async () => {
  const repository = await repositoryOwnedBy(RUNNER);
  const services = identityStack({
    // "token-runner" is no longer in the table: expired, revoked or rotated.
    tokens: {},
    wallets: { "user-runner": [RUNNER] },
  });

  const result = await getMap(repository, services, {
    headers: { authorization: "Bearer token-runner" },
  });
  assert.equal(result.status, 200);
  assert.equal(relationshipOf(result.body), "claimed");
});

test("D2: an identity store outage degrades to anonymous rather than failing the read", async () => {
  const repository = await repositoryOwnedBy(RUNNER);
  const services: ViewerIdentityServices = {
    async verifyAccessToken() {
      return { userId: "user-runner" };
    },
    async listWalletAddresses() {
      throw new Error("connection terminated unexpectedly");
    },
  };

  const result = await getMap(repository, services, {
    headers: { authorization: "Bearer token-runner" },
  });
  assert.equal(result.status, 200);
  assert.equal(relationshipOf(result.body), "claimed");
});

// -------------------------------------------------------------- spoof routes

test("D2 spoof: the legacy x-movenrun-address header confers no identity", async () => {
  const repository = await repositoryOwnedBy(RUNNER);
  const services = identityStack({ tokens: {}, wallets: {} });

  const result = await getMap(repository, services, {
    headers: { "x-movenrun-address": RUNNER.toLowerCase() },
  });
  assert.equal(
    relationshipOf(result.body),
    "claimed",
    "the header that caused D2 must be completely inert",
  );
});

test("D2 spoof: a header claiming another user's wallet cannot make their cell `mine`", async () => {
  const repository = await repositoryOwnedBy(RUNNER);
  // The attacker holds a genuine session — for a *different* wallet — and tries
  // to upgrade it by asserting the victim's address alongside it.
  const services = identityStack({
    tokens: { "token-rival": "user-rival" },
    wallets: { "user-rival": [RIVAL] },
  });

  const result = await getMap(repository, services, {
    headers: {
      authorization: "Bearer token-rival",
      "x-movenrun-address": RUNNER.toLowerCase(),
      "x-forwarded-user": "user-runner",
      "x-user-id": "user-runner",
    },
  });
  assert.equal(relationshipOf(result.body), "rival", "a header must not override the session");
});

test("D2 spoof: query parameters and body fields confer no identity", async () => {
  const repository = await repositoryOwnedBy(RUNNER);
  const services = identityStack({ tokens: {}, wallets: {} });

  const result = await getMap(repository, services, {
    query: { wallet: RUNNER, walletAddress: RUNNER, userId: "user-runner", clubId: "club-north" },
    body: { walletAddress: RUNNER, userId: "user-runner", authenticated: true },
  });
  assert.equal(relationshipOf(result.body), "claimed");
});

test("D2 spoof: a user is only ever given the wallets the identity store returns", async () => {
  const repository = await repositoryOwnedBy(RUNNER);
  const seen: string[] = [];
  const services = identityStack({
    tokens: { "token-rival": "user-rival" },
    wallets: { "user-rival": [RIVAL] },
    onVerify: (token) => seen.push(token),
  });

  await getMap(repository, services, {
    headers: { authorization: "Bearer token-rival", "x-movenrun-address": RUNNER },
  });
  // The token, and nothing else, is what was verified.
  assert.deepEqual(seen, ["token-rival"]);
});

/**
 * Read a module's executable source: comments stripped (they name the
 * forbidden sources deliberately) and the `FORBIDDEN_IDENTITY_SOURCES` literal
 * removed (it is the guard list itself, held as data so it can be asserted).
 */
async function executableSource(file: string): Promise<string> {
  const source = await readFile(fileURLToPath(new URL(file, import.meta.url)), "utf8");
  return source
    .replace(/\/\*\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/export const FORBIDDEN_IDENTITY_SOURCES[\s\S]*?\] as const;/, "");
}

test("D2 spoof: the resolver reads no identity source other than the bearer token", async () => {
  const code = await executableSource("./viewer.ts");
  const reads = code.match(/req\.\w+/g) ?? [];
  assert.deepEqual(
    [...new Set(reads)],
    ["req.header"],
    `the resolver must read only the Authorization header; found ${reads.join(", ")}`,
  );
  for (const forbidden of FORBIDDEN_IDENTITY_SOURCES) {
    assert.ok(!code.includes(forbidden), `viewer.ts must not reference ${forbidden}`);
  }
});

test("D2 spoof: the router derives no identity of its own from the request", async () => {
  const code = await executableSource("./router.ts");
  // The router may read the viewport (`req.query`), the cell id (`req.params`)
  // and the *verified* signature context (`req.movenrunAuth`) — never an
  // identity claim. `req.body` is absent entirely: these are GET routes.
  const reads = [...new Set(code.match(/req\.\w+/g) ?? [])].sort();
  assert.deepEqual(reads, ["req.movenrunAuth", "req.on", "req.params", "req.query"]);
  for (const forbidden of ["x-movenrun-address", "req.header", "req.body"]) {
    assert.ok(!code.includes(forbidden), `router.ts must not reference ${forbidden}`);
  }
});

// --------------------------------------------------------- resolver defaults

test("no Authorization header resolves to the anonymous viewer", async () => {
  const resolve = createSessionViewerResolver(identityStack({}));
  assert.deepEqual(await resolve(request()), ANONYMOUS_VIEWER);
});

test("an authenticated viewer carries the session's user id and lowercased wallets", async () => {
  const resolve = createSessionViewerResolver(
    identityStack({
      tokens: { t: "user-runner" },
      wallets: { "user-runner": [RUNNER.toUpperCase().replace("0X", "0x")] },
      clubs: { "user-runner": "club-north" },
    }),
  );
  const viewer = await resolve(request({ headers: { authorization: "Bearer t" } }));
  assert.deepEqual(viewer, {
    userId: "user-runner",
    walletAddresses: [RUNNER],
    clubId: "club-north",
    authenticated: true,
  });
});

test("a session with no linked wallet is authenticated but owns nothing", async () => {
  const repository = await repositoryOwnedBy(RUNNER);
  const services = identityStack({ tokens: { t: "user-new" }, wallets: { "user-new": [] } });

  const result = await getMap(repository, services, {
    headers: { authorization: "Bearer t" },
  });
  // Authenticated, so `rival` is a claim we can honestly make: we know who the
  // viewer is, and this cell is not theirs.
  assert.equal(relationshipOf(result.body), "rival");
});
