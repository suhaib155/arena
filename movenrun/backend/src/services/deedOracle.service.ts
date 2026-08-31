import { ethers } from "ethers";
import { getConfig } from "../config.js";

/**
 * DeedOracleService — authorizes DeedRegistry claims.
 *
 * Separate from `OracleService` on purpose, and not an extra method on it. The
 * two sign fundamentally different things:
 *
 *   OracleService      personal_sign over solidityPackedKeccak256(...)
 *                      — EIP-191, matching the V1 contracts'
 *                        MessageHashUtils.toEthSignedMessageHash + ECDSA.recover
 *   DeedOracleService  EIP-712 typed data over a DeedClaim struct
 *                      — matching DeedRegistry._hashTypedDataV4
 *
 * They are not interchangeable, and a signature from one will never verify
 * against the other's contract. Putting an EIP-712 method on a class whose
 * every other method is EIP-191 would make that easy to get wrong at a call
 * site, so the two live apart and each one's doc says which scheme it is.
 *
 * ## What a signature here authorizes
 *
 * Exactly one claim: this claimant, this cell, once, before this deadline, on
 * this chain, against this registry. Every one of those is inside the signed
 * data or the domain, so a signature cannot be redirected to another person,
 * another cell, another deployment, or another chain — and cannot be used
 * twice, because the registry consumes the claim id.
 *
 * ## What signing does NOT mean
 *
 * This service does not decide eligibility. It signs what it is told to sign.
 * Whether a claimant actually moved through a cell is a question for the
 * movement-verification layer, and a caller that signs without checking that
 * first has authorized a deed for nothing. `assertEligible` is deliberately a
 * required argument rather than an optional flag so that skipping the check has
 * to be written down.
 */

/** Mirrors DeedRegistry.SIGNING_DOMAIN_NAME / _VERSION. */
export const DEED_DOMAIN_NAME = "MovenRunDeedRegistry";
export const DEED_DOMAIN_VERSION = "1";

/** Mirrors DeedRegistry.DEED_CLAIM_TYPEHASH's struct definition. */
export const DEED_CLAIM_TYPES = {
  DeedClaim: [
    { name: "cellId", type: "uint64" },
    { name: "claimant", type: "address" },
    { name: "claimId", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export interface DeedClaimFields {
  /** The H3 cell, as the uint64 the registry uses for its token id. */
  cellId: bigint;
  /** The address that will send the claim transaction. */
  claimant: string;
  /** Single-use identifier; the registry consumes it. */
  claimId: string;
  /** Unix seconds after which the registry refuses the authorization. */
  deadline: number;
}

export interface DeedOracleOptions {
  /** Signer key. Falls back to config ORACLE_PRIVATE_KEY. */
  privateKey?: string;
  /** Chain the registry is deployed on. Falls back to config CHAIN_ID. */
  chainId?: number | bigint;
  /** The registry's address — part of the EIP-712 domain. */
  registryAddress: string;
}

/**
 * How long an authorization is valid for.
 *
 * Fifteen minutes. Long enough for a participant to receive it and send one
 * transaction, short enough that a leaked authorization is worthless almost
 * immediately. It is not a session; it is permission to send one transaction
 * that is about to be sent.
 */
export const DEED_CLAIM_TTL_SECONDS = 15 * 60;

export class DeedOracleService {
  /* A genuine private field, not TypeScript's `private`, which is erased at
     compile time and leaves the signing wallet — and therefore the key —
     reachable as `(service as any).wallet.privateKey`. `#wallet` is enforced by
     the runtime, so nothing outside this class can reach it and it does not
     appear in JSON.stringify, console output, or an error's serialized shape. */
  readonly #wallet: ethers.Wallet;
  readonly chainId: bigint;
  readonly registryAddress: string;

  constructor(opts: DeedOracleOptions) {
    const privateKey = opts.privateKey ?? getConfig().ORACLE_PRIVATE_KEY;
    const chainId = opts.chainId ?? getConfig().CHAIN_ID;
    if (!ethers.isAddress(opts.registryAddress)) {
      throw new Error("DeedOracleService: registryAddress must be a valid address");
    }
    this.#wallet = new ethers.Wallet(privateKey);
    this.chainId = BigInt(chainId);
    this.registryAddress = ethers.getAddress(opts.registryAddress);
  }

  /** The address the registry must hold ORACLE_SIGNER_ROLE for. */
  get address(): string {
    return this.#wallet.address;
  }

  /** The EIP-712 domain, exactly as the registry computes it. */
  get domain(): ethers.TypedDataDomain {
    return {
      name: DEED_DOMAIN_NAME,
      version: DEED_DOMAIN_VERSION,
      chainId: this.chainId,
      verifyingContract: this.registryAddress,
    };
  }

  /** A fresh single-use claim id. 32 random bytes — not derived from the cell
   *  or the claimant, so it leaks nothing and cannot collide in practice. */
  static newClaimId(): string {
    return ethers.hexlify(ethers.randomBytes(32));
  }

  /**
   * Sign one claim authorization.
   *
   * @param assertEligible must be true, and the caller must have established it
   *   from verified movement. It is a required argument rather than a default
   *   so that authorizing a deed without checking has to be typed deliberately.
   */
  async signClaim(fields: DeedClaimFields, assertEligible: boolean): Promise<string> {
    if (!assertEligible) {
      throw new Error(
        "DeedOracleService: refusing to sign a claim that has not been established as " +
          "eligible from verified movement. A deed authorized for nothing is worse than " +
          "no deed.",
      );
    }
    if (!ethers.isAddress(fields.claimant)) {
      throw new Error("DeedOracleService: claimant must be a valid address");
    }
    if (fields.claimant === ethers.ZeroAddress) {
      throw new Error("DeedOracleService: refusing to authorize the zero address");
    }
    if (fields.cellId < 0n || fields.cellId > (1n << 64n) - 1n) {
      throw new Error("DeedOracleService: cellId must fit in uint64");
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(fields.claimId)) {
      throw new Error("DeedOracleService: claimId must be 32 bytes");
    }
    if (!Number.isInteger(fields.deadline) || fields.deadline <= 0) {
      throw new Error("DeedOracleService: deadline must be a positive unix timestamp");
    }

    return this.#wallet.signTypedData(this.domain, DEED_CLAIM_TYPES as never, {
      cellId: fields.cellId,
      claimant: ethers.getAddress(fields.claimant),
      claimId: fields.claimId,
      deadline: fields.deadline,
    });
  }

  /**
   * Recover the signer of an authorization.
   *
   * For checking one's own output before handing it to a participant — an
   * authorization that does not recover to this service's address would fail
   * on-chain and waste their gas.
   */
  verify(fields: DeedClaimFields, signature: string): string {
    return ethers.verifyTypedData(this.domain, DEED_CLAIM_TYPES as never, fields, signature);
  }
}
