/**
 * Movement verification HTTP surface — bearer-authenticated, user-keyed.
 *
 * This is deliberately NOT `/gps/submit`. That route is the wallet/oracle
 * protocol: wallet-signature auth, keyed by wallet address, and its product is
 * an oracle signature for an on-chain claim. It is untouched by this router
 * and remains the future chain path.
 *
 * This route answers a different question for a different principal: "did the
 * server measure the movement of this authenticated USER's completed session?"
 * It issues no signature, references no chain, and asserts nothing about
 * territory ownership.
 *
 * Trust boundary:
 *  - the user is derived from the bearer session, never from the body;
 *  - the body carries observations only (see validation.ts `.strict()`);
 *  - distance, duration and traversed hexes are all server-computed;
 *  - `confidence` is intentionally NOT returned — it is an anti-cheat signal,
 *    and echoing it back tells a probing client how close it got.
 */
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { IdentityError, isIdentityError } from "../../identity/domain/errors.js";
import { MovementSessionMetadataConflictError } from "../repositories/interfaces.js";
import type { MovementVerificationRecord } from "../repositories/interfaces.js";
import type { MovementVerificationService } from "../services/movementVerification.service.js";
import { parseBody, submitMovementSchema, CLIENT_SESSION_ID_RE } from "./validation.js";

/** Resolves a bearer access token to the owning user. Injected so this router
 *  is testable without the full identity wiring, and so it can never be
 *  accidentally satisfied by anything weaker than a real session check. */
export type VerifyBearer = (accessToken: string) => Promise<{ userId: string }>;

export interface MovementRouterDeps {
  service: MovementVerificationService;
  verifyBearer: VerifyBearer;
  /** Write rate limit, matching what /gps/submit applies. Injected so tests
   *  exercise the handler without a limiter's clock. Verification is bounded
   *  CPU over at most MAX_POINTS, but it is still work a caller can ask for
   *  repeatedly. */
  writeLimiter?: RequestHandler;
}

function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch((err: unknown) => {
      if (isIdentityError(err)) {
        res.status(err.status).json(err.toPublicJSON());
      } else if (err instanceof MovementSessionMetadataConflictError) {
        /* 409, categorically. The session id is already associated with
           different immutable provenance, so this is not a retry of that
           session and asking again cannot help — the same reason the identity
           domain answers 409 rather than 400 for a terminal conflict.
           The message names the category and nothing else: no stored values,
           no submitted values, no timestamps. Echoing either would tell a
           prober what is on file for a session id. */
        res.status(409).json({ error: "session_metadata_conflict" });
      } else {
        next(err instanceof Error ? err : new Error(String(err)));
      }
    });
  };
}

/** The public shape. No internal row id, no confidence, no wallet, no chain
 *  artefact — and `traversedHexIds` is named for what it is: where the user
 *  moved, not what they own. */
function toPublicVerification(record: MovementVerificationRecord) {
  return {
    sessionId: record.clientSessionId,
    status: record.status,
    distanceMeters: record.distanceMeters,
    durationSeconds: record.durationSeconds,
    traversedHexIds: record.traversedHexIds,
    rejectionReasons: record.rejectionReasons,
    /* Sealing, compactly. Whether the route closed, how, and how many times —
       and nothing about where. The intersection, the enclosed polygon and the
       route indices stay on the server for the life of one request; the phone
       still holds its own route while it shows the summary, so it can draw the
       closure it already knows about without being told where it was.

       Null across all three means the engine did not run on this session: it
       predates the engine, carried no provenance, or was rejected. `false` is
       the different statement that it ran and the route stayed open — which is
       an ordinary result and not a failure. */
    sealed: record.sealed,
    sealMethods: record.sealMethods,
    sealCount: record.sealEventCount,
    verifiedAt: record.createdAt.toISOString(),
  };
}

export function createMovementRouter(deps: MovementRouterDeps): Router {
  const router = Router();

  const authenticate = async (req: Request): Promise<{ userId: string }> => {
    const header = req.header("authorization") ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !token) throw new IdentityError("unauthenticated");
    return deps.verifyBearer(token);
  };

  const authed = (fn: (req: Request, res: Response, user: { userId: string }) => Promise<void>) =>
    handle(async (req, res) => fn(req, res, await authenticate(req)));

  /**
   * POST /movement/verify — submit one completed foreground session.
   *
   * Idempotent on (authenticated user, sessionId): 201 the first time, 200 for
   * every repeat, always with the same body. A network retry of a submission
   * that actually succeeded therefore returns the original result instead of
   * being rejected as a duplicate.
   */
  const limit: RequestHandler = deps.writeLimiter ?? ((_req, _res, next) => next());

  router.post(
    "/verify",
    limit,
    authed(async (req, res, user) => {
      const body = parseBody(submitMovementSchema, req.body);
      const { record, created } = await deps.service.submit({
        userId: user.userId,
        clientSessionId: body.sessionId,
        observation: {
          startTime: body.startTime,
          endTime: body.endTime,
          points: body.points,
          session: body.session,
        },
      });
      res.status(created ? 201 : 200).json(toPublicVerification(record));
    })
  );

  /**
   * GET /movement/verify/:sessionId — read back one's OWN result.
   *
   * Owner-scoped by construction: the lookup is keyed by the authenticated
   * user, so a guessed or leaked session id belonging to someone else simply
   * does not resolve. It returns 404 rather than 403 so the endpoint cannot be
   * used to test whether another user's session id exists.
   */
  router.get(
    "/verify/:sessionId",
    authed(async (req, res, user) => {
      const sessionId = req.params.sessionId;
      if (!CLIENT_SESSION_ID_RE.test(sessionId)) throw new IdentityError("invalid_request");
      const record = await deps.service.get(user.userId, sessionId);
      if (!record) throw new IdentityError("not_found");
      res.json(toPublicVerification(record));
    })
  );

  return router;
}
