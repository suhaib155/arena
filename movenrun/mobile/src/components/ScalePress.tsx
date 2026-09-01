import { ReactNode, useRef } from "react";
import {
  Animated,
  Pressable,
  type AccessibilityRole,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { motion } from "@/theme";

interface ScalePressProps {
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  /** Scale while pressed. */
  to?: number;
  style?: StyleProp<ViewStyle>;
  /** Accessibility — forwarded to the underlying Pressable so icon-only and
   *  composite controls can describe themselves to screen readers. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: AccessibilityRole;
  /** An action is in flight — announced as busy, and (like disabled) the press
   *  is refused. Announcing without blocking would invite a double submit. */
  busy?: boolean;
  /**
   * This control is a toggle, and it is currently on.
   *
   * A toggle that only changes colour is invisible to a screen reader, which
   * announces "button" either way. `FloatingMapControl` documented that it
   * exposed its selected state and did not: nothing here forwarded one, so the
   * comment was the only place the promise existed. Pass `undefined` (the
   * default) for a control that is not a toggle — `selected: false` says "a
   * toggle, currently off", which is a different statement from "not a
   * toggle", and announcing the wrong one on every button in the app would be
   * worse than announcing nothing.
   */
  selected?: boolean;
  /**
   * Extra tappable margin, in points, around a control that is deliberately
   * drawn smaller than {@link MIN_TOUCH_TARGET}.
   *
   * Compact glyph buttons — a 32pt sheet dismiss, a header back chevron — are
   * a real visual decision, and inflating them to 44pt would distort the
   * layout they sit in. Growing the *hit area* instead is the platform answer,
   * and it belongs here rather than in each caller so the shared wrapper can
   * be held to the contract. `src/lib/__tests__/uiGuards.test.ts` enforces
   * that a control below the floor declares enough of it.
   */
  hitSlop?: number;
}

/**
 * The accessibility state, or `undefined` when there is nothing to say.
 *
 * Kept separate because the three flags do not compose the way a single
 * spread would suggest: `disabled` and `busy` are only meaningful while the
 * control is inactive, whereas `selected` describes a toggle that is very much
 * live. Emitting `{ selected: false }` on every non-toggle would mislabel the
 * whole app as toggles, so an omitted `selected` stays omitted.
 */
function accessibilityState(
  disabled: boolean | undefined,
  busy: boolean | undefined,
  selected: boolean | undefined,
): { disabled?: boolean; busy?: boolean; selected?: boolean } | undefined {
  const state: { disabled?: boolean; busy?: boolean; selected?: boolean } = {};
  if (disabled || busy) {
    state.disabled = Boolean(disabled);
    state.busy = Boolean(busy);
  }
  if (selected !== undefined) state.selected = selected;
  return Object.keys(state).length > 0 ? state : undefined;
}

/**
 * Pressable that springs to a slightly smaller scale while held — the soft,
 * tactile press used across Daylight Cartography (cards, buttons, chips).
 */
export function ScalePress({
  children,
  onPress,
  disabled,
  to = 0.97,
  style,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole,
  busy,
  selected,
  hitSlop,
}: ScalePressProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const inactive = Boolean(disabled || busy);

  const springTo = (value: number) =>
    Animated.spring(scale, { toValue: value, ...motion.spring }).start();

  return (
    <Pressable
      // The press animation is decorative and runs on the native driver — it
      // never gates or delays this handler.
      onPress={onPress}
      disabled={inactive}
      hitSlop={hitSlop}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={accessibilityState(disabled, busy, selected)}
      onPressIn={() => !inactive && springTo(to)}
      onPressOut={() => springTo(1)}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}
