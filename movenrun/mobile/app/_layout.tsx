import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Stack, useRootNavigationState, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { colors, palette, radius, spacing, type } from "@/theme";
import { Hexagon } from "@/components/Hexagon";
import { Button } from "@/components/Button";
import { useAuthStore } from "@/store/useAuthStore";
import { useAppBootstrap } from "@/hooks/useAppBootstrap";
import { authErrorMessage } from "@/lib/emailAuth";
import { isDecidingStartup, type StartupRoute } from "@/lib/startupDecision";
import { installExpoSecureSessionStore } from "@/lib/secureSessionExpo";
import { installAsyncVerificationQueueStore } from "@/services/verificationQueueStorage";
import { useVerificationRetry } from "@/hooks/useVerificationRetry";

// Install the OS-keystore session store before anything can touch auth state.
// Until this runs, getSecureSessionStore() throws — there is no insecure
// fallback (see src/lib/secureSession.ts, ADR-0012).
installExpoSecureSessionStore();

// The retry queue's durable backing. Installed before any screen can queue a
// failed verification; without it the feature degrades to in-memory only rather
// than throwing (see services/verificationQueue.ts).
installAsyncVerificationQueueStore();

/** Branded loading view shown until persisted state has hydrated. */
function SplashView() {
  return (
    <View style={styles.splash}>
      <Hexagon size={44} color={palette.pulseGreen} coreColor={colors.surface} />
      <Text style={styles.splashText}>MovenRun</Text>
      <Text style={styles.splashLoop}>Move → Capture → Defend → Own</Text>
    </View>
  );
}

/**
 * Recoverable startup failure: a session is stored but the service could not be
 * reached. The user is NOT signed out and nothing is cleared — they retry, or
 * continue in the local beta. No raw error text, no token, no host name.
 */
function StartupErrorView({
  errorCode,
  onRetry,
  onLocalBeta,
}: {
  errorCode: string | null;
  onRetry: () => void;
  onLocalBeta: () => void;
}) {
  return (
    <View style={styles.splash}>
      <Hexagon size={40} color={palette.baseBlue} coreColor={colors.surface} />
      <Text style={styles.errorTitle} accessibilityRole="header">
        Can&apos;t reach MovenRun
      </Text>
      <Text style={styles.errorBody}>
        {authErrorMessage(errorCode) ?? "We couldn't reach MovenRun. Please try again."}
      </Text>
      <View style={styles.errorActions}>
        <Button label="Retry" icon="refresh-outline" onPress={onRetry} />
        <Button label="Explore local beta" variant="secondary" onPress={onLocalBeta} />
      </View>
    </View>
  );
}

/** The concrete route each startup destination maps to. The intro carries an
 *  explicit `source` so Skip/finish behave as first run, never as a replay. */
const STARTUP_HREF: Partial<Record<StartupRoute, "/welcome" | "/opening?source=first-run" | "/(tabs)">> = {
  account: "/welcome",
  intro: "/opening?source=first-run",
  app: "/(tabs)",
};

/**
 * Apply the bootstrap decision exactly once per destination.
 *
 * `replace` is issued only when the target actually changes, so a re-render (or
 * a store update while the same decision holds) can never stack navigations or
 * race a screen's own forward navigation.
 *
 * Returns whether a first-run destination is decided but not yet on screen, so
 * the caller can keep the branded cover up — the tab UI must never flash behind
 * account choice or the intro.
 */
function useStartupRouting(route: StartupRoute): boolean {
  const router = useRouter();
  const navState = useRootNavigationState();
  const navigatorReady = Boolean(navState?.key);
  const [applied, setApplied] = useState<StartupRoute | null>(null);

  useEffect(() => {
    if (!navigatorReady) return;
    if (route === "splash" || route === "service-error") return;
    if (applied === route) return;
    // "app" is the default route, so it needs no replace on a cold start; when
    // the app is *leaving* a first-run screen, that screen navigates itself.
    // Replacing here too would double-navigate.
    const href = STARTUP_HREF[route];
    if (href && href !== "/(tabs)") router.replace(href);
    setApplied(route);
  }, [navigatorReady, route, router, applied]);

  return (route === "account" || route === "intro") && applied !== route;
}

