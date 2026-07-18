/**
 * Test harness — wires the whole identity/wallet service graph over in-memory
 * stores with a controllable clock and deterministic id/nonce/OTP generators.
 * FOR TESTS ONLY (see the import-boundary guard in securityControls.test.ts).
 */
import { createInMemoryStores } from "../repositories/memory.js";
import type { IdentityStores } from "../repositories/interfaces.js";
import { AuditService } from "../services/audit.service.js";
import { SessionService } from "../services/session.service.js";
import { IdentityService } from "../services/identity.service.js";
import { WalletProvisioningService } from "../services/walletProvisioning.service.js";
import { WalletLinkService, type WalletChangePolicy } from "../services/walletLink.service.js";
import { EmailOtpService } from "../services/emailOtp.service.js";
import { AuthOrchestrator } from "../services/authOrchestrator.service.js";
import { EoaSignatureVerifier, NotConfiguredSmartAccountVerifier } from "../providers/eoaVerifier.js";
import { EmailOtpDeliveryDouble, EmbeddedWalletProviderDouble, SmartAccountVerifierDouble } from "./index.js";
import type { EmbeddedWalletProvider, SmartAccountSignatureVerifier } from "../providers/types.js";

export const TEST_DOMAIN = "movenrun.test";
export const TEST_URI = "https://movenrun.test";
export const TEST_CHAIN_ID = 84532;

export interface HarnessOptions {
  embeddedProvider?: EmbeddedWalletProvider | null;
  embeddedWalletEnabled?: boolean;
  provisionSynchronously?: boolean;
  smartAccountVerifier?: SmartAccountSignatureVerifier;
  walletChangePolicy?: WalletChangePolicy;
  otpGen?: () => string;
}

export interface Harness {
  stores: IdentityStores;
  audit: AuditService;
  sessions: SessionService;
  identity: IdentityService;
  provisioning: WalletProvisioningService;
  walletLink: WalletLinkService;
  emailOtp: EmailOtpService;
  orchestrator: AuthOrchestrator;
  delivery: EmailOtpDeliveryDouble;
  embedded: EmbeddedWalletProviderDouble;
  now: () => Date;
  setNow: (d: Date) => void;
  advanceSeconds: (s: number) => void;
  nextId: () => string;
}

export function createHarness(opts: HarnessOptions = {}): Harness {
  let clock = new Date("2026-01-01T00:00:00.000Z");
  const now = () => new Date(clock.getTime());
  const setNow = (d: Date) => {
    clock = d;
  };
  const advanceSeconds = (s: number) => {
    clock = new Date(clock.getTime() + s * 1000);
  };

  const stores = createInMemoryStores(now);

  let idCounter = 0;
  const nextId = () => `id_${(++idCounter).toString().padStart(6, "0")}`;
  let nonceCounter = 0;
  const nonceGen = () => `nonce_${(++nonceCounter).toString().padStart(6, "0")}`;

  const delivery = new EmailOtpDeliveryDouble();
  const embedded = (opts.embeddedProvider as EmbeddedWalletProviderDouble) ?? new EmbeddedWalletProviderDouble();

  const config = {
    sessionPepper: "test-session-pepper-abcdef0123456789",
    accessTokenTtlSeconds: 600,
    refreshTokenTtlSeconds: 60 * 60 * 24 * 30,
    recentAuthWindowSeconds: 300,
    otpPepper: "test-otp-pepper-abcdef0123456789",
    otpTtlSeconds: 300,
    otpMaxAttempts: 5,
    otpResendCooldownSeconds: 30,
    challengeTtlSeconds: 300,
    authDomain: TEST_DOMAIN,
    uri: TEST_URI,
    allowedChainIds: [TEST_CHAIN_ID],
  };

  const audit = new AuditService(stores.audit, nextId);
  const sessions = new SessionService({ sessions: stores.sessions, users: stores.users, audit, config, now, idGen: nextId });
  const identity = new IdentityService({ stores, audit, sessions, now, idGen: nextId });
  const provisioning = new WalletProvisioningService({
    stores,
    audit,
    provider: opts.embeddedProvider === null ? null : embedded,
    now,
    idGen: nextId,
  });
  const walletLink = new WalletLinkService({
    stores,
    audit,
    sessions,
    eoaVerifier: new EoaSignatureVerifier(),
    smartAccountVerifier: opts.smartAccountVerifier ?? new NotConfiguredSmartAccountVerifier(),
    config,
    policy: opts.walletChangePolicy,
    now,
    idGen: nextId,
    nonceGen,
  });
  const emailOtp = new EmailOtpService({
    otpChallenges: stores.otpChallenges,
    audit,
    config,
    delivery,
    now,
    idGen: nextId,
    otpGen: opts.otpGen,
  });
  const orchestrator = new AuthOrchestrator({
    identity,
    sessions,
    provisioning,
    config: {
      embeddedWalletEnabled: opts.embeddedWalletEnabled ?? false,
      provisionSynchronously: opts.provisionSynchronously ?? false,
    },
  });

  return {
    stores,
    audit,
    sessions,
    identity,
    provisioning,
    walletLink,
    emailOtp,
    orchestrator,
    delivery,
    embedded,
    now,
    setNow,
    advanceSeconds,
    nextId,
  };
}
