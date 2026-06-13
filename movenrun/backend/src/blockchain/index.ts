/**
 * Read-only Base Sepolia contract layer (backend infrastructure).
 *
 * Read-only by construction: no signer, no wallet, no private key, no
 * transaction/write methods. See ./README.md.
 */
export * from "./errors.js";
export * from "./networks.js";
export * from "./abis.js";
export * from "./deployments.js";
export * from "./readClient.js";
