import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Stack, useRootNavigationState, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { colors, spacing } from "@/theme";
import { useGameStore } from "@/store/useGameStore";

/** Branded loading view shown until persisted state has hydrated. */
function SplashView() {
  return (
    <View style={styles.splash}>
      <Ionicons name="flame" size={48} color={colors.accent} />
      <Text style={styles.splashText}>MovenRun</Text>
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
  const hasOnboarded = useGameStore((s) => s.hasOnboarded);

  const ready = Boolean(navState?.key) && hydrated;

  useEffect(() => {
    if (!ready) return;
    if (!hasOnboarded) router.replace("/onboarding");
  }, [ready, hasOnboarded, router]);

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
        <Stack.Screen name="onboarding" options={{ animation: "fade" }} />
        <Stack.Screen name="quest/[id]" />
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
      <StatusBar style="light" />
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
  splashText: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 1,
  },
});
