/**
 * The map key: that it is never committed, and that the file which injects it
 * cannot inject anything else.
 *
 * Two separate worries.
 *
 * The first is the ordinary one — a Google Maps key pasted into `app.json` is a
 * key in the repository and in its history forever.
 *
 * The second is subtler and is the reason this file exists at all.
 * `androidRuntimePolicy.test.ts` proves the app's foreground-only location
 * promise *statically, from `app.json`*: it reads the config as data and shows
 * that `ACCESS_BACKGROUND_LOCATION` cannot reach the generated manifest. That
 * proof was airtight while `app.json` was the whole config. Adding
 * `app.config.js` puts a program in front of it, and a program can add a
 * permission, a plugin, or a different package name — none of which the static
 * proof would ever see.
 *
 * So the dynamic layer is held to exactly one field. It is resolved against a
 * fixture and diffed, and anything it changes beyond the Android map key fails
 * here. That is what keeps the other file's proof worth having.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import {
  MAP_KEY_REJECTED_HINT,
  isUsableMapKey,
  mapAvailability,
  mapUnavailableMessage,
} from "@/lib/mapAvailability";

const MOBILE = process.cwd();
const requireFromHere = createRequire(__filename);

interface DynamicConfig {
  (input: { config: Record<string, unknown> }): Record<string, unknown>;
  withMapKey(config: Record<string, any>, apiKey: unknown): Record<string, any>;
  ANDROID_MAPS_KEY_ENV: string;
}

function dynamicConfig(): DynamicConfig {
  return requireFromHere(join(MOBILE, "app.config.js")) as DynamicConfig;
}

/** A config shaped like the real one, with the fields the guard cares about. */
function fixtureConfig(): Record<string, any> {
  return {
    name: "MovenRun",
    slug: "movenrun",
    plugins: ["expo-router", ["expo-location", { locationWhenInUsePermission: "…" }]],
    android: {
      package: "io.movenrun.app",
      permissions: ["android.permission.ACCESS_FINE_LOCATION"],
      adaptiveIcon: { backgroundColor: "#F8FAF7" },
    },
    ios: { bundleIdentifier: "io.movenrun.app" },
    extra: { eas: { projectId: "abc" } },
  };
}

/* ── no key in the repository ─────────────────────────────────────────────── */

test("app.json carries no Google Maps key", () => {
  const raw = readFileSync(join(MOBILE, "app.json"), "utf8");
  const expo = JSON.parse(raw).expo as Record<string, any>;
  const committed = expo?.android?.config?.googleMaps?.apiKey;
  assert.equal(
    committed,
    undefined,
    "a Maps key is committed in app.json — it must come from the environment",
  );
  /* And not smuggled in through a plugin's options either. */
  assert.ok(
    !/googleMapsApiKey|AIza/i.test(raw),
    "app.json contains something that looks like a Maps key",
  );
});

/* ── the dynamic layer changes exactly one thing ──────────────────────────── */

test("with no key in the environment the config is returned untouched", () => {
  const { withMapKey } = dynamicConfig();
  const original = fixtureConfig();
  for (const absent of [undefined, null, "", "   "]) {
    assert.deepEqual(
      withMapKey(fixtureConfig(), absent),
      original,
      `a ${JSON.stringify(absent)} key must not alter the config`,
    );
  }
  /* Specifically: no empty apiKey field is introduced. An empty key renders a
     grey field that looks like a map; an absent one is reported in words. */
  assert.equal(withMapKey(fixtureConfig(), "").android.config, undefined);
});

test("with a key set, only the Android map key changes", () => {
  const { withMapKey } = dynamicConfig();
  const resolved = withMapKey(fixtureConfig(), "test-key-value");

  assert.equal(resolved.android.config.googleMaps.apiKey, "test-key-value");

  /* Diff everything else against the untouched fixture. Strip the one field
     the layer is allowed to set, and the two must be identical — so a widened
     app.config.js (a new permission, an extra plugin, a changed package) fails
     here rather than silently escaping the static policy guard. */
  const stripped = JSON.parse(JSON.stringify(resolved));
  delete stripped.android.config;
  assert.deepEqual(stripped, fixtureConfig(), "app.config.js changed more than the map key");
});

test("the dynamic layer cannot add a permission or a plugin", () => {
  /* Stated separately from the diff above because these two are the ones that
     would actually matter, and a future reader should see them named. */
  const { withMapKey } = dynamicConfig();
  const resolved = withMapKey(fixtureConfig(), "test-key-value");
  assert.deepEqual(resolved.android.permissions, fixtureConfig().android.permissions);
  assert.deepEqual(resolved.plugins, fixtureConfig().plugins);
  assert.equal(resolved.android.package, "io.movenrun.app");
});

