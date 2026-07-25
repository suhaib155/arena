/**
 * D2 (mobile side) — the territory map must be fetched *as the signed-in
 * runner*, so the backend can label their own cells `mine`.
 *
 * ## The defect
 * `territoryApi` sent no credentials at all. The backend therefore saw every
 * request as anonymous, and a runner's own captured territory came back
 * labelled `rival` and rendered in rival colours.
 *
 * ## What is asserted
 *  - the client sends `Authorization: Bearer <accessToken>` from the session it
 *    already holds, and nothing else identity-shaped;
 *  - no session, an unreadable keystore, or an uninstalled store all degrade to
 *    an unauthenticated (but still working) public read;
 *  - `claimed` is a first-class relationship in the style table, visually
 *    distinct from `rival`;
 *  - realtime reconciliation agrees with the map API for an anonymous viewer.
 *
 * `territoryAuth` imports only `@/lib/secureSession` (platform-free by design),
 * so the header rule is verifiable offline. The API module itself pulls in
 * `expo-constants` and cannot load under `node --test`, so its use of the
 * header is locked at the source level instead.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setSecureSessionStore, type SecureSessionStore } from "../secureSession";
import { territoryAuthHeaders } from "../territory/territoryAuth";
import {
  TERRITORY_STYLES,
  TERRITORY_LEGEND_ORDER,
  toRelationship,
} from "../territory/territoryStyle";
import { relationshipFromEvent } from "../territory/realtimeReconcile";

const TOKENS = {
  accessToken: "access-token-abc",
  accessTokenExpiresAt: new Date(Date.now() + 600_000).toISOString(),
  refreshToken: "refresh-token-abc",
  refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
};

/** Install a store whose `load` behaves as given, for one test. */
function installStore(load: SecureSessionStore["load"]) {
  setSecureSessionStore({
    load,
    async save() {},
    async clear() {},
  });
}

// ------------------------------------------------------------- the header

test("D2: territory reads carry the runner's existing bearer session", async () => {
  installStore(async () => TOKENS);
  assert.deepEqual(await territoryAuthHeaders(), {
    Authorization: "Bearer access-token-abc",
  });
});

test("D2: the client sends the token and NOTHING else identity-shaped", async () => {
  installStore(async () => TOKENS);
  const headers = await territoryAuthHeaders();
  assert.deepEqual(Object.keys(headers), ["Authorization"]);
  // A wallet address, user id or club id sent by the client would be a spoof
  // vector; the server derives all of it from the token.
  const serialised = JSON.stringify(headers).toLowerCase();
  for (const forbidden of ["address", "wallet", "userid", "clubid", "0x"]) {
    assert.ok(!serialised.includes(forbidden), `header set leaks "${forbidden}"`);
  }
});

test("D2: a signed-out runner reads the map anonymously rather than failing", async () => {
  installStore(async () => null);
  assert.deepEqual(await territoryAuthHeaders(), {});
});

test("D2: a keystore read failure degrades to anonymous, never throws", async () => {
  installStore(async () => {
    throw new Error("keystore unavailable");
  });
  assert.deepEqual(await territoryAuthHeaders(), {});
});

test("D2: an uninstalled session store degrades to anonymous, never throws", async () => {
  // `getSecureSessionStore()` throws by design until an adapter is installed.
  // A public map read must survive that.
  setSecureSessionStore(undefined as unknown as SecureSessionStore);
  assert.deepEqual(await territoryAuthHeaders(), {});
});

// -------------------------------------------------------- source-level guards

test("D2: no request the territory client builds carries an identity claim", () => {
  const files = [
    join(process.cwd(), "src", "services", "territoryApi.ts"),
    join(process.cwd(), "src", "lib", "territory", "territoryAuth.ts"),
  ];
  // Only what is *sent* matters — `clubId` legitimately appears in the response
  // types — so this inspects the `headers: { ... }` literals specifically.
  const sent: string[] = [];
  for (const file of files) {
    const code = readFileSync(file, "utf8")
      .replace(/\/\*\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    for (const match of code.matchAll(/headers:\s*\{([^}]*)\}/g)) sent.push(match[1]);
    for (const match of code.matchAll(/return\s*\{\s*(Authorization[^}]*)\}/g)) sent.push(match[1]);
  }
  assert.ok(sent.length >= 3, `expected to find the request header literals, found ${sent.length}`);
  const all = sent.join("\n").toLowerCase();
  for (const forbidden of ["x-movenrun-address", "x-movenrun-signature", "wallet", "userid", "clubid"]) {
    assert.ok(!all.includes(forbidden), `an identity claim "${forbidden}" is being sent`);
  }
});

test("D2: the map request actually attaches the auth headers", () => {
  const source = readFileSync(
    join(process.cwd(), "src", "services", "territoryApi.ts"),
    "utf8",
  );
  // getJson is the single path behind map, detail and history.
  assert.match(
    source,
    /headers:\s*\{\s*Accept:\s*"application\/json",\s*\.\.\.\(await territoryAuthHeaders\(\)\)/,
    "getJson must spread the auth headers into every territory read",
  );
});

// ------------------------------------------------------------- claimed style

test("D2: `claimed` is a real relationship, not silently coerced to neutral", () => {
  assert.equal(toRelationship("claimed"), "claimed");
  assert.ok(TERRITORY_LEGEND_ORDER.includes("claimed"));
  assert.ok(TERRITORY_STYLES.claimed);
});

test("D2: `claimed` does not look like `rival` — it may be the viewer's own", () => {
  const claimed = TERRITORY_STYLES.claimed;
  const rival = TERRITORY_STYLES.rival;
  assert.notEqual(claimed.fill, rival.fill);
  assert.notEqual(claimed.outline, rival.outline);
  assert.notEqual(claimed.label, rival.label);
  // And it is distinguishable without colour at all.
  const signature = (s: typeof claimed) =>
    `${s.fillOpacity}|${s.outlineWidth}|${s.outlineDash.join(",")}`;
  assert.notEqual(signature(claimed), signature(rival));
});

test("D2: `claimed` is not mistaken for the viewer's own ground either", () => {
  assert.notEqual(TERRITORY_STYLES.claimed.fill, TERRITORY_STYLES.mine.fill);
  assert.notEqual(TERRITORY_STYLES.claimed.label, TERRITORY_STYLES.mine.label);
});

// -------------------------------------------------------------- realtime

test("D2: realtime agrees with the map API for an anonymous viewer", () => {
  const event = {
    type: "territory.ownership" as const,
    cellId: "892a1008907ffff",
    gridVersion: 2,
    version: 4,
    nextState: "owned",
    nextOwner: "0x1111…1111",
    eventType: "captured",
    at: new Date().toISOString(),
  };
  assert.equal(relationshipFromEvent(event as never, null), "claimed");
  assert.equal(relationshipFromEvent(event as never, "0x1111…1111"), "mine");
  assert.equal(relationshipFromEvent(event as never, "0x2222…2222"), "rival");
});
