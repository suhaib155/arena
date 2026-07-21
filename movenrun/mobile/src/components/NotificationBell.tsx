import { StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, palette, radius, shadows } from "@/theme";
import { ScalePress } from "./ScalePress";

interface NotificationBellProps {
  onPress: () => void;
  /** Show the unread dot (e.g. an urgent territory alert exists). */
  unread?: boolean;
  /** Accessibility label — defaults to a sensible description. */
  accessibilityLabel?: string;
}

/**
 * Header notification bell — the only notification affordance on Home (no
 * permanent banners). Icon-only, so it carries an accessibility label and a
 * 44×44 touch target. The dot encodes "unread" with both colour and shape so
 * it is not colour-only.
 */
export function NotificationBell({
  onPress,
  unread = false,
  accessibilityLabel,
}: NotificationBellProps) {
  return (
    <ScalePress
      onPress={onPress}
      to={0.9}
      style={styles.button}
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ??
        (unread ? "Notifications, unread alerts" : "Notifications")
      }
    >
      <Ionicons name="notifications-outline" size={20} color={colors.text} />
      {unread ? <View style={styles.dot} /> : null}
    </ScalePress>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.card,
  },
  dot: {
    position: "absolute",
    top: 10,
    right: 11,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: palette.heatCoral,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
});
