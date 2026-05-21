import React, { useRef } from "react";
import { TouchableOpacity, StyleSheet, Animated, View } from "react-native";
import { BlurView } from "expo-blur";
import { COLORS } from "../../constants/colors";

interface Props {
  onPress: () => void;
  visible: boolean;
}

export function RecenterButton({ onPress, visible }: Props) {
  const opacity = useRef(new Animated.Value(visible ? 1 : 0)).current;

  React.useEffect(() => {
    Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [visible, opacity]);

  return (
    <Animated.View style={[styles.wrapper, { opacity }]} pointerEvents={visible ? "auto" : "none"}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={styles.button}>
        <BlurView intensity={40} tint="dark" style={styles.blur}>
          <View style={styles.icon}>
            <View style={[styles.crossH, { backgroundColor: COLORS.frost }]} />
            <View style={[styles.crossV, { backgroundColor: COLORS.frost }]} />
            <View style={[styles.ring, { borderColor: COLORS.frost }]} />
            <View style={[styles.dot, { backgroundColor: COLORS.signal }]} />
          </View>
        </BlurView>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    bottom: 200,
    right: 20,
  },
  button: {
    borderRadius: 28,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: `${COLORS.slateHi}cc`,
    shadowColor: COLORS.signal,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  blur: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  icon: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  crossH: { position: "absolute", width: 14, height: 1.5, borderRadius: 1, opacity: 0.7 },
  crossV: { position: "absolute", width: 1.5, height: 14, borderRadius: 1, opacity: 0.7 },
  ring: {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    opacity: 0.6,
  },
  dot: { width: 4, height: 4, borderRadius: 2 },
});
