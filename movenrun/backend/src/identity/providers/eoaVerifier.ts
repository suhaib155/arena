/**
 * Offline EOA signature verifier — the one concrete signature adapter this PR
 * ships. It recovers the signer from a personal_sign / EIP-191 signature using
 * `ethers.verifyMessage`, which is a pure cryptographic operation: NO network,
 * NO RPC, NO key material. It only ever handles a PUBLIC address and a
 * signature the client already produced.
 *
 * Deliberately narrow: it verifies plain externally-owned accounts only. A
 * smart-contract wallet (Base Account, ERC-4337) may not sign with a recover-
 * able secp256k1 signature, so those MUST be routed to a
 * SmartAccountSignatureVerifier (ERC-1271/6492) — see ADR-0005. We never
 * assume `verifyMessage` covers all wallets.
 */
import { verifyMessage } from "ethers";
import type {
  SignatureVerificationResult,
  VerifySignatureInput,
  WalletOwnershipVerifier,
} from "./types.js";

export class EoaSignatureVerifier implements WalletOwnershipVerifier {
  readonly kind = "eoa" as const;

  async verify(input: VerifySignatureInput): Promise<SignatureVerificationResult> {
    try {
      const recovered = verifyMessage(input.message, input.signature);
      return { valid: recovered.toLowerCase() === input.addressCanonical.toLowerCase() };
    } catch {
      // Malformed signature, wrong length, etc. → fail closed, never throw.
      return { valid: false };
    }
  }
}

/**
 * Fail-closed smart-account verifier used until a real ERC-1271/6492 verifier
 * (which needs an RPC provider) is wired. It ALWAYS reports invalid so a
 * contract-wallet link cannot silently succeed through an unverified path.
 */
export class NotConfiguredSmartAccountVerifier {
  readonly kind = "smart_account" as const;
  async verify(_input: VerifySignatureInput): Promise<SignatureVerificationResult> {
    return { valid: false };
  }
}
