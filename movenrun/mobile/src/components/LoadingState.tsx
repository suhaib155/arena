import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { colors, spacing, type } from "@/theme";

interface LoadingStateProps {
  /** What is being waited for. Shown, and read by a screen reader. */
  message?: string;
}

/**
 * A screen-level "still loading" state.
 *
 * Exists because several screens rendered `null` while the persisted store
 * hydrated. On a cold start that is a blank screen with a header and nothing
 * else, which reads as "this feature is broken" rather than "one moment" —
 * and it is indistinguishable from the genuine empty state that follows.
 *
 * Announced as a live region so a screen reader says something during the
 * wait instead of landing the user on an empty page.
 */
export function LoadingState({ message = "Loading…" }: LoadingStateProps) {
  return (
    <View
      style={styles.wrap}
      accessibilityRole="progressbar"
      accessibilityLabel={message}
      accessibilityLiveRegion="polite"
    >
      <ActivityIndicator color={colors.textDim} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.xl,
  },
  text: { ...type.caption, color: colors.textDim, textAlign: "center" },
});
