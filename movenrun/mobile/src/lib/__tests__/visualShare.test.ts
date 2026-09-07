import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { shareVisualSummary, type VisualSharePorts } from "../visualShare";
import { redactEndpoints } from "../mapGeometry";

function fixture() {
  const calls: string[] = [];
  let valid = true;
  const ports: VisualSharePorts = {
    current: () => valid,
    captureMap: async () => { calls.push("map"); return "file://map.png"; },
    prepareCard: async (map) => { calls.push(`prepare:${map}`); },
    captureCard: async () => { calls.push("card"); return "file://card.png"; },
    shareImage: async (uri) => { calls.push(`share:${uri}`); },
    remove: async (uri) => { calls.push(`remove:${uri}`); },
  };
  return { calls, ports, invalidate: () => { valid = false; } };
}

test("primary export snapshots a real map, composes it, shares only the image, then erases both files", async () => {
  const f = fixture(); await shareVisualSummary(f.ports);
  assert.deepEqual(f.calls, ["map", "prepare:file://map.png", "card", "share:file://card.png", "remove:file://map.png", "remove:file://card.png"]);
});

test("missing map still exports an honest summary card without fabricating geography", async () => {
  const f = fixture(); f.ports.captureMap = async () => null;
  await shareVisualSummary(f.ports);
  assert.deepEqual(f.calls, ["prepare:null", "card", "share:file://card.png", "remove:file://card.png"]);
});

for (const stage of ["before", "map", "prepare", "card"] as const) {
  test(`privacy reset at ${stage} blocks OS sharing and removes every completed file`, async () => {
    const f = fixture();
    if (stage === "before") f.invalidate();
    else {
      const method = stage === "map" ? "captureMap" : stage === "prepare" ? "prepareCard" : "captureCard";
      const original = f.ports[method] as (...args: any[]) => Promise<any>;
      (f.ports as any)[method] = async (...args: any[]) => { const result = await original(...args); f.invalidate(); return result; };
    }
    await assert.rejects(shareVisualSummary(f.ports), /share_cancelled/);
    assert.equal(f.calls.some((call) => call.startsWith("share:")), false);
    if (stage !== "before") assert.ok(f.calls.includes("remove:file://map.png"));
    if (stage === "card") assert.ok(f.calls.includes("remove:file://card.png"));
  });
}

test("native sharing failure removes files and propagates to explicit error/fallback UI", async () => {
  const f = fixture(); f.ports.shareImage = async () => { throw new Error("native_failure"); };
  await assert.rejects(shareVisualSummary(f.ports), /native_failure/);
  assert.ok(f.calls.includes("remove:file://map.png")); assert.ok(f.calls.includes("remove:file://card.png"));
});

test("share-route redaction removes middle passes by the endpoints and breaks the surviving line", () => {
  const point = (latitude: number, timestamp: number) => ({ latitude, longitude: 0, timestamp, accuracy: 5 });
  const input = [point(0, 0), point(0.004, 1), point(0.0001, 2), point(0.006, 3), point(0.01, 4)];
  const redacted = redactEndpoints(input);
  assert.deepEqual(redacted.map((p) => p.timestamp), [1, 3]);
  assert.equal((redacted[1] as typeof input[number] & { breakBefore?: boolean }).breakBefore, true);
  assert.equal(redactEndpoints(input.slice(0, 1)).length, 0);
});

test("the no-route card is a designed card, not a card with a hole in it", () => {
  const screen = readFileSync(join(__dirname, "../../../app/route/proof.tsx"), "utf8");

  /* One condition, named once, for every branch that depends on whether this
     card has a route. Three separate `routePoints.length > 0` tests is how a
     card ends up with a status chip that disagrees with its own map slot. */
  assert.match(screen, /const hasRoute = routePoints\.length > 0;/);

  /* A status chip rather than a stray caption line. */
  assert.match(screen, /styles\.statusChip/);
  assert.match(screen, /"Route complete" : "Not enough movement"/);

  /* The empty slot carries an emblem that cannot be read as the walk. */
  assert.match(screen, /<RouteMotif size=\{38\}/);
  const motif = readFileSync(join(__dirname, "../../components/RouteMotif.tsx"), "utf8");
  for (const forbidden of ["road", "MovenMap", "Polyline", "latitude", "longitude"]) {
    assert.ok(!motif.includes(forbidden), `the motif must not name ${forbidden}`);
  }

  /* The endpoint notice appears only when there are endpoints. It used to render
     an empty caption under a divider — a rule drawn across nothing. */
  assert.match(screen, /\{hasRoute \? \(\s*<View style=\{styles\.footerCard\}>/);

  /* Nothing raw on the card: no proof id, no coordinates, no cell ids, and no
     privacy prose. */
  for (const forbidden of ["proofId", "proof.id", "latitude", "longitude", "h3", "off-chain"]) {
    assert.ok(!screen.includes(forbidden), `the share card must not carry ${forbidden}`);
  }

  /* The image is the primary action and text remains the fallback. */
  assert.ok(screen.indexOf('label="Share summary"') < screen.indexOf('label="Share text details"'),
    "the visual card is the primary share");
  assert.match(screen, /label="Share summary" icon="share-outline" loading=\{busy\}/);
});

test("screen image export uses only the redacted native map and preserves the full provider bitmap", () => {
  const screen = readFileSync(join(__dirname, "../../../app/route/proof.tsx"), "utf8");
  assert.match(screen, /useState\(true\)/);
  assert.match(screen, /hideEnds \? redactEndpoints\(session.points\) : session.points/);
  assert.match(screen, /points=\{routePoints\}/);
  assert.match(screen, /resizeMode="contain"/);
  assert.match(screen, /await Sharing.shareAsync\(uri, \{ mimeType: "image\/png"/);
  assert.match(screen, /label="Share text details"/);
  assert.match(screen, /generation === verificationGeneration\(\)/);
  assert.match(screen, /onVerificationPrivacyReset/);
  assert.match(screen, /getLastSession\(\) === session/);
});
