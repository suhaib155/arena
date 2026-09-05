/**
 * Bounded, account-scoped retry for a movement session that could not be
 * verified at the moment it was saved.
 *
 * Pure: no React, no store, no network, no storage. Everything here is plain
 * data in, plain data out, so every bound below can be proven without a device.
 *
 * ## What this is, and what it deliberately is not
 *
 * A user finishes a run in a car park with no signal, saves it, and the
 * verification request fails. The workout is already theirs — XP awarded,
 * history written, zones touched. The only thing missing is the server's
 * measurement, and this module is what lets that one request be tried again
 * when the phone is back online.
 *
 * It is not a synchronisation engine, not background work, and not permission
 * to upload anything the user did not just deliberately save. In particular it
 * NEVER enumerates existing workout history: a pending item can only be created
 * by a submission that actually ran and actually failed, which is why
 * {@link buildPendingItem} takes observations from a live session rather than a
 * session id to look up.
 *
 * ## Why this is the app's first durable location store
 *
 * Nothing else in the app persists coordinates. `RouteTrustRecord` is explicit
 * that it "deliberately holds no coordinates, polyline, path, or place names",
 * `FinishedSession` lives in memory only, and Task 4's `VerifiedMovementRecord`
 * keeps a traversed-hex *count* rather than the trail. So a retry queue cannot
 * reference an existing durable copy of the route — there is none — and it has
 * to hold the observations itself.
 *
 * That makes every bound in this file a privacy control rather than a
 * housekeeping detail:
 *
 *   - {@link MAX_PENDING_AGE_MS} is how long precise coordinates may exist,
 *   - {@link MAX_ATTEMPTS} is how many times they may leave the device,
 *   - {@link MAX_PENDING_ITEMS} is how many routes may be held at once,
 *   - the owner binding is who may send them,
 *
 * and none of them is advisory: {@link retryEligibility} is the single gate
 * every retry passes through.
 */
import {
  isMovementMode,
  isSupportedRulesVersion,
  isValidSessionMetadata,
  type SessionMetadata,
} from "@movenrun/shared/session";

import { CLIENT_SESSION_ID_RE, type PendingReason, type SessionObservations } from "./movementVerification";

/* ── bounds ───────────────────────────────────────────────────────────────── */

/**
 * Total submission attempts allowed for one session, counting the original.
 *
 * Six, not sixty. Retries only happen on deliberate foreground events (see
 * `retryPendingVerifications`), so an ordinary user gets a handful of
 * opportunities per day and six attempts comfortably spans a multi-day
 * connectivity outage. Beyond that the failure is no longer "temporary
 * connectivity" — it is a broken build, a withdrawn endpoint, or a payload the
 * server will never accept — and continuing to send someone's GPS trace at a
 * wall is neither useful to them nor defensible.
 */
export const MAX_ATTEMPTS = 6;

/**
 * How long unsent route observations may live on the device, measured from the
 * END of the session they describe.
 *
 * Seven days, against the backend's hard ceiling of thirty
 * (`MAX_SESSION_AGE_MS` in the movement domain). Deliberately far below it:
 * the backend limit is a validation rule about what it is willing to measure,
 * not a licence to hoard location data for a month. A week covers the realistic
 * recovery cases — a weekend away, a dead data plan, a holiday abroad — and a
 * route that has not been submitted within a week is not going to be.
 *
 * Anchoring to the session's own end time, rather than to when the item was
 * queued, is what makes expiry unfalsifiable: the end time is an *observation*,
 * written once from the tracker's timestamps. Nothing in the retry path may
 * rewrite it, so no amount of re-queuing can extend the window.
 */
export const MAX_PENDING_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How many sessions may be awaiting verification at once.
 *
 * Three. A user who saves a fourth session while still offline is having a
 * connectivity problem, not a backlog problem, and the answer to that is not to
 * accumulate route traces. On overflow the OLDEST is dropped: it is nearest its
 * retention limit and least likely to still matter to anyone.
 */
export const MAX_PENDING_ITEMS = 3;

/** First automatic retry waits a minute; each subsequent one doubles. */
export const RETRY_BASE_DELAY_MS = 60_000;

/** ...up to six hours, so an app left open all day cannot drum on the endpoint. */
export const RETRY_MAX_DELAY_MS = 6 * 60 * 60 * 1000;

/**
 * Upper bound on points in a persisted item, mirroring the backend's
 * `MAX_POINTS`. A payload larger than the server would ever accept is by
 * definition corrupt, and parsing it would only mean holding more coordinates.
 */
