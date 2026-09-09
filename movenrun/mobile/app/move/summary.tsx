import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Alert, BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { DisplayHeading } from "@/components/DisplayHeading";
import { mapBasemapAvailable } from "@/components/map/MovenMap";
import { RouteMapPanel } from "@/components/RouteMapPanel";
import { CountUpText } from "@/components/CountUpText";
import { Hexagon } from "@/components/Hexagon";
import { MovementMetric } from "@/components/MovementMetric";
import { FadeSlideIn, STAGGER_MS } from "@/components/FadeSlideIn";
import { colors, iconTile, ink, palette, pressFade, radius, shadows, softTint, spacing, tints, type } from "@/theme";
import { formatDuration, formatPace } from "@/lib/geo";
import {
  clearLastSession,
  getLastSession,
  getVerificationState,
  isSaveable,
  sessionXp,
  setVerificationState,
  subscribeVerification,
} from "@/services/moveSession";
import { MovementApiClient } from "@/services/movementApi";
import { submitCompletedSession } from "@/services/verifySession";
import { serverSealLabel, toVerifiedRecord, verificationLabel } from "@/lib/verifiedMovement";
import { isVerifiable } from "@/lib/movementVerification";
import { newCapturedZone } from "@/lib/zones";
import { cellsForRoute } from "@/lib/territoryCells";
import { touchedCells } from "@/lib/mapCells";
import { finishedSealLabel, sealFinishedRoute } from "@/lib/sealPreview";
import { useGameStore, useIsCompletedToday } from "@/store/useGameStore";
import { useAuthStore } from "@/store/useAuthStore";
import { scoreRoute, type TrustTone } from "@/lib/routeTrust";
import { gapNotice, summarizeGaps } from "@/lib/trackPoints";
import { resolveCompletion } from "@/lib/completionSummary";
import { hasDrawableRoute, routeMapState } from "@/lib/routeMapState";
import type { Quest } from "@/types";
import { successFeedback, tapFeedback } from "@/lib/haptics";
/* One owner for this id: the Home board filters history by it to tell a real
   movement session apart from an indoor warmup quest. */
import { SESSION_QUEST_ID } from "@/lib/sessionQuest";
import { backIntent, returnToToday, type BackContext } from "@/lib/todayNavigation";

/**
 * One synthetic quest id per local day gates session XP through the store's
 * existing once-per-day award logic — saving repeatedly can't farm XP.
 */

/**
 * The accent for the one result statement at the top of the screen.
 *
 * Colour is never the message — the headline says what happened in words — so
 * this only tints the kicker above it. A separate callout component used to own
 * this mapping and rendered the same three strings the header already showed;
 * it had no other caller and went with the duplication.
 */
function toneAccent(tone: ReturnType<typeof resolveCompletion>["tone"]): string {
  switch (tone) {
    case "green": return ink.green;
    case "warning": return ink.gold;
    case "neutral": return colors.textDim;
    default: return palette.baseBlue;
  }
}

/** Map a trust tone to its Daylight Cartography bar/text colors. */
function toneColor(tone: TrustTone): { bar: string; text: string } {
  switch (tone) {
    case "strong":
      return { bar: palette.pulseGreen, text: ink.green };
    case "good":
      return { bar: palette.baseBlue, text: palette.baseBlue };
    case "caution":
      return { bar: palette.moveGold, text: ink.gold };
    default:
      return { bar: palette.dustGray, text: colors.textDim };
  }
}

