/**
 * Typed client for the movement-verification API (`POST /movement/verify`).
 *
 * The SERVER is authoritative. This client reports observations and decodes a
 * verdict; it never asserts distance, duration, traversed hexes, capture,
 * ownership, XP, Locked MOVE, trust, or a verification status of its own.
 *
 * It is a separate domain client on purpose. It shares the authenticated
 * transport with `identityApi` — one bearer attachment, one single-flight
 * refresh — but knows nothing about identity, sessions or wallets, and
 * `identityApi` knows nothing about movement. Neither knows how refresh works.
 *
 * ## Verified movement is not territory
 *
 * `traversedHexIds` records the H3 cells a route passed through. It is not
 * capture and not ownership: no server-side territory model exists yet (the
 * backend's `hex_activities` / `zones` tables are written by nothing). The
 * field name, this comment, and the absence of any "captured"/"owned" field
 * are all deliberate.
 *
 * ## Logging
 *
 * There is none. Route points and bearer tokens never reach a log line, an
 * error message, or a URL from this module.
 */
import type { SessionMetadata } from "@movenrun/shared/session";
import { isSealMethod, type SealMethod } from "@movenrun/shared/sealing";
import type { AuthedJsonTransport } from "./authedTransport";

/* ── request ──────────────────────────────────────────────────────────────── */

/** One raw device observation. Exactly the fields the server accepts. */
export interface ObservedPoint {
  breakBefore?: boolean;
  lat: number;
  lng: number;
  /** Reported horizontal accuracy in metres. */
  accuracy: number;
  /** Unix ms. */
  timestamp: number;
}

/**
 * What the client may say about a completed session.
 *
 * Note what has no field here and cannot be added by normal typed code:
 * `userId` (the server takes it from the bearer session), `walletAddress`
 * (this path is not the chain protocol), and every authoritative outcome —
 * `distanceMeters`, `durationSeconds`, `traversedHexIds`, `capturedZones`,
 * `xp`, `lockedMove`, `trustScore`, `verified`, `status`.
 *
 * There is no index signature, so this type cannot be widened at a call site.
 * Serialisation additionally *picks* the four known fields rather than
 * spreading the input, so even an `as`-cast or an object arriving from
 * untyped code cannot smuggle an extra key onto the wire.
 */
export interface SubmitMovementRequest {
  /** Stable id minted once per completed session; identical across retries. */
  sessionId: string;
  startTime: number;
  endTime: number;
  points: readonly ObservedPoint[];
  /**
   * Immutable session provenance, when the session has it.
   *
   * Omitted entirely for a session captured before the session model existed —
   * a queued retry from an older build. Absence is the legacy signal; the
   * server stamps such a row legacy rather than assuming a mode and a rules
   * version that were never chosen.
   *
   * Everything here is provenance, not measurement. There is no distance, no
   * duration, no cell list and no reward: the server still computes all of it,
   * and its schema still rejects any field that would claim otherwise.
   */
  session?: SessionMetadata;
}

/**
 * The exact wire payload. Field-by-field, never a spread.
 *
 * Explicit construction is the point: a spread would forward whatever a caller
 * happened to attach to the object, which is exactly how a client-authority
 * field reaches an endpoint that is supposed to refuse one.
 */
function serializeRequest(request: SubmitMovementRequest): {
  sessionId: string;
  startTime: number;
  endTime: number;
  points: { lat: number; lng: number; accuracy: number; timestamp: number; breakBefore?: boolean }[];
  session?: {
    mode: string;
    rulesVersion: number;
    startedAt: number;
    finishedAt: number;
    pauses: { startedAt: number; endedAt: number }[];
  };
} {
  const body = {
    sessionId: request.sessionId,
    startTime: request.startTime,
    endTime: request.endTime,
    points: request.points.map((p) => ({
      lat: p.lat,
      lng: p.lng,
      accuracy: p.accuracy,
      timestamp: p.timestamp,
      ...(p.breakBefore === true ? { breakBefore: true } : {}),
    })),
  };
  if (!request.session) return body;
  const { mode, rulesVersion, startedAt, finishedAt, pauses } = request.session;
  return {
    ...body,
    session: {
      mode,
      rulesVersion,
      startedAt,
      finishedAt,
      pauses: pauses.map((pause) => ({ startedAt: pause.startedAt, endedAt: pause.endedAt })),
    },
  };
}

/* ── response ─────────────────────────────────────────────────────────────── */