export const MAX_PERSISTED_POINTS = 10_000;

/** Bumped when the persisted shape changes; older versions fail closed. */
export const PENDING_SCHEMA_VERSION = 1;

/* ── the persisted item ───────────────────────────────────────────────────── */

/**
 * One session awaiting a retry.
 *
 * The field list is the whole privacy surface, so it is short on purpose. There
 * is no bearer token, no refresh token, no Authorization header, no email, no
 * wallet, no XP, no Locked MOVE, no trust score, no captured or owned zone and
 * no deed state — none of which a retry needs, and all of which would turn a
 * temporary buffer into a second, worse copy of the user's account.
 *
 * There is likewise no separate `createdAt`: `observations.endTime` already
 * says when this route happened, and adding a bookkeeping timestamp would only
 * create a second, forgeable clock to measure retention against.
 */
export interface PendingVerificationItem {
  /** Fails closed when it does not match {@link PENDING_SCHEMA_VERSION}. */
  schemaVersion: number;
  /**
   * The id minted when the session began — never regenerated here. The
   * backend's idempotency is keyed on (authenticated user, clientSessionId), so
   * a retry that invented a fresh id would be a second verification of the same
   * run, which is precisely what the queue exists to avoid.
   */
  clientSessionId: string;
  /**
   * The account that may retry this. Server-derived (`PublicUser.id`), taken
   * from authenticated session state, never from a route field the user can
   * influence.
   *
   * It is a LOCAL authorisation key and is never sent to `/movement/verify` —
   * the server derives the user from the bearer token and would be wrong to
   * trust a client-supplied id for anything.
   */
  ownerUserId: string;
  /** Exactly the observations the original request carried. */
  observations: SessionObservations;
  /**
   * The provenance stamped when the session started, replayed unchanged on
   * every retry.
   *
   * **Optional, and its absence is the legacy signal.** An item queued by a
   * build that predates the session model has no mode and no rules version,
   * and there is nothing truthful to put here: the mode was never chosen, and
   * the rules version did not exist when the session was captured. Inventing
   * one would claim the session followed rules it could not have followed, and
   * deriving a mode from its pace would be a guess wearing the costume of
   * provenance. Such an item keeps submitting in the legacy shape, and the
   * server records it as legacy.
   *
   * This is why the schema version does NOT move for this field: bumping it
   * would make every queued item fail closed and be dropped, throwing away a
   * user's unsent verification to avoid a nullable field. An older item stays
   * valid and simply lacks metadata.
   */
  session?: SessionMetadata;
  /** Submission attempts made so far, including the original. */
  attempts: number;
  /** Epoch ms of the most recent attempt; drives backoff only. */
  lastAttemptAt: number;
  /** Why the last attempt did not settle. Never a payload, never an id. */
  lastReason: PendingReason;
}

/* ── failure classification ───────────────────────────────────────────────── */

/**
 * What a failed attempt means for whether it is worth trying again.
 *
 * `auth_blocked` is its own answer rather than a flavour of retry: an
 * unauthenticated attempt says nothing about the route, and the item must sit
 * still until authentication is resolved rather than burning through the
 * attempt budget against a signed-out app.
 */
export type RetryDisposition = "retry" | "auth_blocked" | "terminal";

/**
 * Classify a failure.
 *
 * The distinction that matters most here is 4xx from 5xx. A 400/422 means the
 * server looked at the payload and refused it — sending the identical bytes
 * again will produce the identical refusal, forever. A 5xx means the server
 * failed to answer, which is exactly the case retry exists for. Collapsing the
 * two would make the queue re-send a permanently invalid payload until its
 * budget ran out.
 *
 * `malformed_response` is terminal for the same reason from the other side: the
 * server answered with something this client refuses to trust, and repeating
 * the request will not change what it sends back.
 */
export function classifyOutcome(reason: PendingReason): RetryDisposition {
  switch (reason) {
    case "offline":
    case "timeout":
    case "server_error":
      return "retry";
    case "unauthenticated":
      return "auth_blocked";
    case "invalid_request":
    case "not_found":
    case "malformed_response":
      return "terminal";
  }
}

/* ── bounds, applied ──────────────────────────────────────────────────────── */

/** Deterministic exponential backoff, capped. No jitter — nothing to inject,
 *  nothing to flake, and a handful of foreground events cannot stampede. */
export function backoffMs(attempts: number): number {
  if (attempts <= 0) return 0;
  const raw = RETRY_BASE_DELAY_MS * 2 ** (attempts - 1);
  return Math.min(raw, RETRY_MAX_DELAY_MS);
}

