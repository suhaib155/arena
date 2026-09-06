/**
 * Whether this build can draw a real basemap, and what to say when it cannot.
 *
 * ## Why this exists at all
 *
 * On Android the basemap is Google Maps, and Google Maps needs an API key
 * compiled into the app. Without one the native view still mounts and still
 * lays out — it simply renders an empty grey field with the Google logo in the
 * corner. Nothing throws. `onMapReady` still fires.
 *
 * That failure mode is the dangerous one for this app, because a grey field
 * with a route drawn on it looks like a map of somewhere. A player recording a
 * demo would be showing a route over nothing and calling it their
 * neighbourhood. So a missing key is detected *before* the map mounts and is
 * reported as a missing key, in words.
 *
 * ## What this deliberately does not do
 *
 * It does not fall back to a drawn substitute. The app used to have one — a
 * pale panel with painted roads and hex accents (`RouteCanvas`) — and it was
 * honest only as long as nobody read it as geography. It cannot be a *fallback*
 * for a real map: the moment it stands in for one, every road on it is a claim
 * about ground the player never walked. A build without a key shows a panel
 * that says there is no map, and shows the route's real statistics, which are
 * true regardless.
 *
 * It also cannot detect a key that is present but *rejected* — wrong package
 * name, wrong signing certificate, Maps SDK not enabled on the project. That
 * verdict is only visible to the native SDK at runtime and is not surfaced to
 * JavaScript. {@link MAP_KEY_REJECTED_HINT} is what the diagnostics panel tells
 * a human to check, and `docs/MAP_PROVIDER.md` carries the setup that prevents
 * it.
 */

/** Platforms as far as the basemap is concerned. */
export type MapPlatform = "android" | "ios" | "web" | "unknown";

export type MapAvailability =
  /** A real basemap will render. */
  | { status: "ready" }
  /** Android, but no Google Maps API key is compiled into this build. */
  | { status: "missing_key" }
  /** No native map on this platform (web). */
  | { status: "unsupported_platform" };

/**
 * The shape this module reads out of the Expo app config.
 *
 * Declared structurally rather than importing Expo's own types so the check
 * stays testable on plain Node, and so a config shape that drifts is a
 * compile error here rather than a silent `undefined` at runtime.
 */
export interface MapConfigSlice {
  android?: {
    config?: {
      googleMaps?: {
        apiKey?: string | null;
      } | null;
    } | null;
  } | null;
}

/**
 * What a human should check when the key is present but the map is still grey.
 *
 * Kept next to the availability rules because it is the same subject, and
 * because it must stay in step with `docs/MAP_PROVIDER.md`.
 */
export const MAP_KEY_REJECTED_HINT =
  "A map key is configured. If the map is still blank, the key is being rejected: check that Maps SDK for Android is enabled, and that the key's Android restriction lists this build's package name and signing certificate fingerprint.";

/**
 * Whether a configured value is a usable key.
 *
 * An empty string, whitespace, or a leftover placeholder is not a key. Those
 * are the values an unset environment variable actually produces — an
 * `app.config` that interpolates `process.env.SOMETHING` when it is undefined
 * yields the empty string, not `undefined` — so treating them as present would
 * defeat the whole check.
 */
export function isUsableMapKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  /* The placeholders this repo and the Expo docs use. A build carrying one of
     these has been configured by copy-paste, not by a real key. */
  const placeholders = [
    "fill_me_in",
    "your_key_here",
    "your_google_maps_api_key",
    "undefined",
    "null",
  ];
  return !placeholders.includes(trimmed.toLowerCase());
}

/**
 * Whether this build can show a real basemap.
 *
 * iOS is `ready` unconditionally: the default provider there is Apple Maps,
 * which is part of the OS and needs no key of ours. Only the Google provider
 * needs one, and this app does not opt into Google on iOS.
 */
export function mapAvailability(
  platform: MapPlatform,
  config: MapConfigSlice | null | undefined,
): MapAvailability {
  if (platform === "web") return { status: "unsupported_platform" };
  if (platform === "ios") return { status: "ready" };
  /* "unknown" is treated as Android: on this project Android is the build that
     needs a key and the one the demo is recorded on, so an unrecognised
     platform should fail toward *checking* rather than toward assuming fine. */
  const key = config?.android?.config?.googleMaps?.apiKey;
  return isUsableMapKey(key) ? { status: "ready" } : { status: "missing_key" };
}

/** One plain sentence for a player, never a stack trace and never a key. */
export function mapUnavailableMessage(availability: MapAvailability): string | null {
  switch (availability.status) {
    case "ready":
      return null;
    case "missing_key":
      return "This build has no map key, so the map can't be shown. Your distance, time and route are still recorded.";
    case "unsupported_platform":
      return "The map isn't available on this platform. Your distance, time and route are still recorded.";
  }
}
