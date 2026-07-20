/**
 * Session lifecycle: issue, verify access, rotate refresh, detect replay,
 * revoke (single / family / all), and enforce recent-auth for sensitive ops.
 *
 * Token model (no external JWT dependency; all built on node:crypto):
 *  - REFRESH token: `<sessionId>.<secret>`. Only the HMAC of `<secret>` (under
 *    the server pepper) is persisted, and it is UNIQUE. The plaintext is
 *    returned once and never stored — a leaked DB cannot reconstruct it.
 *  - ACCESS token: an opaque, stateless, short-lived HMAC over
 *    `sessionId|expiry|securityVersion`. Verification recomputes the HMAC
 *    (constant-time) and additionally re-checks the live session (active, not
 *    revoked, unexpired) and that its securityVersion still matches the user's
 *    — so a security-version bump or a revoke invalidates outstanding access
 *    tokens immediately, without waiting for expiry.
 *
 * Refresh rotation + reuse detection: each refresh rotates the session
 * (`active` → `rotated`) and mints a fresh session in the SAME family. If a
 * refresh token whose session is already `rotated`/`revoked` is presented
 * again, that is a replay: the WHOLE family is revoked (fail closed) and a
 * `refresh_replay_detected` audit event is written. The authority is the DB,
 * so this holds across process restarts and replicas — no process-local Map.
 */
import {
  keyedHash,
  makeCompositeToken,
  newId,
  randomToken,
  safeEqual,
  splitCompositeToken,
} from "../crypto/secure.js";
import { IdentityError } from "../domain/errors.js";
import type { AssuranceLevel, SessionRevocationReason } from "../domain/types.js";
import type {
  SessionRepository,
  UserRepository,
} from "../repositories/interfaces.js";
import type { SessionRecord } from "../repositories/records.js";
import type { AuditService } from "./audit.service.js";
// publicViews is a pure mapping module (no Express import) — the service uses
// it so there is exactly ONE definition of the public session shape.
import { toPublicSessionSummary, type PublicSessionSummary } from "../http/publicViews.js";
import { createHmac } from "node:crypto";

/** Domain-separation label for the access-token HMAC, keeping its input space
 *  disjoint from refresh-secret hashing under the shared session pepper. */
const ACCESS_TOKEN_CONTEXT = "movenrun.session.access.v1\n";

export interface SessionServiceConfig {
  sessionPepper: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  recentAuthWindowSeconds: number;
}

export interface IssueSessionInput {
  userId: string;
  assuranceLevel: AssuranceLevel;
  deviceLabel?: string | null;
  userAgentHash?: string | null;
  /** Continue an existing rotation lineage (used by refresh). */
  familyId?: string;
  lastAuthenticatedAt?: Date;
}

export interface IssuedSession {
  session: SessionRecord;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

interface Deps {
  sessions: SessionRepository;
  users: UserRepository;
  audit: AuditService;
  config: SessionServiceConfig;
  now?: () => Date;
  idGen?: () => string;
}

export class SessionService {
  private readonly sessions: SessionRepository;
  private readonly users: UserRepository;
  private readonly audit: AuditService;
  private readonly config: SessionServiceConfig;
  private readonly now: () => Date;
  private readonly idGen: () => string;

  constructor(deps: Deps) {
    this.sessions = deps.sessions;
    this.users = deps.users;
    this.audit = deps.audit;
    this.config = deps.config;
    this.now = deps.now ?? (() => new Date());
    this.idGen = deps.idGen ?? newId;
  }

  private buildAccessToken(sessionId: string, expiresAt: Date, securityVersion: number): string {
    const payload = `${sessionId}.${expiresAt.getTime()}.${securityVersion}`;
    const mac = this.accessTokenMac(payload);
    return `${Buffer.from(payload).toString("base64url")}.${mac}`;
  }

  /**
   * MAC for access tokens. The shared session pepper is used for two distinct
   * purposes (access-token signing and refresh-secret hashing), so each is
   * domain-separated by a fixed context label prepended to the HMAC input.
   * That makes the two input spaces provably disjoint — a refresh hash can
   * never coincide with a valid access-token MAC — without introducing a
   * second secret or bespoke crypto.
   */
  private accessTokenMac(payload: string): string {
    return createHmac("sha256", this.config.sessionPepper)
      .update(ACCESS_TOKEN_CONTEXT)
      .update(payload)
      .digest("base64url");
  }