export default function MoveSummaryScreen() {
  const router = useRouter();
  const session = useMemo(() => getLastSession(), []);
  const trust = useMemo(() => (session ? scoreRoute(session) : null), [session]);
  const setRouteTrust = useGameStore((s) => s.setRouteTrust);
  const addRouteTrustRecord = useGameStore((s) => s.addRouteTrustRecord);
  const completeQuest = useGameStore((s) => s.completeQuest);
  const captureZone = useGameStore((s) => s.captureZone);
  const recordMovementVerification = useGameStore((s) => s.recordMovementVerification);
  const defendZones = useGameStore((s) => s.defendZones);
  const ownedZones = useGameStore((s) => s.zones);
  const alreadySavedToday = useIsCompletedToday(SESSION_QUEST_ID);
  /* THE identity client, built once by the auth store — screens never
     construct their own. The movement client rides its transport, so both
     domains share one bearer attachment and one single-flight refresh. */
  const identityClient = useAuthStore((s) => s.client);
  /* Server-derived account id. Used only as the LOCAL owner key for a queued
     retry — it is never sent to /movement/verify, which derives the user from
     the bearer token and would be wrong to trust a client-supplied id. */
  const accountId = useAuthStore((s) => (s.status === "signedIn" ? s.user?.id ?? null : null));
  const movementClient = useMemo(
    () => (identityClient ? new MovementApiClient(identityClient.transport) : null),
    [identityClient],
  );
  const [saved, setSaved] = useState(false);
  const [showRouteDetails, setShowRouteDetails] = useState(false);
  const savingRef = useRef(false);
  /** The Back handler's inputs, refreshed each render. See `leave` below. */
  const exitRef = useRef<BackContext>({ saveInFlight: false, unsavedProgress: false });
  const verification = useSyncExternalStore(subscribeVerification, getVerificationState, getVerificationState);
  const zonesTouched = useMemo(() => session ? cellsForRoute(session.points) : [], [session]);
  const seal = useMemo(() => session ? sealFinishedRoute(session) : null, [session]);
  /* The same cells, as map overlay input. `touched` and never `held`: the map
     shows where the route went, which is evidence of movement. Whether any of
     it becomes ground is the server's answer from verified evidence, and the
     summary must not colour it in ahead of that.
     Declared here, above the no-session early return, because a hook after a
     conditional return is a hook that does not always run. */
  const mapCells = useMemo(() => touchedCells(zonesTouched), [zonesTouched]);
  /* The session's own pauses, so the drawn line breaks exactly where the
     measured distance stops counting. */
  const mapPauses = useMemo(() => session?.session?.pauses ?? [], [session]);
  /**
   * What the map slot resolves to: a route, the player's ground, or a panel
   * saying there is neither.
   *
   * Decided in `lib/routeMapState.ts` rather than here. A 0 m session used to
   * hand an empty point array straight to the map, which has no honest viewport
   * for a route that does not exist and so opened at world scale — a map of
   * nowhere, presented as the result of the session.
   */
  const mapState = useMemo(
    () => routeMapState({
      points: session?.points ?? [],
      pauses: session?.session?.pauses ?? [],
      displaySeed: session?.displaySeed ?? null,
      mapAvailable: mapBasemapAvailable(),
    }),
    [session],
  );

  /**
   * Android hardware Back.
   *
   * It used to pop the screen, which navigated without releasing the handoff:
   * the route's raw coordinates and the display seed stayed in module memory, a
   * still-unsaved session was discarded with no confirmation and no way back to
   * it, and the leftover session made a "View route summary" button appear on
   * unrelated zone screens. `gestureEnabled: false` in the stack does not cover
   * this — it disables the swipe and has no effect on the hardware button.
   *
   * Every case now ends the way `Back to Today` does, through `returnToToday`,
   * which releases the handoff. Registered above the no-session early return,
   * because a hook after a conditional return is a hook that does not always
   * run.
   */
  const done = useCallback(() => {
    returnToToday(router, clearLastSession);
  }, [router]);

  const leave = useCallback(() => {
    const intent = backIntent(exitRef.current);
    if (intent === "block") return true;
    if (intent === "leave") { done(); return true; }
    Alert.alert(
      "Leave without saving?",
      "This session won't be saved, and its XP won't be earned.",
      [
        { text: "Keep summary", style: "cancel" },
        { text: "Leave", style: "destructive", onPress: done },
      ],
    );
    return true;
  }, [done]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", leave);
    return () => sub.remove();
  }, [leave]);

  if (!session) {
    return (
      <Screen>
        <View style={styles.missingWrap}>
          <Text style={styles.missingText}>No session to show.</Text>
          <Button label="Back to Today" variant="secondary" onPress={() => returnToToday(router, clearLastSession)} />
        </View>
      </Screen>
    );
  }

  /* Foreground-only tracking stops when the app is backgrounded. If that
     happened, the distance below is a floor, not a measurement — say so rather
     than presenting an incomplete route as the truth. */
  const gaps = gapNotice(summarizeGaps(session.gaps ?? [], session.durationMs));

  const km = session.distanceM / 1000;
  const xp = sessionXp(session.distanceM, session.durationMs);
  const pace = formatPace(session.distanceM, session.durationMs);
  const saveable = session.mode === "gps" && isSaveable(session.distanceM, session.durationMs);
  const evidenceComplete = session.evidenceStatus !== "capacity_limited";
  /**
   * Did this session actually move?
   *
   * `isSaveable` is distance **OR** duration, so five minutes of standing still
   * is saveable while having gone nowhere. That one conflation is what let a
   * motionless session bank XP, bump the streak, refresh a zone's defence,
   * increment the defend counter and play the capture celebration.
   *
   * `hasDrawableRoute` is the existing canonical predicate for "there is a
   * route here" — the same one the map slot uses to decide whether a line can
   * honestly be drawn, and the same evidence-break rule the polyline and the
   * measured distance already share. Reusing it adds no new threshold and
   * cannot drift from what the screen draws.
   *
   * The app's own words already set this bar: the defend collection reads
   * "Defend a zone by moving over it".
   */
  const movedOverGround = hasDrawableRoute(session.points, mapPauses);
  /* Whether Save will actually reach the server, so the upload disclosure is
     shown exactly when it is true. Same predicate the submission itself uses. */
  const willSubmit = isVerifiable({
    mode: session.mode,
    finished: true,
    saveable,
    points: session.points,
  });

  /* Territory touched — the real H3 resolution-8 cells this route passed
     through, derived from the in-memory route through the same shared domain
     the backend verifies with. Derived here and not stored: a sequence of
     cells is coarse location history, and only a captured cell reaches disk.
     Touching a cell is not owning it — capture below is still local preview
     state, and no server has agreed to any of it. */
  const candidate =
    zonesTouched.find((t) => !ownedZones.some((z) => z.id === t.id)) ?? null;
  const ownedTouched = zonesTouched.filter((t) =>
    ownedZones.some((z) => z.id === t.id),
  );

  /**
   * Did this route close?
   *
   * Computed once from the finished route, locally, through the same shared
   * engine the server runs. It is a **preview**: the server recomputes sealing
   * from verified evidence and that is the answer that counts. Null when the
   * session carries no provenance or a rules version this build cannot read —
   * which means *unknown*, and unknown never grants anything.
   */

  /**
   * Nothing about a route becomes ground until the route seals.
   *
   * This gate is the product catching up with its own core mechanic. Saving a
   * qualifying session used to claim the first untouched cell it passed
   * through, with no closure of any kind — which is precisely the thing V3 says
   * does not happen. An open route now banks its XP, its history and its
   * verification exactly as before, and claims nothing.
   *
   * What it does NOT do is grant server-side territory, or invent solid or
   * shade ground. The zone list this writes to is local preview state that no
   * server has agreed to, and it stays that.
   */
  const captureEligible =
    saveable && evidenceComplete && !alreadySavedToday && candidate !== null && seal?.sealed === true;

  /* Truthful completion state — the reward block only shows when there is a
     real reward to bank, and is always tagged local preview (never confirmed
     payout). Capture/defend saves navigate away to the capture screen, so the
     "saved" state reachable here is the zero-capture save. */
  const completion = resolveCompletion({
    mode: session.mode,
    saveable,
    movedOverGround,
    alreadySavedToday,
    saved,
    outcome: saved ? "saved" : null,
    defendedCount: 0,
  });

  const save = () => {
    if (!saveable || saved || alreadySavedToday || savingRef.current) return;
    savingRef.current = true;
    tapFeedback();
    /* Synthetic "quest" routes the award through the existing store: same
       XP-once-per-day gate, same history, no new earning logic. */
    const sessionQuest: Quest = {
      id: SESSION_QUEST_ID,
      title: "Movement Session",
      summary: "GPS movement session",
      description: "A real-world movement session tracked with foreground GPS.",
      category: "Cardio",
      difficulty: "Medium",
      durationSeconds: Math.round(session.durationMs / 1000),
      xpReward: xp,
      icon: "navigate",
      instructions: [],
    };
    /* Movement reward, movement streak and the movement history row all go
       through this one action, and all three are earned by moving. A session
       that recorded no route is saved without it: it still gets its
       route-history record below, and Home's movement task — which filters
       history by SESSION_QUEST_ID — correctly stays unsatisfied. */
    if (movedOverGround) completeQuest(sessionQuest);
    /* Server verification of the completed route.
       Saving is the user's deliberate act of turning this session into
       progress, and it is the only path that is already gated to real GPS
       sessions long enough to be worth keeping — so it is the honest place for
       the route to leave the device, and the only one.
       Fire-and-forget on purpose: `submitCompletedSession` never throws, the
       result is recorded against this session's stable id, and a slow or
       failed verification must never delay or block a completion the user has
       already earned. Nothing below depends on it. */
    if (movementClient) {
      void submitCompletedSession(session, {
        client: movementClient,
        readState: getVerificationState,
        writeState: setVerificationState,
        /* Who may retry this route if the request fails, taken from
           authenticated session state and never from anything on the session
           itself. Null when nobody is signed in, which means the failure stays
           in memory and no coordinates are written to disk at all. */
        ownerUserId: accountId,
      }).then((state) => {
        /* Keep only a settled verdict, addressed by THIS session's stable id.
           `toVerifiedRecord` returns null for local/submitting/pending, so a
           failed attempt records nothing rather than a row that looks like an
           answer. Nothing here captures a zone or awards anything — the store
           action only appends what the server said. */
        const record = toVerifiedRecord(session.clientSessionId, state);
        if (record) recordMovementVerification(record);
      });
    }
    /* Persist the route-trust *preview* summary only (score + label) — never
       raw GPS points, and it does not affect rewards or capture. */
    if (trust) setRouteTrust(trust.score, trust.label);
    successFeedback();
    /* Movement defend: the route touched zones you already own. */
    /* Territory defence needs movement over the ground, not time spent near it.
       Without this a five-minute stand inside an owned zone refreshed its
       defence and control, reset its decay clock, incremented `timesDefended`
       — which feeds collections, season objectives, the questline, club
       scoring and the passport — and redirected to the capture celebration. */
    const defendedCount = evidenceComplete && movedOverGround
      ? defendZones(ownedTouched.map((t) => t.id))
      : 0;
    /* One common zone per saved session (and saves are once per day).
       New capture takes priority for the result moment; defended zones are
       reported alongside it. */
    let captured = false;
    let capturedId: string | null = null;
    if (candidate && evidenceComplete && seal?.sealed === true) {
      const outcome = captureZone(newCapturedZone(candidate, false));
      captured = outcome.captured;
      if (outcome.captured) capturedId = outcome.zone.id;
    }
    /* Append a local route-review record — summary only (score/label/flags +
       scalar distance/duration/outcome). That record holds no coordinates or path.
       Demo and too-short routes never reach save(), so they never append. */
    if (trust) {
      addRouteTrustRecord({
        trustScore: trust.score,
        trustLabel: trust.label,
        explanation: trust.explanation,
        positiveSignals: trust.positiveSignals,
        riskFlags: trust.riskFlags,
        distanceMeters: Math.round(session.distanceM),
        durationSeconds: Math.round(session.durationMs / 1000),
        routeOutcome: captured ? "captured" : defendedCount > 0 ? "defended" : "saved",
        zoneCountTouched: zonesTouched.length,
        defendedCount,
      });
    }
    if (captured && capturedId) {
      router.replace({
        pathname: "/move/captured",
        params: { id: capturedId, kind: "captured", defended: String(defendedCount) },
      });
      return;
    }
    if (defendedCount > 0) {
      router.replace({
        pathname: "/move/captured",
        params: { id: ownedTouched[0].id, kind: "defended", defended: String(defendedCount) },
      });
      return;
    }
    setSaved(true);
  };

  const showFooterSave = saveable && !saved && !alreadySavedToday;

  /* Keep the exit decision's inputs current. Assigned during render rather
     than held in state because nothing renders from it — the Back handler is
     the only reader, and a state round-trip would re-render the route canvas
     for a value the canvas does not use. */
  exitRef.current = {
    /* A save is one synchronous transaction; `savingRef` latches at its start
       and `saved` marks it settled. The server submission it fires is
       deliberately not waited on — it is single-flighted by session id and its
       payload is built before the first await, so leaving cannot orphan it. */
    saveInFlight: savingRef.current && !saved,
    /* Only real, bankable progress is worth a prompt. */
    unsavedProgress: showFooterSave && movedOverGround,
  };

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* The result, stated once.
            This block and the callout below it used to say the same thing twice:
            the kicker was rendered here and again inside the callout, and
            "Not enough movement" appeared as both a page subtitle and a callout
            headline. A reader does not learn a fact twice by reading it twice —
            they start wondering whether the two are different facts. */}
        <View style={styles.header}>
          <DisplayHeading eyebrow={completion.kicker} title={completion.headline} detail={completion.detail} />
        </View>

        {gaps ? (
          <View style={styles.gapNotice}>
            <Ionicons name="alert-circle-outline" size={16} color={palette.moveGold} />
            <Text style={styles.gapText}>{gaps}</Text>
          </View>
        ) : null}
        {!evidenceComplete ? (
          <View style={styles.gapNotice}>
            <Ionicons name="information-circle-outline" size={16} color={colors.textDim} />
            <Text style={styles.gapText}>
              Your workout continued. The full route could not be retained, so this map shows
              the recorded section. Earlier loop previews remain; this workout cannot capture
              or strengthen territory and will be saved locally without a server route check.
            </Text>
          </View>
        ) : null}

        {/* What the session measured. Ahead of the map now: for a session with
            no route the numbers are the result, and a map slot explaining its
            own emptiness is a poor thing to lead with. */}
        <FadeSlideIn>
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <CountUpText value={km} decimals={2} style={styles.statValue} />
              <Text style={styles.statLabel}>km</Text>
            </View>
            <View style={styles.statDivider} />
            <MovementMetric value={formatDuration(session.durationMs)} label="time" />
            <View style={styles.statDivider} />
            <MovementMetric value={pace ?? "—"} label="pace /km" />
          </View>
        </FadeSlideIn>

        {/* The ground. A route where there is one, the player's own area where
            there is a position but no route, and a panel that says so where
            there is neither — never a default world view. */}
        <FadeSlideIn delay={STAGGER_MS}>
          <RouteMapPanel
            state={mapState}
            points={session.points}
            pauses={mapPauses}
            cells={mapCells}
            style={styles.routeMap}
          />
        </FadeSlideIn>

        {verification.kind !== "local" ? <View style={styles.zoneCard} accessibilityLiveRegion="polite">
          <Text style={styles.zoneTitle}>{verificationLabel(verification)}</Text>
          <Text style={styles.sealLine}>{serverSealLabel(verification)}</Text>
        </View> : null}

        {/* Rewards — only when there's a real reward to bank; always local preview */}
        {completion.showRewards ? (
          <FadeSlideIn delay={STAGGER_MS * 2}>
            <View style={styles.rewardCard}>
              {!completion.progressPersisted ? (
                <View style={styles.pendingBadge}>
                  <Ionicons name="time-outline" size={13} color={colors.textDim} />
                  <Text style={styles.pendingText}>Earn on save</Text>
                </View>
              ) : null}
              <View style={styles.rewardRow}>
                <View style={[styles.rewardIcon, { backgroundColor: softTint(palette.moveGold) }]}>
                  <Ionicons name="flash" size={18} color={palette.moveGold} />
                </View>
                <Text style={styles.rewardLabel}>XP</Text>
                <CountUpText value={xp} prefix="+" style={[styles.rewardValue, { color: ink.gold }]} />
              </View>
            </View>
          </FadeSlideIn>
        ) : null}

        {/* Territory touched — Free Map Beta simulation.
            Hidden entirely when the route touched nothing. It used to render
            regardless, so a session with no route showed a card whose whole
            content was "No zones reached yet" plus a sealing line about a route
            that does not exist plus a Preview tag — three labels reporting the
            absence the map panel above has already stated. */}
        {zonesTouched.length > 0 ? (
        <FadeSlideIn delay={STAGGER_MS * 3}>
          <View style={styles.zoneCard}>
            <View style={styles.zoneHead}>
              <Text style={styles.zoneTitle}>Areas traversed</Text>
              <Text style={styles.zoneCount}>
                {zonesTouched.length} zone{zonesTouched.length === 1 ? "" : "s"}
              </Text>
            </View>

            <View style={styles.zoneHexRow}>
              {zonesTouched.slice(0, 5).map((t, i) => {
                const owned = ownedZones.some((z) => z.id === t.id);
                const isCandidate = captureEligible && candidate?.id === t.id;
                return (
                  <Hexagon
                    key={t.id}
                    size={i === 0 ? 36 : 30}
                    color={owned ? tints.green : isCandidate ? tints.greenSoft : tints.neutral}
                    coreColor={
                      owned
                        ? palette.pulseGreen
                        : isCandidate
                          ? palette.voltMint
                          : undefined
                    }
                  />
                );
              })}
            </View>

            {candidate ? (
              <View style={styles.candidateRow}>
                <View style={[styles.candidateBadge, !captureEligible && { backgroundColor: colors.surfaceAlt }]}>
                  <Text style={[styles.candidateBadgeText, !captureEligible && { color: colors.textDim }]}>Common Zone</Text>
                </View>
                <Text style={styles.candidateName} numberOfLines={1}>
                  {candidate.name}
                </Text>
                <Text style={styles.candidateHint}>
                  {session.mode === "demo"
                    ? "demo only"
                    : captureEligible
                      ? "Capture preview"
                      : "traversed only"}
                </Text>
              </View>
            ) : (
              <Text style={styles.zoneEmpty}>All touched zones are already yours.</Text>
            )}

            {ownedTouched.length > 0 && saveable && movedOverGround && !alreadySavedToday && !saved && evidenceComplete ? (
              <Text style={styles.defendHint}>
                {ownedTouched.length} of yours touched — defense refreshes when you
                save.
              </Text>
            ) : null}

            {/* What the route did, stated plainly.
                An open route is not a failed workout: the session saved, the
                XP banked and the verification went out exactly as they always
                have. It simply did not close, and closing is what a route has
                to do before any of this ground can ever be claimed. Neutral
                type, no red, no "you missed it". */}
            <Text style={styles.sealLine}>{finishedSealLabel(seal)}</Text>
            {/* The one Preview label on this screen. The route-quality card
                below used to carry a second, and two of them read as two
                different qualifications rather than one honest one. */}
            <Text style={styles.zoneBeta}>Preview</Text>
          </View>
        </FadeSlideIn>
        ) : null}

        {/* Route Trust — local verification preview (does not affect rewards) */}
        {trust ? (
          <FadeSlideIn delay={STAGGER_MS * 4}>
            <View style={styles.trustCard}>
              <Pressable style={pressFade(styles.trustHead)} accessibilityRole="button"
                accessibilityLabel="Route quality details" accessibilityState={{ expanded: showRouteDetails }}
                onPress={() => setShowRouteDetails((shown) => !shown)}>
                <Text style={styles.trustTitle}>Route quality</Text>
                <View style={styles.previewBadge}>
                  <Text style={styles.previewBadgeText}>{trust.label}</Text>
                </View>
                <Ionicons name={showRouteDetails ? "chevron-up" : "chevron-down"} size={18} color={colors.textDim} />
              </Pressable>

              {showRouteDetails ? <>
              <View style={styles.trustScoreRow}>
                <View style={styles.trustScoreWrap}>
                  <Text style={[styles.trustScore, { color: toneColor(trust.tone).text }]}>
                    {trust.score}
                  </Text>
                  <Text style={styles.trustScoreMax}>/100</Text>
                </View>
                <View style={styles.trustLabelWrap}>
                  <Text style={[styles.trustLabel, { color: toneColor(trust.tone).text }]}>
                    {trust.label}
                  </Text>
                  <Text style={styles.trustExplain}>{trust.explanation}</Text>
                </View>
              </View>

              <View style={styles.trustBarTrack}>
                <View
                  style={[
                    styles.trustBarFill,
                    { width: `${trust.score}%`, backgroundColor: toneColor(trust.tone).bar },
                  ]}
                />
              </View>

              {trust.positiveSignals.length > 0 ? (
                <View style={styles.chipRow}>
                  {trust.positiveSignals.map((s) => (
                    <View key={s} style={[styles.chip, styles.chipGood]}>
                      <Ionicons name="checkmark-circle" size={12} color={ink.green} />
                      <Text style={[styles.chipText, { color: ink.green }]}>{s}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {trust.riskFlags.length > 0 ? (
                <View style={styles.chipRow}>
                  {trust.riskFlags.map((f) => (
                    <View key={f} style={[styles.chip, styles.chipRisk]}>
                      <Ionicons name="alert-circle" size={12} color={palette.heatCoral} />
                      <Text style={[styles.chipText, { color: ink.coral }]}>{f}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              </> : null}
            </View>
          </FadeSlideIn>
        ) : null}

        {trust && session.mode === "gps" ? (
          <FadeSlideIn delay={STAGGER_MS * 5}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Preview and share your route"
              style={pressFade(styles.proofRow)}
              onPress={() => {
                tapFeedback();
                router.push({
                  pathname: "/route/proof",
                  params: {
                    title: "Free Run",
                    score: String(trust.score),
                    label: trust.label,
                    distanceMeters: String(Math.round(session.distanceM)),
                    durationSeconds: String(Math.round(session.durationMs / 1000)),
                    outcome: saved ? "saved" : "summary-only",
                    zones: String(zonesTouched.length),
                    defended: "0",
                    at: new Date(session.finishedAt).toISOString(),
                  },
                });
              }}
            >
              <Ionicons name="share-social-outline" size={18} color={colors.primary} />
              <Text style={styles.proofText}>Share your route</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
            </Pressable>
          </FadeSlideIn>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {showFooterSave ? (
          <>
            {/* Said at the moment of the action, not buried in a settings page.
                Saving is what sends the route, so this is where the user finds
                out — and it is shown only when signed in, because a local-beta
                save genuinely uploads nothing. */}
            {/* Only when saving will actually send something. `isVerifiable`
                needs two points for the server to measure anything, so a
                one-fix stationary session is never submitted — promising the
                upload anyway would be the disclosure describing a request that
                does not happen. */}
            {accountId && evidenceComplete && willSubmit ? (
              <Text style={styles.uploadNote}>
                Saving sends this session&apos;s route to MovenRun to verify the distance.
              </Text>
            ) : null}
            <Button
              label={captureEligible ? "Save + preview capture" : "Save session"}
              icon={captureEligible ? "flag" : "bookmark"}
              onPress={save}
            />
          </>
        ) : null}
        <Button
          label="Back to Today"
          icon="home"
          variant={showFooterSave ? "secondary" : "primary"}
          onPress={done}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  gapNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: softTint(palette.moveGold),
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  gapText: { ...type.caption, fontSize: 12.5, lineHeight: 17, color: colors.text, flex: 1 },
  scroll: { paddingBottom: spacing.lg, gap: spacing.md },
  header: { paddingTop: spacing.lg, gap: spacing.xs },
  /* Tinted per result by `toneAccent`; the default here is only what shows if
     the accent is ever absent. */
  kicker: { ...type.kicker, color: colors.primary },
  /* The result itself. 24 rather than 28: "Not enough movement" is three words
     wider than "Your session" and wrapped a display line on a small screen. */
  title: { ...type.display, fontSize: 24, lineHeight: 30 },
  headerDetail: { ...type.caption, fontSize: 13, lineHeight: 18, color: colors.textDim },
  /* Taller than the old canvas: a real basemap needs room to be read as a
     place rather than a texture. */
  routeMap: { height: 240 },
  statsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    ...shadows.card,
  },
  stat: { flexGrow: 1, flexBasis: 84, alignItems: "center", gap: 2, paddingVertical: spacing.xs },
  statValue: { ...type.title, fontSize: 22, lineHeight: 34, includeFontPadding: true, fontVariant: ["tabular-nums"] },
  statLabel: { ...type.caption, fontSize: 11 },
  statDivider: { width: 1, alignSelf: "stretch", marginVertical: 6, backgroundColor: colors.surfaceAlt },
  rewardCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.float,
  },
  pendingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
  },
  pendingText: { ...type.caption, fontSize: 11, fontWeight: "600", color: colors.textDim },
  rewardRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  rewardIcon: { ...iconTile(38) },
  rewardLabel: { ...type.heading, fontSize: 15, flex: 1 },
  rewardLabelWrap: { flex: 1, gap: 1 },
  rewardLabelPlain: { ...type.heading, fontSize: 15 },
  rewardSub: { ...type.caption, fontSize: 11, color: colors.textFaint },
  rewardValue: { fontSize: 22, fontWeight: "800", letterSpacing: -0.4 },
  rewardDivider: { height: 1, backgroundColor: colors.surfaceAlt },
  zoneCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  zoneHead: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, justifyContent: "space-between", alignItems: "center" },
  zoneTitle: { ...type.heading, fontSize: 15 },
  zoneCount: { ...type.mono, fontSize: 12, color: colors.textDim },
  zoneHexRow: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40 },
  zoneEmpty: { ...type.caption, fontSize: 12.5, color: colors.textFaint },
  candidateRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  candidateBadge: {
    backgroundColor: softTint(palette.pulseGreen),
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
  },
  candidateBadgeText: { fontSize: 11, fontWeight: "700", color: ink.green },
  candidateName: { ...type.heading, fontSize: 14, flex: 1 },
  candidateHint: { ...type.caption, fontSize: 11.5, color: colors.textFaint },
  /* Deliberately the same neutral weight whether the route sealed or not.
     Colour is not carrying the meaning here — the sentence is. */
  sealLine: { ...type.caption, color: colors.textDim, marginTop: spacing.sm },
  zoneBeta: { ...type.mono, fontSize: 10.5, color: colors.textFaint },
  defendHint: { ...type.caption, fontSize: 12, color: ink.green, fontWeight: "600" },
  trustCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  trustHead: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, minHeight: 48, justifyContent: "space-between", alignItems: "center" },
  trustTitle: { ...type.heading, fontSize: 15 },
  previewBadge: {
    backgroundColor: softTint(palette.baseBlue),
    borderRadius: radius.pill,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
  },
  previewBadgeText: { fontSize: 10.5, fontWeight: "800", color: palette.baseBlue },
  trustScoreRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  trustScoreWrap: { flexDirection: "row", alignItems: "baseline" },
  trustScore: { ...type.title, fontSize: 34, fontVariant: ["tabular-nums"] },
  trustScoreMax: { ...type.caption, fontSize: 13, color: colors.textFaint },
  trustLabelWrap: { flex: 1, gap: 2 },
  trustLabel: { ...type.heading, fontSize: 15 },
  trustExplain: { ...type.caption, fontSize: 12, lineHeight: 16, color: colors.textDim },
  trustBarTrack: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: "hidden",
  },
  trustBarFill: { height: 8, borderRadius: radius.pill },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
  },
  chipGood: { backgroundColor: softTint(palette.pulseGreen) },
  chipRisk: { backgroundColor: softTint(palette.heatCoral) },
  chipText: { fontSize: 11, fontWeight: "700" },
  uploadNote: {
    ...type.body,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textDim,
    textAlign: "center",
    paddingHorizontal: spacing.sm,
  },
  proofRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  proofText: { flex: 1, ...type.heading, fontSize: 14.5 },
  footer: { paddingVertical: spacing.md, gap: spacing.sm },
  missingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg },
  missingText: { ...type.body },
});
