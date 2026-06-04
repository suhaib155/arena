import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "@/theme";

interface SectionHeaderProps {
  title: string;
  /** Optional trailing text, e.g. a count or "See all". */
  trailing?: string;
}

/** Consistent section heading so vertical rhythm matches across screens. */
export function SectionHeader({ title, trailing }: SectionHeaderProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      {trailing ? <Text style={styles.trailing}>{trailing}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  title: { color: colors.text, fontSize: 18, fontWeight: "700" },
  trailing: { color: colors.textDim, fontSize: 13, fontWeight: "600" },
});
