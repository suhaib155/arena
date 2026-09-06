import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { Screen } from "@/components/Screen";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Button } from "@/components/Button";
import { FirstTimeGuide } from "@/components/FirstTimeGuide";
import { LegalLinks } from "@/components/LegalAcceptance";
import { EDUCATION_TOPICS, type EducationTopic } from "@/lib/education";
import { colors, radius, spacing, type } from "@/theme";

export default function HelpScreen() {
  const { topic } = useLocalSearchParams<{ topic?: string }>();
  const initial = EDUCATION_TOPICS.find(value => value === topic) ?? null;
  const [replay, setReplay] = useState<EducationTopic | null>(initial);
  return <Screen>
    <ScreenHeader title="Help" />
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>Find your next move</Text>
      <Button label="Territory guide" icon="map-outline" variant="secondary" onPress={() => setReplay("territory")} />
      <Button label="Deeds guide" icon="albums-outline" variant="secondary" onPress={() => setReplay("deeds")} />
      <Button label="Clubs guide" icon="people-outline" variant="secondary" onPress={() => setReplay("clubs")} />
      <View style={styles.card}>
        <Text style={styles.heading}>Quest rewards</Text>
        <Text style={styles.body}>Complete the countdown to earn XP. Paused time does not count. Each quest awards XP once per day.</Text>
      </View>
      <LegalLinks />
    </ScrollView>
    {replay ? <FirstTimeGuide key={replay} topic={replay} replay onClose={() => setReplay(null)} /> : null}
  </Screen>;
}
const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingVertical: spacing.lg }, title: { ...type.title }, heading: { ...type.heading }, body: { ...type.body },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
});