test("the injected key is read from a named environment variable", () => {
  const config = dynamicConfig();
  assert.equal(config.ANDROID_MAPS_KEY_ENV, "GOOGLE_MAPS_ANDROID_API_KEY");
  /* The documentation and the code must name the same variable, or the setup
     instructions configure something the build never reads. */
  const doc = readFileSync(join(MOBILE, "..", "docs", "MAP_PROVIDER.md"), "utf8");
  assert.ok(
    doc.includes(config.ANDROID_MAPS_KEY_ENV),
    "docs/MAP_PROVIDER.md does not name the variable the build actually reads",
  );
});

/* ── what the app says when there is no map ───────────────────────────────── */

test("Android without a usable key reports a missing key", () => {
  assert.deepEqual(mapAvailability("android", {}), { status: "missing_key" });
  assert.deepEqual(mapAvailability("android", null), { status: "missing_key" });
  assert.deepEqual(
    mapAvailability("android", { android: { config: { googleMaps: { apiKey: "" } } } }),
    { status: "missing_key" },
  );
});

test("Android with a key is ready; iOS needs none; web has no native map", () => {
  assert.deepEqual(
    mapAvailability("android", { android: { config: { googleMaps: { apiKey: "AIza-real" } } } }),
    { status: "ready" },
  );
  assert.deepEqual(mapAvailability("ios", null), { status: "ready" });
  assert.deepEqual(mapAvailability("web", null), { status: "unsupported_platform" });
});

test("an unknown platform is checked rather than assumed fine", () => {
  /* Failing toward "check the key" is the safe direction: the alternative is a
     build that silently believes it has a basemap and renders grey. */
  assert.deepEqual(mapAvailability("unknown", null), { status: "missing_key" });
});

test("placeholders are not keys", () => {
  for (const value of ["FILL_ME_IN", "your_key_here", "undefined", "null", "  ", "", 7, null]) {
    assert.equal(isUsableMapKey(value), false, `${JSON.stringify(value)} accepted as a key`);
  }
  assert.equal(isUsableMapKey("AIzaSyExampleLooksLikeARealKey"), true);
});

test("the unavailable message explains the loss without blaming the player", () => {
  const message = mapUnavailableMessage({ status: "missing_key" })!;
  assert.match(message, /still recorded/, "the player must know their route is safe");
  assert.ok(!/error|failed|invalid/i.test(message), "this is a build gap, not a user error");
  assert.equal(mapUnavailableMessage({ status: "ready" }), null);
});

/* ── the preview gained a map; the share payload did not ──────────────────── */

test("the shared payload is still text, and still carries no route", () => {
  /* The Route Proof screen now draws the walk on a real map. That is a local
     preview. The thing the OS share sheet sends must remain the scalar text it
     has always been — this is the exact seam where a map ends up in someone
     else's chat because the preview and the payload were confused. */
  const screen = readFileSync(join(MOBILE, "app", "route", "proof.tsx"), "utf8");

  const shareCall = screen.slice(screen.indexOf("Share.share("), screen.indexOf("successFeedback()"));
  assert.ok(shareCall.length > 0, "the share call is gone — this guard lost its subject");
  assert.match(shareCall, /message:\s*proof\.shareText/, "the share payload must be the proof text");
  for (const leaked of ["points", "routePoints", "coordinate", "latitude", "longitude", "url", "uri"]) {
    assert.ok(
      !new RegExp(`\\b${leaked}\\b`, "i").test(shareCall),
      `the share call carries ${leaked}`,
    );
  }
});

test("the redaction cannot be off by default", () => {
  const screen = readFileSync(join(MOBILE, "app", "route", "proof.tsx"), "utf8");
  assert.match(
    screen,
    /const \[hideEnds, setHideEnds\] = useState\(true\)/,
    "the start/finish redaction must default to on — a player should have to ask to reveal",
  );
  assert.match(screen, /redactEndpoints\(/, "the preview must actually redact, not merely offer to");
});

test("the card never states the stronger claim about the wrong thing", () => {
  /* With a map on screen, "no route path" is true of the shared text and false
     of the card. The two must be stated separately. */
  const screen = readFileSync(join(MOBILE, "app", "route", "proof.tsx"), "utf8");
  const withMap = screen.slice(screen.indexOf("routePoints.length > 0"));
  const claim = withMap.match(/"Shared text holds no coordinates[^"]*"/);
  assert.ok(claim, "the map-present footer claim is gone");
  assert.match(claim[0], /Shared text/, "the claim must name what it is about");
});

test("the misconfigured-key hint names what a human must actually check", () => {
  /* A present-but-rejected key is invisible to JavaScript, so the only useful
     thing the app can do is say precisely where to look. */
  for (const term of ["Maps SDK", "package name", "signing certificate"]) {
    assert.ok(MAP_KEY_REJECTED_HINT.includes(term), `the hint omits ${term}`);
  }
});
