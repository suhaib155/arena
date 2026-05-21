import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
} from "react-native";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "../store/index";
import { COLORS } from "../constants/colors";

interface Props {
  hasActiveBattleAlert: boolean;
}

export function TopBar({ hasActiveBattleAlert }: Props) {
  const insets = useSafeAreaInsets();
  const moveBalance = useStore((s) => s.moveBalance);
  const walletAddress = useStore((s) => s.walletAddress);
  const cityName = useStore((s) => s.cityName);

  const displayedBalance = useRef(0);
  const countAnim = useRef(new Animated.Value(0)).current;
  const bellPulse = useRef(new Animated.Value(1)).current;
  const balanceScaleAnim = useRef(new Animated.Value(1)).current;
  const [renderedBalance, setRenderedBalance] = React.useState("0.00");

  const targetBalance = Number(moveBalance) / 1e18;

  useEffect(() => {
    if (targetBalance === displayedBalance.current) return;

    Animated.sequence([
      Animated.timing(balanceScaleAnim, { toValue: 1.15, duration: 150, useNativeDriver: true }),
      Animated.timing(balanceScaleAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
    ]).start();

    const start = displayedBalance.current;
    const end = targetBalance;
    const duration = 800;
    const startTime = Date.now();

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = start + (end - start) * eased;
      displayedBalance.current = current;
      setRenderedBalance(current.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
      if (t < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [targetBalance, balanceScaleAnim]);

  useEffect(() => {
    if (!hasActiveBattleAlert) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bellPulse, { toValue: 1.3, duration: 400, useNativeDriver: true }),
        Animated.timing(bellPulse, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [hasActiveBattleAlert, bellPulse]);

  const avatarLetter = walletAddress ? walletAddress.slice(2, 4).toUpperCase() : "??";
  const displayCity = cityName || "Unknown City";

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <BlurView intensity={40} tint="dark" style={styles.blur}>
        <View style={styles.inner}>
          <View style={styles.left}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{avatarLetter}</Text>
            </View>
            <Text style={styles.cityName} numberOfLines={1}>{displayCity}</Text>
          </View>

          <Animated.View style={[styles.center, { transform: [{ scale: balanceScaleAnim }] }]}>
            <View style={[styles.coinIcon, { backgroundColor: COLORS.gold }]}>
              <Text style={styles.coinM}>M</Text>
            </View>
            <Text style={styles.balance}>{renderedBalance}</Text>
          </Animated.View>

          <View style={styles.right}>
            <Animated.View style={{ transform: [{ scale: bellPulse }] }}>
              <TouchableOpacity style={styles.bell} activeOpacity={0.7}>
                <Text style={styles.bellIcon}>⌖</Text>
                {hasActiveBattleAlert && <View style={styles.bellDot} />}
              </TouchableOpacity>
            </Animated.View>
          </View>
        </View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
  },
  blur: {
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: `${COLORS.slateHi}b0`,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  left: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: COLORS.slateHi,
    borderWidth: 2,
    borderColor: COLORS.signal,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: COLORS.signal,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  cityName: {
    color: COLORS.mist,
    fontSize: 11,
    fontFamily: "monospace",
    letterSpacing: 0.5,
    maxWidth: 90,
  },
  center: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  coinIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  coinM: {
    color: "#000",
    fontSize: 10,
    fontWeight: "900",
  },
  balance: {
    color: COLORS.gold,
    fontSize: 17,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    letterSpacing: 0.3,
  },
  right: {
    flex: 1,
    alignItems: "flex-end",
  },
  bell: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: `${COLORS.slateHi}80`,
    alignItems: "center",
    justifyContent: "center",
  },
  bellIcon: {
    fontSize: 18,
    color: COLORS.mist,
  },
  bellDot: {
    position: "absolute",
    top: 5,
    right: 5,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.ember,
    borderWidth: 1.5,
    borderColor: COLORS.abyss,
  },
});
