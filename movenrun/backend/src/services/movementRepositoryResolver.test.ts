/**
 * CLI repository wiring — the resolution path, not the interface.
 *
 * The bug this guards against passed every interface check that existed:
 * `DrizzleMovementVerificationRepository` genuinely satisfies
 * `VerifiedMovementLookup`, and a type-level proof said so. What was broken was
 * the CLI's *resolution* of it — the old code looked for module exports named
 * `createMovementVerificationRepository` / `movementVerificationRepository`,
 * which the reviewed module does not have, so it loaded the module, found
 * neither, and refused.
 *
 * So these tests exercise resolution, and one of them asserts the specific
 * shape of the old mistake. The end-to-end proof against a real PostgreSQL and
 * the real production modules lives in the integration run described in the PR;
 * this branch predates the movement module, so the unnamed default path here
 * necessarily reaches its fail-closed outcome.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import {
  MovementRepositoryUnavailableError,
  resolveMovementVerificationLookup,
  type ResolverDeps,
} from "./movementRepositoryResolver.js";
import type { VerifiedMovementLookup } from "./deedClaimBridge.js";

const URL_VALUE = "postgresql://someone:hunter2@db.internal:5432/movenrun";

/** Stands in for the reviewed class: same export name, same constructor shape. */
class FakeDrizzleRepository {
  constructor(readonly db: unknown) {}
  async findByUserSession() {
    return null;
  }
}

function deps(over: Partial<ResolverDeps> = {}): ResolverDeps {
  return {
    loadRepositoryModule: async () => ({
      DrizzleMovementVerificationRepository: FakeDrizzleRepository,
    }),
    loadDbModule: async () => ({ getDb: () => ({ marker: "the-one-pool" }) }),
    ...over,
  };
}

/**
 * Run `fn` with DATABASE_URL set, and restore it only once `fn` has SETTLED.
 *
 * The first version of this helper was synchronous: it called `fn()`, got a
 * promise back, and restored the environment in `finally` immediately — before
 * the resolver's async body had run past its first `await`. Every error
 * constructed after that point therefore saw a restored (absent) value, which
 * made the secrecy test below blind: a mutation interpolating
 * `process.env.DATABASE_URL` into the error message went undetected, because by
 * the time the message was built there was nothing there to leak.
 */
async function withDatabaseUrl<T>(
  value: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = process.env.DATABASE_URL;
  if (value === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
}

async function refusal(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    assert.ok(
      err instanceof MovementRepositoryUnavailableError,
      `expected a categorised refusal, got ${String(err)}`,
    );
    return err.reason;
  }
  throw new Error("expected a refusal, but resolution succeeded");
}

/* ── the fix ──────────────────────────────────────────────────────────────── */

test("resolves the class the reviewed module actually exports", async () => {
  const lookup = await withDatabaseUrl(URL_VALUE, async () =>
    resolveMovementVerificationLookup(deps()),
  );
  assert.ok(lookup instanceof FakeDrizzleRepository);
  assert.equal(typeof lookup.findByUserSession, "function");
});

test("constructs the repository with the db from getDb(), not something else", async () => {
  /* The production pattern is `new DrizzleMovementVerificationRepository(getDb())`.
     Constructing it with anything else — a fresh pool, a parsed DATABASE_URL,
     undefined — would give the CLI a second connection and a second source of
     truth. */
  let getDbCalls = 0;
  const marker = { marker: "the-one-pool" };
  const lookup = (await withDatabaseUrl(URL_VALUE, async () =>
    resolveMovementVerificationLookup(
      deps({
        loadDbModule: async () => ({
          getDb: () => {
            getDbCalls += 1;
            return marker;
          },
        }),
      }),
    ),
  )) as unknown as FakeDrizzleRepository;

  assert.equal(getDbCalls, 1, "getDb() must be called exactly once");
  assert.equal(lookup.db, marker, "the repository must hold the db getDb() returned");
});

test("the old export-name assumptions no longer control resolution", async () => {
  /* This is the exact defect. A module exporting ONLY the old names — and not
     the reviewed class — must now be refused rather than accepted, and a module
     exporting only the reviewed class must be accepted rather than refused. */
  const onlyOldNames = await refusal(() =>
    withDatabaseUrl(URL_VALUE, async () =>
      resolveMovementVerificationLookup(
        deps({
          loadRepositoryModule: async () => ({
            createMovementVerificationRepository: () => new FakeDrizzleRepository({}),
            movementVerificationRepository: new FakeDrizzleRepository({}),
          }),
        }),
      ),
    ),
  );
  assert.equal(onlyOldNames, "repository_module_unavailable");

  // And the reviewed shape resolves.
  const lookup = await withDatabaseUrl(URL_VALUE, async () =>
    resolveMovementVerificationLookup(deps()),
  );
  assert.ok(lookup);
});

test("the resolved instance satisfies the bridge's lookup port", async () => {
  const lookup: VerifiedMovementLookup = await withDatabaseUrl(URL_VALUE, async () =>
    resolveMovementVerificationLookup(deps()),
  );
  assert.equal(await lookup.findByUserSession("u", "s"), null);
});

