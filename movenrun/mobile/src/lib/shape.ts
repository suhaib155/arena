/**
 * Shape and interaction rules — platform-free so they are testable off-device.
 *
 * These live outside `theme.ts` because that module imports `Platform` as a
 * *value* (for the mono font stack), which drags the whole React Native runtime
 * into any node test that touches it. The rules below are pure arithmetic and
 * plain objects; `@/theme` re-exports them so screens keep one import.
 *
 * Why they exist at all:
 *
 *  - Corner radius is OPTICAL, not absolute. A fixed 16px radius reads as a
 *    circle on a 24px tile and as a square on a 48px one, which is how the app
 *    ended up rendering the same kind of control as a circle on one screen and
 *    a rounded square on the next.
 *  - A selection outline must not resize the thing it outlines.
 *  - Every tappable surface must answer a touch.
 */
import type { StyleProp, ViewStyle } from "react-native";

/** Corner softness for a square icon container, as a fraction of its size.
 *  Tuned so a 24px and a 56px tile look like the same family. */
export const ICON_TILE_RATIO = 0.32;

/** Minimum comfortable touch target (points), per iOS HIG / Material. */
export const MIN_TOUCH_TARGET = 44;

/** Proportional corner radius for a square container of `size`. */
export function tileRadius(size: number): number {
  return Math.round(size * ICON_TILE_RATIO);
}

/**
 * A centred square icon container with an optically consistent corner.
 * Spread it and add only what differs: `{ ...iconTile(38), backgroundColor }`.
 *
 * Use for FUNCTIONAL icons — list rows, CTA rows, mission and reward tiles.
 */
export function iconTile(size: number): ViewStyle {
  return {
    width: size,
    height: size,
    borderRadius: tileRadius(size),
    alignItems: "center",
    justifyContent: "center",
  };
}

/**
 * A fully circular container. Use for IDENTITY and status — avatars, numbered
 * bullets, empty-state illustration bubbles, iconic round affordances — never
 * for a functional icon tile.
 */
export function avatar(size: number): ViewStyle {
  return {
    width: size,
    height: size,
    borderRadius: size / 2,
    alignItems: "center",
    justifyContent: "center",
  };
}

/**
 * Selection outline that does NOT move anything.
 *
 * Adding a border only when selected changes the box size, so a card grows by
 * twice the border width and reflows its row the moment it is tapped. The
 * border is always reserved; only its colour changes.
 */
export function selectionRing(selected: boolean, color: string): ViewStyle {
  return { borderWidth: 2, borderColor: selected ? color : "transparent" };
}

/**
 * Press feedback for a plain `Pressable`.
 *
 * Cards and buttons go through `ScalePress` and spring when held, but roughly
 * half the app's tappable surfaces were bare `Pressable`s with no feedback at
 * all — so identical-looking rows responded to touch on one screen and felt
 * dead on the next. This is the one shared answer for those:
 * `style={pressFade(styles.row)}`.
 *
 * Opacity only, so it never affects layout and never fights a border radius —
 * unlike a platform ripple, which must be told the shape of every control it
 * lands on.
 */
export const PRESSED_OPACITY = 0.55;

export function pressFade(
  base?: StyleProp<ViewStyle>,
): (state: { pressed: boolean }) => StyleProp<ViewStyle> {
  return ({ pressed }) => [base, pressed ? { opacity: PRESSED_OPACITY } : null];
}
