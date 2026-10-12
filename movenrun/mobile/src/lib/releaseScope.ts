/**
 * Google Play v1 release scope — the single switchboard for what ships.
 *
 * Play v1 is the Movement Game: real foreground GPS sessions on a real map,
 * missions and earned XP, honest summaries and sharing, a personal history,
 * and the player's own explored ground shown as a labelled preview. It is not
 * the multiplayer territory economy. Anything that needs other players, a
 * server-authoritative ownership state, a wallet or a token is deferred, and
 * the screens for it are unreachable in a release build rather than left as
 * buttons that suggest a live feature.
 *
 * Deferred features are not deleted. Flip a flag here once the feature is
 * actually live and tested, and every entry point and route guard follows.
 *
 * Kept free of `react-native` imports so it runs under the plain-Node suite.
 */

export type ReleaseFeature =
  /** Seeded club catalogue, club contribution, club territory, crew missions. */
  | "clubs"
  /** City war, rivals, city districts, district mastery, event and sponsor zones. */
  | "competition"
  /** Deed showroom and any ownership preview. */
  | "deeds"
  /** Embedded/linked wallets and the network/contract status screen. */
  | "wallets";

/** What Play v1 ships. `false` means unreachable in the app, not deleted. */
export const RELEASE_FEATURES: Readonly<Record<ReleaseFeature, boolean>> = Object.freeze({
  clubs: false,
  competition: false,
  deeds: false,
  wallets: false,
});

export function isFeatureInRelease(feature: ReleaseFeature): boolean {
  return RELEASE_FEATURES[feature] === true;
}

/**
 * Every route that belongs to a deferred feature, by the pathname Expo Router
 * reports for it. A route listed here is redirected home if it is ever reached
 * (a stale deep link, an old notification, a missed entry point).
 */
export const FEATURE_ROUTES: Readonly<Record<ReleaseFeature, readonly string[]>> = Object.freeze({
  clubs: ["/clubs", "/club-territory", "/crew-missions"],
  competition: [
    "/city-war",
    "/rivals",
    "/city-districts",
    "/district-mastery",
    "/event-zones",
    "/sponsor-zones",
  ],
  deeds: ["/deed-showroom"],
  wallets: ["/account/wallets", "/network/status"],
});

function normalise(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] ?? "";
  const trimmed = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return trimmed.toLowerCase();
}

/** The deferred feature a pathname belongs to, or null when it ships in v1. */
export function deferredFeatureFor(pathname: string): ReleaseFeature | null {
  const path = normalise(pathname);
  for (const feature of Object.keys(FEATURE_ROUTES) as ReleaseFeature[]) {
    if (isFeatureInRelease(feature)) continue;
    if (FEATURE_ROUTES[feature].some((route) => path === route || path.startsWith(`${route}/`))) {
      return feature;
    }
  }
  return null;
}

export function isRouteInRelease(pathname: string): boolean {
  return deferredFeatureFor(pathname) === null;
}