/* ── fail closed ──────────────────────────────────────────────────────────── */

test("a missing DATABASE_URL is refused before anything touches config", async () => {
  /* `getConfig()` calls process.exit(1) on invalid environment. Reaching it
     would kill the CLI with a schema dump instead of telling the operator which
     prerequisite is missing. */
  for (const value of [undefined, "", "   "]) {
    const reason = await refusal(() =>
      withDatabaseUrl(value, async () => resolveMovementVerificationLookup(deps())),
    );
    assert.equal(reason, "database_not_configured");
  }
});

test("an unloadable repository module fails closed", async () => {
  const reason = await refusal(() =>
    withDatabaseUrl(URL_VALUE, async () =>
      resolveMovementVerificationLookup(
        deps({
          loadRepositoryModule: async () => {
            throw new Error("ERR_MODULE_NOT_FOUND");
          },
        }),
      ),
    ),
  );
  assert.equal(reason, "repository_module_unavailable");
});

test("an unloadable or malformed db module fails closed", async () => {
  for (const [label, loadDbModule] of [
    ["throws", async () => { throw new Error("ERR_MODULE_NOT_FOUND"); }],
    ["no getDb export", async () => ({})],
    ["getDb is not callable", async () => ({ getDb: "nope" })],
  ] as [string, ResolverDeps["loadDbModule"]][]) {
    const reason = await refusal(() =>
      withDatabaseUrl(URL_VALUE, async () =>
        resolveMovementVerificationLookup(deps({ loadDbModule })),
      ),
    );
    assert.equal(reason, "database_module_unavailable", label);
  }
});

test("a database initialisation failure fails closed", async () => {
  const reason = await refusal(() =>
    withDatabaseUrl(URL_VALUE, async () =>
      resolveMovementVerificationLookup(
        deps({
          loadDbModule: async () => ({
            getDb: () => {
              throw new Error(`connect ECONNREFUSED ${URL_VALUE}`);
            },
          }),
        }),
      ),
    ),
  );
  assert.equal(reason, "database_initialisation_failed");
});

test("a repository of the wrong shape is refused, not returned", async () => {
  const reason = await refusal(() =>
    withDatabaseUrl(URL_VALUE, async () =>
      resolveMovementVerificationLookup(
        deps({
          loadRepositoryModule: async () => ({
            DrizzleMovementVerificationRepository: class {
              /* no findByUserSession */
            },
          }),
        }),
      ),
    ),
  );
  assert.equal(reason, "database_initialisation_failed");
});

/* ── no fallback, ever ────────────────────────────────────────────────────── */

test("nothing falls back to an in-memory or non-authoritative source", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const code = (p: string) =>
    readFileSync(join(process.cwd(), p), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/.*$/gm, "$1 ");

  for (const file of [
    "src/services/movementRepositoryResolver.ts",
    "src/scripts/issueDeedClaim.ts",
  ]) {
    const source = code(file);
    for (const banned of [
      "InMemoryMovementVerificationRepository",
      "hex_activities",
      "hexActivities",
      "newCapturedZone",
      "new Pool(",
      "DATABASE_URL,",
      "drizzle(",
    ]) {
      assert.ok(!source.includes(banned), `${file} must not reference ${banned}`);
    }
  }

  /* Every failure path is a throw. A resolver that returned SOMETHING on
     failure is the shape of the bug worth fearing most, because the CLI would
     then authorize deeds against a source nobody chose. */
  const resolver = code("src/services/movementRepositoryResolver.ts");
  const returns = resolver.match(/return [a-zA-Z]/g) ?? [];
  assert.ok(returns.length <= 2, "the resolver should have one success return path");
});

test("no failure ever emits the connection string or a credential", async () => {
  const leaky = `connect ECONNREFUSED ${URL_VALUE}`;
  const captured: string[] = [];
  for (const make of [
    () => withDatabaseUrl(undefined, async () => resolveMovementVerificationLookup(deps())),
    () =>
      withDatabaseUrl(URL_VALUE, async () =>
        resolveMovementVerificationLookup(
          deps({
            loadDbModule: async () => ({
              getDb: () => {
                throw new Error(leaky);
              },
            }),
          }),
        ),
      ),
    () =>
      withDatabaseUrl(URL_VALUE, async () =>
        resolveMovementVerificationLookup(
          deps({
            loadRepositoryModule: async () => {
              throw new Error(leaky);
            },
          }),
        ),
      ),
  ]) {
    try {
      await make();
    } catch (err) {
      captured.push(String((err as Error).message), inspect(err, { depth: 6 }));
    }
  }
  const surface = captured.join("|");
  assert.ok(captured.length > 0, "the failure paths must actually throw");
  for (const secret of ["hunter2", "db.internal", "postgresql://", URL_VALUE]) {
    assert.ok(!surface.includes(secret), `"${secret}" must never reach an error`);
  }
});
