import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, shadows, spacing } from "@/theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        // Floating glass-style bar: white, rounded, soft shadow, no top border.
        tabBarStyle: {
          position: "absolute",
          left: spacing.lg,
          right: spacing.lg,
          bottom: spacing.md,
          height: 62,
          paddingTop: 6,
          paddingBottom: 8,
          borderRadius: radius.xl,
          borderTopWidth: 0,
          backgroundColor: colors.surface,
          ...shadows.float,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Today",
          tabBarIcon: ({ color, size }: { color: string; size: number }) => (
            <Ionicons name="map-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, size }: { color: string; size: number }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
