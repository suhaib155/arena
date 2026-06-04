import { ReactNode } from "react";
import { StyleSheet, View, ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing } from "@/theme";

interface ScreenProps {
  children: ReactNode;
  /** Apply top safe-area padding (screens without a header want this). */
  edgeTop?: boolean;
  style?: ViewStyle;
}

/** Full-bleed dark background with safe-area handling. */
export function Screen({ children, edgeTop = true, style }: ScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.root,
        { paddingTop: edgeTop ? insets.top : 0, paddingBottom: insets.bottom },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
  },
});
