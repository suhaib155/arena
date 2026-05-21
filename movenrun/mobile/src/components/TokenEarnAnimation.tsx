import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  Share,
  Modal,
  ScrollView,
} from "react-native";
import { useStore } from "../store/index.js";

interface Props {
  visible: boolean;
  onClose: () => void;
}

function useCountUp(target: number, duration: number = 1800) {
  const [current, setCurrent] = useState(0);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!target) return;
    setCurrent(0);
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    const listener = anim.addListener(({ value }) => {
      setCurrent(Math.floor(value * target * 100) / 100);
    });
    return () => anim.removeListener(listener);
  }, [target, duration]);

  return current;
}

function HexCapturedBadge({ hexId, type }: { hexId: string; type: "captured" | "contributed" }) {
  const color = type === "captured" ? "#ffe000" : "#00ff88";
  return (
    <View style={[hexBadgeStyles.badge, { borderColor: color + "60", backgroundColor: color + "15" }]}>
      <Text style={[hexBadgeStyles.icon, { color }]}>{type === "captured" ? "⬡" : "⬡"}</Text>
      <View>
        <Text style={[hexBadgeStyles.type, { color }]}>{type === "captured" ? "CAPTURED" : "CONTRIBUTED"}</Text>
        <Text style={hexBadgeStyles.id}>{hexId.slice(-6)}</Text>
      </View>
    </View>
  );
}

const hexBadgeStyles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  icon: { fontSize: 20 },
  type: { fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  id: { color: "#aaa", fontFamily: "monospace", fontSize: 11 },
});

function StarBurst({ active }: { active: boolean }) {
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) return;
    Animated.sequence([
      Animated.parallel([
        Animated.timing(scale, { toValue: 1.4, duration: 500, easing: Easing.out(Easing.back(1.5)), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.6, duration: 200, useNativeDriver: true }),
      ]),
      Animated.timing(opacity, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();
  }, [active]);

  return (
    <Animated.View
      style={[
        starStyles.burst,
        { transform: [{ scale }], opacity },
      ]}
    />
  );
}

const starStyles = StyleSheet.create({
  burst: {
    position: "absolute",
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: "#00ff88",
    alignSelf: "center",
  },
});

