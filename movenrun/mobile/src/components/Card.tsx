import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, radius, shadows, spacing } from "@/theme";

type CardVariant = "standard" | "hero" | "flat";

interface CardProps {
  children: ReactNode;
  variant?: CardVariant;
  style?: StyleProp<ViewStyle>;
}

/**
 * The app's only card surface.
 *
 * Twenty-odd screens each declared their own `{ backgroundColor, borderRadius,
 * padding, ...shadows }`, and they drifted: radius 22 here, 28 there, padding
 * 12 on one list and 16 on the next. Cards that are meant to read as the same
 * object have to *be* the same object, so there are exactly three:
 *
 *  - **standard** — the default. Everything in a list or a grid.
 *  - **hero** — one per screen at most: the thing the screen is *about*.
 *    Rounder, roomier, and lifted, so it wins by construction.
 *  - **flat** — grouped content that shouldn't float (nested panels, the inside
 *    of a sheet). Bordered instead of shadowed.
 *
 * Padding follows the 8pt grid at the standard mobile card inset (16), with the
 * hero at the next step up (24).
 */
export function Card({ children, variant = "standard", style }: CardProps) {
  return <View style={[styles.base, styles[variant], style]}>{children}</View>;
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
  standard: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  hero: {
    borderRadius: radius.xl,
    padding: spacing.xl,
    ...shadows.float,
  },
  flat: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
