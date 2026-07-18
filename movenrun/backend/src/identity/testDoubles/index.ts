/**
 * Deterministic provider test doubles — FOR TESTS ONLY.
 *
 * A guard test (securityControls.test.ts) asserts that NO production module
 * under src/identity/** imports anything from this directory, enforcing the
 * "production modules cannot import fake adapters" boundary from the brief.
 * These doubles make NO network call, hold NO private key, and generate NO
 * mnemonic — embedded addresses are derived deterministically from a hash of
 * the idempotency key purely so tests are reproducible.
 */
import { createHash } from "node:crypto";
import { getAddress } from "ethers";
import type {
  EmailOtpDeliveryProvider,
  EmbeddedWalletProvider,
  EmbeddedWalletProvisionResult,
  SignatureVerificationResult,
  SmartAccountSignatureVerifier,
  VerifySignatureInput,
} from "../providers/types.js";
import { EmbeddedWalletTerminalError, EmbeddedWalletTransientError } from "../providers/types.js";

/** Derive a stable, valid-looking EVM address from a seed — NO key material. */
function deterministicAddress(seed: string): { canonical: string; checksum: string } {
  const bytes = createHash("sha256").update(seed).digest().subarray(0, 20);
  const checksum = getAddress("0x" + bytes.toString("hex"));
  return { canonical: checksum.toLowerCase(), checksum };
}

export interface EmbeddedWalletProviderDoubleOptions {
  /** Number of leading calls that should throw a transient error before
   *  succeeding — models a flaky provider for retry tests. */
  transientFailures?: number;
  /** If true, always throws a terminal error. */
  terminal?: boolean;
}

export class EmbeddedWalletProviderDouble implements EmbeddedWalletProvider {
  readonly providerName = "double-embedded";
  private calls = 0;
  /** idempotencyKey → issued result, so a replay returns the SAME wallet. */
  private issued = new Map<string, EmbeddedWalletProvisionResult>();

  constructor(private readonly opts: EmbeddedWalletProviderDoubleOptions = {}) {}

  get provisionCallCount(): number {
    return this.calls;
  }

  async provision(input: { userId: string; idempotencyKey: string }): Promise<EmbeddedWalletProvisionResult> {
    this.calls += 1;
    if (this.opts.terminal) throw new EmbeddedWalletTerminalError();
    if (this.opts.transientFailures && this.calls <= this.opts.transientFailures) {
      throw new EmbeddedWalletTransientError();
    }
    const cached = this.issued.get(input.idempotencyKey);
    if (cached) return cached;
    const addr = deterministicAddress(`embedded:${input.idempotencyKey}`);
    const result: EmbeddedWalletProvisionResult = {
      addressCanonical: addr.canonical,
      addressChecksum: addr.checksum,
      providerWalletRef: `wref_${createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 16)}`,
    };
    this.issued.set(input.idempotencyKey, result);
    return result;
  }

  async beginExport(input: { userId: string; walletProviderRef: string }): Promise<{ handoffRef: string; expiresAt: Date }> {
    return {
      handoffRef: `export_${createHash("sha256").update(input.walletProviderRef).digest("hex").slice(0, 16)}`,
      expiresAt: new Date(Date.now() + 60_000),
    };
  }
}

/** Captures delivered OTP codes so tests can complete the flow. */
export class EmailOtpDeliveryDouble implements EmailOtpDeliveryProvider {
  readonly providerName = "double-email";
  readonly sent: Array<{ email: string; code: string }> = [];

  async sendOtp(input: { email: string; code: string; ttlSeconds: number }): Promise<void> {
    this.sent.push({ email: input.email, code: input.code });
  }

  lastCodeFor(email: string): string | undefined {
    for (let i = this.sent.length - 1; i >= 0; i--) if (this.sent[i].email === email) return this.sent[i].code;
    return undefined;
  }
}

/**
 * Smart-account verifier double: treats a signature as valid iff it exactly
 * equals the marker `smart-account-ok` for the expected address — enough to
 * exercise the contract-wallet routing path deterministically without an RPC.
 */
export class SmartAccountVerifierDouble implements SmartAccountSignatureVerifier {
  readonly kind = "smart_account" as const;
  async verify(input: VerifySignatureInput): Promise<SignatureVerificationResult> {
    return { valid: input.signature === `smart-account-ok:${input.addressCanonical}`, deployed: true };
  }
}
