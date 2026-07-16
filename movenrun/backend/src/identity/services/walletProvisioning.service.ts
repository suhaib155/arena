/**
 * Idempotent embedded-wallet provisioning (ADR-0004).
 *
 * Two phases, each idempotent:
 *   request()   — records a provisioning intent as a single wallet row in
 *                 state `requested`. Repeated/concurrent calls converge on the
 *                 SAME row (the wallets_embedded_per_user_provider_unique
 *                 constraint is the backstop), so a webhook replay, retry, or
 *                 concurrent signup never creates a second default wallet.
 *   provision() — drives the provider call and moves the row
 *                 requested → provisioning → active (or failed_*). Safe to call
 *                 more than once: an already-`active` row short-circuits, and a
 *                 provider replay (same idempotency key → same address) leaves
 *                 the row unchanged. The wallet becomes the user's active
 *                 wallet exactly once (only when they have none).
 *
 * The provider returns ONLY a public address and an opaque reference — never
 * secret material — so nothing secret is ever persisted (ADR-0008).
 */
import { newId } from "../crypto/secure.js";
import { canonicalizeAddress } from "../domain/address.js";
import { IdentityError } from "../domain/errors.js";
import type { IdentityStores } from "../repositories/interfaces.js";
import type { WalletRecord } from "../repositories/records.js";
import {
  EmbeddedWalletTerminalError,
  EmbeddedWalletTransientError,
  type EmbeddedWalletProvider,
} from "../providers/types.js";
import type { AuditService } from "./audit.service.js";

interface Deps {
  stores: IdentityStores;
  audit: AuditService;
  /** Absent in this PR (no vendor wired) → provision() fails closed. */
  provider?: EmbeddedWalletProvider | null;
  now?: () => Date;
  idGen?: () => string;
}

export class WalletProvisioningService {
  private readonly stores: IdentityStores;
  private readonly audit: AuditService;
  private readonly provider: EmbeddedWalletProvider | null;
  private readonly now: () => Date;
  private readonly idGen: () => string;

  constructor(deps: Deps) {
    this.stores = deps.stores;
    this.audit = deps.audit;
    this.provider = deps.provider ?? null;
    this.now = deps.now ?? (() => new Date());
    this.idGen = deps.idGen ?? newId;
  }

  /** Record (idempotently) the intent to provision an embedded wallet. */
  async request(userId: string, sourceProvider: string): Promise<WalletRecord> {
    const existing = await this.stores.wallets.findEmbeddedByUserProvider(userId, sourceProvider);
    if (existing) return existing;

    try {
      const wallet = await this.stores.wallets.create({
        id: this.idGen(),
        userId,
        walletType: "embedded_eoa",
        sourceProvider,
        isEmbedded: true,
        isActive: false,
        ownershipStatus: "unverified",
        provisioningState: "requested",
      });
      await this.audit.record("wallet_provisioning_requested", { userId, subjectId: wallet.id, metadata: { sourceProvider } });
      return wallet;
    } catch {
      // Lost the race to a concurrent request — return the row that won.
      const winner = await this.stores.wallets.findEmbeddedByUserProvider(userId, sourceProvider);
      if (winner) return winner;
      throw new IdentityError("conflict", "wallet provisioning could not be recorded");
    }
  }

  /**
   * Drive the provider call for a previously-requested wallet. Idempotent:
   * an already-active wallet is returned unchanged; a provider replay yields
   * the same address and leaves state at `active`.
   */
  async provision(walletId: string): Promise<WalletRecord> {
    if (!this.provider) throw new IdentityError("provider_not_configured");
    const wallet = await this.stores.wallets.findById(walletId);
    if (!wallet || !wallet.isEmbedded) throw new IdentityError("not_found");
    if (wallet.provisioningState === "active") return wallet;
    if (wallet.provisioningState === "failed_terminal") {
      throw new IdentityError("provisioning_not_retryable");
    }

    await this.stores.wallets.update(walletId, { provisioningState: "provisioning" });

    try {
      const result = await this.provider.provision({ userId: wallet.userId, idempotencyKey: walletId });
      const canon = canonicalizeAddress(result.addressCanonical);
      if (!canon) throw new EmbeddedWalletTerminalError("provider returned an invalid address");

      // Another user must not already VERIFIED-own this address.
      const conflict = await this.stores.wallets.findVerifiedByAddress(canon.canonical);
      if (conflict && conflict.userId !== wallet.userId) {
        await this.stores.wallets.update(walletId, { provisioningState: "failed_terminal" });
        await this.audit.record("wallet_provisioning_failed", { userId: wallet.userId, subjectId: walletId, metadata: { terminal: true, reason: "address_conflict" } });
        throw new IdentityError("wallet_owned_by_another_user");
      }

      const updated = await this.stores.wallets.update(walletId, {
        addressCanonical: canon.canonical,
        addressChecksum: canon.checksum,
        providerWalletRef: result.providerWalletRef,
        ownershipStatus: "verified",
        verifiedAt: this.now(),
        provisioningState: "active",
      });
      await this.audit.record("wallet_provisioning_completed", { userId: wallet.userId, subjectId: walletId });

      // Default-active exactly once: only if the user has no active wallet yet.
      const active = await this.stores.wallets.findActiveByUser(wallet.userId);
      if (!active) {
        const nowActive = await this.stores.wallets.setActive(wallet.userId, walletId);
        await this.audit.record("active_wallet_changed", { userId: wallet.userId, subjectId: walletId, metadata: { reason: "provisioned_default" } });
        return nowActive ?? updated ?? wallet;
      }
      return updated ?? wallet;
    } catch (err) {
      if (err instanceof IdentityError) throw err;
      const terminal = err instanceof EmbeddedWalletTerminalError;
      const transient = err instanceof EmbeddedWalletTransientError;
      await this.stores.wallets.update(walletId, {
        provisioningState: terminal ? "failed_terminal" : "failed_transient",
      });
      await this.audit.record("wallet_provisioning_failed", { userId: wallet.userId, subjectId: walletId, metadata: { terminal, transient } });
      // Surface a stable, non-attacker-helpful outcome. Transient failures are
      // retryable via retry(); terminal ones are recoverable via support flow.
      throw new IdentityError(terminal ? "provisioning_not_retryable" : "conflict", "wallet provisioning failed");
    }
  }

  /** Retry a transient failure. Terminal failures are not retryable here. */
  async retry(walletId: string): Promise<WalletRecord> {
    const wallet = await this.stores.wallets.findById(walletId);
    if (!wallet || !wallet.isEmbedded) throw new IdentityError("not_found");
    if (wallet.provisioningState === "active") return wallet;
    if (wallet.provisioningState !== "failed_transient" && wallet.provisioningState !== "requested") {
      throw new IdentityError("provisioning_not_retryable");
    }
    return this.provision(walletId);
  }

  status(walletId: string): Promise<WalletRecord | null> {
    return this.stores.wallets.findById(walletId);
  }

  /** The user's embedded wallet for a given source provider, if any. */
  getEmbeddedWallet(userId: string, sourceProvider: string): Promise<WalletRecord | null> {
    return this.stores.wallets.findEmbeddedByUserProvider(userId, sourceProvider);
  }
}
