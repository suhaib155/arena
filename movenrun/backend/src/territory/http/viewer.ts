/**
 * Viewer resolution for the territory API (D2).
 *
 * ## The defect this replaces
 * The map endpoint used to read the caller's wallet from the `x-movenrun-address`
 * request header when no signature had been verified, and the mobile client
 * never sent it at all. So `viewer.walletAddress` was always null, every owned
 * cell came back labelled `rival`, and a runner's own territory rendered in
 * rival colours.
 *
 * ## What replaces it
 * Identity comes from the **already-verified session** and nothing else:
 * `Authorization: Bearer <accessToken>` → `sessions.verifyAccess` →
 * `wallets.listWallets(userId)`. There is deliberately no code path here that
 * reads an identity claim from a header, a query parameter or a body field, so
 * there is nothing for a client to spoof. `assertNoIdentityHeaderTrust` is a
 * source-level guard against that regressing.
 *
 * ## Unauthenticated callers
 * The public map endpoints stay public — they return the same cells, the same
 * scores and the same geometry to everyone. What changes is the *label*: an
 * anonymous caller gets `claimed` for held ground rather than `rival`, because
 * `rival` asserts "this belongs to someone other than you", which is not
 * knowable without an identity. See `relationshipFor` in rules.ts.
 *
 * A token that is missing, malformed, expired or revoked is treated exactly
 * like no token at all: the caller is anonymous. The endpoint never 401s on a
 * bad token, because it is a *public* endpoint whose data does not depend on
 * identity — failing the request would turn an expired session into a blank map
 * rather than a correctly-labelled anonymous one.
 */
import type { Request } from "express";
import { ANONYMOUS_VIEWER, type TerritoryViewer } from "../rules.js";

/** The identity services this needs, narrowed to the two calls it makes. */
export interface ViewerIdentityServices {
  /** Verifies a bearer access token. Must throw or reject on any failure. */
  verifyAccessToken(token: string): Promise<{ userId: string } | null>;
  /** Every wallet address linked to the user. Lowercasing happens here. */
  listWalletAddresses(userId: string): Promise<string[]>;
  /** The user's club, when clubs are wired up. Optional. */
  findClubId?(userId: string): Promise<string | null>;
}

/** Extract a bearer token, or null when the header is absent/malformed. */
export function readBearerToken(req: Request): string | null {
  const header = req.header("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer") return null;
  return token && token.length > 0 ? token : null;
}

/**
 * Build a viewer from the request's session.
 *
 * Never throws: any failure to establish identity degrades to anonymous, which
 * is a safe, well-defined answer for a public endpoint.
 */
export function createSessionViewerResolver(
  services: ViewerIdentityServices,
): (req: Request) => Promise<TerritoryViewer> {
  return async function resolveViewer(req: Request): Promise<TerritoryViewer> {
    const token = readBearerToken(req);
    if (!token) return ANONYMOUS_VIEWER;

    try {
      const session = await services.verifyAccessToken(token);
      // A null session is an expired/revoked/unknown token. Anonymous, not an
      // error — see the module header.
      if (!session?.userId) return ANONYMOUS_VIEWER;

      const [addresses, clubId] = await Promise.all([
        services.listWalletAddresses(session.userId),
        services.findClubId?.(session.userId) ?? Promise.resolve(null),
      ]);

      return {
        userId: session.userId,
        walletAddresses: addresses.map((a) => a.toLowerCase()),
        clubId,
        authenticated: true,
      };
    } catch {
      // Verification threw (expired, revoked, malformed, store unavailable).
      // Degrade to anonymous rather than failing a public read.
      return ANONYMOUS_VIEWER;
    }
  };
}

/**
 * Source-level guard, exported for the test that enforces it: this module must
 * never read an identity claim from anywhere a client controls other than the
 * bearer token itself.
 *
 * Kept as data rather than a comment so `viewer.test.ts` can assert it, and so
 * a future edit that reintroduces a header-derived identity fails a test rather
 * than passing review unnoticed.
 */
export const FORBIDDEN_IDENTITY_SOURCES = [
  "x-movenrun-address",
  "x-movenrun-signature",
  "x-forwarded-user",
  "x-user-id",
  "req.query.wallet",
  "req.query.walletAddress",
  "req.query.userId",
  "req.query.clubId",
  "req.body",
] as const;
