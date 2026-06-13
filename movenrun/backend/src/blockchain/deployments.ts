/**
 * Read-only deployment loader.
 *
 * Loads the authoritative deployment record produced at deploy time
 * (`contracts/deployments/<network>.json`) and cross-checks it against the
 * shared address registry (`@movenrun/shared`). Addresses are never invented:
 * if a contract is missing or malformed, a typed error is thrown.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACT_ADDRESSES } from "@movenrun/shared/src/constants/contracts.js";
import { getNetwork, type NetworkConfig } from "./networks.js";
import {
  InvalidAddressError,
  MissingContractAddressError,
  MissingDeploymentError,
} from "./errors.js";

/** Contracts deployed to Base Sepolia, in deployment order (see audit doc). */
export const EXPECTED_CONTRACTS = [
  "MoveToken",
  "GPSOracle",
  "ZoneNFT",
  "GearNFT",
  "MoveVault",
  "ZoneChallenge",
  "SeasonController",
  "MovenDAO",
] as const;

export type ContractName = (typeof EXPECTED_CONTRACTS)[number];

export interface Deployment {
  network: string;
  chainId: number;
  deployer: string;
  timestamp: string;
  addresses: Record<ContractName, string>;
  txHashes?: Record<string, string>;
  constructorArgs?: Record<string, unknown>;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function isValidAddress(value: unknown): value is string {
  return typeof value === "string" && ADDRESS_RE.test(value);
}

/**
 * Walk up from this module toward the repo root looking for the contracts
 * deployment file. Works whether the backend runs from `src/` (tsx) or `dist/`.
 */
function findDeploymentFile(network: string): string | null {
  const rel = join("contracts", "deployments", `${network}.json`);
  let dir = dirname(fileURLToPath(import.meta.url));
  // Bounded walk to the filesystem root.
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, rel);
    if (existsSync(candidate)) return candidate;
    // Also handle a monorepo root that nests the workspace under `movenrun/`.
    const nested = join(dir, "movenrun", rel);
    if (existsSync(nested)) return nested;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Load and validate the deployment record for a network. Cross-checks every
 * address against the shared registry; throws typed errors on any mismatch,
 * missing contract, or malformed address.
 */
export function loadDeployment(networkName = "baseSepolia"): Deployment {
  const net: NetworkConfig = getNetwork(networkName);

  const file = findDeploymentFile(net.name);
  if (!file) {
    throw new MissingDeploymentError(
      net.name,
      `contracts/deployments/${net.name}.json not found`,
    );
  }

  let parsed: Deployment;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8")) as Deployment;
  } catch (err) {
    throw new MissingDeploymentError(
      net.name,
      `could not parse ${file}: ${(err as Error).message}`,
    );
  }

  if (parsed.chainId !== net.chainId) {
    throw new MissingDeploymentError(
      net.name,
      `chainId mismatch: file=${parsed.chainId} expected=${net.chainId}`,
    );
  }

  validateAddresses(parsed.addresses, net.name);
  crossCheckRegistry(parsed.addresses, net.name);

  return parsed;
}

/**
 * Assert every expected contract has a syntactically valid address. Pure (no
 * I/O) so the error paths are directly testable.
 */
export function validateAddresses(
  addresses: Partial<Record<ContractName, string>> | undefined,
  networkName: string,
): void {
  for (const name of EXPECTED_CONTRACTS) {
    const addr = addresses?.[name];
    if (!addr) throw new MissingContractAddressError(name, networkName);
    if (!isValidAddress(addr)) throw new InvalidAddressError(name, addr);
  }
}

/**
 * Cross-check addresses against the shared registry so the deployment file and
 * `@movenrun/shared` can never silently drift. Only compares entries the
 * registry actually carries.
 */
export function crossCheckRegistry(
  addresses: Record<ContractName, string>,
  networkName: string,
): void {
  const registry =
    (CONTRACT_ADDRESSES as Record<string, Record<string, string>>)[
      networkName
    ] ?? {};
  for (const name of EXPECTED_CONTRACTS) {
    const fromRegistry = registry[name];
    if (fromRegistry && fromRegistry.toLowerCase() !== addresses[name].toLowerCase()) {
      throw new MissingDeploymentError(
        networkName,
        `registry/deployment mismatch for ${name}: registry=${fromRegistry} deployment=${addresses[name]}`,
      );
    }
  }
}

/** Resolve a single contract address (validated) for a network. */
export function getContractAddress(
  name: ContractName,
  networkName = "baseSepolia",
): string {
  const deployment = loadDeployment(networkName);
  const addr = deployment.addresses[name];
  if (!addr) throw new MissingContractAddressError(name, networkName);
  if (!isValidAddress(addr)) throw new InvalidAddressError(name, addr);
  return addr;
}
