/**
 * Account hub — sign-in entry (Email / Google / Base) with pending/error/
 * recovery states, and, once signed in, a summary distinguishing the MovenRun
 * identity from the automatically-created wallet, with links to wallet and
 * security management.
 *
 * The screen is a production-quality SHELL: it drives the real API client when
 * a backend URL is configured, and otherwise shows an honest "backend not
 * configured" state instead of any fake login. No wallet is generated locally
 * and no seed phrase / private key is ever requested.
 */
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { SectionHeader } from "@/components/SectionHeader";
import { Badge } from "@/components/Badge";
import { colors, radius, shadows, spacing, type } from "@/theme";
import { useAuthStore } from "@/store/useAuthStore";
import { IdentityApiClient } from "@/services/identityApi";
import { shortAddress, walletTypeLabel } from "@/lib/walletPresentation";

function friendlyError(code: string | null): string | null {
  if (!code) return null;
  switch (code) {
    case "api_base_url_unset":
    case "client_unavailable":
      return "The MovenRun backend isn't configured in this build yet.";
    case "verification_failed":
      return "That code didn't match. Check it and try again.";
    case "too_many_attempts":
      return "Too many attempts. Please wait a moment and retry.";
    case "provider_not_configured":
      return "This sign-in method isn't available yet.";
    default:
      return "Something went wrong. Please try again.";
  }
}

export default function AccountScreen() {
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const wallets = useAuthStore((s) => s.wallets);
  const errorCode = useAuthStore((s) => s.errorCode);
  const beginEmailOtp = useAuthStore((s) => s.beginEmailOtp);
  const completeEmailOtp = useAuthStore((s) => s.completeEmailOtp);
  const setClient = useAuthStore((s) => s.setClient);
  const existingClient = useAuthStore((s) => s.client);

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);

  // Build the API client lazily; if no backend URL is set it stays null and the
  // UI shows the honest "not configured" path rather than a fake success.
  const client = useMemo(() => {
    if (existingClient) return existingClient;
    try {
      const c = new IdentityApiClient();
      setClient(c);
      return c;
    } catch {
      return null;
    }
  }, [existingClient, setClient]);

  const busy = status === "authenticating";
  const activeWallet = wallets.find((w) => w.isActive) ?? null;
  const errorText = friendlyError(errorCode);

  const onContinueEmail = async () => {
    if (!client) {
      // Surface the not-configured state through the store's error path.
      await beginEmailOtp(email); // sets error when client is unavailable
      return;
    }
    await beginEmailOtp(email);
    if (useAuthStore.getState().status !== "error") setCodeSent(true);
  };

  if (status === "signedIn" && user) {
    return (
      <Screen>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.h1} accessibilityRole="header">
            Your MovenRun account
          </Text>

          <View style={styles.card}>
            <SectionHeader title="MovenRun identity" />
            <Text style={styles.mono} accessibilityLabel={`MovenRun user id ${user.id}`}>
              {user.id}
            </Text>
            <Text style={styles.caption}>
              This is your permanent identity. Your wallets and sign-in methods link to it — switching
              wallets never moves your rewards or ownership.
            </Text>
          </View>

          <View style={styles.card}>
            <SectionHeader title="Active wallet" trailing="Base Sepolia · testnet" />
            {activeWallet ? (
              <>
                <View style={styles.rowBetween}>
                  <Badge label={walletTypeLabel(activeWallet.walletType)} color={colors.primary} />
                  <Text style={styles.mono}>{shortAddress(activeWallet.address)}</Text>
                </View>
                <Text style={styles.caption}>You control this wallet. MovenRun never holds its keys.</Text>
              </>
            ) : (
              <Text style={styles.caption}>Your wallet is being set up. Check the Wallets screen for status.</Text>
            )}
          </View>

          <Button label="Manage wallets" icon="wallet-outline" onPress={() => router.push("/account/wallets")} />
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
          One account, many ways in. We&apos;ll create your wallet automatically — no seed phrases, ever.
        </Text>

        <View style={styles.card}>
          <SectionHeader title="Continue with Email" />
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            accessibilityLabel="Email address"
            editable={!busy}
          />
          {codeSent ? (
            <>
              <TextInput
                style={styles.input}
                value={code}
                onChangeText={setCode}
                placeholder="6-digit code"
                placeholderTextColor={colors.textFaint}
                keyboardType="number-pad"
                accessibilityLabel="One-time code"
                editable={!busy}
              />
              <Button
                label="Verify code"
                onPress={() => completeEmailOtp(email, code)}
                loading={busy}
                disabled={busy || code.length < 4}
              />
            </>
          ) : (
            <Button
              label="Send code"
              onPress={onContinueEmail}
              loading={busy}
              disabled={busy || email.length < 3}
            />
          )}
        </View>

        <View style={styles.card}>
          <SectionHeader title="Or continue with" />
          <Button label="Continue with Google" icon="logo-google" variant="secondary" onPress={() => {}} disabled />
          <Button
            label="Continue with Base"
            icon="cube-outline"
            variant="secondary"
            onPress={() => {}}
            disabled
            style={styles.spaced}
          />
          <Text style={styles.caption}>Google and Base sign-in arrive in a later build.</Text>
        </View>

        {errorText ? (
          <View style={styles.errorBox} accessibilityLiveRegion="polite">
            <Text style={styles.errorText}>{errorText}</Text>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingVertical: spacing.lg, paddingBottom: spacing.xxl },
  h1: { ...type.title, fontSize: 26 },
  caption: { ...type.caption, color: colors.textDim },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    ...type.body,
    color: colors.text,
  },
  mono: { ...type.mono, fontSize: 13, color: colors.text },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  spaced: { marginTop: spacing.sm },
  errorBox: {
    backgroundColor: `${colors.danger}14`,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  errorText: { ...type.caption, color: colors.danger },
});