  /** Issue a brand-new session (login/signup) or continue a family (refresh). */
  async issue(input: IssueSessionInput): Promise<IssuedSession> {
    const user = await this.users.findById(input.userId);
    if (!user || user.status !== "active") throw new IdentityError("unauthenticated");

    const now = this.now();
    const sessionId = this.idGen();
    const familyId = input.familyId ?? this.idGen();
    const refreshSecret = randomToken(32);
    const refreshTokenHash = keyedHash(refreshSecret, this.config.sessionPepper);
    const refreshTokenExpiresAt = new Date(now.getTime() + this.config.refreshTokenTtlSeconds * 1000);
    const lastAuthenticatedAt = input.lastAuthenticatedAt ?? now;

    const session = await this.sessions.create({
      id: sessionId,
      userId: user.id,
      familyId,
      assuranceLevel: input.assuranceLevel,
      refreshTokenHash,
      securityVersion: user.securityVersion,
      expiresAt: refreshTokenExpiresAt,
      lastAuthenticatedAt,
      deviceLabel: input.deviceLabel ?? null,
      userAgentHash: input.userAgentHash ?? null,
    });

    const accessTokenExpiresAt = new Date(now.getTime() + this.config.accessTokenTtlSeconds * 1000);
    const accessToken = this.buildAccessToken(sessionId, accessTokenExpiresAt, user.securityVersion);
    const refreshToken = makeCompositeToken(sessionId, refreshSecret);

    await this.audit.record("session_issued", { userId: user.id, subjectId: sessionId });
    return { session, accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt };
  }

  /** Verify a bearer access token. Returns the live session or throws. */
  async verifyAccess(accessToken: string): Promise<SessionRecord> {
    const dot = accessToken.lastIndexOf(".");
    if (dot <= 0) throw new IdentityError("session_invalid");
    const payloadB64 = accessToken.slice(0, dot);
    const mac = accessToken.slice(dot + 1);
    let payload: string;
    try {
      payload = Buffer.from(payloadB64, "base64url").toString("utf8");
    } catch {
      throw new IdentityError("session_invalid");
    }
    const [sessionId, expiryStr, versionStr] = payload.split(".");
    if (!sessionId || !expiryStr || !versionStr) throw new IdentityError("session_invalid");

    const expectedMac = this.accessTokenMac(payload);
    if (!safeEqual(mac, expectedMac)) throw new IdentityError("session_invalid");

    const expiresAt = Number(expiryStr);
    if (!Number.isFinite(expiresAt) || this.now().getTime() > expiresAt) {
      throw new IdentityError("session_expired");
    }

    const session = await this.sessions.findById(sessionId);
    if (!session || session.status !== "active" || session.revokedAt !== null) {
      throw new IdentityError("session_invalid");
    }
    if (session.expiresAt.getTime() <= this.now().getTime()) throw new IdentityError("session_expired");

    const user = await this.users.findById(session.userId);
    if (!user || user.status !== "active") throw new IdentityError("session_invalid");
    // Security-version binding: a bump invalidates every outstanding token.
    if (Number(versionStr) !== user.securityVersion || session.securityVersion !== user.securityVersion) {
      throw new IdentityError("session_invalid");
    }

    await this.sessions.markUsed(sessionId, this.now());
    return session;
  }