export function TokenEarnAnimation({ visible, onClose }: Props) {
  const lastRunResult = useStore((s) => s.lastRunResult);
  const resetRun = useStore((s) => s.resetRun);

  const total = lastRunResult ? Number(lastRunResult.totalEarned) / 1e18 : 0;
  const base = lastRunResult ? Number(lastRunResult.baseEarn) / 1e18 : 0;
  const gear = lastRunResult ? Number(lastRunResult.gearBonus) / 1e18 : 0;
  const zoneTax = lastRunResult ? Number(lastRunResult.zoneTaxEarned) / 1e18 : 0;

  const displayTotal = useCountUp(total, 1600);

  const slideUp = useRef(new Animated.Value(60)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      slideUp.setValue(60);
      fadeIn.setValue(0);
      return;
    }
    Animated.parallel([
      Animated.timing(slideUp, { toValue: 0, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(fadeIn, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
  }, [visible]);

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Just earned ${total.toFixed(2)} $MOVE on MovenRun! ${lastRunResult?.distanceKm.toFixed(2)} km covered. Run to earn on Base chain.`,
        title: "MovenRun Earn",
      });
    } catch (e) {
      console.error("Share error:", e);
    }
  };

  const handleClose = () => {
    resetRun();
    onClose();
  };

  if (!lastRunResult) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <StarBurst active={visible} />

        <Animated.View
          style={[styles.container, { transform: [{ translateY: slideUp }], opacity: fadeIn }]}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            {/* Title */}
            <Text style={styles.label}>YOU EARNED</Text>

            {/* Animated counter */}
            <View style={styles.counterWrap}>
              <Text style={styles.counter}>{displayTotal.toFixed(2)}</Text>
              <Text style={styles.symbol}>$MOVE</Text>
            </View>

            {/* Breakdown */}
            <View style={styles.breakdownCard}>
              <Text style={styles.breakdownTitle}>Breakdown</Text>

              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>Base earn</Text>
                <Text style={styles.breakdownVal}>+{base.toFixed(2)}</Text>
              </View>

              {gear > 0 && (
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Gear bonus</Text>
                  <Text style={[styles.breakdownVal, { color: "#ffe000" }]}>+{gear.toFixed(2)}</Text>
                </View>
              )}

              {zoneTax > 0 && (
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Zone tax earned</Text>
                  <Text style={[styles.breakdownVal, { color: "#00aaff" }]}>+{zoneTax.toFixed(2)}</Text>
                </View>
              )}

              <View style={[styles.breakdownRow, styles.totalRow]}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalVal}>{total.toFixed(2)} $MOVE</Text>
              </View>
            </View>

            {/* Distance */}
            <View style={styles.distanceRow}>
              <Text style={styles.distanceVal}>{lastRunResult.distanceKm.toFixed(2)} km</Text>
              <Text style={styles.distanceLabel}>covered this run</Text>
            </View>

            {/* Hex activity */}
            {(lastRunResult.hexesCaptured.length > 0 || lastRunResult.hexesContributed.length > 0) && (
              <View style={styles.hexSection}>
                <Text style={styles.hexSectionTitle}>Zone Activity</Text>
                <View style={styles.hexGrid}>
                  {lastRunResult.hexesCaptured.map((h) => (
                    <HexCapturedBadge key={h} hexId={h} type="captured" />
                  ))}
                  {lastRunResult.hexesContributed.map((h) => (
                    <HexCapturedBadge key={h} hexId={h} type="contributed" />
                  ))}
                </View>
              </View>
            )}

            {/* Actions */}
            <TouchableOpacity style={styles.shareBtn} onPress={handleShare}>
              <Text style={styles.shareBtnText}>Share My Run</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
              <Text style={styles.closeBtnText}>Done</Text>
            </TouchableOpacity>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "#000000ee",
    justifyContent: "flex-end",
    alignItems: "center",
  },
  container: {
    width: "100%",
    backgroundColor: "#0f0f0f",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "92%",
  },
  content: {
    padding: 28,
    alignItems: "center",
    gap: 20,
  },
  label: {
    color: "#00ff88",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 3,
    textTransform: "uppercase",
  },
  counterWrap: { alignItems: "center" },
  counter: {
    color: "#fff",
    fontSize: 72,
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
    lineHeight: 80,
  },
  symbol: { color: "#00ff88", fontSize: 22, fontWeight: "800", marginTop: 4 },
  breakdownCard: {
    alignSelf: "stretch",
    backgroundColor: "#1a1a1a",
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  breakdownTitle: { color: "#555", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  breakdownRow: { flexDirection: "row", justifyContent: "space-between" },
  breakdownLabel: { color: "#888", fontSize: 14 },
  breakdownVal: { color: "#00ff88", fontSize: 14, fontWeight: "700" },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: "#2a2a2a",
    paddingTop: 10,
    marginTop: 4,
  },
  totalLabel: { color: "#fff", fontSize: 15, fontWeight: "700" },
  totalVal: { color: "#00ff88", fontSize: 18, fontWeight: "800" },
  distanceRow: { alignItems: "center" },
  distanceVal: { color: "#fff", fontSize: 36, fontWeight: "800" },
  distanceLabel: { color: "#666", fontSize: 14, marginTop: 2 },
  hexSection: { alignSelf: "stretch", gap: 10 },
  hexSectionTitle: { color: "#555", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 },
  hexGrid: { gap: 8 },
  shareBtn: {
    alignSelf: "stretch",
    backgroundColor: "#00ff88",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
  },
  shareBtnText: { color: "#000", fontWeight: "800", fontSize: 16 },
  closeBtn: {
    alignSelf: "stretch",
    backgroundColor: "#1a1a1a",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
  },
  closeBtnText: { color: "#888", fontWeight: "600", fontSize: 15 },
});
