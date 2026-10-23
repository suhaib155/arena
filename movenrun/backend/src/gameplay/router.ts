/**
 * Gameplay HTTP surface (G3/G4 server preparation). Mounted only when
 * MOVENRUN_GAMEPLAY_ENABLED is "true" (see wiring.ts); otherwise every path
 * here falls through to the API's 404.
 *
 * Every route needs a valid MovenRun session; the user always comes from the
 * bearer token, never from the body or the path. Bodies are `.strict()`: there
 * is no field for a unit, a push, an outcome, a strength or a credit, so the
 * phone cannot claim ground or points. Writes are idempotent:
 *  - apply: keyed by (user, client session id); a repeat returns the stored
 *    result with `replayed: true`;
 *  - create club: keyed by the client-chosen club id; a repeat by its creator
 *    with the same name is a no-op;
 *  - join and leave: repeating either changes nothing.
 * Day settlement has no route: it runs in the API's maintenance loop.
 */
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { isIdentityError, IdentityError } from "../identity/domain/errors.js";
import type { LeaderboardMetric } from "@movenrun/shared/clubsDistricts";
import { GameplayError, type GameplayService } from "./service.js";

export type VerifyBearer = (accessToken: string) => Promise<{ userId: string }>;

export interface GameplayRouterDeps {
  service: GameplayService;
  verifyBearer: VerifyBearer;
  writeLimiter?: RequestHandler;
}

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const METRICS: readonly LeaderboardMetric[] = ["player_credits", "club_credits", "club_district_days"];

const emptyBody = z.object({}).strict();
const createClubBody = z.object({
  clubId: z.string().regex(ID_RE),
  // Letters, digits, spaces and a little punctuation; no markup, no control characters.
  name: z.string().transform((s) => s.trim().replace(/\s+/g, " ")).pipe(z.string().min(3).max(40).regex(/^[\p{L}\p{N} .'&-]+$/u)),
}).strict();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value ?? {});
  if (!result.success) throw new GameplayError(400, "invalid_request");
  return result.data;
}

function dayParam(raw: string | undefined): number {
  if (!raw || !/^\d{1,6}$/.test(raw)) throw new GameplayError(400, "invalid_request");
  return Number(raw);
}

function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch((err: unknown) => {
      if (err instanceof GameplayError) res.status(err.status).json({ error: err.code });
      else if (isIdentityError(err)) res.status(err.status).json(err.toPublicJSON());
      else next(err instanceof Error ? err : new Error(String(err)));
    });
  };
}

export function createGameplayRouter(deps: GameplayRouterDeps): Router {
  const router = Router();
  const limit: RequestHandler = deps.writeLimiter ?? ((_req, _res, next) => next());

  const authenticate = async (req: Request): Promise<{ userId: string }> => {
    const header = req.header("authorization") ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !token) throw new IdentityError("unauthenticated");
    return deps.verifyBearer(token);
  };
  const authed = (fn: (req: Request, res: Response, user: { userId: string }) => Promise<void>) =>
    handle(async (req, res) => fn(req, res, await authenticate(req)));

  /** POST /gameplay/sessions/:sessionId/apply — turn one's own verified session into pushes. */
  router.post("/sessions/:sessionId/apply", limit, authed(async (req, res, user) => {
    const sessionId = req.params.sessionId ?? "";
    if (!ID_RE.test(sessionId)) throw new GameplayError(400, "invalid_request");
    parse(emptyBody, req.body);
    const summary = await deps.service.applySession(user.userId, sessionId);
    res.status(summary.replayed ? 200 : 201).json(summary);
  }));

  /** POST /gameplay/clubs — create a club under a client-chosen id, and join it. */
  router.post("/clubs", limit, authed(async (req, res, user) => {
    const body = parse(createClubBody, req.body);
    const result = await deps.service.createClub(user.userId, body.clubId, body.name);
    res.status(result.created ? 201 : 200).json(result);
  }));

  /** POST /gameplay/clubs/:clubId/join */
  router.post("/clubs/:clubId/join", limit, authed(async (req, res, user) => {
    const clubId = req.params.clubId ?? "";
    if (!ID_RE.test(clubId)) throw new GameplayError(400, "invalid_request");
    parse(emptyBody, req.body);
    res.json(await deps.service.joinClub(user.userId, clubId));
  }));

  /** POST /gameplay/clubs/leave */
  router.post("/clubs/leave", limit, authed(async (req, res, user) => {
    parse(emptyBody, req.body);
    res.json(await deps.service.leaveClub(user.userId));
  }));

  /** GET /gameplay/me/holdings — own ground today, as counts. */
  router.get("/me/holdings", authed(async (_req, res, user) => {
    res.json(await deps.service.myHoldings(user.userId));
  }));

  /** GET /gameplay/me/credits?season=N — own off-chain credit lines. */
  router.get("/me/credits", authed(async (req, res, user) => {
    const season = dayParam(typeof req.query.season === "string" ? req.query.season : undefined);
    if (season < 1) throw new GameplayError(400, "invalid_request");
    res.json(await deps.service.myCredits(user.userId, season));
  }));

  /** GET /gameplay/clubs/:clubId/days/:day — a club's aggregate for a settled day. */
  router.get("/clubs/:clubId/days/:day", authed(async (req, res) => {
    const clubId = req.params.clubId ?? "";
    if (!ID_RE.test(clubId)) throw new GameplayError(400, "invalid_request");
    res.json(await deps.service.clubDay(clubId, dayParam(req.params.day)));
  }));

  /** GET /gameplay/districts/days/:day — district standings for a settled day. */
  router.get("/districts/days/:day", authed(async (req, res) => {
    res.json(await deps.service.districtsDay(dayParam(req.params.day)));
  }));

  /** GET /gameplay/leaderboards/:season?metric=… — a board from settled days only. */
  router.get("/leaderboards/:season", authed(async (req, res, user) => {
    const season = dayParam(req.params.season);
    if (season < 1) throw new GameplayError(400, "invalid_request");
    const metric = req.query.metric === undefined ? deps.service.rules.defaultLeaderboard : req.query.metric;
    if (typeof metric !== "string" || !METRICS.includes(metric as LeaderboardMetric)) throw new GameplayError(400, "invalid_request");
    res.json(await deps.service.leaderboard(user.userId, season, metric as LeaderboardMetric));
  }));

  return router;
}
