import { useEffect } from "react";
import { Share, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Button } from "@/components/Button";
import { Hexagon } from "@/components/Hexagon";
import { FadeSlideIn } from "@/components/FadeSlideIn";
import { colors, ink, palette, radius, shadows, spacing, tints, type } from "@/theme";
import { formatPace } from "@/lib/geo";
import { useGameStore } from "@/store/useGameStore";
import { computePassport } from "@/lib/routePassport";
import { buildProof, outcomeLabel, runTitle } from "@/lib/routeProof";
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
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Route Proof — premium, privacy-safe local share card. Scalar summary stats
 * only (no raw GPS, coordinates, path, map image, or location). Share is
 * text-only via the OS share sheet; nothing is uploaded.
 */
export default function RouteProofScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const selectedClub = getClubById(useGameStore((s) => s.selectedClubId));
  const history = useGameStore((s) => s.routeTrustHistory);
  const zonesOwned = useGameStore((s) => s.zones.length);
  const timesDefended = useGameStore((s) => s.timesDefended);
  const markViewedProof = useGameStore((s) => s.markViewedProof);
  useEffect(() => {
    markViewedProof();
  }, [markViewedProof]);
  const passport = computePassport(history, { zonesOwned, timesDefended });

  const rawOutcome = str(params.outcome) as RouteOutcome;
  const outcome: RouteOutcome = VALID_OUTCOMES.includes(rawOutcome) ? rawOutcome : "summary-only";
  const distanceMeters = num(params.distanceMeters);
  const durationSeconds = num(params.durationSeconds);
  const zones = num(params.zones);

  const proof = buildProof({
    createdAt: str(params.at) || undefined,
    distanceMeters,
    durationSeconds,
    trustScore: num(params.score),
    trustLabel: str(params.label) || "Not evaluated",
    routeOutcome: outcome,
    zonesTouched: zones,
    defendedCount: num(params.defended),
    clubName: selectedClub?.name ?? null,
    passportLabel: passport.reviewedRouteCount > 0 ? passport.readinessLabel : null,
  });

  const pace = formatPace(distanceMeters, durationSeconds * 1000);

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
      <ScreenHeader title="Route Proof" />

      <View style={styles.body}>
        <FadeSlideIn>
          <View style={styles.card}>
            <View style={styles.brandRow}>
              <Hexagon size={15} color={tints.green} coreColor={palette.pulseGreen} />
              <Text style={styles.brand}>MovenRun</Text>
              <View style={{ flex: 1 }} />
              <Text style={styles.previewTag}>Route Proof Preview</Text>
            </View>

            <Text style={styles.stripLabel}>{outcomeLabel(outcome)} · local summary</Text>

            {/* stat strip */}
            <View style={styles.stripRow}>
              <View style={styles.stripStat}>
                <Text style={[styles.stripValue, { color: ink.green }]}>{zones}</Text>
                <Text style={styles.stripLabel}>zones touched</Text>
              </View>
              <View style={styles.stripDivider} />
              <View style={styles.stripStat}>
                <Text style={[styles.stripValue, { color: palette.baseBlue }]}>
                  {proof.trustScore}
                </Text>
                <Text style={styles.stripLabel}>Local signal score · {proof.trustLabel}</Text>
              </View>
            </View>

            {/* main run block */}
            <Text style={styles.runTitle}>{runTitle(outcome)}</Text>
            <View style={styles.statRow}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{fmtKm(distanceMeters)}</Text>
                <Text style={styles.statLabel}>distance</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statValue}>{fmtDuration(durationSeconds)}</Text>
                <Text style={styles.statLabel}>duration</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statValue}>{pace ?? "—"}</Text>
                <Text style={styles.statLabel}>pace /km</Text>
              </View>
            </View>

            {/* quality bar: Risk → Strong signal */}
            <View style={styles.qualityWrap}>
              <View style={styles.qualityTrack}>
                <View style={[styles.qualitySeg, { backgroundColor: palette.heatCoral }]} />
                <View style={[styles.qualitySeg, { backgroundColor: palette.moveGold }]} />
                <View style={[styles.qualitySeg, { backgroundColor: palette.pulseGreen }]} />
                <View style={[styles.qualitySeg, { backgroundColor: palette.voltMint }]} />
                <View
                  style={[
                    styles.qualityMarker,
                    { left: `${Math.max(2, Math.min(98, proof.trustScore))}%` },
                  ]}
                />
              </View>
              <View style={styles.qualityLabels}>
                <Text style={styles.qualityEnd}>Risk</Text>
                <Text style={styles.qualityEnd}>Strong signal</Text>
              </View>
            </View>

            {/* proof id + safety footer */}
            <View style={styles.footerCard}>
              <View style={styles.proofIdRow}>
                <Ionicons name="ribbon-outline" size={13} color={palette.moveGold} />
                <Text style={styles.proofId}>{proof.proofId}</Text>
              </View>
              <Text style={styles.safety}>This proof holds no coordinates · No route path · Local preview</Text>
              <Text style={styles.safetyDim}>Not on-chain</Text>
            </View>
          </View>
        </FadeSlideIn>
      </View>

      <View style={styles.footer}>
        <Button label="Share summary" icon="share-outline" onPress={onShare} />
        <Text style={styles.ctaNote}>Local proof preview · not on-chain</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },

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


  /* stat strip */
  stripRow: { flexDirection: "row", alignItems: "center" },
  stripStat: { flex: 1, alignItems: "center", gap: 1 },
  stripValue: { ...type.display, fontSize: 30, fontVariant: ["tabular-nums"] },
  stripLabel: { ...type.caption, fontSize: 11 },
  stripDivider: { width: 1, alignSelf: "stretch", marginVertical: 6, backgroundColor: colors.surfaceAlt },

  /* main run */
  runTitle: { ...type.display, fontSize: 24, textAlign: "center", marginTop: -spacing.sm },
  statRow: { flexDirection: "row", alignItems: "center" },
  stat: { flex: 1, alignItems: "center", gap: 2 },
  statValue: { ...type.title, fontSize: 18, fontVariant: ["tabular-nums"] },
  statLabel: { ...type.caption, fontSize: 10.5 },
  statDivider: { width: 1, alignSelf: "stretch", backgroundColor: colors.surfaceAlt },

  /* quality bar */
  qualityWrap: { gap: 6 },
  qualityTrack: {
    flexDirection: "row",
    height: 10,
    borderRadius: radius.pill,
    overflow: "hidden",
    position: "relative",
  },
  qualitySeg: { flex: 1, height: 10 },
  qualityMarker: {
    position: "absolute",
    top: -3,
    marginLeft: -8,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 3,
    borderColor: colors.text,
  },
  qualityLabels: { flexDirection: "row", justifyContent: "space-between" },
  qualityEnd: { ...type.caption, fontSize: 10.5, color: colors.textFaint },

  /* footer card */
  footerCard: {
    alignItems: "center",
    gap: 3,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  proofIdRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  proofId: { ...type.mono, fontSize: 12.5, fontWeight: "700", color: colors.text },
  safety: { ...type.mono, fontSize: 10.5, color: colors.textFaint },
  safetyDim: { ...type.mono, fontSize: 10, color: colors.textFaint },

  footer: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
  ctaNote: { ...type.mono, fontSize: 11, color: colors.textFaint, textAlign: "center" },
});
