import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { ScalePress } from "@/components/ScalePress";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import {
  BASE_SEPOLIA_STATUS,
  CATEGORY_META,
  shortAddress,
  type ContractCategory,
  type ContractStatus,
} from "@/data/contractStatus";
import { tapFeedback } from "@/lib/haptics";

/** Accent per category — Base Blue default, Deed Violet for NFTs, subtle MOVE
 *  Gold for the token. Pulse Green is reserved for the "deployed" badge. */
function accentFor(category: ContractCategory): string {
  if (category === "nft") return palette.deedViolet;
  if (category === "token") return palette.moveGold;
  return palette.baseBlue;
}

/**
 * Base Sepolia status — read-only preview. Shows that the MovenRun contract
 * foundation is deployed on Base Sepolia testnet. No wallet, no signing, no
 * chain calls: all data is mirrored static metadata (see data/contractStatus).
 */
export default function NetworkStatusScreen() {
  const router = useRouter();
  const status = BASE_SEPOLIA_STATUS;

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
        {/* Hero */}
        <FadeSlideIn>
          <View style={styles.hero}>
            <Text style={styles.heroKicker}>Base Sepolia Preview</Text>
            <Text style={styles.heroTitle}>
              MovenRun contracts are deployed on Base Sepolia testnet.
            </Text>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: `${palette.baseBlue}14` }]}>
                <Ionicons name="eye-outline" size={13} color={palette.baseBlue} />
                <Text style={[styles.badgeText, { color: palette.baseBlue }]}>Read-only</Text>
              </View>
              <View style={[styles.badge, { backgroundColor: `${palette.pulseGreen}1A` }]}>
                <Ionicons name="wallet-outline" size={13} color="#0A8F60" />
                <Text style={[styles.badgeText, { color: "#0A8F60" }]}>No wallet needed</Text>
              </View>
            </View>
          </View>
        </FadeSlideIn>

        {/* Network card */}
        <FadeSlideIn delay={STAGGER_MS}>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Network</Text>
            <NetworkRow label="Network" value={status.networkName} />
            <NetworkRow label="Chain ID" value={String(status.chainId)} mono />
            <NetworkRow label="Mode" value={status.mode} />
            <NetworkRow label="App access" value={status.appAccess} />
            <NetworkRow label="Deployed" value={status.deployedAt} mono last />
          </View>
        </FadeSlideIn>

        {/* Contract list */}
        <FadeSlideIn delay={STAGGER_MS * 2}>
          <Text style={styles.listHeading}>
            Contracts <Text style={styles.listCount}>{status.contracts.length}</Text>
          </Text>
        </FadeSlideIn>
        <View style={styles.list}>
          {status.contracts.map((c, i) => (
            <FadeSlideIn key={c.key} delay={STAGGER_MS * (3 + i)}>
              <ContractRow contract={c} />
            </FadeSlideIn>
          ))}
        </View>

        {/* Safety card */}
        <FadeSlideIn delay={STAGGER_MS * 11}>
          <View style={[styles.card, styles.safetyCard]}>
            <View style={styles.safetyHead}>
              <Ionicons name="shield-checkmark-outline" size={18} color={palette.heatCoral} />
              <Text style={styles.safetyTitle}>What this is — and isn&apos;t</Text>
            </View>
            <SafetyLine text="This screen does not connect a wallet." />
            <SafetyLine text="No minting, claiming, trading, or token rewards are live." />
            <SafetyLine text="Local gameplay remains off-chain during beta." />
          </View>
        </FadeSlideIn>

        {/* Next step card */}
        <FadeSlideIn delay={STAGGER_MS * 12}>
          <View style={styles.nextCard}>
            <Ionicons name="time-outline" size={18} color={palette.deedViolet} />
            <Text style={styles.nextText}>
              Wallet preview arrives later, after GPS verification and read-only checks.
              Zone Deeds arrive later.
            </Text>
          </View>
        </FadeSlideIn>

        <Text style={styles.footerNote}>
          Read-only preview · Base Sepolia testnet · local beta remains off-chain.
        </Text>
      </ScrollView>
    </Screen>
  );
}

function NetworkRow({
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
    <View style={[styles.netRow, last ? null : styles.netRowBorder]}>
      <Text style={styles.netLabel}>{label}</Text>
      <Text style={[styles.netValue, mono ? styles.netValueMono : null]}>{value}</Text>
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
          <Text style={styles.rowAddr} numberOfLines={1}>
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
          <Text style={styles.rowCategory}>{meta.label} · read-only preview</Text>
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
  heroTitle: { ...type.display, fontSize: 24, lineHeight: 30 },
  badgeRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", marginTop: spacing.xs },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
  },
  badgeText: { fontSize: 12, fontWeight: "700" },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  sectionTitle: { ...type.heading, fontSize: 15, marginBottom: spacing.sm },
  netRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
  },
  netRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  netLabel: { ...type.body, fontSize: 13, color: colors.textDim },
  netValue: { ...type.heading, fontSize: 14 },
  netValueMono: { ...type.mono, fontSize: 13, color: colors.text },

  listHeading: { ...type.heading, fontSize: 18 },
  listCount: { ...type.title, fontSize: 15, color: colors.textFaint },
  list: { gap: spacing.sm },
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

  nextCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    backgroundColor: `${palette.deedViolet}0F`,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  nextText: { flex: 1, ...type.body, fontSize: 13, lineHeight: 19, color: colors.text },

  footerNote: {
    ...type.mono,
    fontSize: 11,
    color: colors.textFaint,
    textAlign: "center",
    paddingTop: spacing.xs,
  },
});
