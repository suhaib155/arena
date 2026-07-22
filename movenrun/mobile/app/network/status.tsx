import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { ScalePress } from "@/components/ScalePress";
import { StatusPill } from "@/components/StatusPill";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import {
  BASE_SEPOLIA_STATUS,
  CATEGORY_META,
  shortAddress,
  type ContractCategory,
  type ContractStatus,
} from "@/data/contractStatus";
import { useAuthStore } from "@/store/useAuthStore";
import { buildNetworkView, type NetTone, type NetworkRowVM } from "@/lib/networkView";
import { tapFeedback } from "@/lib/haptics";
import type { IoniconName } from "@/types";

/** Accent per category — Base Blue default, Deed Violet for NFTs, subtle MOVE
 *  Gold for the token. Pulse Green is reserved for the "deployed" badge. */
function accentFor(category: ContractCategory): string {
  if (category === "nft") return palette.deedViolet;
  if (category === "token") return palette.moveGold;
  return palette.baseBlue;
}

const ROW_ICON: Record<string, IoniconName> = {
  account: "person-circle-outline",
  wallet: "wallet-outline",
  chain: "cube-outline",
  gameplay: "phone-portrait-outline",
};

/**
 * Network — a plain-language technical-status surface (NOT a crypto control
 * panel). It states one dominant, honest network line, then a few compact
 * connection rows derived from existing non-secret auth/wallet state via the
 * pure buildNetworkView selector. It renders NO wallet address, user id, token,
 * session id, or secret; the public contract foundation lives in a collapsed
 * technical-details drawer. One primary action (Account & Security / Sign in)
 * reuses the existing /account route — no wallet linking or chain calls here.
 */
export default function NetworkStatusScreen() {
  const router = useRouter();
  const status = BASE_SEPOLIA_STATUS;

  const authStatus = useAuthStore((s) => s.status);
  const authUser = useAuthStore((s) => s.user);
  const wallets = useAuthStore((s) => s.wallets);

  const view = useMemo(
    () =>
      buildNetworkView({
        authStatus,
        hasUser: authUser != null,
        walletCount: wallets.length,
        hasEmbeddedWallet: wallets.some((w) => w.isEmbedded),
      }),
    [authStatus, authUser, wallets],
  );

  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <Screen>
      <View style={styles.headerRow}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Network</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Dominant network state — text carries the meaning, not colour. */}
        <FadeSlideIn>
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>Network status</Text>
            <Text style={styles.heroTitle}>{view.dominantLabel}</Text>
            <View style={styles.pillRow}>
              <StatusPill icon="cube-outline" label="Base Sepolia · deployed" tone="primary" />
              <StatusPill icon="phone-portrait-outline" label="Local gameplay · off-chain" tone="neutral" />
            </View>
            <Text style={styles.heroDetail}>{view.dominantDetail}</Text>
          </View>
        </FadeSlideIn>

        {/* Connection rows — compact, non-secret, address-free. */}
        <FadeSlideIn delay={STAGGER_MS}>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>This device</Text>
            <View style={styles.rowList}>
              {view.rows.map((r) => (
                <ConnectionRow key={r.key} row={r} />
              ))}
            </View>
          </View>
        </FadeSlideIn>

        {/* One primary action, reusing the existing /account route. */}
        <FadeSlideIn delay={STAGGER_MS * 2}>
          <Button
            label={view.primaryActionLabel}
            icon={view.signedIn ? "shield-checkmark-outline" : "log-in-outline"}
            onPress={() => {
              tapFeedback();
              router.push("/account");
            }}
          />
        </FadeSlideIn>

        {/* Technical details — collapsed by default. */}
        <FadeSlideIn delay={STAGGER_MS * 3}>
          <View style={styles.detailsWrap}>
            <Pressable
              onPress={() => {
                tapFeedback();
                setDetailsOpen((v) => !v);
              }}
              style={styles.detailsHeader}
              accessibilityRole="button"
              accessibilityLabel="Technical details"
              accessibilityHint={detailsOpen ? "Collapse technical details" : "Expand technical details"}
            >
              <View style={styles.detailsIcon}>
                <Ionicons name="hardware-chip-outline" size={15} color={colors.textDim} />
              </View>
              <Text style={styles.detailsTitle}>Technical details</Text>
              <Ionicons
                name={detailsOpen ? "chevron-up" : "chevron-down"}
                size={16}
                color={colors.textFaint}
              />
            </Pressable>

            {detailsOpen ? (
              <View style={styles.detailsBody}>
                <View style={styles.metaCard}>
                  <MetaRow label="Network" value={status.networkName} />
                  <MetaRow label="Chain ID" value={String(status.chainId)} mono />
                  <MetaRow label="Mode" value={status.mode} />
                  <MetaRow label="App access" value={status.appAccess} />
                  <MetaRow label="Deployed" value={status.deployedAt} mono last />
                </View>

                <Text style={styles.contractsHeading}>
                  Public contract foundation{" "}
                  <Text style={styles.contractsCount}>{status.contracts.length}</Text>
                </Text>
                <Text style={styles.contractsNote}>
                  Public Base Sepolia testnet addresses. Not your wallet — read-only reference only.
                </Text>
                <View style={styles.rowList}>
                  {status.contracts.map((c) => (
                    <ContractRow key={c.key} contract={c} />
                  ))}
                </View>
              </View>
            ) : null}
          </View>
        </FadeSlideIn>

        {/* Safety card — what this is and isn't. */}
        <FadeSlideIn delay={STAGGER_MS * 4}>
          <View style={[styles.card, styles.safetyCard]}>
            <View style={styles.safetyHead}>
              <Ionicons name="shield-checkmark-outline" size={18} color={palette.heatCoral} />
              <Text style={styles.safetyTitle}>What this is — and isn&apos;t</Text>
            </View>
            <SafetyLine text="This screen does not connect a wallet or sign anything." />
            <SafetyLine text="No minting, claiming, trading, or token rewards are live." />
            <SafetyLine text="Local gameplay stays on this device and off-chain during beta." />
          </View>
        </FadeSlideIn>

        <Text style={styles.footerNote}>
          Read-only status · Base Sepolia testnet · local beta remains off-chain.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const TONE_COLOR: Record<NetTone, string> = {
  primary: palette.baseBlue,
  success: palette.pulseGreen,
  neutral: palette.silverTrail,
  warning: palette.moveGold,
};

