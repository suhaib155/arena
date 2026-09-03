/**
 * The `@movenrun/shared` public surface.
 *
 * This file did not exist. `package.json` named `./dist/index.js` as the entry
 * and `./dist/index.d.ts` as the types, `build` ran a bare `tsc` with no
 * `tsconfig.json` — which prints its own help text and exits 2 — and there was
 * no `src/index.ts` for it to have compiled. So nothing could import the bare
 * `@movenrun/shared` specifier and resolve: backend reached past the exports
 * map into `../shared/src/*` through a tsconfig path alias, its `tsconfig.json`
 * excluded every file that used the bare specifier, and mobile did not depend
 * on the package at all.
 *
 * That was survivable while the two apps shared only constants neither of them
 * actually agreed on. It is not survivable for the world grid, where having one
 * definition is the entire point — so the entry points now name real files.
 * See `docs/H3_GEOGRAPHY.md`.
 *
 * ## Two entry points, deliberately
 *
 * `@movenrun/shared/h3` is the geography alone. `@movenrun/shared` is
 * everything, including the zone-economy thresholds, the emission schedule and
 * the deployed contract addresses. Mobile imports the first: a phone has no
 * business carrying a token supply schedule in its bundle, and the narrower
 * import is what keeps that true without anyone having to remember it.
 */

/* Geography. The canonical H3 world, shared by mobile and backend. Also
   available on its own at `@movenrun/shared/h3`, which is how the app imports
   it. */
export * from "./domain/h3";

/* Sessions. What a movement session is: identity, mode, rules version,
   lifecycle timestamps and pauses. Also available on its own at
   `@movenrun/shared/session`. Kept a separate subpath from `/h3` rather than
   merged: a consumer that needs geography does not need the session model, and
   an importer should not drag in the other to get one. */
export * from "./domain/session";

/* Route geometry. The metric and planar primitives sealing is built on, and
   the only implementation of them: the phone's live preview and the server's
   authority share this module so they cannot drift apart. Also at
   `@movenrun/shared/geo`. */
export * from "./domain/geo";

/* Sealing. When a route closes and which slice of it closed — evidence for the
   territory work that will consume it, and never territory itself. Also at
   `@movenrun/shared/sealing`. */
export * from "./domain/sealing";

/* Zone-economy thresholds. `H3_RESOLUTION` lives in the same file but is
   deliberately not re-exported here — the domain module above already exports
   it, and two star exports of one name would silently drop it from this
   barrel rather than conflict. */
export {
  DORMANCY_DAYS,
  HEX_AREA_KM2,
  MIN_ACTIVITY_DAYS,
  MIN_ACTIVITY_THRESHOLD,
  RECLAIM_DAYS,
} from "./constants/h3";

export * from "./constants/contracts";
export * from "./constants/emission";

/* Types. Chain- and route-shaped records used by the backend services. */
export * from "./types/gps";
export * from "./types/token";
export * from "./types/zone";