  /**
   * Rotate a refresh token. On success returns fresh access+refresh tokens for
   * a new session in the same family. On replay (already-rotated/revoked
   * session) revokes the whole family and throws `refresh_reuse_detected`.
   */
  async refresh(refreshToken: string): Promise<IssuedSession> {
    const parts = splitCompositeToken(refreshToken);
    if (!parts) throw new IdentityError("session_invalid");
    const refreshTokenHash = keyedHash(parts.secret, this.config.sessionPepper);
    const session = await this.sessions.findByRefreshHash(refreshTokenHash);
    // The id half must match the row found by hash — cheap integrity check.
    if (!session || session.id !== parts.id) throw new IdentityError("session_invalid");

    const now = this.now();

    // Replay: a refresh credential whose session is no longer active means the
    // token was already rotated (or the family was revoked). Contain the blast
    // radius by revoking the entire family.
    if (session.status !== "active" || session.revokedAt !== null) {
      await this.sessions.revokeFamily(session.familyId, "refresh_replay", now);
      await this.audit.record("refresh_replay_detected", {
        userId: session.userId,
        subjectId: session.familyId,
      });
      throw new IdentityError("refresh_reuse_detected");
    }

    if (session.expiresAt.getTime() <= now.getTime()) {
      throw new IdentityError("session_expired");
    }

    const user = await this.users.findById(session.userId);
    if (!user || user.status !== "active" || session.securityVersion !== user.securityVersion) {
      throw new IdentityError("session_invalid");
    }

    // Rotate via an atomic compare-and-set. If it returns null, another
    // concurrent refresh with the same token already rotated this session
    // between our status read above and here — that is a reuse race, so we
    // fail closed exactly like an explicit replay: revoke the whole family.
    const rotated = await this.sessions.markRotated(session.id, now);
    if (!rotated) {
      await this.sessions.revokeFamily(session.familyId, "refresh_replay", now);
      await this.audit.record("refresh_replay_detected", { userId: session.userId, subjectId: session.familyId });
      throw new IdentityError("refresh_reuse_detected");
    }

    // Mint a new session in the same family, carrying forward the assurance
    // level and last-authentication time.
    const issued = await this.issue({
      userId: session.userId,
      assuranceLevel: session.assuranceLevel,
      familyId: session.familyId,
      deviceLabel: session.deviceLabel,
      userAgentHash: session.userAgentHash,
      lastAuthenticatedAt: session.lastAuthenticatedAt,
    });

    // Close the rotate→issue window: a revocation (revoke-others, revoke-all,
    // reuse-triggered family revoke) that landed between our CAS above and the
    // new session's insert was intended to cover this family — the freshly
    // minted session must not outlive it. Fail closed: revoke the family
    // (which now includes the new session) and reject this refresh.
    const oldAfterIssue = await this.sessions.findById(session.id);
    if (!oldAfterIssue || oldAfterIssue.revokedAt !== null) {
      const reason: SessionRevocationReason = oldAfterIssue?.revocationReason ?? "refresh_replay";
      await this.sessions.revokeFamily(session.familyId, reason, this.now());
      await this.audit.record("session_revoked", {
        userId: session.userId,
        subjectId: issued.session.id,
        metadata: { reason, raceGuard: "refresh_vs_revocation" },
      });
      throw new IdentityError("session_invalid");
    }

    await this.audit.record("session_refreshed", {
      userId: session.userId,
      subjectId: issued.session.id,
    });
    return issued;
  }

  async revoke(sessionId: string, reason: SessionRevocationReason = "user_logout"): Promise<void> {
    const session = await this.sessions.revoke(sessionId, reason, this.now());
    if (session) await this.audit.record("session_revoked", { userId: session.userId, subjectId: sessionId, metadata: { reason } });
  }

  /** Revoke every session for a user AND bump securityVersion so outstanding
   *  access tokens die immediately. */
  async revokeAll(userId: string, reason: SessionRevocationReason = "revoke_all"): Promise<number> {
    const n = await this.sessions.revokeAllForUser(userId, reason, this.now());
    await this.users.bumpSecurityVersion(userId);
    await this.audit.record("session_revoked", { userId, metadata: { reason, scope: "all", count: n } });
    return n;
  }

  // ---- session/device management (PR #53) ---------------------------------

  /** Sessions revoked/expired longer ago than this are omitted from the
   *  inventory — a fixed retention window, not unbounded history. */
  static readonly INVENTORY_RETENTION_DAYS = 7;
  /** Hard cap on inventory size (current session always included). */
  static readonly INVENTORY_MAX_SESSIONS = 20;
  /** How many raw rows to pull from the repository before mapping. */
  private static readonly INVENTORY_FETCH_LIMIT = 100;

