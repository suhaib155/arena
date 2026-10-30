/**
 * Express router for the identity/wallet surface.
 *
 * Cross-cutting properties:
 *  - deny by default: every route except the two unauthenticated auth-entry
 *    endpoints and readiness requires a valid bearer access token
 *    (SessionService.verifyAccess);
 *  - fail closed: provider-dependent flows return `provider_not_configured`
 *    when no provider is wired — never a fake success;
 *  - stable errors: an IdentityError becomes its mapped status + public JSON;
 *    anything else bubbles to the app's generic 500 handler so no internal
 *    detail leaks as a "helpful" 4xx;
 *  - no secret material in responses (see publicViews.ts).
 *
 * Every handler runs through `handle()`, which awaits it and routes any
 * rejection — so nothing is ever swallowed, and internal errors never leak.
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import { IdentityError, isIdentityError } from "../domain/errors.js";
import type { SessionRecord } from "../repositories/records.js";
import type { IdentityServices } from "./wiring.js";
import {
  emailOtpBeginSchema,
  emailOtpCompleteSchema,
  googleCompleteSchema,
  walletBeginSchema,
  walletCompleteSchema,
  walletExchangeSchema,
  linkBeginSchema,
  linkCompleteSchema,
  parseBody,
  PUBLIC_SESSION_ID_RE,
  refreshSchema,
  walletIdSchema,
} from "./validation.js";
import { sanitizeDeviceLabel } from "../domain/deviceLabel.js";
import { ACCOUNT_DELETION_CONFIRMATION, ErasureBusyError, type AccountDeletionStore, type DeletionRequestOutcome } from "../accountDeletion.js";
import { PKCE_CHALLENGE_RE, SUPABASE_PROVIDER, type SupabaseSignInService, type VerifiedSignIn } from "../services/supabaseSignIn.service.js";
import type { SignupOrLoginResult } from "../services/authOrchestrator.service.js";
import {
  toPublicIdentity,
  toPublicSession,
  toPublicUser,
  toPublicWallet,
} from "./publicViews.js";

/** Retry-After for a deletion that could not start (seconds). */
const DELETION_RETRY_AFTER_SECONDS = 5;

/**
 * Route wrapper: an IdentityError becomes its mapped status + public JSON;
 * anything else forwards to Express's error middleware (the app's generic 500
 * handler), so no internal detail ever leaks as a "helpful" 4xx.
 */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch((err: unknown) => {
      if (isIdentityError(err)) {
        res.status(err.status).json(err.toPublicJSON());
      } else {
        next(err instanceof Error ? err : new Error(String(err)));
      }
    });
  };
}

export interface IdentityRouterOptions {
  /** Account erasure. Absent → the delete route fails closed. */
  accountDeletion?: AccountDeletionStore | null;
  /** Google and wallet sign-in through Supabase Auth. Absent → those routes fail closed. */
  supabaseSignIn?: SupabaseSignInService | null;
  /** Email one-time codes. Off unless a delivery provider is configured; off in Play v1. */
  emailOtpEnabled?: boolean;
}

/** The session payload every successful sign-in returns. */
function signInResponse(result: SignupOrLoginResult) {
  return {
    user: toPublicUser(result.user),
    session: {
      ...toPublicSession(result.session.session),
      accessToken: result.session.accessToken,
      accessTokenExpiresAt: result.session.accessTokenExpiresAt.toISOString(),
      refreshToken: result.session.refreshToken,
      refreshTokenExpiresAt: result.session.refreshTokenExpiresAt.toISOString(),
    },
    embeddedWallet: result.embeddedWallet ? toPublicWallet(result.embeddedWallet) : null,
  };
}

