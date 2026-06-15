import { Pressable, Share, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { Hexagon } from "@/components/Hexagon";
import { FadeSlideIn } from "@/components/FadeSlideIn";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useGameStore } from "@/store/useGameStore";
import { computePassport } from "@/lib/routePassport";
import { buildProof, outcomeLabel } from "@/lib/routeProof";
import type { RouteOutcome } from "@/lib/routeTrust";
import { getClubById } from "@/data/clubs";
import { tapFeedback, successFeedback } from "@/lib/haptics";

function num(v: string | string[] | undefined, fallback = 0): number {
  const s = Array.isArray(v) ? v[0] : v;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}
function str(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

const VALID_OUTCOMES: RouteOutcome[] = ["saved", "captured", "defended", "summary-only"];

function fmtKm(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}
function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/**
 * Route Proof — local, shareable summary card. Privacy-safe: scalar summary
 * stats only (no raw GPS, coordinates, path, map image, or location). Share is
 * text-only via the OS share sheet; nothing is uploaded or sent to a server.
 */
export default function RouteProofScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const selectedClub = getClubById(useGameStore((s) => s.selectedClubId));
  const history = useGameStore((s) => s.routeTrustHistory);
  const zonesOwned = useGameStore((s) => s.zones.length);
  const timesDefended = useGameStore((s) => s.timesDefended);
  const passport = computePassport(history, { zonesOwned, timesDefended });

  const rawOutcome = str(params.outcome) as RouteOutcome;
  const outcome: RouteOutcome = VALID_OUTCOMES.includes(rawOutcome) ? rawOutcome : "saved";

  const proof = buildProof({
    createdAt: str(params.at) || undefined,
    distanceMeters: num(params.distanceMeters),
    durationSeconds: num(params.durationSeconds),
    trustScore: num(params.score),
    trustLabel: str(params.label) || "Saved",
    routeOutcome: outcome,
    zonesTouched: num(params.zones),
    defendedCount: num(params.defended),
    clubName: selectedClub?.name ?? null,
    passportLabel: passport.reviewedRouteCount > 0 ? passport.readinessLabel : null,
  });

  const onShare = async () => {
    tapFeedback();
    try {
      await Share.share({ message: proof.shareText });
      successFeedback();
    } catch {
      /* user dismissed the share sheet — no-op */
    }
  };

  return (
    <Screen>
      <View style={styles.headerRow}>
        <Pressable hitSlop={12} onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Route Proof</Text>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.body}>
        <FadeSlideIn>
          {/* The share card */}
          <View style={styles.card}>
            <View style={styles.brandRow}>
              <Hexagon size={16} color="#C9EEDE" coreColor={palette.pulseGreen} />
              <Text style={styles.brand}>MovenRun</Text>
              <View style={{ flex: 1 }} />
              <Text style={styles.previewTag}>Route Proof Preview</Text>
            </View>

            <View style={styles.scoreBlock}>
              <Text style={styles.scoreValue}>{proof.trustScore}</Text>
              <Text style={styles.scoreLabel}>{proof.trustLabel} signal</Text>
            </View>

            <View style={styles.statRow}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{fmtKm(proof.distanceMeters)}</Text>
                <Text style={styles.statLabel}>distance</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statValue}>{fmtDuration(proof.durationSeconds)}</Text>
                <Text style={styles.statLabel}>duration</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={[styles.statValue, { color: palette.baseBlue }]}>
                  {outcomeLabel(proof.routeOutcome)}
                </Text>
                <Text style={styles.statLabel}>outcome</Text>
              </View>
            </View>

            <View style={styles.badgeRow}>
              {proof.clubName ? (
                <View style={[styles.badge, { backgroundColor: `${palette.pulseGreen}1A` }]}>
                  <Ionicons name="people-outline" size={12} color="#0A8F60" />
                  <Text style={[styles.badgeText, { color: "#0A8F60" }]}>{proof.clubName}</Text>
                </View>
              ) : null}
              {proof.passportLabel ? (
                <View style={[styles.badge, { backgroundColor: `${palette.deedViolet}14` }]}>
                  <Ionicons name="shield-half-outline" size={12} color={palette.deedViolet} />
                  <Text style={[styles.badgeText, { color: palette.deedViolet }]}>
                    {proof.passportLabel}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={styles.proofIdRow}>
              <Ionicons name="ribbon-outline" size={14} color={palette.moveGold} />
              <Text style={styles.proofId}>{proof.proofId}</Text>
              <Text style={styles.proofIdNote}>Local proof preview · not on-chain</Text>
            </View>

            <Text style={styles.privacyFooter}>No raw GPS · No route path · Local preview</Text>
          </View>
        </FadeSlideIn>

        <Text style={styles.helper}>
          Shares a text summary only. No coordinates, route path, or location are
          included — and nothing is uploaded.
        </Text>
      </View>

      <View style={styles.footer}>
        <Button label="Share summary" icon="share-outline" onPress={onShare} />
        <Button label="Back" icon="chevron-back" variant="secondary" onPress={() => router.back()} />
      </View>
    </Screen>
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
  body: { flex: 1, paddingHorizontal: spacing.lg, gap: spacing.md, paddingTop: spacing.sm },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.lg,
    ...shadows.float,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  brand: { ...type.heading, fontSize: 16 },
  previewTag: { ...type.kicker, color: palette.baseBlue },

  scoreBlock: { alignItems: "center", gap: 2 },
  scoreValue: { ...type.display, fontSize: 56, color: "#0A8F60", fontVariant: ["tabular-nums"] },
  scoreLabel: { ...type.heading, fontSize: 15, color: colors.textDim },

  statRow: { flexDirection: "row", alignItems: "center" },
  stat: { flex: 1, alignItems: "center", gap: 2 },
  statValue: { ...type.title, fontSize: 18, fontVariant: ["tabular-nums"] },
  statLabel: { ...type.caption, fontSize: 10.5 },
  statDivider: { width: 1, alignSelf: "stretch", backgroundColor: colors.surfaceAlt },

  badgeRow: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap", gap: spacing.sm },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: radius.pill,
    paddingVertical: 5,
    paddingHorizontal: spacing.md,
  },
  badgeText: { fontSize: 11.5, fontWeight: "700" },

  proofIdRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, flexWrap: "wrap" },
  proofId: { ...type.mono, fontSize: 13, fontWeight: "700", color: colors.text },
  proofIdNote: { ...type.mono, fontSize: 10.5, color: colors.textFaint },

  privacyFooter: {
    ...type.mono,
    fontSize: 10.5,
    color: colors.textFaint,
    textAlign: "center",
  },

  helper: { ...type.caption, fontSize: 12, lineHeight: 17, color: colors.textDim, textAlign: "center" },

  footer: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
});
