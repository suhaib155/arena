/**
 * Network configuration for read-only contract access.
 *
 * Base Sepolia (testnet) is the only deployed target — Base mainnet is reserved
 * for Phase 3 and is intentionally not configured here. There is no private key,
 * no signer, and no wallet anywhere in this module.
 */
import { UnsupportedNetworkError } from "./errors.js";

export interface NetworkConfig {
  /** Deployment-file network key (matches contracts/deployments/<name>.json). */
  name: string;
  /** EVM chain id. */
  chainId: number;
  /** Env var that supplies the RPC URL (never commit the actual URL/secret). */
  rpcEnvVar: string;
  /**
   * Public, replaceable fallback RPC used only when the env var is unset. It is
   * a public endpoint (rate-limited, no API key) — set the env var for anything
   * beyond a smoke test.
   */
  defaultRpcUrl: string;
}

export const BASE_SEPOLIA: NetworkConfig = {
  name: "baseSepolia",
  chainId: 84532,
  rpcEnvVar: "BASE_SEPOLIA_RPC_URL",
  defaultRpcUrl: "https://sepolia.base.org",
};

export const NETWORKS = {
  baseSepolia: BASE_SEPOLIA,
} as const;

export type SupportedNetworkName = keyof typeof NETWORKS;

/** Look up a network config by name; throws a typed error if unsupported. */
export function getNetwork(name: string): NetworkConfig {
  const net = (NETWORKS as Record<string, NetworkConfig>)[name];
  if (!net) {
    throw new UnsupportedNetworkError(name, Object.keys(NETWORKS));
  }
  return net;
}

/**
 * Resolve the RPC URL for a network: explicit override → env var → public
 * fallback. The fallback keeps reads working without secrets, but is meant to
 * be replaced via the env var.
 */
export function resolveRpcUrl(net: NetworkConfig, override?: string): string {
  return override ?? process.env[net.rpcEnvVar] ?? net.defaultRpcUrl;
}
