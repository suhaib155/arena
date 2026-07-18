/**
 * External-wallet linking, active-wallet switching, and revocation (ADR-0007).
 *
 * Challenge lifecycle is fully replay-safe and DB-authoritative:
 *  - a challenge binds user, session, action, domain, URI, chain id, a strong
 *    single-use nonce, an expected address, and a validity window;
 *  - the signed message is REBUILT from the stored challenge at verify time
 *    (never parsed from the client), so a signature is only valid for the exact
 *    action/domain/chain/nonce the server issued;
 *  - consumption is an ATOMIC transition (consumedAt null → now) in the store,
 *    so a replay — even after a process restart or on another replica — is
 *    rejected because the authority is the row, not a process-local Map.
 *
 * Smart-contract wallets are routed to the SmartAccountSignatureVerifier
 * (ERC-1271/6492), never assumed to produce a recoverable EOA signature.
 */
import { newId, randomToken } from "../crypto/secure.js";
import { canonicalizeAddress } from "../domain/address.js";
import { messageFromChallenge } from "../domain/challengeMessage.js";
import { IdentityError } from "../domain/errors.js";
import type { WalletChallengeAction, WalletType } from "../domain/types.js";
import { UniqueConstraintError, type IdentityStores } from "../repositories/interfaces.js";
import type { SessionRecord, WalletChallengeRecord, WalletRecord } from "../repositories/records.js";
import type {
  SmartAccountSignatureVerifier,
  WalletOwnershipVerifier,
} from "../providers/types.js";
import type { AuditService } from "./audit.service.js";
import type { SessionService } from "./session.service.js";

export interface WalletLinkConfig {
  authDomain: string | null;
  uri: string | null;
  allowedChainIds: number[];
  challengeTtlSeconds: number;
}

/** Injected hook: returns true if wallet changes must be blocked right now
 *  (e.g. a sensitive on-chain operation is pending). Defaults to "not blocked".
 *  Kept as a boundary so a future settlement/pending-op subsystem can enforce
 *  it without this service importing that subsystem. */
export type WalletChangePolicy = (userId: string) => Promise<boolean> | boolean;

interface Deps {
  stores: IdentityStores;
  audit: AuditService;
  sessions: SessionService;
  eoaVerifier: WalletOwnershipVerifier;
  smartAccountVerifier: SmartAccountSignatureVerifier;
  config: WalletLinkConfig;
  policy?: WalletChangePolicy;
  now?: () => Date;
  idGen?: () => string;
  nonceGen?: () => string;
}

export interface BeginChallengeInput {
  session: SessionRecord;
  action: WalletChallengeAction;
  address: string;
  chainId: number;
  walletType: WalletType;
}

export interface CompleteLinkInput {
  session: SessionRecord;
  nonce: string;
  address: string;
  signature: string;
  walletType: WalletType;
  sourceProvider: string;
  /** Caller-declared binding the challenge MUST match — a mismatch is rejected
   *  before the signature is even checked. */
  expect: { domain: string; uri: string; chainId: number; action: WalletChallengeAction };
}

export class WalletLinkService {
  private readonly stores: IdentityStores;
  private readonly audit: AuditService;
  private readonly sessions: SessionService;
  private readonly eoaVerifier: WalletOwnershipVerifier;
  private readonly smartAccountVerifier: SmartAccountSignatureVerifier;
  private readonly config: WalletLinkConfig;
  private readonly policy: WalletChangePolicy;
  private readonly now: () => Date;
  private readonly idGen: () => string;
  private readonly nonceGen: () => string;

  constructor(deps: Deps) {
    this.stores = deps.stores;
    this.audit = deps.audit;
    this.sessions = deps.sessions;
    this.eoaVerifier = deps.eoaVerifier;
    this.smartAccountVerifier = deps.smartAccountVerifier;
    this.config = deps.config;
    this.policy = deps.policy ?? (() => false);
    this.now = deps.now ?? (() => new Date());
    this.idGen = deps.idGen ?? newId;
    this.nonceGen = deps.nonceGen ?? (() => randomToken(24));
  }

  /** Issue a challenge and the exact message the wallet must sign. */
  async beginChallenge(input: BeginChallengeInput): Promise<{ challenge: WalletChallengeRecord; message: string }> {
    if (!this.config.authDomain || !this.config.uri) {
      throw new IdentityError("provider_not_configured", "auth domain not configured");
    }
    if (!this.config.allowedChainIds.includes(input.chainId)) {
      throw new IdentityError("invalid_request", "unsupported chain");
    }
    const canon = canonicalizeAddress(input.address);
    if (!canon) throw new IdentityError("invalid_request", "invalid address");

    const now = this.now();
    const challenge = await this.stores.walletChallenges.create({
      id: this.idGen(),
      userId: input.session.userId,
      sessionId: input.session.id,
      action: input.action,
      domain: this.config.authDomain,
      uri: this.config.uri,
      chainId: input.chainId,
      nonce: this.nonceGen(),
      expectedAddress: canon.canonical,
      notBefore: now,
      expiresAt: new Date(now.getTime() + this.config.challengeTtlSeconds * 1000),
    });
    const message = messageFromChallenge(challenge, canon.checksum);
    return { challenge, message };
  }

