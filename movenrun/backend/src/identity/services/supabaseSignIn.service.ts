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
import { SupabaseAuthError, type ProviderUserSummary, type VerifiedSupabaseUser } from "../providers/supabaseAuth.js";
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
  listUsers(page: number, perPage: number): Promise<ProviderUserSummary[]>;
  getUser(subject: string): Promise<ProviderUserSummary | null>;
}

/** How soon after its Google sign-in a Supabase session must be exchanged. */
export const GOOGLE_EXCHANGE_WINDOW_MS = 10 * 60 * 1000;
/** Clock difference tolerated between Supabase and this server. */
export const GOOGLE_EXCHANGE_SKEW_MS = 60 * 1000;
/**
 * How long a spent session's record is kept: far longer than the window, so
 * the record still refuses the session if its sign-in time were ever
 * misreported. Rows are a session id and a time; at the 1,000-account cap a
 * month of daily sign-ins is about 30,000 rows (a few MB).
 */
export const GOOGLE_EXCHANGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Most spent records one exchange removes; the rest go on later exchanges. */
export const GOOGLE_EXCHANGE_PURGE_BATCH = 500;

/** How long a provider user may exist without a MovenRun account before the sweep removes it. */
export const ORPHAN_GRACE_MS = 60 * 60 * 1000;
/** Most provider users one sweep may delete; the rest wait for the next run. */
export const ORPHAN_SWEEP_MAX_DELETES = 100;

/** First wait before a failed provider deletion is retried; doubles per attempt, up to a day. */
export const PENDING_DELETION_RETRY_MS = 10 * 60 * 1000;
/**
 * How long one worker owns a queued deletion while it reads and deletes the
 * provider user. Far longer than the two provider calls can take (10 s
 * timeout each), so a lease never lapses mid-call; a worker that dies holding
 * one only delays that row.
 */
export const PENDING_DELETION_LEASE_MS = 10 * 60 * 1000;
/** A queued deletion older than this is reported (as a count) every run. */
export const PENDING_DELETION_OVERDUE_MS = 24 * 60 * 60 * 1000;

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
  /** Operator log; counts only. */
  log?: Pick<Console, "warn">;
}

export interface VerifiedSignIn {
  subject: string;
  email: string | null;
  method: "google" | "wallet";
  /** Google only: the Supabase session to spend with `claimGoogleExchange`, and how long its record is kept. */
  googleSession?: { id: string; keepUntil: Date };
}