export type MovementVerificationStatus = "verified" | "rejected";

export interface MovementVerification {
  sessionId: string;
  status: MovementVerificationStatus;
  /** Server-measured. Null when the session was rejected before measurement. */
  distanceMeters: number | null;
  durationSeconds: number | null;
  /** Where the route went. NOT capture, NOT ownership — see the module header. */
  traversedHexIds: string[];
  /** Non-empty exactly when `status` is "rejected". */
  rejectionReasons: string[];
  verifiedAt: string;
  /** Optional only for older stored/test records; the decoder normalizes absence to null. */
  sealed?: boolean | null;
  sealMethods?: SealMethod[] | null;
  sealCount?: number | null;
}

export interface SubmitMovementResult {
  verification: MovementVerification;
  /**
   * True when the server returned an existing verification (HTTP 200) rather
   * than performing a new one (201) — an idempotent replay. The result is
   * identical either way; this only tells the caller it need not resubmit.
   */
  replayed: boolean;
}

/* ── errors ───────────────────────────────────────────────────────────────── */

/**
 * Transport and protocol failures only.
 *
 * A decoded verdict of `rejected` is NOT one of these: the request succeeded
 * and the server answered. Confusing "the network failed" with "your route
 * was not acceptable" is exactly what this separation prevents.
 */
export type MovementApiErrorKind =
  | "network_unavailable"
  | "timeout"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "server_error"
  | "malformed_response";

export class MovementApiError extends Error {
  readonly kind: MovementApiErrorKind;
  /** HTTP status, or 0 when no server verdict was reached. */
  readonly status: number;
  /** The server's stable code where one was returned. Never a payload echo. */
  readonly code: string;

  constructor(kind: MovementApiErrorKind, status: number, code: string) {
    // Deliberately terse: no URL, no body, no token, no coordinates.
    super(`movement api: ${kind}`);
    this.name = "MovementApiError";
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

/** Map a transport failure onto the movement domain's vocabulary. */
function classify(status: number, code: string): MovementApiErrorKind {
  if (status === 0) return code === "request_timeout" ? "timeout" : "network_unavailable";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 400 || status === 422) return "invalid_request";
  if (status >= 500) return "server_error";
  return "server_error";
}

interface TransportShapedError {
  status: number;
  code: string;
}

function isTransportShaped(err: unknown): err is TransportShapedError {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as { status?: unknown }).status === "number" &&
    typeof (err as { code?: unknown }).code === "string"
  );
}

/* ── runtime decoding ─────────────────────────────────────────────────────── */

/**
 * Decode a server response, failing closed.
 *
 * A TypeScript interface is a compile-time claim about a value the network
 * supplies, which is to say it is not validation at all. Everything below is
 * checked at runtime, and anything unexpected raises `malformed_response`
 * rather than being coerced into a verification the server did not give us.
 *
 * A small explicit decoder rather than a schema library: the mobile workspace
 * has no runtime validator today, and adding one for a single response shape
 * would be a dependency the app does not otherwise need.
 */
