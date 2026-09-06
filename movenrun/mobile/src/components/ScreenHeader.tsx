import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, iconTile, MIN_TOUCH_TARGET, pressFade, spacing, type } from "@/theme";

/**
 * The screen header — one back/dismiss control, one title, one optional
 * trailing slot.
 *
 * Twenty-four screens hand-rolled this. The *geometry* had actually survived
 * copy-paste intact — twenty of them declared a byte-identical `headerRow`
 * block — but everything around it had not:
 *
 *  - The glyph was 22pt on most screens, 24pt on the three that dismiss, 26pt
 *    on the zone detail, and 28pt on the quest detail.
 *  - The back control was `colors.text`; the dismiss control was
 *    `colors.textDim`, for no reason anyone had written down.
 *  - The right-hand spacer that keeps the title optically centred was
 *    `styles.backBtn` on most screens, `{ width: 24 }` on one, `{ width: 26 }`
 *    on another, and missing on a third.
 *  - `app/zone/[id].tsx` passed `pressFade()` with no base style, so its back
 *    control had no size at all and fell back to the glyph's own 26pt.
 *  - `app/quest/[id].tsx` put `onPress` directly on an `<Ionicons>`. That is a
 *    press target with no role, no label, no press feedback, and a hit area
 *    the size of the glyph — and, being neither `Pressable` nor `ScalePress`,
 *    it was invisible to every guard in `uiGuards.test.ts`.
 *  - **Not one of the twenty-four carried an `accessibilityLabel`.** The most
 *    used control in the app announced nothing on twenty-four screens.
 *
 * So the header is a component. The label is not optional here — it is
 * supplied by construction, which is the only way twenty-four screens get it
 * and keep it.
 *
 * ## Touch target
 * The control occupies 44pt, with extra hit slop. Equal side slots keep the
 * wrapping title balanced; optional status content occupies its own row so
 * large text never has to compete with it for the title's width. Safe-area
 * padding belongs to the containing Screen.
 */
interface ScreenHeaderProps {
  title: string;
  /**
   * `back` reads as "up one level" and draws a chevron; `dismiss` reads as
   * "leave this flow" and draws a close. They are different promises, so they
   * are different glyphs and different spoken labels — but the same size,
   * colour and target.
   */
  action?: "back" | "dismiss";
  /** Defaults to `router.back()`. Pass a handler for flows that confirm first. */
  onAction?: () => void;
  /** Overrides the spoken label when "Back"/"Close" is not the whole truth. */
  actionLabel?: string;
  /**
   * Right-hand slot — a chip, a count, a status. When absent the mirror width
   * is still reserved, so the title stays optically centred instead of
   * shifting between screens that have one and screens that do not.
   */
  trailing?: ReactNode;
  /** A small status dot before the title (a live session's paused/moving state). */
  dotColor?: string;
}

const GLYPH = { back: "chevron-back", dismiss: "close" } as const;
const SPOKEN = { back: "Back", dismiss: "Close" } as const;

export function ScreenHeader({
  title,
  action = "back",
  onAction,
  actionLabel,
  trailing,
  dotColor,
}: ScreenHeaderProps) {
  const router = useRouter();
  return (
    <View>
    <View style={styles.row}>
      <Pressable
        onPress={onAction ?? (() => router.back())}
        hitSlop={12}
        style={pressFade(styles.control)}
        accessibilityRole="button"
        accessibilityLabel={actionLabel ?? SPOKEN[action]}
      >
        <Ionicons name={GLYPH[action]} size={22} color={colors.text} />
      </Pressable>

      <View style={styles.titleWrap}>
        {dotColor ? <View style={[styles.dot, { backgroundColor: dotColor }]} /> : null}
        <Text style={styles.title}>
          {title}
        </Text>
      </View>

      <View style={styles.trailing} />
    </View>
    {trailing ? <View style={styles.statusRow}>{trailing}</View> : null}
    </View>
  );
}

const CONTROL = 44;

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    gap: spacing.sm,
  },
  control: { ...iconTile(CONTROL) },
  titleWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  title: { ...type.heading, fontSize: 16, flexShrink: 1, textAlign: "center" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  // Mirrors the control so the title is centred whether or not a chip is here.
  trailing: { minWidth: CONTROL, width: CONTROL, alignItems: "flex-end" },
  statusRow: { alignItems: "center", paddingBottom: spacing.xs },
});
