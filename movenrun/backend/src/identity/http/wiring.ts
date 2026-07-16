/**
 * Composition root for the identity/wallet services.
 *
 * `createIdentityServices` wires the service graph over any IdentityStores
 * bundle (in-memory for tests, Drizzle for production) plus an optional set of
 * external provider adapters. This PR ships NO concrete vendor adapters, so the
 * production wiring passes none — provider-dependent flows then fail closed
 * (`provider_not_configured`) rather than faking success.
 *
 * The EOA verifier is always wired (it is pure, offline crypto); the
 * smart-account verifier defaults to the fail-closed adapter until a real
 * ERC-1271/6492 verifier (which needs an RPC provider) is introduced.
 */
import type { IdentityStores } from "../repositories/interfaces.js";
import type { ResolvedIdentityConfig } from "../config.js";
import { AuditService } from "../services/audit.service.js";
import { SessionService } from "../services/session.service.js";
import { IdentityService } from "../services/identity.service.js";
import { WalletProvisioningService } from "../services/walletProvisioning.service.js";
import { WalletLinkService, type WalletChangePolicy } from "../services/walletLink.service.js";
import { EmailOtpService } from "../services/emailOtp.service.js";
import { AuthOrchestrator } from "../services/authOrchestrator.service.js";
import { EoaSignatureVerifier, NotConfiguredSmartAccountVerifier } from "../providers/eoaVerifier.js";
import type {
  EmailOtpDeliveryProvider,
  EmbeddedWalletProvider,
  SmartAccountSignatureVerifier,
} from "../providers/types.js";

export interface IdentityProviders {
  embeddedWallet?: EmbeddedWalletProvider | null;
  emailDelivery?: EmailOtpDeliveryProvider | null;
  smartAccountVerifier?: SmartAccountSignatureVerifier | null;
  walletChangePolicy?: WalletChangePolicy;
}

export interface IdentityServices {
  audit: AuditService;
  sessions: SessionService;
  identity: IdentityService;
  provisioning: WalletProvisioningService;
  walletLink: WalletLinkService;
  emailOtp: EmailOtpService;
  orchestrator: AuthOrchestrator;
  config: ResolvedIdentityConfig;
}

export function createIdentityServices(
  stores: IdentityStores,
  config: ResolvedIdentityConfig,
  providers: IdentityProviders = {}
): IdentityServices {
  const audit = new AuditService(stores.audit);
  const sessions = new SessionService({
    sessions: stores.sessions,
    users: stores.users,
    audit,
    config: {
      sessionPepper: config.sessionPepper,
      accessTokenTtlSeconds: config.accessTokenTtlSeconds,
      refreshTokenTtlSeconds: config.refreshTokenTtlSeconds,
      recentAuthWindowSeconds: config.recentAuthWindowSeconds,
    },
  });
  const identity = new IdentityService({ stores, audit, sessions });
  const provisioning = new WalletProvisioningService({
    stores,
    audit,
    provider: providers.embeddedWallet ?? null,
  });
  const walletLink = new WalletLinkService({
    stores,
    audit,
    sessions,
    eoaVerifier: new EoaSignatureVerifier(),
    smartAccountVerifier: providers.smartAccountVerifier ?? new NotConfiguredSmartAccountVerifier(),
    config: {
      authDomain: config.authDomain,
      uri: config.authDomain ? `https://${config.authDomain}` : null,
      allowedChainIds: config.allowedChainIds,
      challengeTtlSeconds: config.challengeTtlSeconds,
    },
    policy: providers.walletChangePolicy,
  });
  const emailOtp = new EmailOtpService({
    otpChallenges: stores.otpChallenges,
    audit,
    config: {
      otpPepper: config.otpPepper,
      otpTtlSeconds: config.otpTtlSeconds,
      otpMaxAttempts: config.otpMaxAttempts,
      otpResendCooldownSeconds: config.otpResendCooldownSeconds,
    },
    delivery: providers.emailDelivery ?? null,
  });
  const orchestrator = new AuthOrchestrator({
    identity,
    sessions,
    provisioning,
    config: {
      embeddedWalletEnabled: config.embeddedWalletEnabled,
      provisionSynchronously: config.embeddedWalletEnabled && Boolean(providers.embeddedWallet),
    },
  });

  return { audit, sessions, identity, provisioning, walletLink, emailOtp, orchestrator, config };
}
