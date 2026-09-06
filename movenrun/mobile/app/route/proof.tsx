import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, Image, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import { captureRef, releaseCapture } from "react-native-view-shot";
import { shareVisualSummary } from "@/lib/visualShare";
import { ensureShareCacheClean } from "@/services/shareCache";
import { onVerificationPrivacyReset, verificationGeneration } from "@/services/verificationPrivacy";
import { useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Button } from "@/components/Button";
import { Hexagon } from "@/components/Hexagon";
import { colors, ink, palette, pressFade, radius, shadows, spacing, tints, type } from "@/theme";
import { formatPace } from "@/lib/geo";
import { MovenMap, type MovenMapHandle } from "@/components/map/MovenMap";
import { DEFAULT_PRIVACY_RADIUS_M, redactEndpoints } from "@/lib/mapGeometry";
import { getLastSession, isSessionPrivacyCurrent, subscribeVerification } from "@/services/moveSession";
import { useGameStore } from "@/store/useGameStore";
import { computePassport } from "@/lib/routePassport";
import { buildProof, runTitle } from "@/lib/routeProof";
import type { RouteOutcome } from "@/lib/routeTrust";
import { getClubById } from "@/data/clubs";
import { tapFeedback } from "@/lib/haptics";

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

/** A temporary image export of the same redacted route shown on this screen. */
export default function RouteProofScreen() {
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

  /* The finished session still held in memory. Null when this screen was
     reached without one, or after a privacy reset spent it — in which case the
     card simply shows no map rather than an emptier one. */
  const [hideEnds, setHideEnds] = useState(true);
  const [session, setSession] = useState(() => {
    const held = getLastSession();
    return held && isSessionPrivacyCurrent(held) ? held : null;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState<string | null | undefined>(undefined);
  const mapRef = useRef<MovenMapHandle>(null);
  const cardRef = useRef<View>(null);
  const active = useRef(false);
  const revision = useRef(0);
  const files = useRef(new Set<string>());
  const imageReady = useRef<null | { resolve(): void; reject(error: Error): void }>(null);
  const mounted = useRef(true);
  async function removeFile(uri: string) {
    files.current.delete(uri);
    releaseCapture(uri);
    await FileSystem.deleteAsync(uri, { idempotent: true });
  }
  function cancel() {
    revision.current += 1;
    imageReady.current?.reject(new Error("share_cancelled"));
    imageReady.current = null;
    for (const file of files.current) void removeFile(file).catch(() => {});
    if (mounted.current) setSnapshot(undefined);
  }
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeVerification(() => {
      if (getLastSession() !== session) { cancel(); setSession(getLastSession()); }
    });
    const reset = onVerificationPrivacyReset(() => { cancel(); setSession(null); });
    return () => { mounted.current = false; cancel(); unsubscribe(); reset(); };
  }, [session]);
  const routePoints = useMemo(() => {
    if (session === null) return [];
    return hideEnds ? redactEndpoints(session.points) : session.points;
  }, [session, hideEnds]);
  const mapPauses = useMemo(() => session?.session?.pauses ?? [], [session]);

  const onShare = async () => {
    if (active.current) return;
    active.current = true;
    setBusy(true); setError(""); tapFeedback();
    const version = revision.current;
    const generation = verificationGeneration();
    const current = () => mounted.current && version === revision.current && generation === verificationGeneration() &&
      (!session || (getLastSession() === session && isSessionPrivacyCurrent(session)));
    try {
      await ensureShareCacheClean();
      if (!(await Sharing.isAvailableAsync())) throw new Error("sharing_unavailable");
      await shareVisualSummary({
        current,
        captureMap: async () => {
          const uri = routePoints.length ? await mapRef.current?.capture() ?? null : null;
          if (uri) files.current.add(uri);
          return uri;
        },
        prepareCard: (uri) => new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => { imageReady.current = null; reject(new Error("image_timeout")); }, 8000);
          imageReady.current = { resolve: () => { clearTimeout(timeout); imageReady.current = null; resolve(); },
            reject: (e) => { clearTimeout(timeout); imageReady.current = null; reject(e); } };
          setSnapshot(uri);
        }),
        captureCard: async () => {
          const uri = await captureRef(cardRef, { format: "png", quality: 1, result: "tmpfile" });
          files.current.add(uri); return uri;
        },
        shareImage: async (uri) => {
          await Sharing.shareAsync(uri, { mimeType: "image/png", UTI: "public.png", dialogTitle: "Share your move" });
          // Some Android recipients read the URI after the chooser returns.
          // Keep it until returning to MovenRun, bounded to two minutes.
          if (AppState.currentState !== "active" && current()) await new Promise<void>((resolve) => {
            const finish = () => { clearTimeout(timeout); listener.remove(); reset(); resolve(); };
            const listener = AppState.addEventListener("change", (state) => { if (state === "active") finish(); });
            const reset = onVerificationPrivacyReset(finish);
            const timeout = setTimeout(finish, 120_000);
          });
        },
        remove: removeFile,
      });
    } catch {
      if (current()) setError("Couldn’t share the image. Try again, or share text details below.");
    } finally {
      active.current = false;
      if (mounted.current) { setBusy(false); setSnapshot(undefined); }
    }
  };

  return (
    <Screen>
      <ScreenHeader title="Share your move" />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.body} removeClippedSubviews={false}>
          <View ref={cardRef} collapsable={false} style={styles.card}>
            <View style={styles.brandRow}>
              <Hexagon size={15} color={tints.green} coreColor={palette.pulseGreen} />
              <Text style={styles.brand}>MovenRun</Text>
              <View style={{ flex: 1 }} />
              <Text style={styles.previewTag}>Your move</Text>
            </View>

            <Text style={styles.stripLabel}>{outcome === "summary-only" ? "Not enough movement" : "Route complete"}</Text>

            {/* The walk itself, on real ground. Shown only when the session is
                still in memory — there is no stand-in map for a route this
                screen does not have. */}
            {routePoints.length > 0 ? (
              <>
                {snapshot !== undefined ? (
                  snapshot ? <Image source={{ uri: snapshot }} style={styles.shareMap} resizeMode="contain"
                    onLoad={() => requestAnimationFrame(() => imageReady.current?.resolve())} onError={() => imageReady.current?.reject(new Error("image_load"))} /> :
                  <View style={styles.shareMap} onLayout={() => imageReady.current?.resolve()}><Text style={styles.stripLabel}>Map unavailable</Text></View>
                ) : <MovenMap
                  key={String(hideEnds)}
                  ref={mapRef}
                  points={routePoints}
                  pauses={mapPauses}
                  interactive={false}
                  style={styles.shareMap}
                  accessibilityLabel={
                    hideEnds
                      ? "Map of your route, with the areas around the start and finish hidden"
                      : "Map of your full route, including the start and finish"
                  }
                />}
                <Pressable
                  disabled={busy}
                  style={pressFade(styles.privacyRow)}
                  onPress={() => {
                    tapFeedback();
                    cancel();
                    setHideEnds((on) => !on);
                  }}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: hideEnds }}
                  accessibilityLabel="Hide the start and finish of the route"
                  accessibilityHint={`Hides everything within ${DEFAULT_PRIVACY_RADIUS_M} metres of where you started and stopped`}
                >
                  <Ionicons
                    name={hideEnds ? "eye-off-outline" : "eye-outline"}
                    size={15}
                    color={hideEnds ? ink.green : colors.textDim}
                  />
                  <Text style={styles.privacyText}>
                    {hideEnds
                      ? `Start and finish hidden (${DEFAULT_PRIVACY_RADIUS_M} m)`
                      : "Showing the full route, ends included"}
                  </Text>
                </Pressable>
              </>
            ) : <View onLayout={() => { if (snapshot === null) imageReady.current?.resolve(); }} key={String(snapshot)}><Text style={styles.stripLabel}>No shareable route</Text></View>}

            {/* main run block */}
            <Text style={styles.runTitle}>{str(params.title) || runTitle(outcome)}</Text>
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

            {/* Endpoint visibility is explicit before sharing. */}
            <View style={styles.footerCard}>
              <Text style={styles.safety}>
                {routePoints.length > 0
                  ? (hideEnds ? "Start and finish hidden" : "Full route visible")
                  : ""}
              </Text>
            </View>
          </View>
      </ScrollView>

      <View style={styles.footer}>
        {!!error && <Text accessibilityRole="alert" style={styles.stripLabel}>{error}</Text>}
        <Button label="Share summary" icon="share-outline" loading={busy} onPress={onShare} />
        <Button label="Share text details" variant="ghost" disabled={busy} onPress={() => {
          void Share.share({ message: proof.shareText }).catch(() => setError("Couldn’t open sharing. Please try again."));
        }} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flexGrow: 1, paddingTop: spacing.sm, paddingBottom: spacing.md },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.lg,
    ...shadows.float,
  },
  shareMap: { height: 240, width: "100%", marginTop: spacing.sm },
  privacyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    minHeight: 44,
  },
  privacyText: { ...type.caption, fontSize: 11.5, fontWeight: "600" },
  brandRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
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
  statRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  stat: { flexGrow: 1, flexBasis: 80, alignItems: "center", gap: 2 },
  statValue: { ...type.title, fontSize: 22, lineHeight: 34, includeFontPadding: true, fontVariant: ["tabular-nums"] },
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