  /** Verify a signed challenge and link the wallet to the session's user. */
  async completeLink(input: CompleteLinkInput): Promise<WalletRecord> {
    const canon = canonicalizeAddress(input.address);
    if (!canon) throw new IdentityError("invalid_request", "invalid address");

    const challenge = await this.stores.walletChallenges.findByNonce(input.nonce);
    if (!challenge || challenge.userId !== input.session.userId) {
      throw new IdentityError("wallet_challenge_invalid");
    }

    const now = this.now();
    if (now < challenge.notBefore || now.getTime() > challenge.expiresAt.getTime()) {
      throw new IdentityError("challenge_expired");
    }

    // Caller's declared binding must match what the server issued. This makes
    // wrong-domain / wrong-uri / wrong-chain / wrong-action explicit rejects.
    if (
      challenge.domain !== input.expect.domain ||
      challenge.uri !== input.expect.uri ||
      challenge.chainId !== input.expect.chainId ||
      challenge.action !== input.expect.action
    ) {
      throw new IdentityError("wallet_challenge_invalid");
    }
    if (challenge.expectedAddress && challenge.expectedAddress !== canon.canonical) {
      throw new IdentityError("wallet_challenge_invalid");
    }

    // Rebuild the authoritative message and verify with the right verifier.
    const message = messageFromChallenge(challenge, canon.checksum);
    const isContract = input.walletType === "external_smart_account" || input.walletType === "base_smart_account";
    const verifier = isContract ? this.smartAccountVerifier : this.eoaVerifier;
    const result = await verifier.verify({
      message,
      signature: input.signature,
      addressCanonical: canon.canonical,
      chainId: challenge.chainId,
    });
    if (!result.valid) throw new IdentityError("wallet_challenge_invalid");

    // Atomic single-use consume — this is the replay gate.
    const consumed = await this.stores.walletChallenges.consume(input.nonce, now);
    if (!consumed) throw new IdentityError("challenge_consumed");

    // Duplicate-ownership check: a verified wallet for this address may belong
    // only to this user.
    const owner = await this.stores.wallets.findVerifiedByAddress(canon.canonical);
    if (owner) {
      if (owner.userId !== input.session.userId) {
        await this.audit.record("security_policy_denied", { userId: input.session.userId, metadata: { reason: "wallet_owned_by_another_user" } });
        throw new IdentityError("wallet_owned_by_another_user");
      }
      return owner; // idempotent: already linked to this user
    }

    try {
      const wallet = await this.stores.wallets.create({
        id: this.idGen(),
        userId: input.session.userId,
        addressCanonical: canon.canonical,
        addressChecksum: canon.checksum,
        walletType: input.walletType,
        sourceProvider: input.sourceProvider,
        isEmbedded: false,
        isActive: false,
        ownershipStatus: "verified",
        verifiedAt: now,
      });
      await this.audit.record("wallet_linked", { userId: input.session.userId, subjectId: wallet.id, metadata: { walletType: input.walletType } });
      return wallet;
    } catch (err) {
      if (err instanceof UniqueConstraintError) {
        // Concurrent link of the same address won the race.
        const winner = await this.stores.wallets.findVerifiedByAddress(canon.canonical);
        if (winner && winner.userId === input.session.userId) return winner;
        throw new IdentityError("wallet_owned_by_another_user");
      }
      throw err;
    }
  }

  /** Make a verified, non-revoked wallet the user's active wallet. */
  async setActiveWallet(session: SessionRecord, walletId: string): Promise<WalletRecord> {
    await this.assertChangeAllowed(session.userId);
    const wallet = await this.stores.wallets.findById(walletId);
    if (!wallet || wallet.userId !== session.userId || wallet.revokedAt !== null) {
      throw new IdentityError("not_found");
    }
    if (wallet.ownershipStatus !== "verified") {
      throw new IdentityError("wallet_challenge_invalid", "wallet not verified");
    }
    const updated = await this.stores.wallets.setActive(session.userId, walletId);
    await this.audit.record("active_wallet_changed", { userId: session.userId, subjectId: walletId, metadata: { reason: "user_selected" } });
    return updated ?? wallet;
  }

  /**
   * Revoke a wallet (preserving history) and, if it was active, fall back to
   * another verified wallet so the user is never left with no active wallet
   * when one remains available.
   */
  async revokeWallet(session: SessionRecord, walletId: string): Promise<WalletRecord> {
    await this.assertChangeAllowed(session.userId);
    const wallet = await this.stores.wallets.findById(walletId);
    if (!wallet || wallet.userId !== session.userId || wallet.revokedAt !== null) {
      throw new IdentityError("not_found");
    }
    const wasActive = wallet.isActive;
    const revoked = await this.stores.wallets.update(walletId, {
      ownershipStatus: "revoked",
      isActive: false,
      revokedAt: this.now(),
    });
    await this.audit.record("wallet_unlinked", { userId: session.userId, subjectId: walletId });

    if (wasActive) {
      const fallback = (await this.stores.wallets.listByUser(session.userId)).find(
        (w) => w.id !== walletId && w.revokedAt === null && w.ownershipStatus === "verified"
      );
      if (fallback) {
        await this.stores.wallets.setActive(session.userId, fallback.id);
        await this.audit.record("active_wallet_changed", { userId: session.userId, subjectId: fallback.id, metadata: { reason: "fallback_after_revocation" } });
      }
    }
    return revoked ?? wallet;
  }

  private async assertChangeAllowed(userId: string): Promise<void> {
    const blocked = await this.policy(userId);
    if (blocked) {
      await this.audit.record("security_policy_denied", { userId, metadata: { reason: "wallet_change_blocked_pending_operation" } });
      throw new IdentityError("wallet_operation_locked");
    }
  }

  listWallets(userId: string): Promise<WalletRecord[]> {
    return this.stores.wallets.listByUser(userId);
  }
}
