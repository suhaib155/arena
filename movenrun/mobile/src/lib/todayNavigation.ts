/**
 * Leaving a finished session, and what leaving is allowed to cost.
 *
 * ## Why hardware Back needs its own decision
 *
 * Every exit from the summary has to do two things: navigate, and release the
 * in-memory handoff that holds the route's raw coordinates. `Back to Today`
 * did both. Android's hardware Back did neither — it popped the screen, so the
 * route and the display seed stayed in module memory and a saveable session
 * could be discarded by one press with no confirmation and no way back to it.
 * `gestureEnabled: false` in the stack does not help: it disables the swipe and
 * has no effect on the hardware button.
 *
 * The decision is a pure function so the three cases are a property of a tested
 * rule rather than of a component's branch order.
 */

/** Summary may be the only route (replace/deep link), so dismissAll can be a no-op. */
export function returnToToday(router: { replace: (href: "/(tabs)") => void }, release: () => void) {
  router.replace("/(tabs)");
  release();
}

/** What hardware Back should do from a finished-session screen. */
export type BackIntent =
  /** Leave now, releasing the handoff. */
  | "leave"
  /** Ask first: leaving would discard progress the user could still bank. */
  | "confirm"
  /** Swallow the press: a save transaction is mid-flight. */
  | "block";

export interface BackContext {
  /** A save is running and has not settled. */
  saveInFlight: boolean;
  /**
   * There is progress a further tap could still bank — a movement session that
   * is saveable, has actually moved, and has not been saved yet.
   *
   * A session with nothing to reward is deliberately **not** included: it earns
   * no XP and changes no territory, so a confirmation there would ask the user
   * to think about a choice that costs them nothing.
   */
  unsavedProgress: boolean;
}

export function backIntent({ saveInFlight, unsavedProgress }: BackContext): BackIntent {
  if (saveInFlight) return "block";
  if (unsavedProgress) return "confirm";
  return "leave";
}
