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
 * Handlers never `await` without a surrounding catch — `wrap()` forwards
 * rejections to Express so there is no swallowed promise rejection.
 */
import { Router, type NextFunction, type Request, type Response } from "express";
import { IdentityError, isIdentityError } from "../domain/errors.js";
import type { SessionRecord } from "../repositories/records.js";
import type { IdentityServices } from "./wiring.js";
import {
  emailOtpBeginSchema,
  emailOtpCompleteSchema,
  linkBeginSchema,
  linkCompleteSchema,
  parseBody,
  refreshSchema,
  walletIdSchema,
} from "./validation.js";
import {
  toPublicIdentity,
  toPublicSession,
  toPublicUser,
  toPublicWallet,
} from "./publicViews.js";

interface AuthedRequest extends Request {
  session?: SessionRecord;
}

function wrap(fn: (req: AuthedRequest, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req as AuthedRequest, res).catch(next);
  };
}

function sendError(res: Response, err: unknown): void {
  if (isIdentityError(err)) {
    res.status(err.status).json(err.toPublicJSON());
    return;
  }
  throw err instanceof Error ? err : new Error(String(err));
}

export function createIdentityRouter(services: IdentityServices): Router {
  const router = Router();

  // Bearer-auth guard. Reads `Authorization: Bearer <accessToken>` and returns
  // the verified session. Deny-by-default: any failure is surfaced as 401.
  const authenticate = async (req: AuthedRequest): Promise<SessionRecord> => {
    const header = req.header("authorization") ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !token) throw new IdentityError("unauthenticated");
    return services.sessions.verifyAccess(token);
  };

  const authed = (fn: (req: AuthedRequest, res: Response, session: SessionRecord) => Promise<void>) =>
    wrap(async (req, res) => {
      let session: SessionRecord;
      try {
        session = await authenticate(req);
      } catch (err) {
        sendError(res, err);
        return;
      }
      try {
        await fn(req, res, session);
      } catch (err) {
        sendError(res, err);
      }
    });

  const guard = (fn: (req: AuthedRequest, res: Response) => Promise<void>) =>
    wrap(async (req, res) => {
      try {
        await fn(req, res);
      } catch (err) {
        sendError(res, err);
      }
    });

  // ---- readiness (separate from liveness /health in index.ts) -------------
  router.get("/ready", (_req, res) => {
    res.json({
      status: "ready",
      providers: {
        embeddedWalletEnabled: services.config.embeddedWalletEnabled,
        google: services.config.googleStatus,
      },
    });
  });

  // ---- unauthenticated auth entry ----------------------------------------
  router.post(
    "/auth/email/begin",
    guard(async (req, res) => {
      const body = parseBody(emailOtpBeginSchema, req.body);
      const result = await services.emailOtp.begin({ email: body.email });
      res.status(202).json(result); // 202: uniform whether or not the email exists
    })
  );

  router.post(
    "/auth/email/complete",
    guard(async (req, res) => {
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
        userAgentHash: undefined,
      });
      res.json({
        user: toPublicUser(result.user),
        session: {
          ...toPublicSession(result.session.session),
          accessToken: result.session.accessToken,
          accessTokenExpiresAt: result.session.accessTokenExpiresAt.toISOString(),
          refreshToken: result.session.refreshToken,
          refreshTokenExpiresAt: result.session.refreshTokenExpiresAt.toISOString(),
        },
        embeddedWallet: result.embeddedWallet ? toPublicWallet(result.embeddedWallet) : null,
      });
    })
  );

  // Google / Base account entry points exist in the contract but ship no wired
  // provider in this PR → fail closed rather than fake a login.
  for (const path of ["/auth/google/begin", "/auth/google/complete", "/auth/base/begin", "/auth/base/complete"]) {
    router.post(
      path,
      guard(async () => {
        throw new IdentityError("provider_not_configured");
      })
    );
  }

  router.post(
    "/auth/refresh",
    guard(async (req, res) => {
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
        walletType: body.walletType as never,
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
        walletType: body.walletType as never,
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
