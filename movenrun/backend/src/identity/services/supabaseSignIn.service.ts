/**
 * Sign-in through Supabase Auth: "Continue with Google" and "Continue with
 * Wallet". Supabase holds the login methods; MovenRun keys its own account to
 * the Supabase user id (`auth.users.id`) as a ("supabase", <id>) identity, so
 * every method Supabase attaches to that user reaches the same player and
 * nothing is ever matched by email or address.
 *
 * Google: the app completes Supabase's PKCE flow itself and hands the server a
 * Supabase access token, which is verified here and must come from an OAuth
 * login.
 *
 * Wallet in the app: the signing happens in the wallet's own browser, on the
 * MovenRun sign-in page. That page finishes the wallet sign-in with a PKCE
 * challenge from the app and receives a one-time code instead of a session;
 * the app exchanges the code with its verifier. The code alone is worthless.
 *
 * Wallet: the server writes the EIP-4361 message (domain, URI, chain, a
 * single-use nonce, five-minute expiry), the wallet signs it, and the server
 * checks the nonce, the exact message and the signature before passing it to
 * Supabase's Web3 grant. A wallet signature is not a transaction: nothing is
 * sent on chain and no funds are needed. Only plain EOA wallets are accepted;
 * contract wallets (EIP-1271) are refused until a verifier for them exists.
 */
import { createHash, randomBytes } from "node:crypto";
import { getAddress } from "ethers";
import { IdentityError } from "../domain/errors.js";
import type { IdentityStores } from "../repositories/interfaces.js";
import type { SignInStores } from "../repositories/signInStores.js";
import { SupabaseAuthError, type VerifiedSupabaseUser } from "../providers/supabaseAuth.js";
import type { WalletOwnershipVerifier } from "../providers/types.js";

export const SUPABASE_PROVIDER = "supabase" as const;
export const WALLET_MESSAGE_TTL_MS = 5 * 60 * 1000;
export const WALLET_SIGN_IN_STATEMENT =
  "Sign in to MovenRun. This only proves you control this address: it is not a transaction and costs nothing.";
/** Base mainnet. Only the chain id written into the message; nothing is sent to any chain. */
export const DEFAULT_WALLET_CHAIN_ID = 8453;
/** How long a wallet sign-in may wait in the wallet's browser before the app collects it. */
export const WALLET_HANDOFF_TTL_MS = 5 * 60 * 1000;
/** Handoff codes use an unambiguous alphabet so a person can type one if the redirect fails. */
const HANDOFF_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
const HANDOFF_CODE_LENGTH = 12;
export const HANDOFF_CODE_RE = /^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{12}$/;
/** RFC 7636: S256 challenge, 43 base64url characters. */
export const PKCE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
export const PKCE_VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;

const sha256 = (value: string) => createHash("sha256").update(value).digest();
export const pkceChallengeOf = (verifier: string) => sha256(verifier).toString("base64url");

function randomHandoffCode(): string {
  // Rejection sampling keeps every character equally likely.
  let out = "";
  while (out.length < HANDOFF_CODE_LENGTH) {
    for (const byte of randomBytes(32)) {
      if (byte < 240 && out.length < HANDOFF_CODE_LENGTH) out += HANDOFF_ALPHABET[byte % HANDOFF_ALPHABET.length];
    }
  }
  return out;
}

export interface SupabaseTokenCheck {
  verify(token: string): Promise<VerifiedSupabaseUser>;
}

export interface SupabaseAuthCalls {
  signInWithEthereum(message: string, signature: string): Promise<{ accessToken: string }>;
  deleteUser(subject: string): Promise<void>;
}

export interface SupabaseSignInConfig {
  /** The domain written into wallet messages; must also be on Supabase's redirect allow list. */
  authDomain: string;
  chainId: number;
}

interface Deps {
  tokens: SupabaseTokenCheck;
  auth: SupabaseAuthCalls;
  stores: Pick<IdentityStores, "identities">;
  signIn: SignInStores;
  eoaVerifier: WalletOwnershipVerifier;
  config: SupabaseSignInConfig;
  now?: () => Date;
  nonce?: () => string;
  handoffCode?: () => string;
}

