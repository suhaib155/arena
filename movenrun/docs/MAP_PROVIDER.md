# The map provider — what was chosen, on what evidence, and what it costs

The app draws real geography for the first time. This is the decision behind
that, the setup a human has to do once, and the parts that are still ungated.

## The decision

**`react-native-maps@1.20.1`**, Google Maps on Android, Apple Maps on iOS.

Not chosen blindly, and not chosen because it is the popular answer. The
evidence below was gathered against this repository's actual versions — Expo SDK
54.0.36, React Native 0.81.5, React 19.1.0, `newArchEnabled: false` — rather
than against a general recommendation.

| Provider | Expo 54 | RN 0.81 | Android | iOS | H3 polygons | Route | Snapshot | Key / cost | Complexity | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **`react-native-maps` 1.20.1** | Yes — the version Expo SDK 54 itself pins in `expo/bundledNativeModules.json` | Yes — peer range `react-native >= 0.64.3`, `react >= 17.0.1` | Google Maps | Apple Maps (default) | `<Polygon>`, arbitrary vertex count | `<Polyline>`, multiple | `takeSnapshot()` on the map ref | Google Maps key, Android only; free tier covers a demo | Config plugin + prebuild; no custom native code | **Chosen** |
| `expo-maps` | Expo's own, ships with the SDK | Yes | Google Maps | Apple Maps only — deliberately no Google on iOS | Supported | Supported | Less mature | None beyond Google's | Lowest | Rejected — still **alpha**, documented as subject to frequent breaking changes, and the overlay/snapshot surface this app needs is the least settled part of it. Wrong risk for a build that has to record on a specific day. |
| `@maplibre/maplibre-react-native` 11.3.9 | Peer `expo >= 54.0.0` | Peer `react-native >= 0.80.0` | Vector tiles | Vector tiles | Excellent | Excellent | Supported | **No basemap of its own** — needs a tile/style provider (and an account) that this project does not have | Highest — config plugin plus native build | Rejected for now. The strongest styling story of the four, and the natural home if the map ever needs to look unlike Google's. It cannot be adopted without first choosing and paying for a tile provider. |
| `@rnmapbox/maps` 10.3.5 | Workable | Workable | Mapbox | Mapbox | Excellent | Excellent | Static + snapshot | Mapbox account, token, and usage-based billing | High — download token at build time | Rejected — the account and billing setup is a larger external gate than the one Google already imposes, for no capability this app needs today. |

### Why the Expo pin rather than the newest release

`react-native-maps` is at **1.29.0** (published 2026-06-28). Expo SDK 54 pins
**1.20.1**. The pin is the version Expo tests this SDK against and the one
`expo install` and `expo-doctor` treat as correct, and it satisfies this
project's peer requirements with room to spare. Taking 1.29.0 would mean
carrying a combination nobody has validated in exchange for features this app
does not use. If a later need calls for it, moving is a one-line change and a
rebuild.

> **This version was pinned from local evidence, not from Expo's API.**
> `api.expo.dev` is blocked by this environment's egress proxy, so
> `expo install react-native-maps` could not resolve the recommendation over the
> network. The version was read out of the installed
> `node_modules/expo/bundledNativeModules.json` instead, which is the same
> manifest `expo install` consults. Worth re-confirming with `expo install
> --check` in an environment that can reach Expo.

## Setup a human must do once

The app cannot do this part. Until it is done, Android builds show "This build
has no map key" instead of a map — deliberately, see below.

1. In the Google Cloud console, on the project that owns this app, **enable
   *Maps SDK for Android***. Enabling *Maps JavaScript API* or *Maps SDK for
   iOS* instead is the most common reason a key is present and rejected.
2. Create an **API key**.
3. **Restrict it**, both ways:
   - *Application restrictions* → **Android apps**, and add the package name
     **`io.movenrun.app`** together with the **SHA-1 fingerprint** of the
     signing certificate the build uses. For an EAS build that is EAS's own
     keystore: `eas credentials` → Android → the preview profile → read the
     SHA-1 from the keystore it shows. A debug build signed locally has a
     *different* SHA-1 and needs its own entry.
   - *API restrictions* → **Restrict key** → *Maps SDK for Android* only.
   An unrestricted key is usable by anyone who extracts it from the APK, and it
   bills to this project.
