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
import { MOVEMENT_MODES, SUPPORTED_RULES_VERSIONS } from "@movenrun/shared/session";

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

/** Bound on pauses in one session, so a payload cannot carry an unbounded
 *  list. A hundred pause/resume cycles is already far beyond plausible. */
export const MAX_PAUSES = 100;

const pauseInterval = z
  .object({
    startedAt: z.number().int().positive(),
    endedAt: z.number().int().positive(),
  })
  .strict();

/**
 * Immutable session provenance.
 *
 * `.strict()` like everything else, and note what is NOT here: no distance, no
 * duration, no traversed cells, no capture, no ownership, no seal, no XP, no
 * points, no trust score. The server computes all of those, and a body that
 * offers one is refused before a handler runs — which is what keeps "the phone
 * reports observations" a structural property rather than a convention.
 *
 * `mode` and `rulesVersion` are validated against the shared domain, so an
 * unknown value fails closed here rather than being stored and reinterpreted
 * later. A client cannot pick its own rules.
 */
const sessionMetadataSchema = z
  .object({
    mode: z.enum(MOVEMENT_MODES),
    rulesVersion: z
      .number()
      .int()
      .refine((v) => SUPPORTED_RULES_VERSIONS.includes(v), {
        message: "unsupported session rules version",
      }),
    startedAt: z.number().int().positive(),
    finishedAt: z.number().int().positive(),
    pauses: z.array(pauseInterval).max(MAX_PAUSES),
  })
  .strict();

export const submitMovementSchema = z
  .object({
    sessionId: z.string().regex(CLIENT_SESSION_ID_RE),
    startTime: z.number().int().positive(),
    endTime: z.number().int().positive(),
    points: z.array(observedPoint).min(MIN_POINTS).max(MAX_POINTS),
    /**
     * Optional, for one deliberate reason: a retry queued by a build that
     * predates the session model has no metadata, and there is nothing
     * truthful to invent for it. Absence means legacy, and the server records
     * it as legacy rather than stamping today's mode and rules version onto a
     * session captured under neither.
     *
     * This is bounded compatibility, not a permanent optional field. See
     * `docs/SESSION_MODEL.md` for the removal milestone.
     */
    session: sessionMetadataSchema.optional(),
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
