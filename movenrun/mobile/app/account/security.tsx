/**
 * Account security screen — linked sign-in methods, session management (sign
 * out of this device, sign out everywhere), and the non-custodial security
 * posture stated plainly. No secret is ever shown here.
 */
import { useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { SectionHeader } from "@/components/SectionHeader";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useAuthStore } from "@/store/useAuthStore";

function providerLabel(provider: string): string {
  switch (provider) {
    case "email_otp":
      return "Email";
    case "google":
      return "Google";
    case "base_account":
      return "Base Account";
    default:
      return provider;
  }
}

export default function SecurityScreen() {
  const router = useRouter();
  const identities = useAuthStore((s) => s.identities);
  const status = useAuthStore((s) => s.status);
  const signOut = useAuthStore((s) => s.signOut);
  const signOutEverywhere = useAuthStore((s) => s.signOutEverywhere);
  const [busy, setBusy] = useState(false);

  const doSignOut = async () => {
    setBusy(true);
    await signOut();
    setBusy(false);
    router.replace("/account");
  };

  const doSignOutEverywhere = async () => {
    setBusy(true);
    await signOutEverywhere();
    setBusy(false);
    router.replace("/account");
  };

  const confirmSignOutEverywhere = () => {
    Alert.alert(
      "Sign out of all devices?",
      "This ends every active MovenRun session. You'll need to sign in again on each device.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Sign out everywhere", style: "destructive", onPress: doSignOutEverywhere },
      ]
    );
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.h1} accessibilityRole="header">
          Account security
        </Text>

        <SectionHeader title="Sign-in methods" />
        {status === "signedIn" && identities.length > 0 ? (
          identities.map((i) => (
            <View key={i.id} style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.method}>{providerLabel(i.provider)}</Text>
                <Badge label={i.verificationStatus === "verified" ? "Verified" : "Unverified"} color={colors.accent} />
              </View>
              <Text style={styles.caption}>Assurance level {i.assuranceLevel.toUpperCase()}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.caption}>Sign in to manage your login methods.</Text>
        )}

        <SectionHeader title="Sessions" />
        <Button label="Sign out of this device" icon="log-out-outline" variant="secondary" onPress={doSignOut} loading={busy} disabled={status !== "signedIn"} />
        <Button
          label="Sign out everywhere"
          icon="shield-outline"
          variant="ghost"
          onPress={confirmSignOutEverywhere}
          disabled={status !== "signedIn" || busy}
          style={styles.spaced}
        />

        <View style={[styles.card, styles.noteCard]}>
          <Text style={styles.noteTitle}>MovenRun is non-custodial</Text>
          <Text style={styles.caption}>
            You control your wallet. MovenRun never holds, stores, or asks for your recovery phrase or private
            keys, and support can never move your funds. Anyone asking for your recovery phrase is trying to
            scam you.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingVertical: spacing.lg, paddingBottom: spacing.xxl },
  h1: { ...type.title, fontSize: 26 },
  caption: { ...type.caption, color: colors.textDim },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.xs,
    ...shadows.card,
  },
  noteCard: { backgroundColor: palette.paleSky, marginTop: spacing.md },
  noteTitle: { ...type.heading, fontSize: 15 },
  method: { ...type.heading, fontSize: 15 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  spaced: { marginTop: spacing.sm },
});