4. Put the key in the environment as **`GOOGLE_MAPS_ANDROID_API_KEY`**:
   - locally: a `.env` file in `movenrun/mobile/` (already git-ignored), or
     exported in the shell before `expo prebuild` / `expo run:android`;
   - for EAS: `eas secret:create --scope project --name
     GOOGLE_MAPS_ANDROID_API_KEY --value <key>`;
   - for the GitHub Actions APK workflow: a repository secret of the same name,
     passed into the build step's environment.
5. Rebuild. The key is compiled into the binary at prebuild time — setting it
   afterwards changes nothing about an APK that already exists.

**Never commit the key.** `mobile/app.config.js` reads it from the environment
and `src/lib/__tests__/mapConfig.test.ts` fails if one appears in `app.json`.

iOS needs no key: the default provider there is Apple Maps.

### If the map is still blank with a key set

The key is being rejected, and only the native SDK can see that — it is not
reported to JavaScript, so the app cannot tell you which of these it is. In
order of likelihood: *Maps SDK for Android* is not enabled; the key's Android
restriction does not list this build's package name **and** SHA-1; the key is
restricted to a different API; billing is not enabled on the Google Cloud
project.

## How the app is wired

One directory imports the library — `mobile/src/components/map/provider.ts` —
and everything else goes through the components beside it. A grep for
`react-native-maps` outside `src/components/map/` should return nothing, which
is what makes the table above a decision that can be revisited rather than one
the codebase is married to.

| Piece | File | Job |
| --- | --- | --- |
| Provider seam | `components/map/provider.ts` | The only `react-native-maps` import |
| Map shell | `components/map/MovenMap.tsx` | Availability gate, provider choice, camera wiring |
| Route | `components/map/RoutePolyline.tsx` | One polyline per **observed** span |
| Grid | `components/map/H3Overlay.tsx` | Real resolution-8 boundaries |
| Markers | `components/map/{StartMarker,CurrentLocationMarker}.tsx` | Origin and head of route |
| Camera | `components/map/useMapCamera.ts` | Follow / recentre / fit, reduced-motion aware |
| Geometry | `lib/mapGeometry.ts` | Segments and viewports — platform-free, tested |
| Grid selection | `lib/mapCells.ts` | Which cells are drawn, and what each claims |
| Key gate | `lib/mapAvailability.ts` | Whether a real basemap exists at all |

## Three decisions worth knowing about

**A missing key fails in words, not in grey.** Without a key the native view
still mounts and still lays out; it just renders an empty field with a Google
logo. Nothing throws. A route drawn on that looks like a route through
somewhere. So availability is checked before the map mounts, and a build without
a key says so.

**There is no drawn fallback map.** The app has a `RouteCanvas` — a pale panel
with painted roads and hex accents — and it is honest as an illustration. It
cannot stand in for a basemap: the moment it does, every painted road is a claim
about ground the player never walked. It is not wired to the map's failure path.

**The OS blue dot is off.** `showsUserLocation` draws the platform's own reading
of the device position, which is not the same as the head of the route this app
accepted — fixes rejected as too inaccurate move one and not the other. Two dots
that disagree, one of them ahead of the line, is exactly what makes a walking
demo look broken. The marker the app draws is tied to the evidence.

## What is not done here

- **No APK has been built with a key.** The key is an external gate, so the
  map has not been seen rendering on a device from this branch.
- **`takeSnapshot()` is wired but unverified on hardware.** The API exists in
  1.20.1 and the share card handles a null result by showing no map. Whether the
  Android capture includes the polygon and polyline overlays is a device
  question, and it is on the physical-test list rather than claimed here.
- **No offline basemap.** Out of tile coverage, the basemap is blank and the
  route still draws. The distance and the route are on-device and unaffected.
