/**
 * Narrow production provider interfaces — the ONLY surface the domain services
 * depend on. Concrete vendor SDKs live behind adapters that implement these;
 * no vendor SDK type is ever allowed to leak past an adapter (ADR-0002/0003).
 *
 * This PR ships NO concrete third-party vendor adapter (per the brief: prefer
 * secure architecture over premature SDK coupling). It ships:
 *   - the interfaces below;
 *   - a real, offline `EoaSignatureVerifier` (ethers, no network);
 *   - `NotConfigured*` fail-closed adapters used when a provider isn't wired;
 *   - deterministic test doubles under ../testDoubles (test-only).
 */

/** Result of verifying a signed challenge. Never returns the signature itself. */
export interface SignatureVerificationResult {
  valid: boolean;
  /** For smart-account verifiers: whether the account is deployed (ERC-6492
   *  covers the undeployed case). Undefined for plain EOA verification. */
  deployed?: boolean;
}

export interface VerifySignatureInput {
  /** The exact message that was signed (SIWE/EIP-4361 string). */
  message: string;
  /** The signature bytes (0x-hex). Held only for this request, never stored. */
  signature: string;
  /** Canonical (lowercase) address the signature must recover to / validate for. */
  addressCanonical: string;
  /** Chain the account lives on (relevant for contract-wallet verification). */
  chainId: number;
}

/** Verifies plain EOA (secp256k1 personal_sign) signatures. Offline. */
export interface WalletOwnershipVerifier {
  readonly kind: "eoa";
  verify(input: VerifySignatureInput): Promise<SignatureVerificationResult>;
}

/**
 * Verifies smart-contract-wallet signatures: ERC-1271 (deployed) and ERC-6492
 * (undeployed / counterfactual). A real implementation needs an RPC provider,
 * so it is intentionally NOT wired in this PR — the fail-closed
 * `NotConfiguredSmartAccountVerifier` is used instead. The interface exists so
 * the wallet-link service already routes contract wallets through it.
 */
export interface SmartAccountSignatureVerifier {
  readonly kind: "smart_account";
  verify(input: VerifySignatureInput): Promise<SignatureVerificationResult>;
}

/** Outcome of an embedded-wallet provisioning call. Contains NO secret — only
 *  the public address and an opaque provider handle. */
export interface EmbeddedWalletProvisionResult {
  addressCanonical: string;
  addressChecksum: string;
  /** Opaque provider reference (e.g. wallet id). NEVER a key or seed. */
  providerWalletRef: string;
}

/** Distinguishes a safely-retryable failure from a terminal one. */
export class EmbeddedWalletTransientError extends Error {
  constructor(message = "embedded wallet provider transient failure") {
    super(message);
    this.name = "EmbeddedWalletTransientError";
  }
}
export class EmbeddedWalletTerminalError extends Error {
  constructor(message = "embedded wallet provider terminal failure") {
    super(message);
    this.name = "EmbeddedWalletTerminalError";
  }
}

/**
 * Provisions and (later) exports a user-controlled embedded wallet. The export
 * path never returns secret material to MovenRun — it returns only a handoff
 * reference the client uses to open the provider's isolated export surface
 * (ADR-0009). `provision` must be safe to call more than once for the same
 * idempotency key: a provider replay returns the SAME wallet, not a new one.
 */
export interface EmbeddedWalletProvider {
  readonly providerName: string;
  provision(input: { userId: string; idempotencyKey: string }): Promise<EmbeddedWalletProvisionResult>;
  /** Returns an opaque, short-lived handoff reference for the provider's
   *  isolated export UI. Throws if step-up requirements aren't met upstream. */
  beginExport(input: { userId: string; walletProviderRef: string }): Promise<{ handoffRef: string; expiresAt: Date }>;
}

/** Verified result of an external auth provider (email OTP is handled
 *  natively; this covers OIDC/Base-style providers that return a subject). */
export interface ExternalAuthResult {
  provider: "google" | "base_account";
  providerSubject: string;
  normalizedEmail: string | null;
  emailVerified: boolean;
}

/** OIDC (Google) adapter. Not wired in this PR (fail closed when unconfigured). */
export interface OidcAuthProvider {
  readonly provider: "google";
  buildAuthorizationUrl(input: {
    state: string;
    nonce: string;
    codeChallenge: string;
    redirectUri: string;
  }): string;
  exchangeCode(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    expectedNonce: string;
  }): Promise<ExternalAuthResult>;
}

/** Sends an email OTP. External side effect; not wired in this PR. */
export interface EmailOtpDeliveryProvider {
  readonly providerName: string;
  sendOtp(input: { email: string; code: string; ttlSeconds: number }): Promise<void>;
}
