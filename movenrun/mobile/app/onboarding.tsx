import { useRef, useState } from "react";
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { colors, palette, radius, spacing, type } from "@/theme";
import type { IoniconName } from "@/types";
import { useGameStore } from "@/store/useGameStore";
import { tapFeedback } from "@/lib/haptics";

interface Slide {
  icon: IoniconName;
  tint: string;
  title: string;
  body: string;
}

const SLIDES: Slide[] = [
  {
    icon: "walk",
    tint: palette.pulseGreen,
    title: "Move every day",
    body: "Get a fresh movement quest each day — short, doable bursts of cardio, mobility, strength, and mindfulness.",
  },
  {
    icon: "timer-outline",
    tint: palette.baseBlue,
    title: "Start, move, finish",
    body: "Tap a quest, follow the steps, and run the built-in timer. Pause whenever you need to.",
  },
  {
    icon: "trophy",
    tint: palette.moveGold,
    title: "Earn XP & streaks",
    body: "Gain XP, level up, and build a daily streak — saved on your device. Territory capture and Locked MOVE arrive with the map beta.",
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const completeOnboarding = useGameStore((s) => s.completeOnboarding);
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  // Slides scroll inside the screen's horizontal padding, so each page is the
  // window width minus the left+right padding (spacing.lg each side).
  const pageWidth = width - spacing.lg * 2;
  const isLast = index === SLIDES.length - 1;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
    if (next !== index) setIndex(next);
  };

  const finish = () => {
    completeOnboarding();
    router.replace("/");
  };

  const next = () => {
    tapFeedback();
    if (isLast) {
      finish();
      return;
    }
    scrollRef.current?.scrollTo({ x: pageWidth * (index + 1), animated: true });
  };

  return (
    <Screen>
      <View style={styles.skipRow}>
        <Pressable onPress={finish} hitSlop={12}>
          <Text style={styles.skip}>Skip</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        style={styles.pager}
      >
        {SLIDES.map((slide) => (
          <View key={slide.title} style={[styles.slide, { width: pageWidth }]}>
            <View style={[styles.iconCircle, { backgroundColor: `${slide.tint}1A` }]}>
              <Ionicons name={slide.icon} size={64} color={slide.tint} />
            </View>
            <Text style={styles.title}>{slide.title}</Text>
            <Text style={styles.body}>{slide.body}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.dots}>
        {SLIDES.map((s, i) => (
          <View
            key={s.title}
            style={[styles.dot, i === index ? styles.dotActive : null]}
          />
        ))}
      </View>

      <View style={styles.footer}>
        <Button
          label={isLast ? "Get started" : "Next"}
          icon={isLast ? "rocket-outline" : "arrow-forward"}
          onPress={next}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  skipRow: { alignItems: "flex-end", paddingTop: spacing.sm, height: 32 },
  skip: { ...type.caption, fontSize: 15, fontWeight: "600" },
  pager: { flex: 1 },
  slide: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  iconCircle: {
    width: 140,
    height: 140,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  title: { ...type.display, fontSize: 26, textAlign: "center" },
  body: {
    ...type.body,
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
    paddingHorizontal: spacing.md,
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: palette.dustGray,
  },
  dotActive: { backgroundColor: colors.primary, width: 22 },
  footer: { paddingVertical: spacing.md },
});
