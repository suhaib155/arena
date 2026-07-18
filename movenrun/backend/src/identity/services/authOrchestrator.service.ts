/**
 * Composes a full authentication outcome from the focused services: resolve or
 * create the canonical user (IdentityService), issue a durable session
 * (SessionService), and — on first-time signup — record an embedded-wallet
 * provisioning request and (when a provider is enabled and wired) provision the
 * user-controlled wallet as the default active wallet (WalletProvisioningService).
 *
 * This is the single place the "a successful first-time signup creates: user,
 * identity, session, provisioning request, and (when enabled) a provisioned
 * default wallet" requirement is realized. Every step is idempotent, so a
 * repeated/replayed provider callback produces the same user, the same wallet,
 * and no duplicates.
 */
import { IdentityService, type ProviderIdentityInput } from "./identity.service.js";
import type { SessionService, IssuedSession } from "./session.service.js";
import type { WalletProvisioningService } from "./walletProvisioning.service.js";
import type { UserRecord, AuthIdentityRecord, WalletRecord } from "../repositories/records.js";

/** Fixed source-provider label for the auto-provisioned embedded wallet, so
 *  the "one embedded wallet per user" uniqueness key is stable. */
export const EMBEDDED_WALLET_SOURCE = "embedded";

export interface AuthOrchestratorConfig {
  embeddedWalletEnabled: boolean;
  /** When true and a provider is wired, provision synchronously during signup;
   *  otherwise the wallet stays in `requested` for a worker/retry to complete. */
  provisionSynchronously?: boolean;
}

interface Deps {
  identity: IdentityService;
  sessions: SessionService;
  provisioning: WalletProvisioningService;
  config: AuthOrchestratorConfig;
}

export interface SignupOrLoginInput {
  providerIdentity: ProviderIdentityInput;
  deviceLabel?: string | null;
  userAgentHash?: string | null;
}

export interface SignupOrLoginResult {
  user: UserRecord;
  identity: AuthIdentityRecord;
  created: boolean;
  session: IssuedSession;
  embeddedWallet: WalletRecord | null;
}

export class AuthOrchestrator {
  constructor(private readonly deps: Deps) {}

  async signupOrLogin(input: SignupOrLoginInput): Promise<SignupOrLoginResult> {
    const { user, identity, created } = await this.deps.identity.authenticate(input.providerIdentity);

    const session = await this.deps.sessions.issue({
      userId: user.id,
      assuranceLevel: identity.assuranceLevel,
      deviceLabel: input.deviceLabel ?? null,
      userAgentHash: input.userAgentHash ?? null,
    });

    let embeddedWallet: WalletRecord | null = null;
    if (created) {
      // Always record the provisioning intent on first signup (idempotent).
      embeddedWallet = await this.deps.provisioning.request(user.id, EMBEDDED_WALLET_SOURCE);
      if (this.deps.config.embeddedWalletEnabled && this.deps.config.provisionSynchronously) {
        // Only runs when a provider is actually wired; otherwise provision()
        // fails closed and the wallet stays observably in `requested`.
        try {
          embeddedWallet = await this.deps.provisioning.provision(embeddedWallet.id);
        } catch {
          // Provisioning failure must not block sign-in; the wallet state is
          // observable and recoverable via retry. Sign-in still succeeds.
          embeddedWallet = await this.deps.provisioning.status(embeddedWallet.id);
        }
      }
    } else {
      // Returning user: surface their existing embedded wallet if any.
      embeddedWallet = await this.deps.provisioning.getEmbeddedWallet(user.id, EMBEDDED_WALLET_SOURCE);
    }

    return { user, identity, created, session, embeddedWallet };
  }
}
