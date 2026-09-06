import { useCallback, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Button } from "@/components/Button";
import { GroundPanel } from "@/components/GroundPanel";
import { ReadinessChip } from "@/components/ReadinessChip";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { colors, hairline, iconTile, palette, radius, shadows, softTint, spacing, type } from "@/theme";
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
    if (!__DEV__) return;
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
      <ScreenHeader
        title="Start Move"
        action="dismiss"
        trailing={
          <ReadinessChip
            icon={readiness.icon as IoniconName}
            label={readinessChipLabel(readiness.kind)}
            tone={readiness.tone}
          />
        }
      />

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

        {/* What a move is for.
            This slot used to hold a hand-drawn map: two grey roads, a green hex
            and a location pin, none of it anywhere. It read as a preview of the
            ground you were about to cover, on the one screen where the app has
            no location yet — a decorative surface impersonating the real map
            two taps away. The screen now says what the session actually does
            instead, which is both honest and the more useful thing to read
            while you are lacing your shoes. */}
        <FadeSlideIn delay={STAGGER_MS}>
          <GroundPanel
            icon="git-branch-outline"
            kicker="What a move does"
            title="Walk it, close the loop, hold the ground."
            detail="Distance and time are recorded as you move. Cross your own trail, or finish near where you started, and the route seals — that is what makes ground claimable."
            tone="info"
          />
        </FadeSlideIn>

        {/* Readiness — honest state, what it means, what to do */}
        <FadeSlideIn delay={STAGGER_MS * 2}>
          <View style={[styles.readyCard, { borderColor: hairline(toneColor) }]}>
            <View style={styles.readyHead}>
              <View style={[styles.readyIcon, { backgroundColor: softTint(toneColor) }]}>
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
            <Fact
              icon="shield-checkmark-outline"
              text="Signed in, saving sends the route to verify it"
            />
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
        {__DEV__ && readiness.offerDemo ? (
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
  activityIcon: { ...iconTile(44), backgroundColor: colors.primaryDim },
  activityBody: { flex: 1, gap: 2 },
  activityName: { ...type.heading, fontSize: 16 },
  activitySub: { ...type.caption, fontSize: 12, color: colors.textDim },
  readyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
  readyHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  readyIcon: { ...iconTile(40) },
  readyTitle: { ...type.heading, fontSize: 16, flex: 1 },
  readyMsg: { ...type.body, fontSize: 13.5, lineHeight: 19 },
  offlineNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
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
