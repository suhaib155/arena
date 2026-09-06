import { useEffect, useRef } from "react";
import { AccessibilityInfo, findNodeHandle, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { colors, ink, pressFade, radius, spacing, type } from "@/theme";
import { Button } from "./Button";

interface Props { visible: boolean; onKeepMoving(): void; onFinish(): void }

/** Confirmation never pauses recording; dismiss and Android Back keep moving. */
export function FinishSessionSheet({ visible, onKeepMoving, onFinish }: Props) {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const safeAction = useRef<View>(null);
  const submitted = useRef(false);
  useEffect(() => { if (!visible) submitted.current = false; }, [visible]);
  const finish = () => {
    if (submitted.current) return;
    submitted.current = true;
    onFinish();
  };
  return (
    <Modal visible={visible} transparent animationType={reducedMotion ? "none" : "fade"}
      onRequestClose={onKeepMoving} statusBarTranslucent
      onShow={() => {
        const target = findNodeHandle(safeAction.current);
        if (target) AccessibilityInfo.setAccessibilityFocus(target);
      }}>
      <View style={[styles.overlay, { paddingTop: insets.top + spacing.lg, paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <ScrollView style={styles.sheet} contentContainerStyle={styles.content} bounces={false}
          accessibilityViewIsModal importantForAccessibility="yes">
          <View style={styles.motif}><Ionicons name="flag-outline" size={28} color={ink.blue} /></View>
          <Text style={styles.title} accessibilityRole="header">Ready to finish?</Text>
          <Text style={styles.detail}>End this move and see your route.</Text>
          <Pressable ref={safeAction} onPress={onKeepMoving} style={pressFade(styles.safeAction)}
            accessibilityRole="button" accessibilityLabel="Keep moving" accessibilityHint="Closes this sheet and continues recording">
            <Text style={styles.safeLabel}>Keep moving</Text>
          </Pressable>
          <Button label="Finish" variant="secondary" icon="flag-outline" onPress={finish}
            accessibilityHint="Ends and reviews this movement session" />
        </ScrollView>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", paddingHorizontal: spacing.lg, backgroundColor: "rgba(12,20,32,0.35)" },
  sheet: { flexGrow: 0, backgroundColor: colors.surface, borderRadius: radius.xl },
  content: { padding: spacing.lg, gap: spacing.md },
  motif: { alignSelf: "center", padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surfaceAlt },
  title: { ...type.title, textAlign: "center" },
  detail: { ...type.caption, textAlign: "center", marginBottom: spacing.sm },
  safeAction: { minHeight: 56, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  safeLabel: { ...type.heading, color: colors.surface, textAlign: "center" },
});
