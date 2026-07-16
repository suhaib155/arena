/**
 * Canonical MovenRun identity resolution + auth-method linking.
 *
 * Core invariant (ADR-0001): the permanent identity is `users.id`. Email
 * addresses, Google identities, and Base Accounts are LINKED methods keyed by
 * (provider, providerSubject) — never by email. Two auth methods that happen
 * to share an email do NOT merge into one user; merging only ever happens
 * through an explicit, authenticated, recently-verified link.
 *
 * Idempotency: `authenticate` resolves an existing (provider, providerSubject)
 * to its user, so repeated or concurrent provider callbacks converge on ONE
 * user and never duplicate. First-time creation is atomic
 * (stores.createUserWithIdentity) so a lost uniqueness race re-resolves to the
 * winner instead of leaving an orphan user.
 */
import { newId } from "../crypto/secure.js";
import { IdentityError } from "../domain/errors.js";
import type { AssuranceLevel, AuthProviderKind } from "../domain/types.js";
import { UniqueConstraintError, type IdentityStores } from "../repositories/interfaces.js";
import type { AuthIdentityRecord, SessionRecord, UserRecord } from "../repositories/records.js";
import type { AuditService } from "./audit.service.js";
import type { SessionService } from "./session.service.js";

export interface ProviderIdentityInput {
  provider: AuthProviderKind;
  /** Provider-stable subject (OIDC sub, canonical Base address, or normalized
   *  email for email_otp). NEVER a raw email for google/base. */
  providerSubject: string;
  normalizedEmail?: string | null;
  emailVerified?: boolean;
  assuranceLevel?: AssuranceLevel;
}

export interface AuthenticateResult {
  user: UserRecord;
  identity: AuthIdentityRecord;
  /** True when this call created the user (first-time signup). */
  created: boolean;
}

interface Deps {
  stores: IdentityStores;
  audit: AuditService;
  sessions: SessionService;
  now?: () => Date;
  idGen?: () => string;
}

export class IdentityService {
  private readonly stores: IdentityStores;
  private readonly audit: AuditService;
  private readonly sessions: SessionService;
  private readonly now: () => Date;
  private readonly idGen: () => string;

  constructor(deps: Deps) {
    this.stores = deps.stores;
    this.audit = deps.audit;
    this.sessions = deps.sessions;
    this.now = deps.now ?? (() => new Date());
    this.idGen = deps.idGen ?? newId;
  }

  /**
   * Resolve (provider, providerSubject) to a MovenRun user, creating the user
   * on first sight. Idempotent and concurrency-safe.
   */
  async authenticate(input: ProviderIdentityInput): Promise<AuthenticateResult> {
    const existing = await this.stores.identities.findActiveByProviderSubject(
      input.provider,
      input.providerSubject
    );
    if (existing) {
      const user = await this.stores.users.findById(existing.userId);
      if (!user) throw new IdentityError("session_invalid"); // integrity: identity without user
      await this.stores.identities.markAuthenticated(existing.id, this.now());
      await this.audit.record("login", { userId: user.id, subjectId: existing.id, metadata: { provider: input.provider } });
      return { user, identity: existing, created: false };
    }

    const assurance = input.assuranceLevel ?? this.defaultAssurance(input.provider);
    try {
      const { user, identity } = await this.stores.createUserWithIdentity({
        userId: this.idGen(),
        identity: {
          id: this.idGen(),
          userId: "", // set inside the atomic op
          provider: input.provider,
          providerSubject: input.providerSubject,
          normalizedEmail: input.normalizedEmail ?? null,
          verificationStatus: input.emailVerified || input.provider !== "email_otp" ? "verified" : "unverified",
          assuranceLevel: assurance,
        },
      });
      await this.stores.identities.markAuthenticated(identity.id, this.now());
      await this.audit.record("signup", { userId: user.id, subjectId: identity.id, metadata: { provider: input.provider } });
      return { user, identity, created: true };
    } catch (err) {
      // Lost the create race — re-resolve to the user that won.
      if (err instanceof UniqueConstraintError) {
        const winner = await this.stores.identities.findActiveByProviderSubject(
          input.provider,
          input.providerSubject
        );
        if (winner) {
          const user = await this.stores.users.findById(winner.userId);
          if (user) {
            await this.audit.record("login", { userId: user.id, subjectId: winner.id, metadata: { provider: input.provider } });
            return { user, identity: winner, created: false };
          }
        }
      }
      throw err;
    }
  }