function ConnectionRow({ row }: { row: NetworkRowVM }) {
  const c = TONE_COLOR[row.tone];
  return (
    <View
      style={styles.connRow}
      accessibilityRole="text"
      accessibilityLabel={`${row.label}: ${row.value}`}
    >
      <View style={[styles.connIcon, { backgroundColor: `${c}16` }]}>
        <Ionicons name={ROW_ICON[row.key] ?? "ellipse-outline"} size={16} color={c} />
      </View>
      <Text style={styles.connLabel}>{row.label}</Text>
      <Text style={[styles.connValue, { color: c }]} numberOfLines={1}>
        {row.value}
      </Text>
    </View>
  );
}

function MetaRow({
  label,
  value,
  mono,
  last,
}: {
  label: string;
  value: string;
  mono?: boolean;
  last?: boolean;
}) {
  return (
    <View style={[styles.metaRow, last ? null : styles.metaRowBorder]}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={[styles.metaValue, mono ? styles.metaValueMono : null]}>{value}</Text>
    </View>
  );
}

function ContractRow({ contract }: { contract: ContractStatus }) {
  const [open, setOpen] = useState(false);
  const accent = accentFor(contract.category);
  const meta = CATEGORY_META[contract.category];
  return (
    <ScalePress
      to={0.99}
      style={styles.row}
      onPress={() => {
        tapFeedback();
        setOpen((v) => !v);
      }}
      accessibilityRole="button"
      accessibilityLabel={`${contract.displayName}, deployed`}
      accessibilityHint={open ? "Collapse contract detail" : "Expand contract detail"}
    >
      <View style={styles.rowTop}>
        <View style={[styles.rowIcon, { backgroundColor: `${accent}14` }]}>
          <Ionicons name={meta.icon} size={18} color={accent} />
        </View>
        <View style={styles.rowBody}>
          <View style={styles.rowTitleLine}>
            <Text style={styles.rowName} numberOfLines={1}>
              {contract.displayName}
            </Text>
            <View style={styles.deployedChip}>
              <View style={styles.deployedDot} />
              <Text style={styles.deployedText}>deployed</Text>
            </View>
          </View>
          <Text style={styles.rowAddr} numberOfLines={open ? undefined : 1}>
            {open ? contract.address : shortAddress(contract.address)}
          </Text>
        </View>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={16}
          color={colors.textFaint}
        />
      </View>
      {open ? (
        <View style={styles.rowDetail}>
          <Text style={styles.rowPurpose}>{contract.purpose}</Text>
          <Text style={styles.rowCategory}>{meta.label} · read-only reference</Text>
        </View>
      ) : null}
    </ScalePress>
  );
}

