import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Stack, useRootNavigationState, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { colors, palette, spacing, type } from "@/theme";
import { Hexagon } from "@/components/Hexagon";
import { useGameStore } from "@/store/useGameStore";

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
 * Sends first-time users to onboarding once persisted state has hydrated and the
 * navigator is mounted. Returns whether we're still deciding, so the layout can
 * keep the splash up and avoid flashing the home screen.
 */
function useStartupRedirect(): boolean {
  const router = useRouter();
  const navState = useRootNavigationState();
  const hydrated = useGameStore((s) => s._hydrated);
  const hasSeenOpeningIntro = useGameStore((s) => s.hasSeenOpeningIntro);
  const hasOnboarded = useGameStore((s) => s.hasOnboarded);

  const ready = Boolean(navState?.key) && hydrated;

  useEffect(() => {
    if (!ready) return;
    // Cinematic opening intro first, then quest onboarding, then the app.
    if (!hasSeenOpeningIntro) router.replace("/opening");
    else if (!hasOnboarded) router.replace("/onboarding");
  }, [ready, hasSeenOpeningIntro, hasOnboarded, router]);

  return !ready;
}

function RootNavigator() {
  const deciding = useStartupRedirect();

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
        <Stack.Screen name="opening" options={{ animation: "fade" }} />
        <Stack.Screen name="onboarding" options={{ animation: "fade" }} />
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
        <Stack.Screen name="active" options={{ gestureEnabled: false }} />
        <Stack.Screen
          name="result"
          options={{ gestureEnabled: false, animation: "fade" }}
        />
      </Stack>
      {deciding ? (
        <View style={StyleSheet.absoluteFill}>
          <SplashView />
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
});
