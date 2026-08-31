/**
 * Request validation for the movement surface.
 *
 * `.strict()` throughout, so an UNKNOWN field is a hard rejection. That is the
 * structural guarantee behind "the client cannot assert authority": there is
 * no field for distance, duration, hexes, capture, XP, Locked MOVE, trust
 * score, ownership, wallet address or user id, and a body that tries to
 * smuggle one in is refused before any handler runs. Adding such a field later
 * would be a visible, reviewable schema change rather than a silent
 * passthrough.
 */
import { z } from "zod";
import { IdentityError } from "../../identity/domain/errors.js";

/** Bounded charset/length, so a lookup key can never be a control string or
 *  an unbounded blob. Matches identity's PUBLIC_SESSION_ID_RE conventions. */
export const CLIENT_SESSION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Hard cap on points per session — bounds CPU and payload independently of
 *  the app-wide 2mb JSON limit. */
export const MAX_POINTS = 10_000;
export const MIN_POINTS = 2;

const observedPoint = z
  .object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
    accuracy: z.number().finite().min(0).max(10_000),
    timestamp: z.number().int().positive(),
  })
  .strict();

export const submitMovementSchema = z
  .object({
    sessionId: z.string().regex(CLIENT_SESSION_ID_RE),
    startTime: z.number().int().positive(),
    endTime: z.number().int().positive(),
    points: z.array(observedPoint).min(MIN_POINTS).max(MAX_POINTS),
  })
  .strict();

export type SubmitMovementBody = z.infer<typeof submitMovementSchema>;

/** Parse or throw a stable `invalid_request` — never a raw zod error, which
 *  would echo the submitted payload back to the caller. */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new IdentityError("invalid_request", parsed.error.issues[0]?.message ?? "invalid body");
  }
  return parsed.data;
}