  /**
   * The caller's session inventory as privacy-preserving public summaries.
   * Ordering: current session first; other ACTIVE sessions by most recent use
   * (falling back to issue time); recently revoked/expired sessions last, by
   * most recent relevant timestamp. Rotated rows (internal refresh-chain
   * links) are never shown. `isCurrent` is derived from the verified bearer's
   * session id — server-authoritative, never client-supplied.
   */
  async listSessions(currentSession: SessionRecord): Promise<PublicSessionSummary[]> {
    const now = this.now();
    const retentionMs = SessionService.INVENTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const rows = await this.sessions.listByUser(currentSession.userId, SessionService.INVENTORY_FETCH_LIMIT);

    const current: SessionRecord[] = [];
    const active: SessionRecord[] = [];
    const settled: SessionRecord[] = [];
    for (const r of rows) {
      if (r.id === currentSession.id) {
        current.push(r);
        continue;
      }
      // Rotated rows are superseded internal lifecycle links, not devices —
      // even when a later sweep also revoked them. Each lineage's terminal
      // (never-rotated) row is the single record shown for that device.
      if (r.rotatedAt !== null) continue;
      if (r.revokedAt !== null) {
        if (now.getTime() - r.revokedAt.getTime() <= retentionMs) settled.push(r);
        continue;
      }
      if (r.expiresAt.getTime() <= now.getTime()) {
        if (now.getTime() - r.expiresAt.getTime() <= retentionMs) settled.push(r);
        continue;
      }
      active.push(r);
    }

    const recency = (r: SessionRecord) => (r.lastUsedAt ?? r.issuedAt).getTime();
    active.sort((a, b) => recency(b) - recency(a) || (a.id < b.id ? -1 : 1));
    const settledAt = (r: SessionRecord) => (r.revokedAt ?? r.expiresAt).getTime();
    settled.sort((a, b) => settledAt(b) - settledAt(a) || (a.id < b.id ? -1 : 1));

    return [...current, ...active, ...settled]
      .slice(0, SessionService.INVENTORY_MAX_SESSIONS)
      .map((r) => toPublicSessionSummary(r, currentSession.id, now));
  }

  /**
   * Revoke ONE other caller-owned session. Refuses the current session
   * (`conflict` — the caller should use /session/revoke for that). Foreign
   * and nonexistent ids both yield `not_found` — indistinguishable by
   * construction (ownership sits inside the repository's conditional UPDATE).
   * Idempotent: an already-settled caller-owned session returns success
   * without a second transition or audit event.
   */
  async revokeOtherSession(currentSession: SessionRecord, targetSessionId: string): Promise<void> {
    if (targetSessionId === currentSession.id) {
      throw new IdentityError("conflict", "use session/revoke for the current session");
    }
    const outcome = await this.sessions.revokeOwned(
      targetSessionId,
      currentSession.userId,
      "user_logout",
      this.now()
    );
    if (outcome === "not_found") throw new IdentityError("not_found");
    if (outcome === "revoked") {
      await this.audit.record("session_revoked", {
        userId: currentSession.userId,
        subjectId: targetSessionId,
        metadata: { reason: "user_logout", scope: "other" },
      });
    }
    // "already_settled" → idempotent success, no duplicate transition/audit.
  }

  /**
   * Revoke every other session of the caller in one atomic repository
   * operation, preserving the current session's access AND refresh
   * credentials (no securityVersion bump — that is what distinguishes this
   * from revokeAll). Idempotent; returns the count revoked by this call.
   */
  async revokeOtherSessions(currentSession: SessionRecord): Promise<number> {
    const n = await this.sessions.revokeAllExcept(
      currentSession.userId,
      currentSession.id,
      "user_logout",
      this.now()
    );
    await this.audit.record("session_revoked", {
      userId: currentSession.userId,
      metadata: { reason: "user_logout", scope: "others", count: n },
    });
    return n;
  }

  /** Throws `recent_auth_required` if the session's last authentication is
   *  older than the configured window. Used to gate sensitive changes. */
  assertRecentAuth(session: SessionRecord, now: Date = this.now()): void {
    const ageSeconds = (now.getTime() - session.lastAuthenticatedAt.getTime()) / 1000;
    if (ageSeconds > this.config.recentAuthWindowSeconds) {
      throw new IdentityError("recent_auth_required");
    }
  }
}
