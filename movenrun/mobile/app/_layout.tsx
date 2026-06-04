import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { colors } from "@/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: "slide_from_right",
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="quest/[id]" />
        <Stack.Screen name="active" options={{ gestureEnabled: false }} />
        <Stack.Screen
          name="result"
          options={{ gestureEnabled: false, animation: "fade" }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}
