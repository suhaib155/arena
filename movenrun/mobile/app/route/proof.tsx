import { useMemo } from "react";
import { type DimensionValue, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { Hexagon } from "@/components/Hexagon";
import { FadeSlideIn } from "@/components/FadeSlideIn";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { formatPace } from "@/lib/geo";
import { useGameStore } from "@/store/useGameStore";
import { computePassport } from "@/lib/routePassport";
import { buildProof, runTitle } from "@/lib/routeProof";
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
 * Stylized captured-territory hero — built from plain Views + Hexagon (no map
 * SDK, no SVG, no screenshot). The silhouette is a deterministic pseudo-zone
 * cluster derived from safe scalars (zones + a proof seed) — it never uses raw
 * GPS, coordinates, a route path, or location labels.
 */
function TerritoryHero({ seed, zones }: { seed: number; zones: number }) {
  const nodes = useMemo(() => {
    const count = Math.max(5, Math.min(8, zones || 6));
    const out: { left: DimensionValue; top: DimensionValue; size: number; teal: boolean }[] = [];
    for (let i = 0; i < count; i++) {
      // Deterministic ring layout with a seeded wobble — no location data.
      const wob = ((seed >> i) % 7) - 3; // -3..3
      const angle = (i / count) * Math.PI * 2 + (seed % 10) / 10;
      const r = 24 + wob; // percent radius
      out.push({
        left: `${50 + r * Math.cos(angle)}%`,
        top: `${50 + r * 0.78 * Math.sin(angle)}%`,
        size: i % 3 === 0 ? 30 : 24,
        teal: i % 2 === 0,
      });
    }
    return out;
  }, [seed, zones]);

  return (
    <View style={styles.hero}>
      {/* light map-like roads */}
      <View style={[styles.road, { top: "32%" }]} />
      <View style={[styles.road, { top: "66%" }]} />
      <View style={[styles.roadV, { left: "30%" }]} />
      <View style={[styles.roadV, { left: "70%" }]} />

      {/* glowing captured-territory silhouette */}
      <View style={styles.territoryBlob} />
      <View style={styles.territoryBlob2} />

      {/* territory nodes */}
      {nodes.map((n, i) => (
        <View key={i} style={[styles.node, { left: n.left, top: n.top }]}>
          <Hexagon
            size={n.size}
            color={n.teal ? "#CFF6E6" : "#C9EEDE"}
            coreColor={n.teal ? palette.voltMint : palette.pulseGreen}
          />
        </View>
      ))}

      {/* "you" marker */}
      <View style={styles.markerWrap}>
        <View style={styles.markerRing}>
          <View style={styles.markerDot} />
        </View>
      </View>

      <View style={styles.heroTag}>
        <Ionicons name="navigate" size={11} color="#0A8F60" />
        <Text style={styles.heroTagText}>Captured territory</Text>
      </View>
    </View>
  );
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
  const passport = computePassport(history, { zonesOwned, timesDefended });

  const rawOutcome = str(params.outcome) as RouteOutcome;
  const outcome: RouteOutcome = VALID_OUTCOMES.includes(rawOutcome) ? rawOutcome : "saved";
  const distanceMeters = num(params.distanceMeters);
  const durationSeconds = num(params.durationSeconds);
  const zones = num(params.zones);

  const proof = buildProof({
    createdAt: str(params.at) || undefined,
    distanceMeters,
    durationSeconds,
    trustScore: num(params.score),
    trustLabel: str(params.label) || "Saved",
    routeOutcome: outcome,
    zonesTouched: zones,
    defendedCount: num(params.defended),
    clubName: selectedClub?.name ?? null,
    passportLabel: passport.reviewedRouteCount > 0 ? passport.readinessLabel : null,
  });

  const pace = formatPace(distanceMeters, durationSeconds * 1000);
  const seed = useMemo(() => {
    let h = 0;
    for (const ch of proof.proofId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h;
  }, [proof.proofId]);

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
          <View style={styles.card}>
            <View style={styles.brandRow}>
              <Hexagon size={15} color="#C9EEDE" coreColor={palette.pulseGreen} />
              <Text style={styles.brand}>MovenRun</Text>
              <View style={{ flex: 1 }} />
              <Text style={styles.previewTag}>Route Proof Preview</Text>
            </View>

            <TerritoryHero seed={seed} zones={zones} />

            {/* stat strip */}
            <View style={styles.stripRow}>
              <View style={styles.stripStat}>
                <Text style={[styles.stripValue, { color: "#0A8F60" }]}>{zones}</Text>
                <Text style={styles.stripLabel}>zones touched</Text>
              </View>
              <View style={styles.stripDivider} />
              <View style={styles.stripStat}>
                <Text style={[styles.stripValue, { color: palette.baseBlue }]}>
                  {proof.trustScore}
                </Text>
                <Text style={styles.stripLabel}>{proof.trustLabel}</Text>
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
              <Text style={styles.safety}>No raw GPS · No route path · Local preview</Text>
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

  /* hero */
  hero: {
    height: 200,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
  },
  road: { position: "absolute", left: 0, right: 0, height: 5, backgroundColor: "#E2E8EC" },
  roadV: { position: "absolute", top: 0, bottom: 0, width: 5, backgroundColor: "#E6EBEF" },
  territoryBlob: {
    position: "absolute",
    left: "20%",
    top: "24%",
    width: "60%",
    height: "52%",
    borderRadius: 90,
    backgroundColor: "rgba(24,201,135,0.16)",
    borderWidth: 2,
    borderColor: palette.voltMint,
    transform: [{ rotate: "-8deg" }],
    shadowColor: palette.voltMint,
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  territoryBlob2: {
    position: "absolute",
    left: "34%",
    top: "40%",
    width: "40%",
    height: "40%",
    borderRadius: 80,
    backgroundColor: "rgba(88,242,179,0.18)",
    borderWidth: 1.5,
    borderColor: palette.pulseGreen,
    transform: [{ rotate: "12deg" }],
  },
  node: { position: "absolute", marginLeft: -15, marginTop: -15 },
  markerWrap: {
    position: "absolute",
    left: "50%",
    top: "50%",
    marginLeft: -13,
    marginTop: -13,
  },
  markerRing: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    ...shadows.card,
  },
  markerDot: { width: 13, height: 13, borderRadius: 7, backgroundColor: palette.baseBlue },
  heroTag: {
    position: "absolute",
    left: spacing.md,
    bottom: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(255,255,255,0.9)",
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
  },
  heroTagText: { fontSize: 11, fontWeight: "700", color: "#0A8F60" },

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
    backgroundColor: "#FFFFFF",
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
