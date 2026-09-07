import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, findNodeHandle, Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { useEducation } from "@/hooks/useEducation";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { education } from "@/services/education";
import type { EducationTopic } from "@/lib/education";
import type { IoniconName } from "@/types";
import { colors, ink, palette, radius, spacing, type } from "@/theme";
import { Button } from "./Button";

interface Step { title: string; detail: string; icon: IoniconName }
const GUIDES: Record<EducationTopic, { title: string; color: string; steps: Step[] }> = {
  territory: { title: "Make your move", color: ink.green, steps: [
    { title: "Move", detail: "Start a move and explore the map.", icon: "walk-outline" },
    { title: "Seal", detail: "Cross your trail or return near your start.", icon: "git-merge-outline" },
    { title: "Build territory", detail: "Eligible routes can capture or strengthen zones.", icon: "flag-outline" },
    { title: "Defend", detail: "Return to your zones to keep them strong.", icon: "shield-checkmark-outline" },
  ] },
  deeds: { title: "Discover Deeds", color: palette.deedViolet, steps: [
    { title: "Explore the collection", detail: "Each Deed highlights a territory story.", icon: "albums-outline" },
    { title: "See its progress", detail: "Open a card to see the zone behind it.", icon: "map-outline" },
    { title: "Watch it grow", detail: "Deeds are previews. Ownership and minting are not available.", icon: "lock-closed-outline" },
  ] },
  clubs: { title: "Move together", color: ink.blue, steps: [
    { title: "Choose a club", detail: "Find a club identity that fits your style.", icon: "people-outline" },
    { title: "Explore its territory", detail: "See your club’s territory preview and your contributions.", icon: "map-outline" },
    { title: "Keep showing up", detail: "Your movement builds your progress. Live club competition is coming later.", icon: "footsteps-outline" },
  ] },
};

/** Replay is intentional; automatic presentations are claimed only once after hydration. */
export function FirstTimeGuide({ topic, replay = false, onClose }: {
  topic: EducationTopic; replay?: boolean; onClose?: () => void;
}) {
  const state = useEducation();
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const [focused, setFocused] = useState(false);
  const [step, setStep] = useState(0);
  const heading = useRef<Text>(null);
  const guide = GUIDES[topic];
  const currentStep = guide.steps[Math.min(step, guide.steps.length - 1)];
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => { setFocused(false); setVisible(false); };
  }, []));
  useEffect(() => {
    if (!state.hydrated || !focused) return;
    if (replay || education.claimAutomatic(topic)) {
      setStep(0);
      setVisible(true);
      void education.markSeen(topic);
    }
  }, [state.hydrated, focused, topic, replay]);
  const close = () => { setVisible(false); onClose?.(); };
  const focusHeading = () => {
    const target = findNodeHandle(heading.current);
    if (target) AccessibilityInfo.setAccessibilityFocus(target);
  };
  useEffect(() => { if (visible) focusHeading(); }, [step]);
  return <Modal visible={visible} transparent animationType={reducedMotion ? "none" : "fade"}
    statusBarTranslucent onRequestClose={close} onShow={focusHeading}>
    <View style={[styles.overlay, { paddingTop: insets.top + spacing.lg, paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
      <ScrollView style={styles.sheet} contentContainerStyle={styles.content} bounces={false}
        accessibilityViewIsModal importantForAccessibility="yes">
        <Text style={styles.kicker}>{guide.title} · {step + 1}/{guide.steps.length}</Text>
        <View style={styles.art}><Ionicons name={currentStep.icon} size={52} color={guide.color} /></View>
        <Text ref={heading} accessible accessibilityRole="header" style={styles.title}>{currentStep.title}</Text>
        <Text style={styles.detail}>{currentStep.detail}</Text>
        <Button label={step === guide.steps.length - 1 ? "Let’s move" : "Next"}
          onPress={() => step === guide.steps.length - 1 ? close() : setStep(value => Math.min(value + 1, guide.steps.length - 1))} />
        <Button label="Close guide" variant="ghost" onPress={close} />
      </ScrollView>
    </View>
  </Modal>;
}
const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end", paddingHorizontal: spacing.lg, backgroundColor: "rgba(12,20,32,0.35)" },
  sheet: { flexGrow: 0, backgroundColor: colors.surface, borderRadius: radius.xl },
  content: { padding: spacing.lg, gap: spacing.md }, kicker: { ...type.kicker, textAlign: "center" },
  art: { alignSelf: "center", padding: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.surfaceAlt },
  title: { ...type.title, textAlign: "center" }, detail: { ...type.body, textAlign: "center", marginBottom: spacing.md },
});
