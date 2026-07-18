/**
 * Wallets screen — lists the user's linked wallets, distinguishing the embedded
 * (auto-created) wallet, Base Account, and external wallets, shows which one is
 * active, and exposes switch / connect-another / revoke and a secure-export
 * ENTRY POINT.
 *
 * The export entry is a secure handoff placeholder only: it never reveals a
 * secret in-app (ADR-0009). Connecting an external wallet uses a secure signing
 * flow, never a seed-phrase / private-key input. All chain wording is explicit
 * about testnet.
 */
import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { SectionHeader } from "@/components/SectionHeader";
import { EmptyState } from "@/components/EmptyState";
import { colors, radius, shadows, spacing, type } from "@/theme";
import { useAuthStore } from "@/store/useAuthStore";
import type { PublicWallet } from "@/services/identityApi";
import {
  chainLabel,
  ownershipLabel,
  provisioningLabel,
  shortAddress,
  sortWalletsForDisplay,
  walletTypeColor,
  walletTypeLabel,
} from "@/lib/walletPresentation";

function WalletRow({
  wallet,
  onActivate,
  onRevoke,
  busy,
}: {
  wallet: PublicWallet;
  onActivate: () => void;
  onRevoke: () => void;
  busy: boolean;
}) {
  const provisioning = provisioningLabel(wallet.provisioningState);
  const canActivate = wallet.ownershipStatus === "verified" && !wallet.isActive;
  return (
    <View style={styles.card} accessible accessibilityLabel={`${walletTypeLabel(wallet.walletType)} ${shortAddress(wallet.address)}`}>
      <View style={styles.rowBetween}>
        <Badge label={walletTypeLabel(wallet.walletType)} color={walletTypeColor(wallet.walletType)} />
        {wallet.isActive ? <Badge label="Active" color={colors.accent} /> : null}
      </View>
      <Text style={styles.mono}>{shortAddress(wallet.addressChecksum ?? wallet.address)}</Text>
      <View style={styles.rowBetween}>
        <Text style={styles.caption}>{chainLabel(wallet.chainFamily)}</Text>
        <Text style={styles.caption}>{ownershipLabel(wallet.ownershipStatus)}</Text>
      </View>
      {provisioning ? <Text style={styles.provisioning}>{provisioning}</Text> : null}
      <View style={styles.actions}>
        {canActivate ? (
          <Button label="Make active" onPress={onActivate} disabled={busy} style={styles.flex} />
        ) : null}
        {wallet.ownershipStatus !== "revoked" && !wallet.isEmbedded ? (
          <Button label="Revoke" variant="ghost" onPress={onRevoke} disabled={busy} style={styles.flex} />
        ) : null}
      </View>
    </View>
  );
}

export default function WalletsScreen() {
  const wallets = useAuthStore((s) => s.wallets);
  const refresh = useAuthStore((s) => s.refresh);
  const setActiveWallet = useAuthStore((s) => s.setActiveWallet);
  const revokeWallet = useAuthStore((s) => s.revokeWallet);
  const status = useAuthStore((s) => s.status);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === "signedIn") void refresh();
  }, [status, refresh]);

  const sorted = sortWalletsForDisplay(wallets);

  const confirmRevoke = (wallet: PublicWallet) => {
    Alert.alert(
      "Revoke wallet?",
      "This unlinks the wallet from your MovenRun account. Your rewards and progress stay with your MovenRun identity — nothing is transferred.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Revoke",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            await revokeWallet(wallet.id);
            setBusy(false);
          },
        },
      ]
    );
  };

  const onActivate = async (wallet: PublicWallet) => {
    setBusy(true);
    await setActiveWallet(wallet.id);
    setBusy(false);
  };

  const onExport = () => {
    Alert.alert(
      "Secure wallet export",
      "Exporting your recovery secret happens inside your wallet provider's secure screen — MovenRun never sees it. This handoff isn't wired up in this build yet.\n\nNever share your recovery phrase with anyone, including MovenRun support.",
      [{ text: "Got it" }]
    );
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.h1} accessibilityRole="header">
          Wallets
        </Text>
        <Text style={styles.caption}>
          Your wallets link to your MovenRun identity. Switching the active wallet never moves rewards or
          ownership — those stay with your account.
        </Text>

        {status !== "signedIn" ? (
          <EmptyState icon="wallet-outline" title="Sign in to see your wallets" message="Your wallets appear here once you're signed in." />
        ) : sorted.length === 0 ? (
          <EmptyState icon="wallet-outline" title="No wallets yet" message="Your embedded wallet is created automatically after sign-in." />
        ) : (
          sorted.map((w) => (
            <WalletRow key={w.id} wallet={w} busy={busy} onActivate={() => onActivate(w)} onRevoke={() => confirmRevoke(w)} />
          ))
        )}

        <SectionHeader title="Connect another wallet" />
        <Button label="Connect a wallet" icon="link-outline" variant="secondary" onPress={() => {}} disabled />
        <Text style={styles.caption}>
          Connecting uses a secure signature request — you&apos;ll never paste a seed phrase or private key into
          MovenRun. (Arrives in a later build.)
        </Text>

        <SectionHeader title="Recovery & export" />
        <Button label="Export recovery secret" icon="key-outline" variant="ghost" onPress={onExport} />
        <Text style={styles.caption}>
          Export happens in your provider&apos;s secure surface. MovenRun never stores or displays your recovery
          secret.
        </Text>
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
    gap: spacing.sm,
    ...shadows.card,
  },
  mono: { ...type.mono, fontSize: 14, color: colors.text },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  provisioning: { ...type.caption, color: colors.warning },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  flex: { flex: 1 },
});
