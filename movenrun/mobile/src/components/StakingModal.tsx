import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { useStore, StakingPosition } from "../store/index.js";

type LockDays = 90 | 180 | 365;

interface Option {
  days: LockDays;
  label: string;
  multiplier: number;
  zonePerMove: string;
  color: string;
}

const OPTIONS: Option[] = [
  { days: 90, label: "3 Months", multiplier: 1, zonePerMove: "1x", color: "#6060ff" },
  { days: 180, label: "6 Months", multiplier: 1.8, zonePerMove: "1.8x", color: "#00aaff" },
  { days: 365, label: "12 Months", multiplier: 3, zonePerMove: "3x", color: "#00ff88" },
];

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function StakingModal({ visible, onClose }: Props) {
  const moveBalance = useStore((s) => s.moveBalance);
  const stakingPosition = useStore((s) => s.stakingPosition);
  const setStakingPosition = useStore((s) => s.setStakingPosition);

  const [selected, setSelected] = useState<LockDays>(180);
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const moveBalanceFmt = (Number(moveBalance) / 1e18).toFixed(2);
  const amountNum = parseFloat(amount) || 0;
  const selectedOption = OPTIONS.find((o) => o.days === selected)!;
  const projectedZone = (amountNum * selectedOption.multiplier).toFixed(2);

  const unlockDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + selected);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };

  const handleStake = async () => {
    if (amountNum <= 0) {
      setError("Enter an amount to stake");
      return;
    }
    const amountWei = BigInt(Math.floor(amountNum * 1e18));
    if (amountWei > moveBalance) {
      setError("Insufficient $MOVE balance");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      // TODO: call MoveVault.stake(amountWei, lockDays) via ethers
      await new Promise((r) => setTimeout(r, 1200));
      const unlockTs = Math.floor(Date.now() / 1000) + selected * 86400;
      const position: StakingPosition = {
        stakedAmount: amountWei,
        unlockDate: unlockTs,
        earnedZone: 0n,
        lockDays: selected,
      };
      setStakingPosition(position);
      setAmount("");
      onClose();
    } catch (e: any) {
      setError(e.message ?? "Transaction failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={modalStyles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={modalStyles.backdrop}>
          <View style={modalStyles.sheet}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={modalStyles.title}>Stake $MOVE</Text>
              <Text style={modalStyles.sub}>Lock $MOVE to earn $ZONE governance tokens</Text>

              {stakingPosition && (
                <View style={modalStyles.existingBanner}>
                  <Text style={modalStyles.existingLabel}>Active Position</Text>
                  <Text style={modalStyles.existingVal}>
                    {(Number(stakingPosition.stakedAmount) / 1e18).toFixed(2)} $MOVE staked ·{" "}
                    {stakingPosition.lockDays}d lock
                  </Text>
                  <Text style={modalStyles.existingVal}>
                    Unlocks {new Date(stakingPosition.unlockDate * 1000).toLocaleDateString()}
                  </Text>
                  <Text style={modalStyles.existingEarned}>
                    +{(Number(stakingPosition.earnedZone) / 1e18).toFixed(4)} $ZONE earned
                  </Text>
                </View>
              )}

              {/* Lock period options */}
              <Text style={modalStyles.sectionLabel}>Lock Period</Text>
              <View style={modalStyles.optionsRow}>
                {OPTIONS.map((opt) => {
                  const active = selected === opt.days;
                  return (
                    <TouchableOpacity
                      key={opt.days}
                      style={[
                        modalStyles.optionCard,
                        { borderColor: active ? opt.color : "#2a2a2a" },
                        active && { backgroundColor: opt.color + "18" },
                      ]}
                      onPress={() => setSelected(opt.days)}
                    >
                      <Text style={[modalStyles.optionDays, active && { color: opt.color }]}>
                        {opt.days}d
                      </Text>
                      <Text style={modalStyles.optionLabel}>{opt.label}</Text>
                      <View style={[modalStyles.ratePill, { backgroundColor: opt.color + "22" }]}>
                        <Text style={[modalStyles.rateText, { color: opt.color }]}>
                          {opt.zonePerMove} $ZONE
                        </Text>
                      </View>
                      <Text style={modalStyles.optionSub}>per $MOVE</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Amount input */}
              <Text style={modalStyles.sectionLabel}>Amount</Text>
              <View style={modalStyles.inputRow}>
                <TextInput
                  style={modalStyles.input}
                  value={amount}
                  onChangeText={(t) => { setAmount(t); setError(null); }}
                  placeholder="0.00"
                  placeholderTextColor="#444"
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                />
                <TouchableOpacity
                  style={modalStyles.maxBtn}
                  onPress={() => setAmount(moveBalanceFmt)}
                >
                  <Text style={modalStyles.maxText}>MAX</Text>
                </TouchableOpacity>
              </View>
              <Text style={modalStyles.balanceHint}>Balance: {moveBalanceFmt} $MOVE</Text>

              {/* Summary */}
              {amountNum > 0 && (
                <View style={modalStyles.summary}>
                  <Row label="Lock period" value={`${selected} days`} />
                  <Row label="Unlock date" value={unlockDate()} />
                  <Row label="You stake" value={`${amountNum.toFixed(2)} $MOVE`} />
                  <Row
                    label="You earn"
                    value={`${projectedZone} $ZONE`}
                    highlight={selectedOption.color}
                  />
                </View>
              )}

              {error && <Text style={modalStyles.error}>{error}</Text>}

              <TouchableOpacity
                style={[
                  modalStyles.confirmBtn,
                  { backgroundColor: selectedOption.color },
                  loading && modalStyles.loading,
                ]}
                onPress={handleStake}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={modalStyles.confirmText}>Stake $MOVE</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity style={modalStyles.cancelBtn} onPress={onClose}>
                <Text style={modalStyles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Row({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: string;
}) {
  return (
    <View style={rowStyles.row}>
      <Text style={rowStyles.label}>{label}</Text>
      <Text style={[rowStyles.value, highlight ? { color: highlight } : null]}>{value}</Text>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  label: { color: "#888", fontSize: 13 },
  value: { color: "#fff", fontSize: 13, fontWeight: "600" },
});

const modalStyles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: "#00000088", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: "#141414",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: "90%",
  },
  title: { color: "#fff", fontSize: 22, fontWeight: "700" },
  sub: { color: "#666", fontSize: 14, marginTop: 4, marginBottom: 20 },
  existingBanner: {
    backgroundColor: "#00ff8812",
    borderWidth: 1,
    borderColor: "#00ff8840",
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    gap: 4,
  },
  existingLabel: { color: "#00ff88", fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  existingVal: { color: "#ccc", fontSize: 13 },
  existingEarned: { color: "#00ff88", fontSize: 14, fontWeight: "700", marginTop: 4 },
  sectionLabel: { color: "#555", fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10, marginTop: 4 },
  optionsRow: { flexDirection: "row", gap: 8, marginBottom: 20 },
  optionCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 12,
    alignItems: "center",
    gap: 6,
    backgroundColor: "#1a1a1a",
  },
  optionDays: { color: "#fff", fontSize: 20, fontWeight: "800" },
  optionLabel: { color: "#888", fontSize: 11 },
  ratePill: { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  rateText: { fontSize: 12, fontWeight: "700" },
  optionSub: { color: "#555", fontSize: 10 },
  inputRow: {
    flexDirection: "row",
    backgroundColor: "#1e1e1e",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#333",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  input: { flex: 1, color: "#fff", fontSize: 20, fontWeight: "600", paddingVertical: 14 },
  maxBtn: {
    backgroundColor: "#2a2a2a",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  maxText: { color: "#00ff88", fontSize: 12, fontWeight: "700" },
  balanceHint: { color: "#555", fontSize: 12, marginBottom: 16 },
  summary: {
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  error: { color: "#ff4444", fontSize: 13, marginBottom: 12, textAlign: "center" },
  confirmBtn: { borderRadius: 14, padding: 16, alignItems: "center", marginBottom: 10 },
  loading: { opacity: 0.7 },
  confirmText: { color: "#000", fontWeight: "800", fontSize: 16 },
  cancelBtn: { padding: 14, alignItems: "center" },
  cancelText: { color: "#555", fontSize: 15 },
});