function SafetyLine({ text }: { text: string }) {
  return (
    <View style={styles.safetyLine}>
      <Ionicons name="checkmark-circle" size={15} color={palette.heatCoral} />
      <Text style={styles.safetyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  backBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  headerTitle: { ...type.heading, fontSize: 16 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 48, gap: spacing.lg },

  hero: { gap: spacing.sm, paddingTop: spacing.sm },
  heroKicker: { ...type.kicker, color: colors.primary },
  heroTitle: { ...type.display, fontSize: 24, lineHeight: 30, letterSpacing: -0.4 },
  pillRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", marginTop: spacing.xs },
  heroDetail: { ...type.body, fontSize: 13, lineHeight: 19, color: colors.textDim, marginTop: spacing.xs },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  sectionTitle: { ...type.heading, fontSize: 15, marginBottom: spacing.md },
  rowList: { gap: spacing.sm },

  connRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 44 },
  connIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  connLabel: { ...type.body, fontSize: 13.5, color: colors.textDim, flex: 1 },
  connValue: { ...type.heading, fontSize: 13.5, maxWidth: "52%", textAlign: "right" },

  detailsWrap: { gap: spacing.sm },
  detailsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: 48,
  },
  detailsIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  detailsTitle: { ...type.heading, fontSize: 14.5, flex: 1, color: colors.textDim },
  detailsBody: { gap: spacing.sm },

  metaCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    ...shadows.card,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
  },
  metaRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  metaLabel: { ...type.body, fontSize: 13, color: colors.textDim },
  metaValue: { ...type.heading, fontSize: 14 },
  metaValueMono: { ...type.mono, fontSize: 13, color: colors.text },

  contractsHeading: { ...type.heading, fontSize: 14.5, marginTop: spacing.xs },
  contractsCount: { ...type.title, fontSize: 13, color: colors.textFaint },
  contractsNote: { ...type.caption, fontSize: 11.5, lineHeight: 16, color: colors.textFaint },

  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  rowTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  rowBody: { flex: 1, gap: 3 },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowName: { ...type.heading, fontSize: 15, flexShrink: 1 },
  deployedChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: `${palette.pulseGreen}1A`,
    borderRadius: radius.pill,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
  },
  deployedDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.pulseGreen },
  deployedText: { fontSize: 10, fontWeight: "800", color: "#0A8F60" },
  rowAddr: { ...type.mono, fontSize: 11.5, color: colors.textFaint },
  rowDetail: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 4,
  },
  rowPurpose: { ...type.body, fontSize: 13, lineHeight: 18, color: colors.text },
  rowCategory: { ...type.mono, fontSize: 10.5, color: colors.textFaint },

  safetyCard: { gap: spacing.sm, backgroundColor: "#FFF6F3" },
  safetyHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  safetyTitle: { ...type.heading, fontSize: 15 },
  safetyLine: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  safetyText: { flex: 1, ...type.body, fontSize: 13, lineHeight: 18, color: colors.text },

  footerNote: {
    ...type.mono,
    fontSize: 11,
    color: colors.textFaint,
    textAlign: "center",
    paddingTop: spacing.xs,
  },
});
