/**
 * The one place `react-native-maps` is imported.
 *
 * Every other module in the app reaches the basemap through the components in
 * this directory, and those reach it through here. That is the whole point:
 * the provider decision (see `docs/MAP_PROVIDER.md`) was made on today's
 * evidence and will not hold forever — `expo-maps` is Expo's own successor and
 * is still alpha, MapLibre needs a tile provider we do not have. When one of
 * those becomes the right answer, the diff is this file and the five
 * components beside it, not every screen that shows a map.
 *
 * Nothing here adds behaviour. It re-exports, so that a grep for
 * `react-native-maps` outside this directory is a review finding rather than
 * something to reason about.
 */
export {
  default as MapView,
  Marker,
  Polyline,
  Polygon,
  Circle,
  PROVIDER_GOOGLE,
  PROVIDER_DEFAULT,
} from "react-native-maps";

export type {
  MapViewProps,
  Region,
  LatLng as ProviderLatLng,
  EdgePadding,
  SnapshotOptions,
} from "react-native-maps";
