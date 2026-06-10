import { StyleSheet, Text, View } from "react-native";
import { type } from "@/theme";

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
  title: { ...type.heading, fontSize: 18 },
  trailing: { ...type.caption, fontWeight: "600" },
});
