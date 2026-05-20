import React, { useEffect, useRef } from "react";
import { Animated, Text, StyleSheet, View } from "react-native";
import { useStore } from "../store/index.js";

export function TokenBalance() {
  const moveBalance = useStore((s) => s.moveBalance);
  const animatedValue = useRef(new Animated.Value(0)).current;
  const prevBalance = useRef(0n);

  useEffect(() => {
    if (moveBalance !== prevBalance.current) {
      // Flash animation when balance changes
      Animated.sequence([
        Animated.timing(animatedValue, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(animatedValue, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start();
      prevBalance.current = moveBalance;
    }
  }, [moveBalance, animatedValue]);

  const glowOpacity = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.6],
  });

  const formatted = (Number(moveBalance) / 1e18).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.glow, { opacity: glowOpacity }]} />
      <Text style={styles.label}>$MOVE</Text>
      <Text style={styles.balance}>{formatted}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(0,0,0,0.85)",
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: "#00ff8840",
    overflow: "hidden",
  },
  glow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#00ff88",
    borderRadius: 20,
  },
  label: { color: "#00ff88", fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1.5 },
  balance: { color: "#fff", fontSize: 22, fontWeight: "700", fontVariant: ["tabular-nums"] },
});
