import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/Screen";
import { QuestCard } from "@/components/QuestCard";
import { SectionHeader } from "@/components/SectionHeader";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { Button } from "@/components/Button";
import { spacing, type } from "@/theme";
import { useSessionStart } from "@/hooks/useSessionStart";
import { tapFeedback } from "@/lib/haptics";

/**
 * The warmup quest library.
 *
 * These used to live at the bottom of Home, below six other sections, which
 * meant the daily quest competed with the movement CTA and the rest were
 * scrolled past. Today's quest is now a task on the board; everything else is
 * here, one tap from Profile, where browsing is the point of the screen.
 */
export default function QuestsScreen() {
  const router = useRouter();
  const { dailyQuest, recommendedQuests, completedTodayIds, dailyCompletedToday } =
    useSessionStart();

  const open = (id: string) => {
    tapFeedback();
    router.push({ pathname: "/quest/[id]", params: { id } });
  };

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Button
            label="Back"
            icon="chevron-back"
            variant="ghost"
            onPress={() => {
              tapFeedback();
              router.back();
            }}
            style={styles.back}
          />
          <Text style={styles.title}>Warmup quests</Text>
          <Text style={styles.subtitle}>
            Short indoor sessions that keep your streak alive on days you can't get out.
          </Text>
        </View>

        <FadeSlideIn>
          <SectionHeader title="Today's quest" />
          <View style={styles.gap} />
          <QuestCard
            quest={dailyQuest}
            featured
            completed={dailyCompletedToday}
            onPress={() => open(dailyQuest.id)}
          />
        </FadeSlideIn>

        <SectionHeader title="More quests" trailing={`${recommendedQuests.length}`} />
        <View style={styles.list}>
          {recommendedQuests.map((quest, i) => (
            <FadeSlideIn key={quest.id} delay={STAGGER_MS * (1 + i)}>
              <QuestCard
                quest={quest}
                completed={completedTodayIds.includes(quest.id)}
                onPress={() => open(quest.id)}
              />
            </FadeSlideIn>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.sm, paddingBottom: 120, gap: spacing.lg },
  header: { gap: spacing.xs },
  back: { alignSelf: "flex-start", paddingHorizontal: 0, paddingVertical: spacing.sm },
  title: { ...type.title },
  subtitle: { ...type.body, fontSize: 14 },
  gap: { height: spacing.md },
  list: { gap: spacing.md },
});
