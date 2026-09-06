/**
 * The one piece of app configuration that cannot live in `app.json`.
 *
 * `app.json` is committed, and the Android basemap needs a Google Maps API key
 * compiled into the binary. A key in `app.json` is a key in the repository, in
 * every fork of it, and in the history forever. So the key — and *only* the key
 * — is injected here from the environment at config-resolution time.
 *
 * Expo reads `app.json` first and hands it to this function as `config`. What
 * this returns is the app config; everything else about the build is still
 * decided in `app.json`, where it stays reviewable as data.
 *
 * ## The deliberate narrowness of this file
 *
 * A dynamic config can change anything — permissions, plugins, the package
 * name, the target SDK. That would quietly undo the point of
 * `src/lib/__tests__/androidRuntimePolicy.test.ts`, which proves the app's
 * foreground-only location promise *statically, from `app.json`*. If this file
 * could add `ACCESS_BACKGROUND_LOCATION`, that proof would be worth nothing.
 *
 * So this file sets exactly one field, and
 * `src/lib/__tests__/mapConfig.test.ts` asserts that it sets exactly one field,
 * by resolving it against a fixture config and diffing the result. Widen it and
 * that test fails. Anything other than the map key belongs in `app.json`.
 *
 * ## When the variable is not set
 *
 * The config is returned untouched — no `apiKey`, not an empty one. The app
 * then reports a missing map key in words rather than rendering an empty grey
 * field that looks like a map of nowhere. See `src/lib/mapAvailability.ts`.
 *
 * Setup — including how to restrict the key so a leaked copy is useless — is in
 * `movenrun/docs/MAP_PROVIDER.md`.
 */

/** The environment variable holding the Android Google Maps key. */
const ANDROID_MAPS_KEY_ENV = "GOOGLE_MAPS_ANDROID_API_KEY";

/**
 * Inject the Android Google Maps key, and nothing else.
 *
 * Exported separately from the Expo default export so the guard can call it
 * with a fixture instead of reaching into `process.env` and the real config.
 */
function withMapKey(config, apiKey) {
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) return config;
  return {
    ...config,
    android: {
      ...config.android,
      config: {
        ...(config.android && config.android.config),
        googleMaps: {
          ...(config.android && config.android.config && config.android.config.googleMaps),
          apiKey,
        },
      },
    },
  };
}

module.exports = ({ config }) => withMapKey(config, process.env[ANDROID_MAPS_KEY_ENV]);
module.exports.withMapKey = withMapKey;
module.exports.ANDROID_MAPS_KEY_ENV = ANDROID_MAPS_KEY_ENV;
