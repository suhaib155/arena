import { ethers } from "ethers";
import { getConfig } from "../config.js";

/**
 * OracleService — signs the exact tuples the deployed/current contracts verify.
 *
 * Every helper mirrors the corresponding contract's signature check byte-for-byte
 * (see contracts/src/*.sol, tagged `FIX-001`, and contracts/test/*.test.ts). All
 * hashed digests are personal-signed via `wallet.signMessage(getBytes(digest))`,
 * which applies the EIP-191 prefix and therefore matches the contracts'
 * `MessageHashUtils.toEthSignedMessageHash(...)` + `ECDSA.recover`.
 *
 * chainId is bound into every signature (never removed) so a signature for one
 * chain cannot be replayed on another. Base Sepolia = 84532.
 */
export interface OracleServiceOptions {
  /** Override the signer key (tests). Falls back to config ORACLE_PRIVATE_KEY. */
  privateKey?: string;
  /** Override the chainId (tests). Falls back to config CHAIN_ID (default 84532). */
  chainId?: number | bigint;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export class OracleService {
  private wallet: ethers.Wallet;
  /** The chainId bound into every signature. */
  readonly chainId: bigint;

  constructor(opts: OracleServiceOptions = {}) {
    // Only read (and validate) env when an override isn't supplied — keeps unit
    // tests hermetic and avoids getConfig()'s process.exit on missing env.
    const privateKey = opts.privateKey ?? getConfig().ORACLE_PRIVATE_KEY;
    const chainId = opts.chainId ?? getConfig().CHAIN_ID;
    this.wallet = new ethers.Wallet(privateKey);
    this.chainId = BigInt(chainId);
  }

  get address(): string {
    return this.wallet.address;
  }

  /**
   * GPSOracle.submitRoute verifies:
   *   keccak256(abi.encodePacked(block.chainid, to, routeHash, distanceMeters, hexId))
   * `hexId` is the H3 zone the runner is in as uint64 (0 = not in any zone).
   * A concrete hexId is required — pass 0n only when genuinely in no zone.
   */
  async signRouteProof(
    to: string,
    routeHash: string,
    distanceMeters: number | bigint,
    hexId: bigint
  ): Promise<string> {
    const message = ethers.solidityPackedKeccak256(
      ["uint256", "address", "bytes32", "uint256", "uint64"],
      [this.chainId, to, routeHash, BigInt(distanceMeters), hexId]
    );
    return this.wallet.signMessage(ethers.getBytes(message));
  }

  /**
   * ZoneNFT.mintZone verifies:
   *   keccak256(abi.encodePacked(block.chainid, hexId, msg.sender, mintCost))
   * `minter` MUST be the caller (msg.sender) that will submit the mint tx.
   */
  async signZoneMint(hexId: string, minter: string, mintCost: bigint): Promise<string> {
    const message = ethers.solidityPackedKeccak256(
      ["uint256", "uint64", "address", "uint256"],
      [this.chainId, toHexIdUint64(hexId), minter, mintCost]
    );
    return this.wallet.signMessage(ethers.getBytes(message));
  }

  /**
   * ZoneChallenge.declareChallenge verifies:
   *   keccak256(abi.encodePacked(block.chainid, hexId, zoneNFT.zoneOwner(hexId), defenderBaseScore))
   * `defender` MUST equal the on-chain zone owner, and `defenderBaseScore` must be
   * a real validated (non-zero) score. Reading the on-chain zone owner and the
   * 30-day defender score is a follow-up (see PR description); until then this is
   * guarded so a stub zero-address / zero-score can never be signed as a
   * production path. `allowUnvalidated` exists only for deterministic tests.
   */
  async signChallengeDeclaration(
    hexId: string,
    defender: string,
    defenderBaseScore: bigint,
    opts: { allowUnvalidated?: boolean } = {}
  ): Promise<string> {
    if (!opts.allowUnvalidated) {
      if (!ethers.isAddress(defender) || defender === ZERO_ADDRESS) {
        throw new Error(
          "signChallengeDeclaration: refusing to sign a zero/invalid defender — the real on-chain zone owner is required"
        );
      }
      if (defenderBaseScore <= 0n) {
        throw new Error(
          "signChallengeDeclaration: refusing to sign a zero defenderBaseScore — a validated defender score is required"
        );
      }
    }
    const message = ethers.solidityPackedKeccak256(
      ["uint256", "uint64", "address", "uint256"],
      [this.chainId, toHexIdUint64(hexId), defender, defenderBaseScore]
    );
    return this.wallet.signMessage(ethers.getBytes(message));
  }

  /**
   * ZoneChallenge.submitScore verifies:
   *   keccak256(abi.encodePacked(block.chainid, hexId, msg.sender, score))
   * `submitter` MUST be the caller (msg.sender) that will submit the score tx.
   */
  async signScore(hexId: string, submitter: string, score: bigint): Promise<string> {
    const message = ethers.solidityPackedKeccak256(
      ["uint256", "uint64", "address", "uint256"],
      [this.chainId, toHexIdUint64(hexId), submitter, score]
    );
    return this.wallet.signMessage(ethers.getBytes(message));
  }

  /**
   * SeasonController.greatBurn verifies:
   *   keccak256(abi.encode(block.chainid, seasonNumber, topHexIds, yields))
   * Note the contract uses non-packed `abi.encode`, so we mirror it with
   * AbiCoder.defaultAbiCoder().encode (NOT solidityPacked).
   */
  async signGreatBurn(
    seasonNumber: number | bigint,
    topHexIds: bigint[],
    yields: bigint[]
  ): Promise<string> {
    const payload = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256", "uint64[]", "uint256[]"],
      [this.chainId, BigInt(seasonNumber), topHexIds, yields]
    );
    const hash = ethers.keccak256(payload);
    return this.wallet.signMessage(ethers.getBytes(hash));
  }
}

/**
 * Normalize an H3 hex id string to the contract's `uint64` domain.
 * H3 indexes are 64-bit hex strings (with or without a `0x` prefix). "0"/""/"0x0"
 * map to 0n, matching the contract's "not in any zone" sentinel.
 */
export function toHexIdUint64(hexId: string): bigint {
  if (!hexId || hexId === "0" || hexId === "0x0") return 0n;
  return BigInt(hexId.startsWith("0x") ? hexId : "0x" + hexId);
}
