import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useEducation } from "@/hooks/useEducation";
import { legalAccepted } from "@/lib/education";
import { education } from "@/services/education";
import { colors, pressFade, spacing, type } from "@/theme";

export function LegalLinks() {
  const router = useRouter();
  return <View style={styles.links}>
    <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: "/legal", params: { kind: "terms" } })} style={pressFade(styles.link)}>
      <Text style={styles.linkText}>Terms of Use</Text>
    </Pressable>
    <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: "/legal", params: { kind: "privacy" } })} style={pressFade(styles.link)}>
      <Text style={styles.linkText}>Privacy Policy</Text>
    </Pressable>
  </View>;
}

export function LegalAcceptance({ onChange }: { onChange: (accepted: boolean) => void }) {
  const state = useEducation();
  const accepted = legalAccepted(state);
  useEffect(() => { onChange(accepted); }, [accepted, onChange]);
  return <View style={styles.group}>
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: accepted, disabled: !state.hydrated || state.busy }}
      accessibilityLabel="I agree to the Terms of Use and acknowledge the Privacy Policy"
      disabled={!state.hydrated || state.busy} style={pressFade(styles.checkbox)}
      onPress={() => { void education.acknowledge(!accepted); }}>
      <Ionicons name={accepted ? "checkbox" : "square-outline"} size={24} color={colors.primary} />
      <Text style={styles.label}>I agree to the Terms and acknowledge the Privacy Policy.</Text>
    </Pressable>
    <LegalLinks />
    {state.failed ? <Text accessibilityLiveRegion="polite" style={styles.detail}>Couldn’t save your choice. Please try again.</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  group: { gap: spacing.xs }, checkbox: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  label: { ...type.caption, flex: 1 }, links: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  link: { minHeight: 44, justifyContent: "center" }, linkText: { ...type.caption, color: colors.primary },
  detail: { ...type.caption, color: colors.textDim },
});
