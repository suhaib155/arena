import { Children, Fragment, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, type } from "@/theme";
import { ScalePress } from "./ScalePress";

interface ListSectionProps {
  /** Small label above the group. Omit for an unlabelled group. */
  title?: string;
  children: ReactNode;
}

/**
 * A plain grouped list: rows sit directly on the canvas, separated by
 * hairlines.
 *
 * Deliberately not a card. Wrapping every navigation row in its own elevated,
 * shadowed container is what makes a screen read as a stack of identical
 * boxes; elevation should be reserved for content that genuinely sits above
 * the page. Here the hairline does the separating and whitespace does the
 * grouping — the pattern dense navigation actually wants.
 */
export function ListSection({ title, children }: ListSectionProps) {
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.section}>
      {title ? <Text style={styles.sectionTitle}>{title}</Text> : null}
      <View>
        {rows.map((row, i) => (
          <Fragment key={i}>
            {i > 0 ? <View style={styles.divider} /> : null}
            {row}
          </Fragment>
        ))}
      </View>
    </View>
  );
}

interface ListRowProps {
  title: string;
  /** One short supporting line. */
  detail?: string;
  /** Trailing figure, e.g. "12%" or "3/8". */
  value?: string;
  onPress: () => void;
  /** Render without the chevron, for rows that are not navigation. */
  plain?: boolean;
}

/**
 * A single row in a {@link ListSection}. Icon-free by design — the title
 * carries the meaning, and a column of coloured icon tiles is exactly what
 * makes a list look like a settings menu.
 */
export function ListRow({ title, detail, value, onPress, plain = false }: ListRowProps) {
  return (
    <ScalePress
      to={0.99}
      onPress={onPress}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={[title, detail, value].filter(Boolean).join(". ")}
    >
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {detail ? (
          <Text style={styles.detail} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      {value ? <Text style={styles.value}>{value}</Text> : null}
      {plain ? null : <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />}
    </ScalePress>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.xs },
  sectionTitle: {
    ...type.kicker,
    fontSize: 10.5,
    color: colors.textFaint,
    marginBottom: spacing.xs,
  },
  divider: { height: 1, backgroundColor: colors.border, marginLeft: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  body: { flex: 1, gap: 2 },
  title: { ...type.heading, fontSize: 15.5, letterSpacing: -0.3 },
  detail: { ...type.caption, fontSize: 12.5, color: colors.textFaint },
  value: {
    fontSize: 13.5,
    fontWeight: "700",
    color: colors.textDim,
    fontVariant: ["tabular-nums"],
  },
});
