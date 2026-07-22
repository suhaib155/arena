/**
 * Phase 5 source guards — offline, scoped to the Deeds and Network screens.
 *
 * Fail if a redesigned screen renders a wallet address / user id / token /
 * session id / secret / coordinate, adds an unsupported ownership action
 * (mint / transfer / sell / trade / stake / claim / bridge / marketplace),
 * fabricates rarity / market value / finality, drops the honest local-preview
 * and not-on-chain wording, breaks the accordion accessibility state, enables
 * the JS animation driver, adds a sixth tab, or makes the Deeds / Network
 * routes unreachable from Profile.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = join(process.cwd(), "app");
const DEEDS = join(APP, "deed-showroom.tsx");
const NETWORK = join(APP, "network", "status.tsx");
const PROFILE = join(APP, "(tabs)", "profile.tsx");
const TABS_LAYOUT = join(APP, "(tabs)", "_layout.tsx");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** Routes each redesigned screen is allowed to navigate to — all pre-existing. */
const ALLOWED_ROUTES: Record<string, string[]> = {
  deeds: [
    "/territory/map",
    "/territory/alerts",
    "/district-mastery",
    "/city-districts",
    "/route/passport",
    "/move",
  ],
  network: ["/account"],
};

test("Deeds and Network never render a wallet address, user id, token, session id, or secret", () => {
  for (const path of [DEEDS, NETWORK]) {
    const src = read(path);
    // A wallet address is only ever reachable from auth wallets or the user.
    assert.ok(!/\bw\.address\b|wallet\.address|wallets\[[^\]]*\]\.address/.test(src), `${path}: no wallet address`);
    assert.ok(!/authUser\.\w|user\.id\b/.test(src), `${path}: no raw user id`);
    assert.ok(
      !/accessToken|refreshToken|\.sessionId\b|apiKey|privateKey|\.seed\b|providerSecret|webhookSecret/.test(src),
      `${path}: no token / session id / secret`,
    );
    // No raw location: no lat/lng/coordinates leaking onto these surfaces.
    assert.ok(!/latitude|longitude|\bcoordinates\b|\.lat\b|\.lng\b/.test(src), `${path}: no coordinates`);
  }
});

test("Network reads only non-secret wallet presence (isEmbedded), never an address", () => {
  const src = read(NETWORK);
  // It may inspect wallet presence and embedded-ness, but not the address field.
  assert.match(src, /wallets\.some\(\(w\)\s*=>\s*w\.isEmbedded\)/);
  assert.ok(!/\.address/.test(src.replace(/contract\.address|c\.address/g, "")), "only contract addresses (public) may appear");
});

test("Deeds and Network add no unsupported ownership / market action", () => {
  // Guard against interactive handlers, not disclaimer prose. Look for verbs
  // used as calls or route/action targets rather than inside sentences.
  const forbidden = /(mint|transfer|sell|trade|stake|claim|bridge|marketplace)\s*\(|\/(mint|transfer|sell|trade|stake|claim|bridge|marketplace)\b|"(mint|transfer|sell|trade|stake|claim|bridge|marketplace)"/i;
  for (const path of [DEEDS, NETWORK]) {
    assert.ok(!forbidden.test(read(path)), `${path}: no mint/transfer/sell/trade/stake/claim/bridge/marketplace action`);
  }
});

test("Deeds and Network navigate only to pre-existing routes", () => {
  for (const [key, path] of [["deeds", DEEDS], ["network", NETWORK]] as const) {
    const src = read(path);
    const targets = [...src.matchAll(/router\.push\("([^"]+)"\)/g)].map((m) => m[1]);
    for (const t of targets) {
      assert.ok(ALLOWED_ROUTES[key].includes(t), `${path}: unexpected route ${t}`);
    }
  }
});

test("Deeds keeps honest ownership-preview wording (local, earned on device, not on-chain, never 'owned')", () => {
  const src = read(DEEDS);
  assert.match(src, /Local preview/);
  assert.match(src, /earned on this device/i);
  assert.match(src, /not on-chain/i);
  assert.match(src, /Ownership not finalized/i);
  assert.match(src, /No minting/);
  // Never AFFIRMATIVELY asserts ownership or a fabricated market/yield value.
  // (Negated disclaimers like "never minted or owned" / "no market value" are
  // fine; only affirmative claims are forbidden.)
  assert.ok(
    !/\byou (?:now )?own\b|floor price|resale value|\bAPY\b|guaranteed (?:reward|payout|value|ownership)/i.test(src),
    "no affirmative ownership / market / yield claims",
  );
});

test("Network states one dominant status and distinguishes chain from off-chain gameplay", () => {
  const src = read(NETWORK);
  assert.match(src, /off-chain/i);
  assert.match(src, /Base Sepolia/);
  assert.match(src, /does not connect a wallet/i);
  // Never claims a false live/verified/synced/finalized network truth.
  assert.ok(!/block height|gas price|confirmations|latency|uptime|\bfinality\b|sync %|synced|\bverified\b/i.test(src), "no fabricated network truth");
});

test("Deeds locked accordion exposes expanded/collapsed state", () => {
  const src = read(DEEDS);
  assert.match(src, /accessibilityRole="button"/);
  assert.match(src, /Collapse locked|Expand locked/);
});

test("Network technical-details drawer exposes expanded/collapsed state and one primary action", () => {
  const src = read(NETWORK);
  assert.match(src, /accessibilityRole="button"/);
  assert.match(src, /Collapse technical details|Expand technical details/);
  // Exactly one primary <Button> on the screen.
  assert.equal((src.match(/<Button\b/g) ?? []).length, 1);
});

test("Deeds and Network never enable the JS animation driver", () => {
  for (const path of [DEEDS, NETWORK]) {
    assert.ok(!/useNativeDriver:\s*false/.test(read(path)), `${path}: must not use the JS animation driver`);
  }
});

test("Profile keeps Deeds and Network reachable", () => {
  const src = read(PROFILE);
  assert.match(src, /\/deed-showroom/);
  assert.match(src, /\/network\/status/);
});

test("no sixth tab — exactly three tab screens and two push destinations", () => {
  const layout = read(TABS_LAYOUT);
  assert.equal((layout.match(/<Tabs\.Screen\b/g) ?? []).length, 3);
  const bar = read(join(process.cwd(), "src", "components", "MovenTabBar.tsx"));
  const pushTargets = new Set([...bar.matchAll(/push\("([^"]+)"\)/g)].map((m) => m[1]));
  assert.deepEqual([...pushTargets].sort(), ["/move", "/territory/map"]);
});
