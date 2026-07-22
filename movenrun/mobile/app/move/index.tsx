import { useCallback, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { Hexagon } from "@/components/Hexagon";
import { ReadinessChip } from "@/components/ReadinessChip";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import {
  getForegroundPermissionStatus,
  hasLocationServices,
  requestForegroundPermission,
} from "@/services/moveTracker";
import { resolveReadiness, type PermissionStatus } from "@/lib/moveReadiness";
import type { ReadinessTone } from "@/components/ReadinessChip";
import type { IoniconName } from "@/types";
import { tapFeedback } from "@/lib/haptics";

const TONE_COLOR: Record<ReadinessTone, string> = {
  neutral: palette.silverTrail,
  ok: palette.pulseGreen,
  ready: palette.pulseGreen,
  warning: palette.moveGold,
  danger: palette.heatCoral,
};

/**
 * Pre-session readiness. Determines honest location state (permission +
 * services) and shows exactly what's wrong and what to do next — it never
 * claims "ready" unless permission is actually granted. The real permission
 * request and the demo fallback are unchanged; a demo route stays clearly
 * labelled and is never saved as progress.
 */
export default function MoveStartScreen() {
  const router = useRouter();
  const [permission, setPermission] = useState<PermissionStatus>("checking");
  const [servicesOn, setServicesOn] = useState(true);
  const [requesting, setRequesting] = useState(false);

  const refresh = useCallback(async () => {
    const [status, services] = await Promise.all([
      getForegroundPermissionStatus(),
      hasLocationServices(),
    ]);
    setPermission(status);
    setServicesOn(services);
  }, []);

  // Re-check whenever the screen regains focus (e.g. returning from Settings).
  useFocusEffect(
    useCallback(() => {
      setPermission("checking");
      void refresh();
    }, [refresh]),
  );

  const readiness = resolveReadiness({
    permission,
    locationServicesOn: servicesOn,
    blockedReason: null,
    online: true,
  });

  const startGps = useCallback(() => {
    tapFeedback();
    router.replace({ pathname: "/move/session", params: { mode: "gps" } });
  }, [router]);

  const requestPermission = useCallback(async () => {
    tapFeedback();
    setRequesting(true);
    const granted = await requestForegroundPermission();
    setRequesting(false);
    if (granted) {
      router.replace({ pathname: "/move/session", params: { mode: "gps" } });
    } else {
      await refresh();
    }
  }, [refresh, router]);

  const openSettings = useCallback(() => {
    tapFeedback();
    Linking.openSettings().catch(() => {});
  }, []);

  const demo = useCallback(() => {
    tapFeedback();
    router.replace({ pathname: "/move/session", params: { mode: "demo" } });
  }, [router]);

  const onPrimary = () => {
    switch (readiness.kind) {
      case "ready":
        return startGps();
      case "permission-required":
        return requestPermission();
      case "permission-denied":
      case "location-unavailable":
        return openSettings();
      default:
        return undefined;
    }
  };

  const toneColor = TONE_COLOR[readiness.tone];

  return (
    <Screen>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="close" size={24} color={colors.textDim} />
        </Pressable>
        <Text style={styles.topTitle}>Start Move</Text>
        <ReadinessChip
          icon={readiness.icon as IoniconName}
          label={readinessChipLabel(readiness.kind)}
          tone={readiness.tone}
        />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Activity context — one supported movement session (foreground GPS) */}
        <FadeSlideIn>
          <View style={styles.activityCard}>
            <View style={styles.activityIcon}>
              <Ionicons name="walk" size={22} color={colors.primary} />
            </View>
            <View style={styles.activityBody}>
              <Text style={styles.activityName}>Movement session</Text>
              <Text style={styles.activitySub}>
                Foreground GPS · walk, run, or ride — your route draws as you move
              </Text>
            </View>
          </View>
        </FadeSlideIn>

        {/* Map-style context panel */}
        <FadeSlideIn delay={STAGGER_MS}>
          <View style={styles.mapPanel}>
            <View style={[styles.road, { top: "30%" }]} />
            <View style={[styles.road, { top: "66%" }]} />
            <View style={[styles.roadV, { left: "32%" }]} />
            <View style={styles.mapHexA}>
              <Hexagon size={52} color="#E3F4EA" coreColor={palette.pulseGreen} />
            </View>
            <View style={styles.mapHexB}>
              <Hexagon size={38} color="#E9EEF1" />
            </View>
            <View style={styles.mapPin}>
              <Ionicons name="location" size={30} color={colors.primary} />
            </View>
          </View>
        </FadeSlideIn>

        {/* Readiness — honest state, what it means, what to do */}
        <FadeSlideIn delay={STAGGER_MS * 2}>
          <View style={[styles.readyCard, { borderColor: `${toneColor}33` }]}>
            <View style={styles.readyHead}>
              <View style={[styles.readyIcon, { backgroundColor: `${toneColor}16` }]}>
                <Ionicons name={readiness.icon as IoniconName} size={20} color={toneColor} />
              </View>
              <Text style={styles.readyTitle}>{readiness.title}</Text>
            </View>
            <Text style={styles.readyMsg}>{readiness.message}</Text>
            {readiness.offlineNote ? (
              <View style={styles.offlineNote}>
                <Ionicons name="cloud-offline-outline" size={14} color={colors.textFaint} />
                <Text style={styles.offlineText}>{readiness.offlineNote}</Text>
              </View>
            ) : null}
          </View>
        </FadeSlideIn>

        {/* Privacy facts — kept honest, compact */}
        <FadeSlideIn delay={STAGGER_MS * 3}>
          <View style={styles.facts}>
            <Fact icon="phone-portrait-outline" text="Foreground only — no background tracking" />
            <Fact icon="shield-checkmark-outline" text="Stays on your device. Nothing is uploaded" />
          </View>
        </FadeSlideIn>
      </ScrollView>

      {/* One bottom-anchored primary action */}
      <View style={styles.footer}>
        <Button
          label={readiness.primaryLabel}
          icon={
            readiness.canStartGps
              ? "play"
              : readiness.kind === "permission-required"
                ? "navigate"
                : undefined
          }
          onPress={onPrimary}
          loading={requesting || readiness.kind === "checking"}
          disabled={readiness.kind === "checking"}
        />
        {readiness.offerDemo ? (
          <Button label="Not now — try a demo route" variant="ghost" onPress={demo} />
        ) : null}
      </View>
    </Screen>
  );
}

