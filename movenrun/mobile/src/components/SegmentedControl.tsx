import { StyleSheet, Text, View } from "react-native";
import { colors, hairline, radius, shadows, spacing } from "@/theme";
import { ScalePress } from "./ScalePress";
import { tapFeedback } from "@/lib/haptics";

export interface Segment<T extends string> {
  id: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Describes the group to a screen reader, e.g. "Territory view". */
  label: string;
}

/**
 * A row of pill segments — the selected one is solid ink, the rest are quiet
 * white. High contrast and label-only: no icons, because a segmented control
 * that needs iconography is one that has too many options.
 *
 * Selection is announced through `accessibilityState.selected` as well as the
 * fill, so it never depends on colour alone.
 */
export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
  label,
}: SegmentedControlProps<T>) {
  return (
    <View style={styles.row} accessibilityRole="tablist" accessibilityLabel={label}>
      {segments.map((s) => {
        const active = s.id === value;
        return (
          <ScalePress
            key={s.id}
            to={0.96}
            onPress={() => {
              if (active) return;
              tapFeedback();
              onChange(s.id);
            }}
            style={[styles.segment, active ? styles.segmentActive : styles.segmentIdle]}
            accessibilityRole="tab"
            accessibilityLabel={s.label}
          >
            <Text style={[styles.label, active ? styles.labelActive : null]} numberOfLines={1}>
              {s.label}
            </Text>
          </ScalePress>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.sm },
  segment: {
    paddingVertical: 11,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  segmentIdle: { backgroundColor: colors.surface, ...hairline },
  segmentActive: { backgroundColor: colors.ink, ...shadows.soft },
  label: { fontSize: 13.5, fontWeight: "700", letterSpacing: -0.2, color: colors.textDim },
  labelActive: { color: colors.onInk },
});