function decodeVerification(raw: unknown): MovementVerification {
  const fail: () => never = () => {
    throw new MovementApiError("malformed_response", 200, "malformed_response");
  };

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail();
  const body = raw as Record<string, unknown>;

  const sessionId = body.sessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0) fail();

  const status = body.status;
  if (status !== "verified" && status !== "rejected") fail();

  const nullableNumber = (value: unknown): number | null => {
    if (value === null) return null;
    if (typeof value !== "number" || !Number.isFinite(value)) fail();
    return value as number;
  };
  const distanceMeters = nullableNumber(body.distanceMeters);
  const durationSeconds = nullableNumber(body.durationSeconds);

  const stringArray = (value: unknown): string[] => {
    if (!Array.isArray(value)) fail();
    for (const entry of value as unknown[]) if (typeof entry !== "string") fail();
    return value as string[];
  };
  const traversedHexIds = stringArray(body.traversedHexIds);
  const rejectionReasons = stringArray(body.rejectionReasons);

  const verifiedAt = body.verifiedAt;
  if (typeof verifiedAt !== "string" || Number.isNaN(Date.parse(verifiedAt))) fail();

  /* Protocol invariants, not merely field types. A "verified" result carrying
     rejection reasons — or a "rejected" one reporting a measured distance —
     contradicts the contract, and trusting either half would mean choosing
     which one to believe. Fail closed instead. */
  if (status === "verified" && rejectionReasons.length > 0) fail();
  if (status === "rejected" && distanceMeters !== null) fail();

  const absentSeal = ["sealed", "sealMethods", "sealCount"].every((key) => !(key in body));
  const sealed = absentSeal ? null : body.sealed;
  const sealMethods = absentSeal ? null : body.sealMethods;
  const sealCount = absentSeal ? null : body.sealCount;
  if (sealed === null) {
    if (sealMethods !== null || sealCount !== null) fail();
  } else {
    if (typeof sealed !== "boolean" || !Array.isArray(sealMethods) ||
      !sealMethods.every(isSealMethod) || new Set(sealMethods).size !== sealMethods.length ||
      typeof sealCount !== "number" || !Number.isSafeInteger(sealCount) || sealCount < 0) fail();
    const methods = sealMethods as SealMethod[];
    const count = sealCount as number;
    if (sealed ? methods.length === 0 || count < methods.length : methods.length !== 0 || count !== 0) fail();
  }
  if (status === "rejected" && sealed !== null) fail();

  /* The server must never send an ownership claim on this endpoint: it has no
     territory model to base one on. If one ever appears, that is a protocol
     change this client has not reviewed, and it stops here. */
  for (const forbidden of ["capturedZones", "owned", "ownership", "xp", "lockedMove", "trustScore"]) {
    if (forbidden in body) fail();
  }

  return {
    sessionId: sessionId as string,
    status,
    distanceMeters,
    durationSeconds,
    traversedHexIds,
    rejectionReasons,
    verifiedAt: verifiedAt as string,
    sealed: sealed as boolean | null,
    sealMethods: sealMethods as SealMethod[] | null,
    sealCount: sealCount as number | null,
  };
}

/* ── client ───────────────────────────────────────────────────────────────── */

/** Default request deadline. Long enough for a large route on a poor link,
 *  short enough that a stalled socket does not hang a completion flow. */
export const MOVEMENT_REQUEST_TIMEOUT_MS = 20_000;

export class MovementApiClient {
  private readonly transport: AuthedJsonTransport;
  private readonly timeoutMs: number;

  /**
   * Takes the app's shared transport rather than building one. See
   * `authedTransport.ts`: a second transport would mean a second single-flight
   * slot and a refresh-token replay across domains.
   */
  constructor(transport: AuthedJsonTransport, opts: { timeoutMs?: number } = {}) {
    this.transport = transport;
    this.timeoutMs = opts.timeoutMs ?? MOVEMENT_REQUEST_TIMEOUT_MS;
  }

  /**
   * Submit one completed foreground session for verification.
   *
   * Idempotent server-side on (authenticated user, sessionId): resubmitting
   * the same session returns the original verdict rather than a duplicate or a
   * duplicate-rejection.
   */
  async submit(request: SubmitMovementRequest): Promise<SubmitMovementResult> {
    const { body, status } = await this.send("/movement/verify", {
      method: "POST",
      body: serializeRequest(request),
    });
    return { verification: decodeVerification(body), replayed: status === 200 };
  }

  /**
   * Read back one of the caller's OWN verifications.
   *
   * Owner scoping is the server's: the lookup is keyed by the bearer session's
   * user. There is no user id in this signature or on the wire, so a caller
   * cannot ask about somebody else's session even by guessing an id — the
   * server simply answers 404.
   */
  async get(sessionId: string): Promise<MovementVerification> {
    const { body } = await this.send(`/movement/verify/${encodeURIComponent(sessionId)}`, {
      method: "GET",
    });
    return decodeVerification(body);
  }

  private async send(
    path: string,
    init: { method: string; body?: unknown },
  ): Promise<{ body: unknown; status: number }> {
    /* The transport resolves the JSON body; the status code is carried back
       out-of-band via this hook so `submit` can tell 201 from 200 without the
       transport growing a movement-specific return shape. */
    let status = 0;
    try {
      const body = await this.transport.request<unknown>(path, {
        ...init,
        auth: true,
        timeoutMs: this.timeoutMs,
        onStatus: (code) => {
          status = code;
        },
      });
      return { body, status };
    } catch (err) {
      if (err instanceof MovementApiError) throw err;
      if (isTransportShaped(err)) {
        throw new MovementApiError(classify(err.status, err.code), err.status, err.code);
      }
      // Nothing typed came back. Do not surface the raw error: it could carry
      // a URL or body fragment.
      throw new MovementApiError("network_unavailable", 0, "service_unavailable");
    }
  }
}