/** Earliest epoch ms at which an automatic retry may run. */
export function nextRetryAt(item: PendingVerificationItem): number {
  return item.lastAttemptAt + backoffMs(item.attempts);
}

/** Age is measured from the session, not from the queue. See {@link MAX_PENDING_AGE_MS}. */
export function isExpired(item: PendingVerificationItem, now: number): boolean {
  return now - item.observations.endTime > MAX_PENDING_AGE_MS;
}

export function hasAttemptBudget(item: PendingVerificationItem): boolean {
  return item.attempts < MAX_ATTEMPTS;
}

/* ── the single retry gate ────────────────────────────────────────────────── */

/**
 * Why a pending item may or may not be retried right now.
 *
 * `not_owner` and `signed_out` are refusals to act; `expired` and
 * `budget_exhausted` additionally mean the item is dead and its coordinates
 * should go (see `sweepReason`).
 */
export type RetryVerdict =
  | "ok"
  | "not_owner"
  | "signed_out"
  | "expired"
  | "budget_exhausted"
  | "backoff";

export interface RetryContext {
  now: number;
  /** The account authenticated RIGHT NOW, or null when nobody is. */
  currentUserId: string | null;
  /** True only for an explicit user-initiated retry; skips backoff, nothing else. */
  manual?: boolean;
}

/**
 * The one place a retry is authorised.
 *
 * Order is deliberate and is itself the security property: ownership is
 * decided before age, before budget and before backoff, so there is no
 * arrangement of timestamps, attempt counts or user actions that reaches a
 * submission without the account check having passed first.
 *
 * A manual retry relaxes exactly one thing — the backoff delay. It does not
 * relax ownership, expiry or the attempt budget, because a user pressing a
 * button is evidence of intent, not of authorisation.
 */
export function retryEligibility(
  item: PendingVerificationItem,
  ctx: RetryContext,
): RetryVerdict {
  if (ctx.currentUserId === null) return "signed_out";
  /* The hard boundary. A pending route belongs to the account that made it and
     to no other — a later sign-in never adopts an orphan, however convenient
     that would be for delivery. */
  if (item.ownerUserId !== ctx.currentUserId) return "not_owner";
  if (isExpired(item, ctx.now)) return "expired";
  if (!hasAttemptBudget(item)) return "budget_exhausted";
  if (!ctx.manual && ctx.now < nextRetryAt(item)) return "backoff";
  return "ok";
}

/**
 * Whether a verdict means the item is finished and its observations should be
 * deleted rather than kept waiting.
 *
 * Only the two verdicts that can never become `ok` again. `not_owner` and
 * `signed_out` are deliberately absent: they are the current *viewer's*
 * problem, and letting one account's session delete another's queued data
 * would be its own kind of cross-account reach. Those items leave with the
 * logout discard, or with their own expiry.
 */
export function isDeadVerdict(verdict: RetryVerdict): boolean {
  return verdict === "expired" || verdict === "budget_exhausted";
}

/* ── construction ─────────────────────────────────────────────────────────── */

/**
 * Build a pending item from a submission that actually ran and failed.
 *
 * There is no overload that takes a session id, a history record, or a date
 * range, and that absence is the historical-upload guarantee: the only way to
 * obtain observations is to have just held them in memory.
 */
export function buildPendingItem(input: {
  clientSessionId: string;
  ownerUserId: string;
  observations: SessionObservations;
  /** Absent only for a session that genuinely had no metadata. */
  session?: SessionMetadata;
  reason: PendingReason;
  now: number;
}): PendingVerificationItem {
  return {
    schemaVersion: PENDING_SCHEMA_VERSION,
    clientSessionId: input.clientSessionId,
    ownerUserId: input.ownerUserId,
    observations: input.observations,
    ...(input.session ? { session: input.session } : {}),
    attempts: 1,
    lastAttemptAt: input.now,
    lastReason: input.reason,
  };
}

/** Record another failed attempt. `observations` and `ownerUserId` are carried
 *  through untouched — a retry can never re-anchor its own expiry or owner. */
export function withAttempt(
  item: PendingVerificationItem,
  reason: PendingReason,
  now: number,
): PendingVerificationItem {
  return { ...item, attempts: item.attempts + 1, lastAttemptAt: now, lastReason: reason };
}

