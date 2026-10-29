/**
 * Stationary-risk rule on the authoritative verification path (LOCAL,
 * SYNTHETIC evidence; see testing/stationaryRiskCorpus.ts for the assumptions).
 *
 * Track A S03: a phone left still, reporting 6 m accuracy while its real error
 * wanders ~15 m, uploads hundreds of metres that today's server verifies. The
 * versioned rule `stationary-risk/v1` withholds the XP-bearing verdict for
 * such a route while leaving honest small loops, tracks, stop/start, slow and
 * low-accuracy walks verified exactly as before. The rule is off by default.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { GpsService } from "../services/gps.service.js";
import { HexService } from "../services/hex.service.js";
import { detectMovementAnomalies } from "./http/productionRouter.js";
import { verifyMovement, type VerifyMovementDeps } from "./domain/verification.js";
import { captureRoute, CORPUS, corpusSeed, type CapturedRoute, type CorpusFamily } from "./testing/stationaryRiskCorpus.js";

const gps = new GpsService();
const hex = new HexService();
const V1 = "stationary-risk/v1";
const SEEDS = 8;

function verify(route: CapturedRoute, rule?: string) {
  const deps = {
    now: () => route.now,
    detectAnomalies: (o) => detectMovementAnomalies(gps, o),
    calculateDistance: (points) => gps.calculateDistance(points as never),
    traversedHexIds: (points) => hex.getHexIdsForPoints(points),
    ...(rule ? { stationaryRiskRule: rule } : {}),
  } as VerifyMovementDeps;
  return verifyMovement(route.observation, deps);
}

const routes = (family: CorpusFamily) =>
  Array.from({ length: SEEDS }, (_, i) => captureRoute(family.scenario(corpusSeed(family, i))));
const S03 = CORPUS.find((f) => f.name === "still 300s, accuracy 6 m, real error 15 m, rho 0.95")!;

test("default (rule off) keeps today's behaviour: the S03 drift upload is still verified", () => {
  const [route] = routes(S03);
  const result = verify(route!);
  assert.equal(result.status, "verified");
  assert.ok((result.distanceMeters ?? 0) > 400, `distance ${result.distanceMeters}`);
  assert.equal(result.stationaryRisk, undefined);
});

test("stationary-risk/v1: S03 (phone left still, overconfident accuracy) is not XP-eligible", () => {
  for (const route of routes(S03)) {
    assert.equal(verify(route).status, "verified", "precondition: today's rule verifies it");
    const result = verify(route, V1);
    assert.equal(result.status, "rejected");
    assert.equal(result.distanceMeters, null);
    assert.equal(result.rejectionReasons.length, 1);
    assert.match(result.rejectionReasons[0]!, /needs review.*stationary-risk\/v1/);
    assert.equal(result.stationaryRisk?.verdict, "review");
    assert.equal(result.stationaryRisk?.ruleId, V1);
  }
});

test("stationary-risk/v1: the whole stationary family (several accuracies and durations) is withheld", () => {
  for (const family of CORPUS.filter((f) => f.truth === "stationary")) {
    let eligible = 0, verifiedToday = 0;
    for (const route of routes(family)) {
      if (verify(route).status !== "verified") continue;
      verifiedToday += 1;
      if (verify(route, V1).status === "verified") eligible += 1;
    }
    assert.ok(verifiedToday > 0, family.name);
    // One miss in eight is tolerated for the shortest drift spells (documented FN).
    assert.ok(eligible <= 1, `${family.name}: ${eligible}/${verifiedToday} still XP-eligible`);
  }
});

test("stationary-risk/v1: honest loops, 400 m track at 5.5 m/s, stop/start, slow, low-accuracy, W04/I02-like stay verified unchanged", () => {
  for (const family of CORPUS.filter((f) => f.truth === "honest")) {
    for (const route of routes(family)) {
      const before = verify(route);
      const after = verify(route, V1);
      assert.equal(after.status, before.status, `${family.name}: ${after.rejectionReasons.join("; ")}`);
      assert.equal(after.distanceMeters, before.distanceMeters, family.name);
      assert.deepEqual(after.traversedHexIds, before.traversedHexIds, family.name);
    }
  }
});

test("stationary-risk/v1 never overrides an earlier rejection with its own reason", () => {
  const family = CORPUS.find((f) => f.name.startsWith("I02-like"))!;
  const route = routes(family)[0]!;
  const tampered = { ...route, observation: { ...route.observation, points: route.observation.points.slice(0, 1) } };
  const before = verify(tampered), after = verify(tampered, V1);
  assert.deepEqual(after.rejectionReasons, before.rejectionReasons);
  assert.equal(after.stationaryRisk, undefined);
});