export function createIdentityRouter(services: IdentityServices, options: IdentityRouterOptions = {}): Router {
  const router = Router();
  // Responses here carry session tokens and one-time codes: never stored by a
  // browser or an intermediary cache (RFC 6749 §5.1).
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    next();
  });

  // Bearer-auth guard. Reads `Authorization: Bearer <accessToken>` and returns
  // the verified session. Deny-by-default: any failure is a 401 IdentityError.
  const authenticate = async (req: Request): Promise<SessionRecord> => {
    const header = req.header("authorization") ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !token) throw new IdentityError("unauthenticated");
    return services.sessions.verifyAccess(token);
  };

  /** `handle` + bearer authentication for the protected routes. */
  const authed = (fn: (req: Request, res: Response, session: SessionRecord) => Promise<void>) =>
    handle(async (req, res) => fn(req, res, await authenticate(req)));

  // ---- readiness (separate from liveness /health in index.ts) -------------
  // Fails closed (503) when the backing store is unreachable — readiness never
  // claims health it cannot verify. Disabled features are reported as
  // "disabled", never as operational. No secret appears in the response.
  router.get(
    "/ready",
    handle(async (_req, res) => {
      try {
        await services.readiness();
      } catch {
        res.status(503).json({ status: "unavailable" });
        return;
      }
      res.json({
        status: "ready",
        providers: {
          embeddedWalletEnabled: services.config.embeddedWalletEnabled,
          google: services.config.googleStatus,
          authProvider: services.featureSummary.providerStatus,
          webhooks: services.featureSummary.webhooksEnabled ? "enabled" : "disabled",
        },
      });
    })
  );

  // ---- unauthenticated auth entry ----------------------------------------
  // Supabase sign-in (Google, wallet) → one MovenRun account per Supabase user.
  const signInWithSupabase = async (verified: VerifiedSignIn, rawDeviceLabel: string | undefined) => {
    try {
      return await services.orchestrator.signupOrLogin({
        providerIdentity: {
          provider: SUPABASE_PROVIDER,
          providerSubject: verified.subject,
          normalizedEmail: verified.email,
          emailVerified: verified.email !== null,
          assuranceLevel: "aal2",
        },
        deviceLabel: sanitizeDeviceLabel(rawDeviceLabel),
        userAgentHash: undefined,
        // A Google sign-in is spent only here, after the account is admitted, so
        // a refusal or an outage before this point can be retried with the same token.
        beforeSession: verified.googleSession ? () => options.supabaseSignIn!.claimGoogleExchange(verified) : undefined,
      });
    } catch (err) {
      // Refused at the account cap or the hourly quota: the provider user it just created must not
      // linger, so it is removed (or queued for removal) before answering.
      if (isIdentityError(err) && (err.code === "registration_closed" || err.code === "registration_busy")) {
        // The refusal is final for this provider user, so its Google sign-in is
        // spent too: a retry with the same token must not bind an account to a
        // provider user that is being removed. A new sign-in starts afresh.
        if (verified.googleSession) await options.supabaseSignIn?.claimGoogleExchange(verified).catch(() => undefined);
        await options.supabaseSignIn?.removeProviderUsers([verified.subject]);
      }
      throw err;
    }
  };

  router.post(
    "/auth/google/complete",
    handle(async (req, res) => {
      if (!options.supabaseSignIn) throw new IdentityError("provider_not_configured");
      const body = parseBody(googleCompleteSchema, req.body);
      const verified = await options.supabaseSignIn.verifyGoogle(body.accessToken);
      res.json(signInResponse(await signInWithSupabase(verified, body.deviceLabel)));
    })
  );

  router.post(
    "/auth/wallet/begin",
    handle(async (req, res) => {
      if (!options.supabaseSignIn) throw new IdentityError("provider_not_configured");
      const body = parseBody(walletBeginSchema, req.body);
      const challenge = await options.supabaseSignIn.beginWallet(body.address);
      res.json({ message: challenge.message, expiresAt: challenge.expiresAt.toISOString() });
    })
  );

  router.post(
    "/auth/wallet/complete",
    handle(async (req, res) => {
      if (!options.supabaseSignIn) throw new IdentityError("provider_not_configured");
      const body = parseBody(walletCompleteSchema, req.body);
      // Checked before the message is spent, so a malformed request costs nothing.
      if (body.handoffChallenge !== undefined && !PKCE_CHALLENGE_RE.test(body.handoffChallenge)) {
        throw new IdentityError("invalid_request", "invalid code challenge");
      }
      const verified = await options.supabaseSignIn.completeWallet(body.message, body.signature);
      if (body.handoffChallenge !== undefined) {
        // Signed in the wallet's browser on behalf of the app: no session here,
        // only a code the app can spend with its verifier.
        const handoff = await options.supabaseSignIn.createHandoff(verified, body.handoffChallenge);
        res.json({ handoff: { code: handoff.code, expiresAt: handoff.expiresAt.toISOString() } });
        return;
      }
      res.json(signInResponse(await signInWithSupabase(verified, body.deviceLabel)));
    })
  );

  router.post(
    "/auth/wallet/exchange",
    handle(async (req, res) => {
      if (!options.supabaseSignIn) throw new IdentityError("provider_not_configured");
      const body = parseBody(walletExchangeSchema, req.body);
      const verified = await options.supabaseSignIn.exchangeHandoff(body.code, body.codeVerifier);
      res.json(signInResponse(await signInWithSupabase(verified, body.deviceLabel)));
    })
  );

  if (options.emailOtpEnabled) router.post(
    "/auth/email/begin",
    handle(async (req, res) => {
      const body = parseBody(emailOtpBeginSchema, req.body);
      const result = await services.emailOtp.begin({ email: body.email });
      res.status(202).json(result); // 202: uniform whether or not the email exists
    })
  );

  if (options.emailOtpEnabled) router.post(
    "/auth/email/complete",
    handle(async (req, res) => {
      const body = parseBody(emailOtpCompleteSchema, req.body);
      const verified = await services.emailOtp.complete({ email: body.email, code: body.code });
      const result = await services.orchestrator.signupOrLogin({
        providerIdentity: {
          provider: verified.provider,
          providerSubject: verified.providerSubject,
          normalizedEmail: verified.normalizedEmail,
          emailVerified: true,
          assuranceLevel: "aal2",
        },
        // Cosmetic only — sanitized (malformed → null → generic fallback in
        // the public view), never trusted for authorization, never logged.
        deviceLabel: sanitizeDeviceLabel(body.deviceLabel),
        userAgentHash: undefined,
      });
      res.json(signInResponse(result));
    })
  );

  // Base Account entry points exist in the contract but ship no wired provider
  // → fail closed rather than fake a login.
  for (const path of ["/auth/base/begin", "/auth/base/complete"]) {
    router.post(
      path,
      handle(async () => {
        throw new IdentityError("provider_not_configured");
      })
    );
  }

  router.post(
    "/auth/refresh",
    handle(async (req, res) => {
      const body = parseBody(refreshSchema, req.body);
      const issued = await services.sessions.refresh(body.refreshToken);
      res.json({
        session: {
          ...toPublicSession(issued.session),
          accessToken: issued.accessToken,
          accessTokenExpiresAt: issued.accessTokenExpiresAt.toISOString(),
          refreshToken: issued.refreshToken,
          refreshTokenExpiresAt: issued.refreshTokenExpiresAt.toISOString(),
        },
      });
    })
  );

  // ---- authenticated: session / identity ----------------------------------
  router.get(
    "/me",
    authed(async (_req, res, session) => {
      const user = await services.identity.getUser(session.userId);
      if (!user) throw new IdentityError("not_found");
      const identities = await services.identity.listIdentities(session.userId);
      res.json({
        user: toPublicUser(user),
        session: toPublicSession(session),
        identities: identities.map(toPublicIdentity),
      });
    })
  );

  router.get(
    "/identities",
    authed(async (_req, res, session) => {
      const identities = await services.identity.listIdentities(session.userId);
      res.json({ identities: identities.map(toPublicIdentity) });
    })
  );

  // ---- session/device management (PR #53) ---------------------------------

  // Session inventory: caller-owned sessions only, privacy-preserving summary
  // fields only (see PublicSessionSummary), current-first deterministic order,
  // bounded count + fixed retention for settled sessions.
  router.get(
    "/sessions",
    authed(async (_req, res, session) => {
      const sessions = await services.sessions.listSessions(session);
      res.json({ sessions });
    })
  );

  // Revoke ONE other session. Current session is refused (409); foreign and
  // nonexistent ids are indistinguishable (404); already-settled caller-owned
  // ids are idempotent success.
  router.post(
    "/sessions/:id/revoke",
    authed(async (req, res, session) => {
      const targetId = req.params.id;
      if (typeof targetId !== "string" || !PUBLIC_SESSION_ID_RE.test(targetId)) {
        throw new IdentityError("invalid_request");
      }
      await services.sessions.revokeOtherSession(session, targetId);
      res.json({ revoked: true });
    })
  );

  // Revoke every other session, preserving the caller's credentials.
  router.post(
    "/session/revoke-others",
    authed(async (_req, res, session) => {
      const count = await services.sessions.revokeOtherSessions(session);
      res.json({ revoked: count });
    })
  );

  router.post(
    "/session/revoke",
    authed(async (_req, res, session) => {
      await services.sessions.revoke(session.id, "user_logout");
      res.json({ revoked: true });
    })
  );

  router.post(
    "/session/revoke-all",
    authed(async (_req, res, session) => {
      const count = await services.sessions.revokeAll(session.userId, "revoke_all");
      res.json({ revoked: count });
    })
  );

  // ---- authenticated: account deletion ------------------------------------
  // Erases the signed-in account and everything held for it. The body must
  // carry the literal confirmation so a stray request cannot delete an
  // account. The response carries counts only; nothing about the account.
  //  - 200 { deleted: true, status: "completed" }: erased during the request.
  //  - 202 { deleted: false, status: "pending", requestId }: accepted and
  //    durably queued (gameplay on). The account is already signed out
  //    everywhere and cannot sign in; the erasure finishes in the background
  //    and GET /account/deletion/:requestId says when. Never reported as
  //    deleted before it is.
  //  - 503 deletion_busy + Retry-After: nothing was changed or scheduled.
  router.post(
    "/account/delete",
    authed(async (req, res, session) => {
      const confirm = (req.body as { confirm?: unknown } | undefined)?.confirm;
      if (confirm !== ACCOUNT_DELETION_CONFIRMATION) throw new IdentityError("invalid_request", "confirmation required");
      if (!options.accountDeletion) throw new IdentityError("provider_not_configured", "account deletion is not available");
      const store = options.accountDeletion;
      let outcome: DeletionRequestOutcome;
      try {
        outcome = store.request
          ? await store.request(session.userId)
          : { status: "completed", result: await store.erase(session.userId) };
      } catch (err) {
        if (err instanceof ErasureBusyError) {
          res.setHeader("Retry-After", String(DELETION_RETRY_AFTER_SECONDS));
          throw new IdentityError("deletion_busy");
        }
        throw err;
      }
      if (outcome.status === "pending") {
        res.status(202).json({ deleted: false, status: "pending", requestId: outcome.requestId, signedOut: true, signInRecord: "pending" });
        return;
      }
      const { providerSubjects, ...erased } = outcome.result;
      // The sign-in record at Supabase goes right after the MovenRun data; if the
      // provider is unreachable it stays queued and is retried until removed.
      let signInRecord: "removed" | "pending" | "none" = "none";
      if (providerSubjects.length) {
        const removal = options.supabaseSignIn
          ? await options.supabaseSignIn.removeProviderUsers(providerSubjects)
          : { removed: [], pending: providerSubjects };
        signInRecord = removal.pending.length ? "pending" : "removed";
      }
      res.json({ deleted: true, status: "completed", erased, signInRecord });
    })
  );

  // Status of a queued deletion, by the opaque id the request returned. No
  // sign-in needed (the account is signed out by then); it says only whether
  // that request finished, never whose it was. Unknown ids are 404.
  router.get("/account/deletion/:requestId", async (req, res) => {
    try {
      const status = options.accountDeletion?.status ? await options.accountDeletion.status(String(req.params.requestId)) : null;
      if (!status) {
        res.status(404).json(new IdentityError("not_found").toPublicJSON());
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.json({ deleted: status.status === "completed", ...status });
    } catch {
      res.status(503).json(new IdentityError("deletion_busy").toPublicJSON());
    }
  });

  // ---- authenticated: wallets --------------------------------------------
  router.get(
    "/wallets",
    authed(async (_req, res, session) => {
      const wallets = await services.walletLink.listWallets(session.userId);
      res.json({ wallets: wallets.map(toPublicWallet) });
    })
  );

  router.get(
    "/wallets/provisioning/:id",
    authed(async (req, res, session) => {
      const wallet = await services.provisioning.status(req.params.id);
      if (!wallet || wallet.userId !== session.userId) throw new IdentityError("not_found");
      res.json({ wallet: toPublicWallet(wallet) });
    })
  );

  router.post(
    "/wallets/provisioning/:id/retry",
    authed(async (req, res, session) => {
      const existing = await services.provisioning.status(req.params.id);
      if (!existing || existing.userId !== session.userId) throw new IdentityError("not_found");
      const wallet = await services.provisioning.retry(req.params.id);
      res.json({ wallet: toPublicWallet(wallet) });
    })
  );

  router.post(
    "/wallets/link/begin",
    authed(async (req, res, session) => {
      const body = parseBody(linkBeginSchema, req.body);
      const { challenge, message } = await services.walletLink.beginChallenge({
        session,
        action: body.action,
        address: body.address,
        chainId: body.chainId,
        walletType: body.walletType,
      });
      res.json({ nonce: challenge.nonce, message, expiresAt: challenge.expiresAt.toISOString() });
    })
  );

  router.post(
    "/wallets/link/complete",
    authed(async (req, res, session) => {
      const body = parseBody(linkCompleteSchema, req.body);
      const wallet = await services.walletLink.completeLink({
        session,
        nonce: body.nonce,
        address: body.address,
        signature: body.signature,
        walletType: body.walletType,
        sourceProvider: body.sourceProvider,
        expect: {
          domain: services.config.authDomain ?? "",
          uri: services.config.authDomain ? `https://${services.config.authDomain}` : "",
          chainId: body.chainId,
          action: body.action,
        },
      });
      res.json({ wallet: toPublicWallet(wallet) });
    })
  );

  router.post(
    "/wallets/active",
    authed(async (req, res, session) => {
      const body = parseBody(walletIdSchema, req.body);
      const wallet = await services.walletLink.setActiveWallet(session, body.walletId);
      res.json({ wallet: toPublicWallet(wallet) });
    })
  );

  router.post(
    "/wallets/revoke",
    authed(async (req, res, session) => {
      const body = parseBody(walletIdSchema, req.body);
      const wallet = await services.walletLink.revokeWallet(session, body.walletId);
      res.json({ wallet: toPublicWallet(wallet) });
    })
  );

  // Wallet export authorization: recent-auth gated, provider-isolated, and it
  // NEVER returns secret material. No provider is wired in this PR, so it fails
  // closed after enforcing step-up — proving the gate, exposing no secret.
  router.post(
    "/wallets/export/begin",
    authed(async (_req, res, session) => {
      services.sessions.assertRecentAuth(session);
      await services.audit.record("wallet_export_initiated", { userId: session.userId });
      throw new IdentityError("provider_not_configured", "secure export is handled by the provider surface (not yet wired)");
    })
  );

  return router;
}