/**
 * Insert or replace an item, keeping the queue within {@link MAX_PENDING_ITEMS}.
 *
 * Oldest-out by session end time, so the eviction order is a property of when
 * the runs happened rather than of queue bookkeeping.
 */
export function upsertPending(
  queue: readonly PendingVerificationItem[],
  item: PendingVerificationItem,
): PendingVerificationItem[] {
  const others = queue.filter((q) => q.clientSessionId !== item.clientSessionId || q.ownerUserId !== item.ownerUserId);
  const next = [...others, item];
  if (next.length <= MAX_PENDING_ITEMS) return next;
  return [...next]
    .sort((a, b) => a.observations.endTime - b.observations.endTime)
    .slice(next.length - MAX_PENDING_ITEMS);
}

/* ── parsing: nothing crosses the storage boundary on trust ───────────────── */

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const PENDING_REASONS: readonly string[] = [
  "offline",
  "timeout",
  "unauthenticated",
  "invalid_request",
  "not_found",
  "server_error",
  "malformed_response",
];

function parsePoint(value: unknown): SessionObservations["points"][number] | null {
  if (typeof value !== "object" || value === null) return null;
  const p = value as Record<string, unknown>;
  if (!isFiniteNumber(p.lat) || p.lat < -90 || p.lat > 90) return null;
  if (!isFiniteNumber(p.lng) || p.lng < -180 || p.lng > 180) return null;
  if (!isFiniteNumber(p.accuracy) || p.accuracy < 0) return null;
  if (!isFiniteNumber(p.timestamp) || p.timestamp <= 0) return null;
  if (p.breakBefore !== undefined && typeof p.breakBefore !== "boolean") return null;
  return { lat: p.lat, lng: p.lng, accuracy: p.accuracy, timestamp: p.timestamp,
    ...(p.breakBefore === true ? { breakBefore: true } : {}) };
}

/**
 * Validate one persisted item, or reject it entirely.
 *
 * TypeScript stops at the storage boundary: what comes back from the device is
 * whatever was there, which after a downgrade, a half-finished migration, a
 * developer poking at the store, or plain corruption may be anything at all.
 * So every field is checked, and the answer to any doubt is `null` — the item
 * is never repaired, never partially accepted, and never submitted.
 *
 * A rejected item is dropped by the caller without its contents being logged or
 * surfaced; there is nothing useful in a corrupt GPS trace and every reason not
 * to copy it somewhere new.
 */
export function parsePendingItem(value: unknown): PendingVerificationItem | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  if (raw.schemaVersion !== PENDING_SCHEMA_VERSION) return null;

  if (typeof raw.clientSessionId !== "string") return null;
  // Same shape the backend accepts, so a corrupt id is caught here, not as a 400.
  if (!CLIENT_SESSION_ID_RE.test(raw.clientSessionId)) return null;

  // An item with no owner can never pass the account check, so it is worthless
  // AND it is precise location with nobody accountable for it. Reject.
  if (typeof raw.ownerUserId !== "string" || raw.ownerUserId.length === 0) return null;

  if (!isFiniteNumber(raw.attempts) || raw.attempts < 1 || !Number.isInteger(raw.attempts)) return null;
  if (!isFiniteNumber(raw.lastAttemptAt) || raw.lastAttemptAt <= 0) return null;
  if (typeof raw.lastReason !== "string" || !PENDING_REASONS.includes(raw.lastReason)) return null;

  const obs = raw.observations;
  if (typeof obs !== "object" || obs === null) return null;
  const o = obs as Record<string, unknown>;
  if (!isFiniteNumber(o.startTime) || o.startTime <= 0) return null;
  if (!isFiniteNumber(o.endTime) || o.endTime <= 0) return null;
  if (o.endTime < o.startTime) return null;
  if (!Array.isArray(o.points)) return null;
  // Two is the backend's floor for measuring anything; the ceiling mirrors its own.
  if (o.points.length < 2 || o.points.length > MAX_PERSISTED_POINTS) return null;

  const points: SessionObservations["points"] = [];
  for (const candidate of o.points) {
    const point = parsePoint(candidate);
    if (point === null) return null;
    // The window must contain every point or the server rejects it as
    // structurally inconsistent — catching that here saves a doomed upload.
    if (point.timestamp < o.startTime || point.timestamp > o.endTime) return null;
    points.push(point);
  }

  /* Session metadata, when the item has any.
     Three outcomes, and the middle one is the point:
       absent   → a legacy item. Valid, kept, resubmitted in the legacy shape.
       valid    → replayed exactly as stamped.
       present  → the item is rejected outright, like any other corrupt field.
       but bad    A half-readable provenance is worse than none: it would be
                  submitted as though it were what the session recorded. */
  let session: SessionMetadata | undefined;
  if (raw.session !== undefined) {
    const parsed = parseSessionMetadata(raw.session);
    if (parsed === null) return null;
    session = parsed;
  }

  return {
    schemaVersion: PENDING_SCHEMA_VERSION,
    clientSessionId: raw.clientSessionId,
    ownerUserId: raw.ownerUserId,
    observations: { startTime: o.startTime, endTime: o.endTime, points },
    ...(session ? { session } : {}),
    attempts: raw.attempts,
    lastAttemptAt: raw.lastAttemptAt,
    lastReason: raw.lastReason as PendingReason,
  };
}

