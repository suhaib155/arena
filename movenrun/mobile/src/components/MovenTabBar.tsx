import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { colors, glow, radius, shadows, spacing, type } from "@/theme";
import type { IoniconName } from "@/types";
import { ScalePress } from "./ScalePress";
import { tapFeedback } from "@/lib/haptics";

/**
 * Five-destination floating bottom navigation: Home · Territory · Move · Clubs
 * · Profile, with Move as the elevated primary center action.
 *
 * Home / Clubs / Profile are real tab screens (their routes and deep links are
 * unchanged). Territory and Move are push destinations to the existing
 * `/territory/map` and `/move` routes — so nothing was relocated and every
 * existing route keeps working. Active state tracks the three tab screens; the
 * push destinations never claim the active state.
 */

/** Tab-screen route names, in navigator order. */
type TabName = "index" | "clubs" | "profile";

export function MovenTabBar({ state, navigation }: BottomTabBarProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const activeName = state.routes[state.index]?.name as TabName | undefined;

  const goTab = (name: TabName) => {
    tapFeedback();
    const target = state.routes.find((r) => r.name === name);
    const isFocused = activeName === name;
    const event = navigation.emit({
      type: "tabPress",
      target: target?.key ?? name,
      canPreventDefault: true,
    });
    if (!isFocused && !event.defaultPrevented) {
      navigation.navigate(name);
    }
  };

  const push = (path: "/territory/map" | "/move") => {
    tapFeedback();
    router.push(path);
  };

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}
    >
      <View style={styles.bar}>
        <TabButton
          label="Home"
          icon={activeName === "index" ? "home" : "home-outline"}
          active={activeName === "index"}
          onPress={() => goTab("index")}
        />
        <TabButton
          label="Territory"
          icon="map-outline"
          active={false}
          onPress={() => push("/territory/map")}
        />

        <MoveButton onPress={() => push("/move")} />

        <TabButton
          label="Clubs"
          icon={activeName === "clubs" ? "people" : "people-outline"}
          active={activeName === "clubs"}
          onPress={() => goTab("clubs")}
        />
        <TabButton
          label="Profile"
          icon={activeName === "profile" ? "person" : "person-outline"}
          active={activeName === "profile"}
          onPress={() => goTab("profile")}
        />
      </View>
    </View>
  );
}

function TabButton({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: IoniconName;
  active: boolean;
  onPress: () => void;
}) {
  const color = active ? colors.primary : colors.textFaint;
  return (
    <ScalePress
      to={0.9}
      onPress={onPress}
      style={styles.tab}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={22} color={color} />
      <Text style={[styles.tabLabel, { color, fontWeight: active ? "700" : "600" }]}>{label}</Text>
    </ScalePress>
  );
}

function MoveButton({ onPress }: { onPress: () => void }) {
  return (
    <View style={styles.moveSlot}>
      <ScalePress
        to={0.92}
        onPress={onPress}
        style={styles.moveButton}
        accessibilityRole="button"
        accessibilityLabel="Move — start a movement session"
      >
        <Ionicons name="play" size={26} color={colors.surface} />
      </ScalePress>
      <Text style={styles.moveLabel}>Move</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    backgroundColor: "transparent",
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 64,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    ...shadows.float,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingVertical: spacing.sm,
  },
  tabLabel: { ...type.caption, fontSize: 10.5 },
  moveSlot: { width: 72, alignItems: "center", justifyContent: "center" },
  moveButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    marginTop: -22,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: colors.bg,
    ...glow(colors.primary),
  },
  moveLabel: {
    ...type.caption,
    fontSize: 10.5,
    fontWeight: "700",
    color: colors.primary,
    marginTop: 2,
  },
});
