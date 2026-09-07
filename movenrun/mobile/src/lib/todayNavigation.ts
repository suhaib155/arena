/** Summary may be the only route (replace/deep link), so dismissAll can be a no-op. */
export function returnToToday(router: { replace: (href: "/(tabs)") => void }, release: () => void) {
  router.replace("/(tabs)");
  release();
}
