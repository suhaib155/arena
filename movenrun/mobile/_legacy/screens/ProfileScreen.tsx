import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { useChain } from "../hooks/useChain.js";
import { useToken } from "../hooks/useToken.js";
import { useStore } from "../store/index.js";
import { TokenBalance } from "../components/TokenBalance.js";

export default function ProfileScreen() {
  const { authenticated, walletAddress, login, logout } = useChain();
  const { moveBalance, dailyCapRemaining } = useToken();
  const ownedZoneIds = useStore((s) => s.ownedZoneIds);

  if (!authenticated) {
    return (
      <View style={styles.center}>
        <Text style={styles.heading}>Connect Wallet</Text>
        <TouchableOpacity style={styles.btn} onPress={login}>
          <Text style={styles.btnText}>Sign In with Privy</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Profile</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Wallet</Text>
        <Text style={styles.mono}>{walletAddress}</Text>
      </View>

      <TokenBalance />

      <View style={styles.card}>
        <Text style={styles.label}>Daily Cap Remaining</Text>
        <Text style={styles.value}>{dailyCapRemaining ?? "—"} $MOVE</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Owned Zones ({ownedZoneIds.length})</Text>
        {ownedZoneIds.length === 0
          ? <Text style={styles.dim}>No zones yet. Become the top mover in a hex!</Text>
          : ownedZoneIds.map((id) => (
              <Text key={id} style={styles.mono}>{id}</Text>
            ))}
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
        <Text style={styles.logoutText}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0d0d0d" },
  content: { padding: 20, gap: 16 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0d0d0d", gap: 20 },
  heading: { color: "#fff", fontSize: 28, fontWeight: "700" },
  card: { backgroundColor: "#1a1a1a", borderRadius: 12, padding: 16, gap: 8 },
  label: { color: "#888", fontSize: 12, textTransform: "uppercase" },
  value: { color: "#fff", fontSize: 20, fontWeight: "700" },
  mono: { color: "#aaa", fontFamily: "monospace", fontSize: 12 },
  dim: { color: "#555", fontSize: 14 },
  btn: { backgroundColor: "#00ff88", paddingHorizontal: 32, paddingVertical: 16, borderRadius: 32 },
  btnText: { color: "#000", fontWeight: "700", fontSize: 16 },
  logoutBtn: { borderWidth: 1, borderColor: "#333", borderRadius: 12, padding: 16, alignItems: "center" },
  logoutText: { color: "#888", fontSize: 15 },
});
