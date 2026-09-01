/**
 * The app's one authenticated JSON transport.
 *
 * Extracted from `identityApi.ts` so a second domain client (movement
 * verification) can make authenticated calls without either re-implementing
 * refresh or forcing the identity client to grow into a generic god-service.
 *
 * What lives here is exactly the plumbing: base URL, JSON encode/decode, bearer
 * attachment, single-flight refresh, one retry after a successful refresh, and
 * transport-level error normalisation. What does NOT live here is any notion of
 * identity, sessions, wallets, movement, or what a refresh actually *does* —
 * those arrive as injected functions, so neither domain client knows how the
 * other works and neither knows how single-flight is implemented.
 *
 * ## One instance, deliberately
 *
 * The single-flight slot is per-transport. Two transports would mean two slots,
 * and a concurrent 401 in each domain would present the SAME rotating refresh
 * token twice — which the backend treats as a replay and answers by revoking
 * the whole session family. So the app builds one transport and hands it to
 * every domain client; `movementApi.ts` takes one rather than constructing its
 * own, and a test pins that a shared transport still refreshes exactly once
 * when two different domains 401 together.
 *
 * ## Secrecy
 *
 * The access token is read per request and attached only to `Authorization`.
 * It is never placed in a URL, never included in a thrown message, and never
 * logged — this module contains no logging at all. Request bodies (which for
 * movement carry GPS points) are likewise never logged or echoed into errors.
 */
import type { RefreshOutcome } from "../lib/authLifecycle";

/** Every transport failure is reported through this shape. `status` is 0 for
 *  problems that never reached a server verdict (transport, timeout, keystore). */
export interface TransportFailure {
  status: number;
  code: string;
}

/** Builds the domain-specific error a client throws, so each domain keeps its
 *  own error type (`instanceof` checks in stores keep working) while sharing
 *  one transport. */
export type ErrorFactory = (status: number, code: string) => Error;

export interface AuthedTransportOptions {
  baseUrl: string;
  /**
   * The bearer for this request, or `null` when there is genuinely no stored
   * session. May throw the domain error for an unreadable keystore — a store
   * that cannot be READ is not an empty store, and must not become a 401.
   */
  loadAccessToken: () => Promise<string | null>;
  /**
   * One bounded refresh attempt. MUST NOT reject: every failure is a typed
   * outcome, so the shared promise can never leave an unhandled rejection
   * behind for callers that merely awaited it.
   */
  performRefresh: () => Promise<RefreshOutcome>;
  /** Domain error constructor. */
  error: ErrorFactory;
  /**
   * Abort a request after this many ms.
   *
   * Optional, and omitted by the identity client on purpose: the pre-extraction
   * transport had no timeout, and adding one there would be a behaviour change
   * to the auth lifecycle rather than a refactor. New callers opt in.
   */
  timeoutMs?: number;
}

export interface AuthedRequestInit {
  method?: string;
  body?: unknown;
  /** Attach the bearer. */
  auth?: boolean;
  /** Internal: false on the post-refresh retry, bounding recursion at depth 1. */
  retryOn401?: boolean;
  /** Per-call override of {@link AuthedTransportOptions.timeoutMs}. */
  timeoutMs?: number;
  /**
   * Called with the status of the response whose body is returned.
   *
   * Some APIs distinguish outcomes by status alone — the movement endpoint
   * answers 201 for a fresh verification and 200 for an idempotent replay with
   * an identical body. Exposing the code this way keeps that knowledge in the
   * domain client instead of giving the transport a domain-shaped return type.
   * Only invoked for a response that is actually returned to the caller, so a
   * 401 that is refreshed and retried reports the retry's status, not the 401.
   */
  onStatus?: (status: number) => void;
}

export class AuthedJsonTransport {
  private readonly opts: AuthedTransportOptions;

  /**
   * The refresh currently in flight, shared by every caller that needs one.
   *
   * This is a security control, not an optimisation — see the module header.
   */
  private refreshInFlight: Promise<RefreshOutcome> | null = null;

  constructor(opts: AuthedTransportOptions) {
    this.opts = opts;
  }

  get baseUrl(): string {
    return this.opts.baseUrl;
  }

  async request<T>(path: string, init: AuthedRequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (init.auth) {
      const token = await this.opts.loadAccessToken();
      if (!token) throw this.opts.error(401, "unauthenticated");
      headers.authorization = `Bearer ${token}`;
    }

    const res = await this.send(
      this.opts.baseUrl + path,
      {
        method: init.method ?? "GET",
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      },
      init.timeoutMs ?? this.opts.timeoutMs,
    );

    if (res.status === 401 && init.auth && init.retryOn401 !== false) {
      // One transparent refresh attempt, then retry the original call. The
      // attempt is bounded: `retryOn401: false` makes the recursion depth 1,
      // and there is no polling or backoff loop anywhere in this transport.
      // Concurrent 401s all await the SAME refresh (see refreshOnce), so the
      // rotating refresh token is never presented twice.
      const outcome = await this.refreshOnce();
      if (outcome.kind === "refreshed") {
        return this.request<T>(path, { ...init, retryOn401: false });
      }
      // A transient refresh failure must not be reported as "unauthenticated":
      // that would let a network blip look like a revoked session.
      if (outcome.kind === "unavailable") throw this.opts.error(0, outcome.code);
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
      throw this.opts.error(res.status, body?.error?.code ?? "request_failed");
    }
    init.onStatus?.(res.status);
    return (await res.json()) as T;
  }

  /**
   * Single-flight wrapper around the injected refresh.
   *
   * The first caller starts it; every caller that arrives while it is running
   * receives the SAME promise and therefore the same outcome. The slot is
   * cleared once the operation settles — and only if it still holds that
   * operation — so a later, genuinely independent expiry starts a fresh
   * refresh. Nothing here polls, sleeps, or backs off.
   */
  private refreshOnce(): Promise<RefreshOutcome> {
    const existing = this.refreshInFlight;
    if (existing) return existing;

    const operation = this.opts.performRefresh().then(
      (outcome) => {
        if (this.refreshInFlight === operation) this.refreshInFlight = null;
        return outcome;
      },
      (err: unknown) => {
        if (this.refreshInFlight === operation) this.refreshInFlight = null;
        throw err;
      },
    );

    this.refreshInFlight = operation;
    return operation;
  }

  /**
   * Perform one HTTP call, converting a transport failure into a typed
   * `service_unavailable`, and a timeout into `request_timeout`. Raw exception
   * text never escapes this transport, and a network problem is never allowed
   * to masquerade as an auth answer.
   */
  private async send(url: string, init: RequestInit, timeoutMs?: number): Promise<Response> {
    if (timeoutMs === undefined) {
      // Byte-for-byte the pre-extraction path: no AbortController is created,
      // so the identity client's behaviour is unchanged by this refactor.
      try {
        return await fetch(url, init);
      } catch {
        throw this.opts.error(0, "service_unavailable");
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let timedOut = false;
    controller.signal.addEventListener("abort", () => {
      timedOut = true;
    });
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch {
      throw this.opts.error(0, timedOut ? "request_timeout" : "service_unavailable");
    } finally {
      clearTimeout(timer);
    }
  }
}
