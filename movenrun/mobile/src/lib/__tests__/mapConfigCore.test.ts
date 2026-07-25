/**
 * Map configuration resolution — offline, no Expo runtime.
 *
 * Locks the precedence rule (env → app config → development fallback), the
 * "never ship the demo style" production guard, and the fact that no provider
 * token is ever baked into the source.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEVELOPMENT_FALLBACK_STYLE_URL,
  productionConfigProblems,
  resolveMapConfigFrom,
} from "../mapConfigCore";

test("environment variable wins over app config and fallback", () => {
  const config = resolveMapConfigFrom({
    envStyleUrl: "https://tiles.example.com/style.json?key=abc",
    extraStyleUrl: "https://from-app-config.example.com/style.json",
  });
  assert.equal(config.styleUrl, "https://tiles.example.com/style.json?key=abc");
  assert.equal(config.styleUrlSource, "env");
  assert.equal(config.usingDevelopmentFallback, false);
});

test("app config is used when no environment variable is set", () => {
  const config = resolveMapConfigFrom({
    extraStyleUrl: "https://from-app-config.example.com/style.json",
  });
  assert.equal(config.styleUrl, "https://from-app-config.example.com/style.json");
  assert.equal(config.styleUrlSource, "appConfig");
  assert.equal(config.usingDevelopmentFallback, false);
});

test("falls back to the development style only when nothing is configured", () => {
  const config = resolveMapConfigFrom({});
  assert.equal(config.styleUrl, DEVELOPMENT_FALLBACK_STYLE_URL);
  assert.equal(config.styleUrlSource, "fallback");
  assert.equal(config.usingDevelopmentFallback, true);
});

test("blank and whitespace-only values are treated as unset", () => {
  const config = resolveMapConfigFrom({ envStyleUrl: "   ", extraStyleUrl: "" });
  assert.equal(config.styleUrlSource, "fallback");
});

test("api base url loses its trailing slash and derives the realtime url", () => {
  const config = resolveMapConfigFrom({ envApiBaseUrl: "https://api.movenrun.io/" });
  assert.equal(config.apiBaseUrl, "https://api.movenrun.io");
  assert.equal(config.realtimeUrl, "https://api.movenrun.io/v1/territories/stream");
});

test("an explicit realtime url overrides the derived one", () => {
  const config = resolveMapConfigFrom({
    envApiBaseUrl: "https://api.movenrun.io",
    envRealtimeUrl: "https://events.movenrun.io/stream",
  });
  assert.equal(config.realtimeUrl, "https://events.movenrun.io/stream");
});

test("an unconfigured api base url leaves the realtime url null", () => {
  const config = resolveMapConfigFrom({});
  assert.equal(config.apiBaseUrl, null);
  assert.equal(config.realtimeUrl, null);
});

test("production guard rejects the demo style and a missing api base url", () => {
  const problems = productionConfigProblems(resolveMapConfigFrom({}));
  assert.equal(problems.length, 2);
  assert.ok(problems.some((p) => p.includes("EXPO_PUBLIC_MAP_STYLE_URL")));
  assert.ok(problems.some((p) => p.includes("EXPO_PUBLIC_API_BASE_URL")));
});

test("production guard passes a fully configured build", () => {
  const problems = productionConfigProblems(
    resolveMapConfigFrom({
      envStyleUrl: "https://tiles.example.com/style.json?key=abc",
      envApiBaseUrl: "https://api.movenrun.io",
    }),
  );
  assert.deepEqual(problems, []);
});

test("no provider token or public OSM tile server is hardcoded in map config", () => {
  const sources = [
    join(process.cwd(), "src", "lib", "mapConfigCore.ts"),
    join(process.cwd(), "src", "config", "map.ts"),
  ];
  for (const path of sources) {
    const src = readFileSync(path, "utf8");
    // Fallback is MapLibre's own demo style; the OSM community tile servers
    // (tile.openstreetmap.org and friends) must never be a backend here.
    assert.ok(
      !/tile\.openstreetmap\.org|[abc]\.tile\.osm/.test(src),
      `${path}: must not reference a public OSM tile server`,
    );
    // A real key would show up as an inline key/token query parameter.
    assert.ok(
      !/(?:api_key|access_token|apikey)=[A-Za-z0-9_-]{8,}/i.test(src),
      `${path}: must not hardcode a provider token`,
    );
  }
});