export class SupabaseSignInService {
  private readonly now: () => Date;
  private readonly nonce: () => string;
  private readonly handoffCode: () => string;
  private sweeping: Promise<number> | null = null;

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? (() => new Date());
    this.nonce = deps.nonce ?? (() => randomBytes(12).toString("hex"));
    this.handoffCode = deps.handoffCode ?? randomHandoffCode;
  }

  /**
   * Verify a Supabase session from Google sign-in.
   *
   * One MovenRun session per Supabase session. Two independent guards:
   *
   * - Time: a session may be exchanged only within GOOGLE_EXCHANGE_WINDOW_MS
   *   of its Google sign-in, read from the token's `oauth` amr entry alone.
   *   A refresh gives a new token for the same session; any newer
   *   `token_refresh` (or other) entry it carries is ignored, so a refresh
   *   cannot restart the window.
   * - Record: the first exchange records the session id and keeps it for
   *   GOOGLE_EXCHANGE_RETENTION_MS, far past the window, so a copy of the
   *   token or a refresh of it is refused even if the first guard were wrong.
   *
   * The app and website exchange right after the Google redirect and never
   * retry with the same token, so this refuses only a replay. A token without
   * a session id or a single oauth sign-in time is refused rather than let in
   * unrecorded.
   *
   * Nothing is spent here: the record is written by `claimGoogleExchange`
   * after the account is admitted and just before the MovenRun session is
   * issued, so a refusal (account cap, hourly quota) or an outage before that
   * point leaves the same token usable for a retry.
   */
  async verifyGoogle(accessToken: string): Promise<VerifiedSignIn> {
    let user: VerifiedSupabaseUser;
    try {
      user = await this.deps.tokens.verify(accessToken);
    } catch {
      throw new IdentityError("verification_failed");
    }
    // Only an OAuth login may come in this way. A Web3 session must go through
    // the wallet routes, where the nonce and message are checked.
    if (!user.methods.includes("oauth") || !user.providers.includes("google")) throw new IdentityError("verification_failed");
    if (!user.sessionId || !user.oauthSignedInAt) throw new IdentityError("verification_failed");
    const now = this.now().getTime();
    const signedInAt = user.oauthSignedInAt.getTime();
    if (signedInAt > now + GOOGLE_EXCHANGE_SKEW_MS || now - signedInAt > GOOGLE_EXCHANGE_WINDOW_MS) throw new IdentityError("verification_failed");
    // A cheap read refuses a plain replay before any account work.
    if (await this.deps.signIn.googleExchanges.exchanged(user.sessionId)) throw new IdentityError("verification_failed");
    return {
      subject: user.subject,
      email: user.email,
      method: "google",
      googleSession: { id: user.sessionId, keepUntil: new Date(now + GOOGLE_EXCHANGE_RETENTION_MS) },
    };
  }

  /**
   * Spend a verified Google sign-in. Called once the account is admitted and
   * immediately before the MovenRun session is issued; of concurrent
   * exchanges of one Supabase session exactly one gets past this. If the
   * session cannot be issued after this point (a database failure or a lost
   * process) the player signs in with Google again, which starts a new
   * Supabase session; a lost response is the same case and must not be
   * retried with the token.
   */
  async claimGoogleExchange(verified: VerifiedSignIn): Promise<void> {
    const session = verified.googleSession;
    if (!session) throw new IdentityError("verification_failed");
    await this.deps.signIn.googleExchanges.purgeExpired(this.now(), GOOGLE_EXCHANGE_PURGE_BATCH);
    if (!(await this.deps.signIn.googleExchanges.claim(session.id, session.keepUntil))) throw new IdentityError("verification_failed");
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
      // A refusal is final; an outage is worth retrying with a new message. The
      // provider's hook answers 403 at the account cap and 429 at the hourly
      // quota (0009); 429 is also the provider's own sign-in rate limit.
      if (err instanceof SupabaseAuthError && err.reason === "rejected") {
        if (err.status === 403) throw new IdentityError("registration_closed");
        if (err.status === 429) throw new IdentityError("too_many_attempts");
        throw new IdentityError("verification_failed");
      }
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
    // An expired code was made more than one code lifetime ago, right after
    // its wallet signed in. A provider sign-in since then is the person back
    // (a direct sign-in whose account may not be committed yet), so the user
    // is kept and left to the orphan sweep.
    const signedInAfter = new Date(now.getTime() - WALLET_HANDOFF_TTL_MS);
    let removed = 0;
    for (const subject of expired) {
      if (await this.deps.signIn.walletHandoffs.inUse(subject, now)) continue;
      if ((await this.deleteProviderUser(subject, { signedInAfter })) === "removed") removed += 1;
    }
    return removed;
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
      const outcome = await this.deleteProviderUser(subject, {});
      if (outcome === "removed") removed.push(subject);
      else if (outcome === "pending") pending.push(subject);
    }
    return { removed, pending };
  }

  /**
   * One provider deletion, owned through its queue row (A-2).
   *
   * Policy: a newly established identity is never deleted. A subject mapped
   * to an active account, or whose provider user signed in after the deletion
   * was requested (or after `signedInAfter`), is "kept" or "superseded": its
   * row is retired and an unmapped user is left to the orphan sweep, which
   * waits out its own grace period. Any doubt (the provider cannot be read,
   * another worker owns the row) leaves the user in place.
   *
   * Why this cannot delete an account a sign-in is establishing: the row is
   * claimed before the provider user is read. A provider sign-in before the
   * claim shows in that read; one after it reaches `adoptPendingDeletion`
   * while the lease is live and is refused there before any account exists.
   */
  private async deleteProviderUser(
    subject: string,
    opts: { retryAfterMs?: number; signedInAfter?: Date },
  ): Promise<"removed" | "pending" | "kept"> {
    const queue = this.deps.signIn.pendingAuthDeletions;
    const mapped = () => this.deps.stores.identities.findActiveByProviderSubject(SUPABASE_PROVIDER, subject);
    if (await mapped()) {
      await queue.adopt(subject, this.now());
      return "kept";
    }
    // A new request is queued first so a failure is retried; a retry only
    // claims an existing row and never revives one another worker retired.
    if (opts.retryAfterMs === undefined) await queue.add([subject], this.now());
    const claim = await queue.claim(subject, this.now(), { leaseMs: PENDING_DELETION_LEASE_MS, retryAfterMs: opts.retryAfterMs });
    if (!claim) return "pending";
    // Read again under the lease: a sign-in may have mapped it since.
    if (await mapped()) {
      await queue.finish(subject, claim.token);
      return "kept";
    }
    let current: ProviderUserSummary | null;
    try {
      current = await this.deps.auth.getUser(subject);
    } catch {
      // Fail closed: never delete a user that could not be read.
      await queue.release(subject, claim.token, this.now());
      return "pending";
    }
    const cutoff = opts.signedInAfter ?? claim.requestedAt;
    if (current?.lastSignInAt && current.lastSignInAt.getTime() > cutoff.getTime()) {
      // Signed in again since the request: superseded. The row is retired so it
      // cannot stay due; if no account follows, the orphan sweep removes it.
      await queue.finish(subject, claim.token);
      return "pending";
    }
    try {
      // Deleting a user that is already gone succeeds, so a retry after a lost
      // response converges.
      await this.deps.auth.deleteUser(subject);
    } catch {
      await queue.release(subject, claim.token, this.now());
      return "pending";
    }
    await queue.finish(subject, claim.token);
    return "removed";
  }

  /**
   * Called on every Supabase sign-in before the account is looked up or
   * created: the person is back, so a queued deletion of their provider user
   * is retired. Refused, with a retryable error, while a deletion of that user
   * is in flight, because the user may be gone a moment later.
   */
  async adoptPendingDeletion(subject: string): Promise<void> {
    if ((await this.deps.signIn.pendingAuthDeletions.adopt(subject, this.now())) === "busy") throw new IdentityError("provisioning_failed");
  }

  /**
   * Aggregate health of the deletion queue for operators: how many rows are
   * pending, how many were requested over a day ago, how many are in flight.
   * Logs one line with counts (never subjects) when any row is overdue.
   */
  async reportPendingDeletions(): Promise<{ pending: number; overdue: number; inFlight: number }> {
    const stats = await this.deps.signIn.pendingAuthDeletions.stats(this.now(), PENDING_DELETION_OVERDUE_MS);
    if (stats.overdue > 0) {
      (this.deps.log ?? console).warn(`Provider sign-in deletions pending over 24h: ${stats.overdue} (pending ${stats.pending}, in flight ${stats.inFlight})`);
    }
    return stats;
  }

  /**
   * Provider users nobody turned into a MovenRun account: a Google sign-in
   * abandoned before the app reached the API, or a wallet grant made straight
   * against the provider with the public key (a script, not the app). Each
   * one counts toward the provider's free monthly users, so they are removed
   * once both their creation and their last sign-in are older than the grace
   * period. Users mapped to an account, or with a wallet code still waiting,
   * are never touched.
   *
   * Each candidate is read again just before it is deleted, so a person who
   * signed in after the listing keeps their sign-in user. One run deletes at
   * most `maxDeletes`, and a run that starts while another is going joins it
   * instead of listing twice.
   */
  sweepOrphanProviderUsers(opts: { graceMs?: number; perPage?: number; maxPages?: number; maxDeletes?: number } = {}): Promise<number> {
    if (!this.sweeping) {
      this.sweeping = this.sweepOnce(opts).finally(() => {
        this.sweeping = null;
      });
    }
    return this.sweeping;
  }

  private async sweepOnce(opts: { graceMs?: number; perPage?: number; maxPages?: number; maxDeletes?: number }): Promise<number> {
    const graceMs = opts.graceMs ?? ORPHAN_GRACE_MS;
    const perPage = opts.perPage ?? 100;
    const maxPages = opts.maxPages ?? 20;
    const maxDeletes = opts.maxDeletes ?? ORPHAN_SWEEP_MAX_DELETES;
    const stale = (u: ProviderUserSummary, cutoff: number) =>
      u.createdAt.getTime() <= cutoff && (!u.lastSignInAt || u.lastSignInAt.getTime() <= cutoff);
    const listedAt = this.now();
    const candidates: string[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const users = await this.deps.auth.listUsers(page, perPage);
      for (const u of users) {
        if (!stale(u, listedAt.getTime() - graceMs)) continue;
        if (await this.deps.signIn.walletHandoffs.inUse(u.id, listedAt)) continue;
        candidates.push(u.id);
      }
      if (users.length < perPage) break;
    }
    let removed = 0;
    for (const subject of candidates) {
      if (removed >= maxDeletes) break;
      const now = this.now();
      const current = await this.deps.auth.getUser(subject);
      if (!current || !stale(current, now.getTime() - graceMs)) continue;
      if (await this.deps.signIn.walletHandoffs.inUse(subject, now)) continue;
      // Under the lease the user is read once more; any sign-in within the
      // grace period keeps it.
      if ((await this.deleteProviderUser(subject, { signedInAfter: new Date(now.getTime() - graceMs) })) === "removed") removed += 1;
    }
    return removed;
  }

  /**
   * Retry provider deletions that failed earlier. Safe to run repeatedly and
   * concurrently: each row is claimed before it is worked. Rows never tried
   * come first and each failure doubles the wait (up to a day), so rows the
   * provider keeps refusing cannot hold the batch.
   */
  async retryPendingDeletions(limit = 50): Promise<number> {
    const due = await this.deps.signIn.pendingAuthDeletions.due(this.now(), PENDING_DELETION_RETRY_MS, limit);
    let removed = 0;
    for (const subject of due) {
      if ((await this.deleteProviderUser(subject, { retryAfterMs: PENDING_DELETION_RETRY_MS })) === "removed") removed += 1;
    }
    return removed;
  }
}
