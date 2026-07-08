import { test } from "node:test";
import assert from "node:assert/strict";
import { DrizzleRouteRepository } from "./route.repository.drizzle.js";
import { RouteHashConflictError } from "./route.repository.js";

/**
 * DrizzleRouteRepository is a thin query-building layer over drizzle-orm; the
 * SQL itself is drizzle-orm's responsibility and isn't exercised here (that
 * requires a live Postgres — see docs/CONTRACTS_AUDIT.md "Drizzle repository
 * live-DB validation"). What IS exercised, with a minimal stub `Db`, is the
 * one piece of non-generated logic this class adds: mapping a Postgres
 * unique-constraint violation on `routeHash` to a typed `RouteHashConflictError`
 * (the race-condition backstop from route.service.ts), while leaving any
 * other error untouched.
 */

/** Chainable stub mirroring the subset of drizzle-orm's query builder that
 *  DrizzleRouteRepository.update() calls: db.update(...).set(...).where(...).returning(). */
function stubDbThatThrowsOnUpdate(err: unknown) {
  return {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.reject(err),
        }),
      }),
    }),
  } as any;
}

test("DrizzleRouteRepository.update: maps a routeHash unique-constraint violation to RouteHashConflictError", async () => {
  const pgUniqueViolation = Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint: "routes_route_hash_unique",
  });
  const repo = new DrizzleRouteRepository(stubDbThatThrowsOnUpdate(pgUniqueViolation));

  await assert.rejects(
    () => repo.update("route-1", { status: "VERIFIED", routeHash: "abc123" }),
    RouteHashConflictError
  );
});

test("DrizzleRouteRepository.update: does not swallow unrelated constraint violations", async () => {
  const otherViolation = Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint: "some_other_constraint",
  });
  const repo = new DrizzleRouteRepository(stubDbThatThrowsOnUpdate(otherViolation));

  await assert.rejects(
    () => repo.update("route-1", { status: "VERIFIED", routeHash: "abc123" }),
    (err: unknown) => !(err instanceof RouteHashConflictError) && err === otherViolation
  );
});

test("DrizzleRouteRepository.update: does not swallow unrelated (non-constraint) errors", async () => {
  const connectionError = Object.assign(new Error("connection terminated"), { code: "57P01" });
  const repo = new DrizzleRouteRepository(stubDbThatThrowsOnUpdate(connectionError));

  await assert.rejects(
    () => repo.update("route-1", { status: "REJECTED" }),
    (err: unknown) => !(err instanceof RouteHashConflictError) && err === connectionError
  );
});
