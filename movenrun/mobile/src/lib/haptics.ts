import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

/**
 * Thin, crash-safe wrappers around expo-haptics. Haptics aren't available on
 * web and can throw on some devices, so every call is guarded.
 */
export function tapFeedback(): void {
  if (Platform.OS === "web") return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function successFeedback(): void {
  if (Platform.OS === "web") return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}
