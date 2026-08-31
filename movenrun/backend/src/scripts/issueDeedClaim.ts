/**
 * Operator CLI — issue one deed claim authorization.
 *
 * Deliberately a CLI and not an HTTP route. An endpoint that mints
 * authorizations would need its own authentication, its own rate limiting, its
 * own audit trail and its own abuse story, and would be reachable from the
 * internet for the entire life of the deployment. A local command run by a
 * human on a machine that already holds the oracle key needs none of that, and
 * for a pilot of a dozen participants the operational cost is a person typing
 * a line.
 *
 *   yarn tsx src/scripts/issueDeedClaim.ts \
 *     --user <userId> --session <clientSessionId> \
 *     --cell <h3Index> --claimant 0x...
 *
 * Reads ORACLE_PRIVATE_KEY and CHAIN_ID from the established config path, and
 * DEED_REGISTRY_ADDRESS from the environment. Prints the public claim bundle as
 * JSON on stdout — safe to hand to the participant — and nothing else.
 *
 * It never prints the oracle key, never prints route data, never prints the
 * verification record, and never sends a transaction. The participant submits
 * their own claim from their own wallet; this tool has no way to do it for them
 * and is not given one.
 */
import { ethers } from "ethers";
import { DeedOracleService } from "../services/deedOracle.service.js";
import { DeedClaimBridge, ClaimBridgeError } from "../services/deedClaimBridge.js";
import {
  MovementRepositoryUnavailableError,
  resolveMovementVerificationLookup,
} from "../services/movementRepositoryResolver.js";

interface Args {
  user: string;
  session: string;
  cell: string;
  claimant: string;
  registry: string;
}

function parseArgs(argv: string[]): Args {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith("--")) continue;
    out[key.slice(2)] = argv[i + 1] ?? "";
  }
  const registry = out.registry || process.env.DEED_REGISTRY_ADDRESS || "";
  for (const [name, value] of Object.entries({
    user: out.user,
    session: out.session,
    cell: out.cell,
    claimant: out.claimant,
    registry,
  })) {
    if (!value) {
      throw new Error(
        `--${name} is required (registry may come from DEED_REGISTRY_ADDRESS). ` +
          "Usage: --user <id> --session <id> --cell <h3> --claimant 0x...",
      );
    }
  }
  return {
    user: out.user,
    session: out.session,
    cell: out.cell,
    claimant: out.claimant,
    registry,
  };
}

/* The verification source is resolved by services/movementRepositoryResolver.ts,
   which constructs the same `DrizzleMovementVerificationRepository(getDb())`
   production uses. It is a separate module so this file stays a thin operator
   entry point and the bridge stays free of any database dependency. */

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!ethers.isAddress(args.registry)) {
    throw new Error("registry must be a valid contract address");
  }

  const oracle = new DeedOracleService({ registryAddress: args.registry });
  const bridge = new DeedClaimBridge(oracle, await resolveMovementVerificationLookup());

  const bundle = await bridge.issue({
    userId: args.user,
    clientSessionId: args.session,
    cellId: args.cell,
    claimant: args.claimant,
  });

  /* The bundle, and only the bundle — awaited so it is flushed before exit.

     `getDb()` opens a lazy singleton pool and the backend exposes no close
     helper: it is written for a long-lived server process, not a one-shot
     tool. Rather than invent a close API or reach into the pool, this exits
     once the output is on the wire. Adding an unsafe teardown to make a CLI
     tidy would be a worse change than an explicit exit. */
  await new Promise<void>((resolve) => {
    process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`, () => resolve());
  });
  process.exit(0);
}

main().catch((error: unknown) => {
  /* Categories, never payloads. A refusal says which rule was not satisfied;
     it does not echo the cell set, the record, or the request. */
  if (error instanceof ClaimBridgeError) {
    process.stderr.write(`Refused: ${error.reason}\n`);
  } else if (error instanceof MovementRepositoryUnavailableError) {
    /* A category, never a value. A pg failure can carry the connection string,
       so the underlying error is deliberately not surfaced. */
    process.stderr.write(`Unavailable: ${error.reason}\n`);
  } else {
    process.stderr.write(`${(error as Error).message}\n`);
  }
  process.exitCode = 1;
});