  private defaultAssurance(provider: AuthProviderKind): AssuranceLevel {
    // Base Account (cryptographic proof of control) and Google (verified OIDC)
    // start at aal2; email OTP at aal2 as well once verified — but the caller
    // may override per real provider policy.
    return provider === "email_otp" ? "aal1" : "aal2";
  }

  /**
   * Link a NEW auth method to the already-authenticated user behind `session`.
   * Rejects if the (provider, subject) is actively owned by another user, and
   * requires recent authentication (step-up). Never merges by email.
   */
  async linkIdentity(session: SessionRecord, input: ProviderIdentityInput): Promise<AuthIdentityRecord> {
    this.sessions.assertRecentAuth(session, this.now());

    const existing = await this.stores.identities.findActiveByProviderSubject(
      input.provider,
      input.providerSubject
    );
    if (existing) {
      if (existing.userId !== session.userId) {
        await this.audit.record("security_policy_denied", {
          userId: session.userId,
          metadata: { reason: "identity_owned_by_another_user", provider: input.provider },
        });
        throw new IdentityError("identity_owned_by_another_user");
      }
      throw new IdentityError("identity_already_linked");
    }

    let identity: AuthIdentityRecord;
    try {
      identity = await this.stores.identities.create({
        id: this.idGen(),
        userId: session.userId,
        provider: input.provider,
        providerSubject: input.providerSubject,
        normalizedEmail: input.normalizedEmail ?? null,
        verificationStatus: input.emailVerified || input.provider !== "email_otp" ? "verified" : "unverified",
        assuranceLevel: input.assuranceLevel ?? this.defaultAssurance(input.provider),
      });
    } catch (err) {
      if (err instanceof UniqueConstraintError) throw new IdentityError("identity_already_linked");
      throw err;
    }
    await this.audit.record("identity_linked", { userId: session.userId, subjectId: identity.id, metadata: { provider: input.provider } });
    await this.audit.record("recovery_method_changed", { userId: session.userId, subjectId: identity.id, metadata: { change: "added", provider: input.provider } });
    return identity;
  }

  /**
   * Unlink an auth method. Refuses to remove the user's FINAL viable login
   * method (that would lock them out with no recovery). Requires recent auth.
   * Removing a login method is a material security event, so all of the user's
   * sessions are revoked afterward.
   */
  async unlinkIdentity(session: SessionRecord, identityId: string): Promise<void> {
    this.sessions.assertRecentAuth(session, this.now());

    const identity = await this.stores.identities.findById(identityId);
    if (!identity || identity.revokedAt !== null || identity.userId !== session.userId) {
      throw new IdentityError("not_found");
    }
    const active = await this.stores.identities.listActiveByUser(session.userId);
    if (active.length <= 1) {
      await this.audit.record("security_policy_denied", {
        userId: session.userId,
        subjectId: identityId,
        metadata: { reason: "final_login_method" },
      });
      throw new IdentityError("final_login_method");
    }

    await this.stores.identities.revoke(identityId, this.now());
    await this.audit.record("identity_unlinked", { userId: session.userId, subjectId: identityId, metadata: { provider: identity.provider } });
    await this.audit.record("recovery_method_changed", { userId: session.userId, subjectId: identityId, metadata: { change: "removed", provider: identity.provider } });
    // Material security event → drop every session (and bump securityVersion).
    await this.sessions.revokeAll(session.userId, "identity_removed");
  }

  listIdentities(userId: string): Promise<AuthIdentityRecord[]> {
    return this.stores.identities.listActiveByUser(userId);
  }

  getUser(userId: string): Promise<UserRecord | null> {
    return this.stores.users.findById(userId);
  }
}