export interface VerifiedSignIn {
  subject: string;
  email: string | null;
  method: "google" | "wallet";
}

export class SupabaseSignInService {
  private readonly now: () => Date;
  private readonly nonce: () => string;
  private readonly handoffCode: () => string;

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? (() => new Date());
    this.nonce = deps.nonce ?? (() => randomBytes(12).toString("hex"));
    this.handoffCode = deps.handoffCode ?? randomHandoffCode;
  }

  /** Verify a Supabase session from Google sign-in. */
  async verifyGoogle(accessToken: string): Promise<VerifiedSignIn> {
    let user: VerifiedSupabaseUser;
    try {
      user = await this.deps.tokens.verify(accessToken);
    } catch {
      throw new IdentityError("verification_failed");
    }
    // Only an OAuth login may come in this way. A Web3 session must go through
    // the wallet routes, where the nonce and message are checked.
    if (!user.methods.includes("oauth")) throw new IdentityError("verification_failed");
    return { subject: user.subject, email: user.email, method: "google" };
  }

  /** Write the message the wallet will sign. */
  async beginWallet(rawAddress: string): Promise<{ message: string; expiresAt: Date }> {
    let address: string;
    try {
      address = getAddress(rawAddress.trim());
    } catch {
      throw new IdentityError("invalid_request", "invalid address");
    }
    const issuedAt = this.now();
    const expiresAt = new Date(issuedAt.getTime() + WALLET_MESSAGE_TTL_MS);
    const nonce = this.nonce();
    const { authDomain, chainId } = this.deps.config;
    // EIP-4361 layout, field for field as Supabase's own client writes it.
    const message =
      `${authDomain} wants you to sign in with your Ethereum account:\n${address}\n\n${WALLET_SIGN_IN_STATEMENT}\n\n` +
      `URI: https://${authDomain}/sign-in/\nVersion: 1\nChain ID: ${chainId}\nNonce: ${nonce}\n` +
      `Issued At: ${issuedAt.toISOString()}\nExpiration Time: ${expiresAt.toISOString()}`;
    await this.deps.signIn.walletChallenges.create({ nonce, address, message, expiresAt });
    await this.deps.signIn.walletChallenges.purgeExpired(new Date(issuedAt.getTime() - 24 * 60 * 60 * 1000));
    return { message, expiresAt };
  }

  /** Check a signed message and obtain the Supabase user for that wallet. */
  async completeWallet(message: string, signature: string): Promise<VerifiedSignIn> {
    const nonce = /^Nonce: ([A-Za-z0-9]{8,64})$/m.exec(message)?.[1];
    if (!nonce || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new IdentityError("verification_failed");
    const challenge = await this.deps.signIn.walletChallenges.find(nonce);
    // The exact message this server wrote, and nothing else, is accepted.
    if (!challenge || challenge.message !== message) throw new IdentityError("verification_failed");
    const now = this.now();
    if (challenge.consumedAt) throw new IdentityError("challenge_consumed");
    if (challenge.expiresAt.getTime() <= now.getTime()) throw new IdentityError("challenge_expired");
    // Single use, decided by one conditional write before anything else happens.
    if (!(await this.deps.signIn.walletChallenges.consume(nonce, now))) throw new IdentityError("challenge_consumed");

    const proof = await this.deps.eoaVerifier.verify({
      addressCanonical: challenge.address,
      message,
      signature,
      chainId: this.deps.config.chainId,
    });
    if (!proof.valid) throw new IdentityError("verification_failed");

    let accessToken: string;
    try {
      ({ accessToken } = await this.deps.auth.signInWithEthereum(message, signature));
    } catch (err) {
      // A refusal (for example the account cap in the provider's hook) is final;
      // an outage is worth retrying with a new message.
      if (err instanceof SupabaseAuthError && err.reason === "rejected") throw new IdentityError("verification_failed");
      throw new IdentityError("provider_not_configured");
    }
    let user: VerifiedSupabaseUser;
    try {
      user = await this.deps.tokens.verify(accessToken);
    } catch {
      throw new IdentityError("verification_failed");
    }
    return { subject: user.subject, email: null, method: "wallet" };
  }

  /**
   * Park a finished wallet sign-in for the app. The code is returned once and
   * only its hash is kept; it can be spent once, within a few minutes, by the
   * holder of the verifier behind `codeChallenge`.
   */
  async createHandoff(verified: VerifiedSignIn, codeChallenge: string): Promise<{ code: string; expiresAt: Date }> {
    if (!PKCE_CHALLENGE_RE.test(codeChallenge)) throw new IdentityError("invalid_request", "invalid code challenge");
    const code = this.handoffCode();
    const expiresAt = new Date(this.now().getTime() + WALLET_HANDOFF_TTL_MS);
    await this.deps.signIn.walletHandoffs.create({
      codeHash: sha256(code).toString("hex"),
      codeChallenge,
      subject: verified.subject,
      expiresAt,
    });
    return { code, expiresAt };
  }

  /** Spend a handoff code with the app's verifier. */
  async exchangeHandoff(rawCode: string, verifier: string): Promise<VerifiedSignIn> {
    const code = rawCode.trim().toUpperCase().replace(/[\s-]/g, "");
    if (!HANDOFF_CODE_RE.test(code) || !PKCE_VERIFIER_RE.test(verifier)) throw new IdentityError("verification_failed");
    const subject = await this.deps.signIn.walletHandoffs.consume(sha256(code).toString("hex"), pkceChallengeOf(verifier), this.now());
    if (!subject) throw new IdentityError("verification_failed");
    return { subject, email: null, method: "wallet" };
  }

  /**
   * Codes nobody collected: the provider user behind each one is removed
   * unless it already belongs to a MovenRun account.
   */
  async expireHandoffs(limit = 50): Promise<number> {
    const now = this.now();
    await this.deps.signIn.walletHandoffs.purgeConsumed(new Date(now.getTime() - 24 * 60 * 60 * 1000));
    const expired = [...new Set(await this.deps.signIn.walletHandoffs.takeExpired(now, limit))];
    // The same wallet always maps to the same provider user, so a newer code
    // (or one already spent) for that user keeps it.
    const abandoned: string[] = [];
    for (const subject of expired) if (!(await this.deps.signIn.walletHandoffs.inUse(subject, now))) abandoned.push(subject);
    return (await this.removeProviderUsers(abandoned)).removed.length;
  }

  /**
   * A provider user that MovenRun refused (account cap) or erased must not
   * linger at the provider. Users still mapped to a MovenRun account are never
   * touched. Failures are queued and retried by `retryPendingDeletions`.
   */
  async removeProviderUsers(subjects: readonly string[]): Promise<{ removed: string[]; pending: string[] }> {
    const removed: string[] = [];
    const pending: string[] = [];
    for (const subject of subjects) {
      const mapped = await this.deps.stores.identities.findActiveByProviderSubject(SUPABASE_PROVIDER, subject);
      if (mapped) continue;
      await this.deps.signIn.pendingAuthDeletions.add([subject]);
      try {
        await this.deps.auth.deleteUser(subject);
        await this.deps.signIn.pendingAuthDeletions.remove(subject);
        removed.push(subject);
      } catch {
        await this.deps.signIn.pendingAuthDeletions.markAttempt(subject, this.now());
        pending.push(subject);
      }
    }
    return { removed, pending };
  }

  /** Retry provider deletions that failed earlier. Safe to run repeatedly. */
  async retryPendingDeletions(limit = 50): Promise<number> {
    const due = await this.deps.signIn.pendingAuthDeletions.due(this.now(), 10 * 60 * 1000, limit);
    return (await this.removeProviderUsers(due)).removed.length;
  }
}