/**
 * Validate persisted session metadata, or reject the item.
 *
 * Checked against the same shared rules the server applies, so a queued item
 * that could only ever be refused is dropped here rather than spending an
 * attempt and a GPS upload to find out.
 */
function parseSessionMetadata(value: unknown): SessionMetadata | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (!isMovementMode(raw.mode)) return null;
  if (!isSupportedRulesVersion(raw.rulesVersion)) return null;
  if (!isFiniteNumber(raw.startedAt) || !isFiniteNumber(raw.finishedAt)) return null;
  if (!Array.isArray(raw.pauses)) return null;

  const pauses: SessionMetadata["pauses"] = [];
  for (const candidate of raw.pauses) {
    if (typeof candidate !== "object" || candidate === null) return null;
    const p = candidate as Record<string, unknown>;
    if (!isFiniteNumber(p.startedAt) || !isFiniteNumber(p.endedAt)) return null;
    pauses.push({ startedAt: p.startedAt, endedAt: p.endedAt });
  }

  const metadata: SessionMetadata = {
    mode: raw.mode,
    rulesVersion: raw.rulesVersion,
    startedAt: raw.startedAt,
    finishedAt: raw.finishedAt,
    pauses,
  };
  return isValidSessionMetadata(metadata) ? metadata : null;
}

/** Parse a whole persisted queue. Bad items are dropped individually; a
 *  structurally broken file yields an empty queue rather than a guess. */
export function parseQueue(raw: string | null): PendingVerificationItem[] {
  if (raw === null) return [];
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof decoded !== "object" || decoded === null) return [];
  const envelope = decoded as Record<string, unknown>;
  if (envelope.version !== PENDING_SCHEMA_VERSION) return [];
  if (!Array.isArray(envelope.items)) return [];
  const items: PendingVerificationItem[] = [];
  for (const candidate of envelope.items) {
    const item = parsePendingItem(candidate);
    if (item !== null) items.push(item);
  }
  return items.slice(0, MAX_PENDING_ITEMS);
}

/**
 * Serialise a queue for storage.
 *
 * Every field is PICKED, never spread. A spread would let any property that
 * ever lands on an item in memory — an attached error, a debug field, a header,
 * a token someone thought would be convenient — ride silently into durable
 * storage. Picking makes the persisted key set a closed, reviewable list, and a
 * test asserts that list exactly.
 */
export function serializeQueue(items: readonly PendingVerificationItem[]): string {
  return JSON.stringify({
    version: PENDING_SCHEMA_VERSION,
    items: items.map((i) => ({
      schemaVersion: PENDING_SCHEMA_VERSION,
      clientSessionId: i.clientSessionId,
      ownerUserId: i.ownerUserId,
      observations: {
        startTime: i.observations.startTime,
        endTime: i.observations.endTime,
        points: i.observations.points.map((p) => ({
          lat: p.lat,
          lng: p.lng,
          accuracy: p.accuracy,
          timestamp: p.timestamp,
          ...(p.breakBefore === true ? { breakBefore: true } : {}),
        })),
      },
      /* Written only when the session has it. Omitted — rather than written as
         `null` — so absence stays the single legacy signal on the way back in,
         and a legacy item round-trips as a legacy item. */
      ...(i.session
        ? {
            session: {
              mode: i.session.mode,
              rulesVersion: i.session.rulesVersion,
              startedAt: i.session.startedAt,
              finishedAt: i.session.finishedAt,
              pauses: i.session.pauses.map((pause) => ({
                startedAt: pause.startedAt,
                endedAt: pause.endedAt,
              })),
            },
          }
        : {}),
      attempts: i.attempts,
      lastAttemptAt: i.lastAttemptAt,
      lastReason: i.lastReason,
    })),
  });
}
