/**
 * Account security screen — linked sign-in methods and full session/device
 * management: the current session card, other active sessions (each
 * revocable, with confirmation), recently ended sessions, "Sign out other
 * devices", "Sign out of this device", and "Sign out everywhere". The server
 * is authoritative for every list shown here; no secret is ever displayed.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { SectionHeader } from "@/components/SectionHeader";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useAuthStore } from "@/store/useAuthStore";
import type { PublicSessionSummary } from "@/services/identityApi";
import {
  canRevokeSession,
  groupSessions,
  sessionCaption,
  sessionStatusLabel,
} from "@/lib/sessionPresentation";
import { displayDeviceLabel } from "@/lib/deviceLabel";

function providerLabel(provider: string): string {
  switch (provider) {
    case "email_otp":
      return "Email";
    case "google":
      return "Google";
    case "base_account":
      return "Base Account";
    default:
      return provider;
  }
}

function SessionCard({
  session,
  onRevoke,
  revoking,
  actionsDisabled,
}: {
  session: PublicSessionSummary;
  onRevoke?: (s: PublicSessionSummary) => void;
  revoking: boolean;
  actionsDisabled: boolean;
}) {
  const label = displayDeviceLabel(session.deviceLabel);
  const statusLabel = sessionStatusLabel(session);
  const active = session.status === "active";
  return (
    <View
      style={[styles.card, session.isCurrent && styles.currentCard]}
      accessibilityLabel={`${label}, ${statusLabel}`}
    >
      <View style={styles.rowBetween}>
        <Text style={styles.method}>{label}</Text>
        <Badge
          label={statusLabel}
          color={session.isCurrent ? colors.primary : active ? colors.accent : colors.textFaint}
        />
      </View>
      <Text style={styles.caption}>{sessionCaption(session)}</Text>
      {canRevokeSession(session) && onRevoke ? (
        <Button
          label="Sign out this session"
          icon="close-circle-outline"
          variant="ghost"
          onPress={() => onRevoke(session)}
          loading={revoking}
          disabled={actionsDisabled}
        />
      ) : null}
    </View>
  );
}

export default function SecurityScreen() {
  const router = useRouter();
  const identities = useAuthStore((s) => s.identities);
  const status = useAuthStore((s) => s.status);
  const sessions = useAuthStore((s) => s.sessions);
  const sessionsStatus = useAuthStore((s) => s.sessionsStatus);
  const sessionsErrorCode = useAuthStore((s) => s.sessionsErrorCode);
  const pendingSessionAction = useAuthStore((s) => s.pendingSessionAction);
  const loadSessions = useAuthStore((s) => s.loadSessions);
  const revokeSession = useAuthStore((s) => s.revokeSession);
  const revokeOtherSessions = useAuthStore((s) => s.revokeOtherSessions);
  const signOut = useAuthStore((s) => s.signOut);
  const signOutEverywhere = useAuthStore((s) => s.signOutEverywhere);
  const [busy, setBusy] = useState(false);

  const signedIn = status === "signedIn";
  const anyActionInFlight = busy || pendingSessionAction !== null;

  // Load on mount and re-sync when the app returns to the foreground, so the
  // list recovers after resume instead of showing stale sessions.
  useEffect(() => {
    if (!signedIn) return;
    void loadSessions("initial");
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void loadSessions("refresh");
    });
    return () => sub.remove();
  }, [signedIn, loadSessions]);

  // If the session becomes invalid while on this screen (revoked from another
  // device), the store falls back to signedOut — return to the account entry.
  const wasSignedIn = useRef(signedIn);
  useEffect(() => {
    if (wasSignedIn.current && !signedIn) router.replace("/account");
    wasSignedIn.current = signedIn;
  }, [signedIn, router]);

  const confirmRevokeSession = useCallback(
    (session: PublicSessionSummary) => {
      const label = displayDeviceLabel(session.deviceLabel);
      Alert.alert(
        "Sign out this session?",
        `The session on "${label}" will be signed out immediately. This device stays signed in.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Sign out session", style: "destructive", onPress: () => void revokeSession(session.id) },
        ]
      );
    },
    [revokeSession]
  );

  const confirmRevokeOthers = () => {
    Alert.alert(
      "Sign out other devices?",
      "Every other session will be signed out. This device stays signed in.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Sign out other devices", style: "destructive", onPress: () => void revokeOtherSessions() },
      ]
    );
  };

  const doSignOut = async () => {
    setBusy(true);
    await signOut();
    setBusy(false);
    router.replace("/account");
  };

  const doSignOutEverywhere = async () => {
    setBusy(true);
    await signOutEverywhere();
    setBusy(false);
    router.replace("/account");
  };

  const confirmSignOutEverywhere = () => {
    Alert.alert(
      "Sign out of all devices?",
      "This ends every active MovenRun session, including this one. You'll need to sign in again on each device.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Sign out everywhere", style: "destructive", onPress: doSignOutEverywhere },
      ]
    );
  };

  const groups = groupSessions(sessions);
  const loading = sessionsStatus === "loading";
  const refreshing = sessionsStatus === "refreshing";

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadSessions("refresh")}
            enabled={signedIn}
          />
        }
      >
        <Text style={styles.h1} accessibilityRole="header">
          Account security
        </Text>

        <SectionHeader title="Sign-in methods" />
        {signedIn && identities.length > 0 ? (
          identities.map((i) => (
            <View key={i.id} style={styles.card}>
              <View style={styles.rowBetween}>
                <Text style={styles.method}>{providerLabel(i.provider)}</Text>
                <Badge label={i.verificationStatus === "verified" ? "Verified" : "Unverified"} color={colors.accent} />
              </View>
              <Text style={styles.caption}>Assurance level {i.assuranceLevel.toUpperCase()}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.caption}>Sign in to manage your login methods.</Text>
        )}

        <SectionHeader title="This device" />
        {!signedIn ? (
          <Text style={styles.caption}>Sign in to see your active sessions.</Text>
        ) : groups.current ? (
          <SessionCard session={groups.current} revoking={false} actionsDisabled />
        ) : loading ? (
          <Text style={styles.caption}>Loading your sessions…</Text>
        ) : (
          <Text style={styles.caption}>Session details unavailable. Pull to refresh.</Text>
        )}

        {signedIn ? (
          <>
            <SectionHeader title="Other devices" />
            {groups.otherActive.length > 0 ? (
              <>
                {groups.otherActive.map((s) => (
                  <SessionCard
                    key={s.id}
                    session={s}
                    onRevoke={confirmRevokeSession}
                    revoking={pendingSessionAction === s.id}
                    actionsDisabled={anyActionInFlight}
                  />
                ))}
                <Button
                  label="Sign out other devices"
                  icon="phone-portrait-outline"
                  variant="secondary"
                  onPress={confirmRevokeOthers}
                  loading={pendingSessionAction === "revoke-others"}
                  disabled={anyActionInFlight}
                />
              </>
            ) : loading ? (
              <Text style={styles.caption}>Loading…</Text>
            ) : (
              <Text style={styles.caption}>No other devices are signed in.</Text>
            )}

            {groups.recentlyEnded.length > 0 ? (
              <>
                <SectionHeader title="Recently ended" />
                {groups.recentlyEnded.map((s) => (
                  <SessionCard key={s.id} session={s} revoking={false} actionsDisabled />
                ))}
              </>
            ) : null}

            {sessionsStatus === "error" ? (
              <View style={styles.errorBox} accessibilityLiveRegion="polite">
                <Text style={styles.errorText}>
                  {sessionsErrorCode === "not_found"
                    ? "That session no longer exists. The list has been left unchanged — pull to refresh."
                    : "Couldn't update your session list. Pull to refresh to retry."}
                </Text>
              </View>
            ) : null}
          </>
        ) : null}

        <SectionHeader title="Sign out" />
        <Button
          label="Sign out of this device"
          icon="log-out-outline"
          variant="secondary"
          onPress={doSignOut}
          loading={busy}
          disabled={!signedIn || anyActionInFlight}
        />
        <Button
          label="Sign out everywhere"
          icon="shield-outline"
          variant="ghost"
          onPress={confirmSignOutEverywhere}
          disabled={!signedIn || anyActionInFlight}
          style={styles.spaced}
        />

        <View style={[styles.card, styles.noteCard]}>
          <Text style={styles.noteTitle}>MovenRun is non-custodial</Text>
          <Text style={styles.caption}>
            You control your wallet. MovenRun never holds, stores, or asks for your recovery phrase or private
            keys, and support can never move your funds. Anyone asking for your recovery phrase is trying to
            scam you.
          </Text>
        </View>
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
    gap: spacing.xs,
    ...shadows.card,
  },
  currentCard: { borderWidth: 1, borderColor: colors.primary },
  noteCard: { backgroundColor: palette.paleSky, marginTop: spacing.md },
  noteTitle: { ...type.heading, fontSize: 15 },
  method: { ...type.heading, fontSize: 15 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  spaced: { marginTop: spacing.sm },
  errorBox: {
    backgroundColor: `${colors.danger}14`,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  errorText: { ...type.caption, color: colors.danger },
});
