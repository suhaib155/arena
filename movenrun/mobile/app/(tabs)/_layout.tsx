import { Tabs } from "expo-router";
import { MovenTabBar } from "@/components/MovenTabBar";

/**
 * Tab shell. The three stateful destinations (Home, Clubs, Profile) are real
 * tab screens; Territory and the primary Move action live in the custom
 * {@link MovenTabBar} as push destinations to their existing routes, so the
 * five-slot bar never relocates a screen or breaks a deep link.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <MovenTabBar {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="clubs" options={{ title: "Clubs" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
