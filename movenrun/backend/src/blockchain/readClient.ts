/**
 * Read-only Base Sepolia contract client.
 *
 * Wraps an ethers v6 `JsonRpcProvider` (no signer, no wallet, no private key)
 * and the validated deployment. Every contract is constructed with the provider
 * as its runner, so it can only *read* — there are no write/transaction helpers
 * here, and the ABIs themselves contain only `view` functions.
 *
 * Usage:
 *   const client = createBaseSepoliaReadClient();      // RPC from env/fallback
 *   await client.getMoveTokenInfo();
 */
import { ethers } from "ethers";
import {
  BASE_SEPOLIA,
  resolveRpcUrl,
  type NetworkConfig,
} from "./networks.js";
import {
  loadDeployment,
  type ContractName,
  type Deployment,
} from "./deployments.js";
import { MissingContractAddressError } from "./errors.js";
import { CONTRACT_READ_ABIS } from "./abis.js";

export interface DeploymentSummary {
  network: string;
  chainId: number;
  rpcUrl: string;
  deployer: string;
  timestamp: string;
  addresses: Record<string, string>;
}

export interface MoveTokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
}

export interface ZoneNftInfo {
  address: string;
  name: string;
  symbol: string;
}

export interface GpsOracleInfo {
  address: string;
  oracleOperator: string;
  moveToken: string;
}

export interface SeasonInfo {
  address: string;
  seasonNumber: string;
  seasonStart: string;
  seasonEnd: string;
  isMintingAllowed: boolean;
}

/** A read-only handle to the deployed Base Sepolia contracts. */
export class BaseSepoliaReadClient {
  readonly network: NetworkConfig;
  readonly rpcUrl: string;
  readonly provider: ethers.JsonRpcProvider;
  private readonly deployment: Deployment;

  constructor(rpcUrl?: string) {
    this.network = BASE_SEPOLIA;
    this.rpcUrl = resolveRpcUrl(this.network, rpcUrl);
    // staticNetwork avoids an extra eth_chainId round-trip; read-only provider.
    this.provider = new ethers.JsonRpcProvider(this.rpcUrl, this.network.chainId, {
      staticNetwork: true,
    });
    this.deployment = loadDeployment(this.network.name);
  }

  /** Validated address for a deployed contract. */
  getContractAddress(name: ContractName): string {
    const addr = this.deployment.addresses[name];
    if (!addr) throw new MissingContractAddressError(name, this.network.name);
    return addr;
  }

  /**
   * A read-only `ethers.Contract`. Its runner is the provider (not a signer),
   * and the ABI is view-only, so no state-changing call is possible.
   */
  getReadOnlyContract(name: ContractName): ethers.Contract {
    return new ethers.Contract(
      this.getContractAddress(name),
      [...CONTRACT_READ_ABIS[name]],
      this.provider,
    );
  }

  /** Non-network summary of what is deployed (safe with no RPC). */
  getDeploymentSummary(): DeploymentSummary {
    return {
      network: this.deployment.network,
      chainId: this.deployment.chainId,
      rpcUrl: this.rpcUrl,
      deployer: this.deployment.deployer,
      timestamp: this.deployment.timestamp,
      addresses: { ...this.deployment.addresses },
    };
  }

  /* ───────────────────── read helpers (live RPC) ───────────────────── */

  async getMoveTokenInfo(): Promise<MoveTokenInfo> {
    const c = this.getReadOnlyContract("MoveToken");
    const [name, symbol, decimals] = await Promise.all([
      c.name() as Promise<string>,
      c.symbol() as Promise<string>,
      c.decimals() as Promise<bigint>,
    ]);
    return {
      address: this.getContractAddress("MoveToken"),
      name,
      symbol,
      decimals: Number(decimals),
    };
  }

  async getZoneNftInfo(): Promise<ZoneNftInfo> {
    const c = this.getReadOnlyContract("ZoneNFT");
    const [name, symbol] = await Promise.all([
      c.name() as Promise<string>,
      c.symbol() as Promise<string>,
    ]);
    return { address: this.getContractAddress("ZoneNFT"), name, symbol };
  }

  async getGpsOracleInfo(): Promise<GpsOracleInfo> {
    const c = this.getReadOnlyContract("GPSOracle");
    const [oracleOperator, moveToken] = await Promise.all([
      c.oracleOperator() as Promise<string>,
      c.moveToken() as Promise<string>,
    ]);
    return {
      address: this.getContractAddress("GPSOracle"),
      oracleOperator,
      moveToken,
    };
  }

  async getSeasonInfo(): Promise<SeasonInfo> {
    const c = this.getReadOnlyContract("SeasonController");
    const [seasonNumber, seasonStart, seasonEnd, isMintingAllowed] =
      await Promise.all([
        c.seasonNumber() as Promise<bigint>,
        c.seasonStart() as Promise<bigint>,
        c.seasonEnd() as Promise<bigint>,
        c.isMintingAllowed() as Promise<boolean>,
      ]);
    return {
      address: this.getContractAddress("SeasonController"),
      seasonNumber: seasonNumber.toString(),
      seasonStart: seasonStart.toString(),
      seasonEnd: seasonEnd.toString(),
      isMintingAllowed,
    };
  }

  /** True when bytecode exists at the contract address (i.e. it is deployed). */
  async getCodeStatus(name: ContractName): Promise<boolean> {
    const code = await this.provider.getCode(this.getContractAddress(name));
    return code !== "0x";
  }
}

/** Factory: create a read-only Base Sepolia client (RPC from arg/env/fallback). */
export function createBaseSepoliaReadClient(
  rpcUrl?: string,
): BaseSepoliaReadClient {
  return new BaseSepoliaReadClient(rpcUrl);
}