function readinessChipLabel(kind: ReturnType<typeof resolveReadiness>["kind"]): string {
  switch (kind) {
    case "ready":
      return "Ready";
    case "checking":
      return "Checking…";
    case "permission-required":
      return "Allow needed";
    case "permission-denied":
      return "Location off";
    case "location-unavailable":
      return "Unavailable";
    default:
      return "Blocked";
  }
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
    gap: spacing.sm,
  },
  backBtn: { padding: spacing.xs },
  topTitle: { ...type.heading, fontSize: 16, flex: 1 },
  content: { paddingTop: spacing.lg, paddingBottom: spacing.lg, gap: spacing.lg },
  activityCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  activityIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primaryDim,
    alignItems: "center",
    justifyContent: "center",
  },
  activityBody: { flex: 1, gap: 2 },
  activityName: { ...type.heading, fontSize: 16 },
  activitySub: { ...type.caption, fontSize: 12, color: colors.textDim },
  mapPanel: {
    height: 160,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  road: { position: "absolute", left: 0, right: 0, height: 5, backgroundColor: "#E2E8EC" },
  roadV: { position: "absolute", top: 0, bottom: 0, width: 5, backgroundColor: "#E6EBEF" },
  mapHexA: { position: "absolute", left: "18%", top: 20 },
  mapHexB: { position: "absolute", right: "20%", bottom: 16 },
  mapPin: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.float,
  },
  readyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
  readyHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  readyIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  readyTitle: { ...type.heading, fontSize: 16, flex: 1 },
  readyMsg: { ...type.body, fontSize: 13.5, lineHeight: 19 },
  offlineNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  offlineText: { ...type.caption, fontSize: 11.5, color: colors.textDim, flex: 1 },
  facts: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  fact: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  factText: { ...type.caption, fontSize: 13, color: colors.text, flex: 1 },
  footer: { paddingVertical: spacing.md, gap: spacing.xs },
});