function RootNavigator() {
  const decision = useAppBootstrap();
  // Foreground-only, authenticated-only retry of queued verifications. Mounted
  // at the root because it belongs to the app lifecycle, not to a screen — but
  // it does nothing at all until an account is resolved.
  useVerificationRetry();
  const retryRestore = useAuthStore((s) => s.retryRestore);
  const acknowledgeRestoreError = useAuthStore((s) => s.acknowledgeRestoreError);
  const navigationPending = useStartupRouting(decision.route);

  const deciding = isDecidingStartup(decision) || navigationPending;

  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: "slide_from_right",
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="welcome" options={{ animation: "fade" }} />
        <Stack.Screen name="opening" options={{ animation: "fade" }} />
        <Stack.Screen name="onboarding" options={{ animation: "fade" }} />
        <Stack.Screen name="quests" />
        <Stack.Screen name="quest/[id]" />
        <Stack.Screen name="move/index" />
        <Stack.Screen name="move/session" options={{ gestureEnabled: false }} />
        <Stack.Screen
          name="move/summary"
          options={{ gestureEnabled: false, animation: "fade" }}
        />
        <Stack.Screen
          name="move/captured"
          options={{ gestureEnabled: false, animation: "fade" }}
        />
        <Stack.Screen name="zone/[id]" />
        <Stack.Screen name="network/status" />
        <Stack.Screen name="route/review-history" />
        <Stack.Screen name="route/passport" />
        <Stack.Screen name="route/proof" />
        <Stack.Screen name="questline" />
        <Stack.Screen name="territory/map" />
        <Stack.Screen name="territory/alerts" />
        <Stack.Screen name="collections" />
        <Stack.Screen name="weekly-recap" />
        <Stack.Screen name="season-objectives" />
        <Stack.Screen name="city-districts" />
        <Stack.Screen name="rivals" />
        <Stack.Screen name="city-war" />
        <Stack.Screen name="sponsor-zones" />
        <Stack.Screen name="event-zones" />
        <Stack.Screen name="club-territory" />
        <Stack.Screen name="crew-missions" />
        <Stack.Screen name="district-mastery" />
        <Stack.Screen name="deed-showroom" />
        <Stack.Screen name="account/index" />
        <Stack.Screen name="account/wallets" />
        <Stack.Screen name="account/security" />
        <Stack.Screen name="active" options={{ gestureEnabled: false }} />
        <Stack.Screen
          name="result"
          options={{ gestureEnabled: false, animation: "fade" }}
        />
      </Stack>
      {/* First-run and startup states cover the navigator completely, so the
          tab UI can never show through behind them. */}
      {deciding ? (
        <View style={StyleSheet.absoluteFill}>
          <SplashView />
        </View>
      ) : null}
      {decision.route === "service-error" ? (
        <View style={StyleSheet.absoluteFill}>
          <StartupErrorView
            errorCode={decision.errorCode}
            onRetry={() => {
              void retryRestore();
            }}
            onLocalBeta={acknowledgeRestoreError}
          />
        </View>
      ) : null}
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <RootNavigator />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
    gap: spacing.md,
  },
  splashText: { ...type.title, fontSize: 24 },
  splashLoop: { ...type.mono, fontSize: 12, color: colors.textFaint },
  errorTitle: { ...type.title, fontSize: 22, textAlign: "center" },
  errorBody: {
    ...type.body,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    color: colors.textDim,
    paddingHorizontal: spacing.xl,
  },
  errorActions: {
    alignSelf: "stretch",
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    gap: spacing.sm,
    borderRadius: radius.lg,
  },
});
