import type { VerifiedMovementLookup } from "./deedClaimBridge.js";

/**
 * Resolves the production movement-verification repository for the operator CLI.
 *
 * This is the bootstrap boundary, and it is deliberately a separate module from
 * both the CLI and the bridge. The bridge stays free of any database
 * dependency — it takes a {@link VerifiedMovementLookup} and does not care what
 * satisfies it — and the CLI stays free of the details of how one is obtained.
 *
 * ## The defect this exists to fix
 *
 * The first version of this logic lived inline in the CLI and looked for module
 * exports named `createMovementVerificationRepository` or
 * `movementVerificationRepository`. The reviewed repository module exports
 * neither: it exports the class `DrizzleMovementVerificationRepository`, which
 * production constructs as `new DrizzleMovementVerificationRepository(getDb())`.
 *
 * So the CLI loaded the module successfully, failed to find either name, and
 * fell through to its fail-closed "no repository available" path — even with
 * the repository present. The earlier integration proof did not catch it
 * because it checked that the class *satisfies the interface*, which it does.
 * Type compatibility was never the problem; the wiring was.
 *
 * ## What it must not do
 *
 * There is no fallback. Not an in-memory repository, not `hex_activities`
 * (nothing writes it), not local territory state, not an operator assertion
 * that a cell was verified. If the real repository cannot be constructed, the
 * only correct outcome is to refuse: a deed authorized against a fabricated
 * eligibility source is worse than no deed.
 */

/** Why resolution failed. A category, never a value — no connection string,
 *  no credential, no environment dump. */
export type ResolverFailure =
  | "database_not_configured"
  | "repository_module_unavailable"
  | "database_module_unavailable"
  | "database_initialisation_failed";

export class MovementRepositoryUnavailableError extends Error {
  readonly reason: ResolverFailure;
  constructor(reason: ResolverFailure) {
    super(`movement verification repository unavailable: ${reason}`);
    this.name = "MovementRepositoryUnavailableError";
    this.reason = reason;
  }
}

/**
 * Module loaders, overridable only so the failure paths can be tested.
 *
 * The defaults are the real production modules and the integration proof calls
 * `resolveMovementVerificationLookup()` with no arguments, so the wiring that
 * ships is the wiring that is exercised. A seam that were used by the happy
 * path too would reproduce exactly the mistake this module exists to correct.
 */
export interface ResolverDeps {
  loadRepositoryModule: () => Promise<Record<string, unknown>>;
  loadDbModule: () => Promise<Record<string, unknown>>;
}

const productionDeps: ResolverDeps = {
  loadRepositoryModule: () =>
    import("../movement/repositories/drizzle/store.js") as Promise<Record<string, unknown>>,
  loadDbModule: () => import("../db/client.js") as Promise<Record<string, unknown>>,
};

/**
 * Build the same repository production uses, over the same connection pool.
 *
 * `getDb()` is a lazy singleton: it creates one pool on first call and returns
 * it thereafter. Going through it — rather than reading `DATABASE_URL` again
 * and opening a second pool — is what keeps the CLI on one connection and one
 * schema definition.
 */
export async function resolveMovementVerificationLookup(
  deps: ResolverDeps = productionDeps,
): Promise<VerifiedMovementLookup> {
  /* Checked here, before anything touches `getConfig()`. That helper calls
     `process.exit(1)` on invalid environment, which would kill the CLI with a
     schema dump instead of a categorised refusal — and a tool that dies cannot
     tell the operator which of its prerequisites is missing. */
  const databaseUrl = process.env.DATABASE_URL;
  if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
    throw new MovementRepositoryUnavailableError("database_not_configured");
  }

  let repositoryModule: Record<string, unknown>;
  try {
    repositoryModule = await deps.loadRepositoryModule();
  } catch {
    throw new MovementRepositoryUnavailableError("repository_module_unavailable");
  }

  const RepositoryClass = repositoryModule.DrizzleMovementVerificationRepository;
  if (typeof RepositoryClass !== "function") {
    throw new MovementRepositoryUnavailableError("repository_module_unavailable");
  }

  let dbModule: Record<string, unknown>;
  try {
    dbModule = await deps.loadDbModule();
  } catch {
    throw new MovementRepositoryUnavailableError("database_module_unavailable");
  }

  const getDb = dbModule.getDb;
  if (typeof getDb !== "function") {
    throw new MovementRepositoryUnavailableError("database_module_unavailable");
  }

  try {
    const db = (getDb as () => unknown)();
    const repository = new (RepositoryClass as new (db: unknown) => unknown)(db);
    /* One last structural check. The class is the reviewed one, but this is the
       last point at which a mismatch is cheap to catch, and it costs nothing. */
    if (typeof (repository as VerifiedMovementLookup).findByUserSession !== "function") {
      throw new Error("shape mismatch");
    }
    return repository as VerifiedMovementLookup;
  } catch (err) {
    if (err instanceof MovementRepositoryUnavailableError) throw err;
    // Swallowed deliberately: a pg error can carry the connection string.
    throw new MovementRepositoryUnavailableError("database_initialisation_failed");
  }
}
