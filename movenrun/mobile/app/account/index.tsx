/**
 * Account hub — sign in, or see the state of an existing MovenRun account.
 *
 * Sign-in is the shared {@link SignInOptions} (Google or wallet); this screen
 * never re-implements it and never builds its own API client (the app-level
 * bootstrap constructs the single client into the auth store). When no backend
 * is configured it says so plainly instead of faking a login.
 *
 * Privacy rules enforced here: no internal user id, no raw session id, no
 * token, and no wallet address is rendered — the account summary describes
 * wallet *state* in words. Address-level detail lives on the dedicated wallet
 * screen, which the user opens deliberately.
 */
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { LegalLinks } from "@/components/LegalAcceptance";
import { SignInOptions } from "@/components/SignInOptions";
import { SectionHeader } from "@/components/SectionHeader";
import { Badge } from "@/components/Badge";
import { colors, radius, shadows, spacing, type } from "@/theme";
import { useAuthStore } from "@/store/useAuthStore";
import { useGameStore } from "@/store/useGameStore";
import { isBackendConfigured } from "@/services/identityApi";
import { authErrorMessage } from "@/lib/emailAuth";
import { isAuthBusy } from "@/lib/authLifecycle";
import { walletTypeLabel } from "@/lib/walletPresentation";
import { isFeatureInRelease } from "@/lib/releaseScope";
import { MovementApiClient } from "@/services/movementApi";
import { summarizeAccountHistory } from "@/lib/accountHistory";

export default function AccountScreen() {
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const operation = useAuthStore((s) => s.operation);
  const user = useAuthStore((s) => s.user);
  const wallets = useAuthStore((s) => s.wallets);
  const authErrorCode = useAuthStore((s) => s.authErrorCode);
  const restoreErrorCode = useAuthStore((s) => s.restoreErrorCode);
  const retryRestore = useAuthStore((s) => s.retryRestore);
  const markSignedIn = useGameStore((s) => s.markSignedIn);
  const client = useAuthStore((s) => s.client);
  const [historyLabel, setHistoryLabel] = useState<string | null>(null);

  const backendConfigured = isBackendConfigured();
  const busy = isAuthBusy(operation);
  const activeWallet = wallets.find((w) => w.isActive) ?? null;
  const walletsInRelease = isFeatureInRelease("wallets");

  /* Signing in later (from Account rather than first run) keeps local progress
     and records the confirmed mode. `markSignedIn` never demotes a user who has
     already finished first run. */
  useEffect(() => {
    if (status === "signedIn") markSignedIn();
  }, [status, markSignedIn]);

  /* What the account already holds on the server. Shown after a reinstall or
     on a new phone, where local XP starts over but verified sessions do not.
     A failed read shows nothing rather than a misleading zero. */
  useEffect(() => {
    if (status !== "signedIn" || !client) {
      setHistoryLabel(null);
      return;
    }
    let live = true;
    new MovementApiClient(client.transport)
      .list()
      .then((items) => { if (live) setHistoryLabel(summarizeAccountHistory(items).label); })
      .catch(() => { if (live) setHistoryLabel(null); });
    return () => { live = false; };
  }, [status, client]);

  if (status === "signedIn" && user) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.h1} accessibilityRole="header">
            Your MovenRun account
          </Text>

          <View style={styles.card}>
            <SectionHeader title="MovenRun identity" />
            <Text style={styles.body}>
              {walletsInRelease
                ? "You\u2019re signed in. This is your permanent MovenRun identity \u2014 your wallets and sign-in methods link to it, so switching wallets never moves your progress."
                : "You\u2019re signed in. Your verified movement sessions are saved to this account."}
            </Text>
            {historyLabel ? <Text style={styles.caption}>{historyLabel}</Text> : null}
          </View>

          {walletsInRelease ? <View style={styles.card}>
            <SectionHeader title="Active wallet" trailing="Base Sepolia · testnet" />
            {activeWallet ? (
              <>
                <Badge label={walletTypeLabel(activeWallet.walletType)} color={colors.primary} />
                <Text style={styles.caption}>
                  You control this wallet and MovenRun never holds its keys. Open Manage wallets to
                  see its address.
                </Text>
              </>
            ) : (
              <Text style={styles.caption}>
                Your wallet is being set up. Check the Wallets screen for status.
              </Text>
            )}
          </View> : null}

          {walletsInRelease ? <Button label="Manage wallets" icon="wallet-outline" onPress={() => router.push("/account/wallets")} /> : null}
          <Button
            label="Account security"
            icon="shield-checkmark-outline"
            variant="secondary"
            onPress={() => router.push("/account/security")}
            style={styles.spaced}
          />
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.h1} accessibilityRole="header">
          Sign in to MovenRun
        </Text>
        <Text style={styles.caption}>
          {backendConfigured ? "Sign in with Google or your wallet to keep your verified sessions. Or keep playing as a guest." : "Progress sync is unavailable. Keep exploring."}
        </Text>

        {backendConfigured ? (
          <View style={styles.card}>
            <SectionHeader title="Sign in" />
            <SignInOptions />
            {/* Restore Retry is scoped to a failed session RESTORE. Sign-in
                errors stay in the form above, where the user can fix them. */}
            {restoreErrorCode ? (
              <View style={styles.restoreBox} accessibilityLiveRegion="polite">
                <Text style={styles.caption}>{authErrorMessage(restoreErrorCode)}</Text>
                <Button
                  label="Retry"
                  variant="secondary"
                  icon="refresh-outline"
                  disabled={busy}
                  onPress={() => {
                    void retryRestore();
                  }}
                />
              </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.card} accessibilityLiveRegion="polite">
            <View style={styles.statusRow}>
              <Ionicons name="cloud-offline-outline" size={18} color={colors.textDim} />
              <Text style={styles.statusTitle}>Explore without an account</Text>
            </View>
            <Button label="Start Move" icon="walk-outline" onPress={() => router.replace("/move")} />
          </View>
        )}
        <LegalLinks />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingVertical: spacing.lg, paddingBottom: spacing.xxl },
  h1: { ...type.title, fontSize: 26 },
  body: { ...type.body, fontSize: 14, lineHeight: 20 },
  caption: { ...type.caption, color: colors.textDim },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  statusTitle: { ...type.heading, fontSize: 15, flex: 1 },
  spaced: { marginTop: spacing.sm },
  restoreBox: { gap: spacing.md, paddingTop: spacing.xs },
});
