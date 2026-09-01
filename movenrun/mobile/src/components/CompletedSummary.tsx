import { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, iconTile, ink, palette, radius, softTint, spacing, strongTint, type } from "@/theme";
import { ScalePress } from "./ScalePress";

interface CompletedSummaryProps {
  count: number;
  expanded: boolean;
  onToggle: () => void;
  /** Rendered only while expanded. */
  children?: ReactNode;
  /** Noun for the summary line, e.g. "completed". */
  noun?: string;
}

/**
 * Collapsible "✓ N completed" summary. Collapsed by default so completed items
 * don't crowd the active view; the header toggles and exposes its expanded/
 * collapsed state to assistive tech. Completion is shown with a check icon +
 * text, never colour alone. Uses normal flow (no absolute overlay).
 */
export function CompletedSummary({ count, expanded, onToggle, children, noun = "completed" }: CompletedSummaryProps) {
  if (count <= 0) return null;
  return (
    <View style={styles.wrap}>
      <ScalePress
        to={0.99}
        onPress={onToggle}
        style={styles.header}
        accessibilityRole="button"
        accessibilityLabel={`${count} ${noun}`}
        accessibilityHint={expanded ? "Collapse completed" : "Expand completed"}
      >
        <View style={styles.check}>
          <Ionicons name="checkmark" size={15} color={ink.green} />
        </View>
        <Text style={styles.title}>
          {count} {noun}
        </Text>
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={16}
          color={colors.textFaint}
        />
      </ScalePress>
      {expanded && children ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: softTint(palette.pulseGreen),
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: 48,
  },
  check: { ...iconTile(24), backgroundColor: strongTint(palette.pulseGreen) },
  title: { ...type.heading, fontSize: 14.5, flex: 1, color: ink.green },
  body: { gap: spacing.sm },
});
