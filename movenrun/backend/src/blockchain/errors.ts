/**
 * Typed errors for the read-only Base Sepolia contract layer.
 *
 * These let callers distinguish "the deployment data is wrong / missing" from
 * ordinary runtime/RPC failures. Everything here is read-only infrastructure:
 * no signer, no wallet, no writes.
 */

/** Base class for all blockchain-config problems in this module. */
export class BlockchainConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockchainConfigError";
  }
}

/** Thrown when a network name is not one this module supports. */
export class UnsupportedNetworkError extends BlockchainConfigError {
  constructor(network: string, supported: readonly string[]) {
    super(
      `Unsupported network "${network}". Supported: ${supported.join(", ")}.`,
    );
    this.name = "UnsupportedNetworkError";
  }
}

/** Thrown when the deployment file for a network cannot be located/read. */
export class MissingDeploymentError extends BlockchainConfigError {
  constructor(network: string, detail?: string) {
    super(
      `Missing deployment file for network "${network}"${
        detail ? ` (${detail})` : ""
      }.`,
    );
    this.name = "MissingDeploymentError";
  }
}

/** Thrown when an expected contract has no address in the deployment. */
export class MissingContractAddressError extends BlockchainConfigError {
  constructor(contract: string, network: string) {
    super(`No address for contract "${contract}" on network "${network}".`);
    this.name = "MissingContractAddressError";
  }
}

/** Thrown when an address is not a 0x-prefixed 40-hex string. */
export class InvalidAddressError extends BlockchainConfigError {
  constructor(contract: string, value: string) {
    super(`Invalid address for "${contract}": "${value}".`);
    this.name = "InvalidAddressError";
  }
}
