import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { Hexagon } from "@/components/Hexagon";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { requestForegroundPermission } from "@/services/moveTracker";
import type { IoniconName } from "@/types";
import { tapFeedback } from "@/lib/haptics";

/**
 * Pre-session gate: explains exactly why location is needed (foreground only,
 * during a session), asks for permission, and offers a clearly-labeled demo
 * route when the user declines or GPS is unavailable.
 */
export default function MoveStartScreen() {
  const router = useRouter();
  const [denied, setDenied] = useState(false);
  const [requesting, setRequesting] = useState(false);

  const allow = async () => {
    tapFeedback();
    setRequesting(true);
    const granted = await requestForegroundPermission();
    setRequesting(false);
    if (granted) {
      router.replace({ pathname: "/move/session", params: { mode: "gps" } });
    } else {
      setDenied(true);
    }
  };

  const demo = () => {
    tapFeedback();
    router.replace({ pathname: "/move/session", params: { mode: "demo" } });
  };

  return (
    <Screen>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="close" size={24} color={colors.textDim} />
        </Pressable>
        <Text style={styles.topTitle}>Move session</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.center}>
        <FadeSlideIn>
          <View style={styles.art}>
            <View style={styles.artHexA}>
              <Hexagon size={56} color="#E3F4EA" coreColor={palette.pulseGreen} />
            </View>
            <View style={styles.artHexB}>
              <Hexagon size={40} color="#E9EEF1" />
            </View>
            <View style={styles.artPinRing}>
              <Ionicons name="location" size={34} color={colors.primary} />
            </View>
          </View>
        </FadeSlideIn>

        <FadeSlideIn delay={STAGGER_MS}>
          <Text style={styles.title}>Draw your route{"\n"}as you move</Text>
          <Text style={styles.body}>
            MovenRun uses location during a movement session to draw your route
            and calculate progress.
          </Text>
        </FadeSlideIn>

        <FadeSlideIn delay={STAGGER_MS * 2}>
          <View style={styles.facts}>
            <Fact icon="walk-outline" text="Only while a session is running" />
            <Fact icon="phone-portrait-outline" text="Foreground only — no background tracking" />
            <Fact icon="shield-checkmark-outline" text="Stays on your device. Nothing is uploaded" />
          </View>
        </FadeSlideIn>

        {denied ? (
          <View style={styles.deniedNote}>
            <Ionicons name="information-circle" size={16} color={palette.heatCoral} />
            <Text style={styles.deniedText}>
              Location is off. You can enable it in system settings, or try the
              demo route below.
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.footer}>
        <Button
          label={denied ? "Try again" : "Allow Location"}
          icon="navigate"
          onPress={allow}
          loading={requesting}
        />
        <Button label="Not now — try a demo route" variant="ghost" onPress={demo} />
      </View>
    </Screen>
  );
}

function Fact({ icon, text }: { icon: IoniconName; text: string }) {
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={16} color={palette.pulseGreen} />
      <Text style={styles.factText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: spacing.md,
  },
  backBtn: { padding: spacing.xs },
  topTitle: { ...type.heading, fontSize: 16 },
  center: { flex: 1, justifyContent: "center", gap: spacing.xl },
  art: { height: 150, alignItems: "center", justifyContent: "center" },
  artHexA: { position: "absolute", left: "18%", top: 8 },
  artHexB: { position: "absolute", right: "20%", bottom: 4 },
  artPinRing: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.float,
  },
  title: { ...type.display, fontSize: 28, textAlign: "center", marginBottom: spacing.md },
  body: { ...type.body, textAlign: "center", paddingHorizontal: spacing.lg },
  facts: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  fact: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  factText: { ...type.caption, fontSize: 13.5, color: colors.text, flex: 1 },
  deniedNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: `${palette.heatCoral}12`,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  deniedText: { ...type.caption, fontSize: 12.5, color: colors.text, flex: 1 },
  footer: { paddingVertical: spacing.md, gap: spacing.xs },
});
