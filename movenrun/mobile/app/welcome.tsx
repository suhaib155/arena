/**
 * Account choice — the first thing a genuinely fresh user sees.
 *
 * Two honest paths and nothing else: continue with email (the server creates
 * or restores the account — the app never probes which), or explore the local
 * beta. Sign-in is never a hard blocker, because the product still works
 * locally and some builds ship with no account service at all.
 *
 * Deliberately absent: disabled Google/Base buttons (an unavailable provider
 * must not be advertised as a control), any wallet address, any user id, any
 * token, any backend host name, and any permission prompt.
 */
import { useEffect, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen } from "@/components/Screen";
import { Button } from "@/components/Button";
import { EmailOtpForm } from "@/components/EmailOtpForm";
import { Hexagon } from "@/components/Hexagon";
import { colors, palette, radius, shadows, spacing, type } from "@/theme";
import { useAuthStore } from "@/store/useAuthStore";
import { useGameStore } from "@/store/useGameStore";
import { isBackendConfigured } from "@/services/identityApi";
import { authErrorMessage } from "@/lib/emailAuth";
import { isAuthBusy } from "@/lib/authLifecycle";
import { buildDeviceLabel } from "@/lib/deviceLabel";
import { tapFeedback, successFeedback } from "@/lib/haptics";

export default function WelcomeScreen() {
  const status = useAuthStore((s) => s.status);
  const operation = useAuthStore((s) => s.operation);
  const authErrorCode = useAuthStore((s) => s.authErrorCode);
  const restoreErrorCode = useAuthStore((s) => s.restoreErrorCode);
  const beginEmailOtp = useAuthStore((s) => s.beginEmailOtp);
  const completeEmailOtp = useAuthStore((s) => s.completeEmailOtp);
  const retryRestore = useAuthStore((s) => s.retryRestore);
  const chooseLocalBeta = useGameStore((s) => s.chooseLocalBeta);
  const markSignedIn = useGameStore((s) => s.markSignedIn);
  const firstRunStage = useGameStore((s) => s.firstRun.stage);

  const backendConfigured = isBackendConfigured();
  const busy = isAuthBusy(operation);
  /* Conflicting actions are gated only for the brief moment a request is in
     flight, so choosing the local beta can never leave an unseen verification
     landing afterwards and changing first-run state behind the user's back.
     No cancellation infrastructure, no polling — just a short, honest lock. */
  const [formBusy, setFormBusy] = useState(false);
  const locked = busy || formBusy;

  /* The SERVER decides when someone is signed in. First-run state only follows
     that confirmation — never an optimistic local guess. Advancing the stage
     is what moves the app to the intro (the root layout owns navigation). */
  useEffect(() => {
    if (status === "signedIn" && firstRunStage === "account") {
      successFeedback();
      markSignedIn();
    }
  }, [status, firstRunStage, markSignedIn]);

  const onLocalBeta = () => {
    if (locked) return; // never start a second transition mid-request
    tapFeedback();
    chooseLocalBeta();
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.brandRow}>
          <Hexagon size={20} color="#C9EEDE" coreColor={palette.pulseGreen} />
          <Text style={styles.brand}>MovenRun</Text>
        </View>

        <Text style={styles.h1} accessibilityRole="header">
          Protect your MovenRun progress
        </Text>
        <Text style={styles.lede}>
          Continue with email to create or restore your MovenRun account. Your wallet is prepared
          automatically when the service is available — no seed phrase required.
        </Text>

        {backendConfigured ? (
          <View style={styles.card}>
            <EmailOtpForm
              busy={busy}
              errorCode={authErrorCode}
              helperText="New here? We create your account automatically. Returning? Use the same email."
              onBusyChange={setFormBusy}
              onSendCode={beginEmailOtp}
              onVerifyCode={(email, code) =>
                completeEmailOtp(email, code, buildDeviceLabel(Platform.OS))
              }
            />
            {/* A restore Retry belongs ONLY to a failed session restoration.
                A wrong or expired code is a form error and is corrected inside
                the form — offering "Retry" for it would run the wrong
                operation entirely. */}
            {restoreErrorCode ? (
              <View style={styles.restoreBox} accessibilityLiveRegion="polite">
                <Text style={styles.statusBody}>{authErrorMessage(restoreErrorCode)}</Text>
                <Button
                  label="Retry"
                  variant="secondary"
                  icon="refresh-outline"
                  disabled={locked}
                  onPress={() => {
                    tapFeedback();
                    void retryRestore();
                  }}
                />
              </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.card} accessibilityLiveRegion="polite">
            <View style={styles.statusRow}>
              <Ionicons name="cloud-offline-outline" size={18} color={colors.textDim} />
              <Text style={styles.statusTitle}>Accounts aren&apos;t available in this build</Text>
            </View>
            <Text style={styles.statusBody}>
              {authErrorMessage("api_base_url_unset")}
            </Text>
          </View>
        )}

        <Button
          label="Explore local beta"
          variant="secondary"
          icon="walk-outline"
          disabled={locked}
          onPress={onLocalBeta}
        />

        {/* Honest footer. There is no hosted privacy/terms page in this build,
            so the facts are stated here rather than linking somewhere that
            does not exist. */}
        <View style={styles.footer}>
          <Text style={styles.footerHeading}>Privacy</Text>
          <Text style={styles.footerText}>
            Your route stays on your device. Raw GPS is never uploaded and is not kept in your
            progress history.
          </Text>
          <Text style={styles.footerHeading}>Terms</Text>
          <Text style={styles.footerText}>
            MovenRun is a local beta. There is no purchase, no reward payout, and no minting.
          </Text>
          <Text style={styles.footerText}>
            You can explore the local beta without an account or a wallet, and sign in later from
            Profile without losing your progress.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg, paddingVertical: spacing.lg, paddingBottom: spacing.xxl },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  brand: { ...type.heading, fontSize: 16 },
  h1: { ...type.display, fontSize: 28, lineHeight: 34 },
  lede: { ...type.body, fontSize: 15, lineHeight: 22, color: colors.textDim },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  statusTitle: { ...type.heading, fontSize: 15, flex: 1 },
  statusBody: { ...type.body, fontSize: 13.5, lineHeight: 19, color: colors.textDim },
  restoreBox: { gap: spacing.md, paddingTop: spacing.xs },
  footer: { gap: spacing.xs, paddingTop: spacing.sm },
  footerHeading: { ...type.kicker, color: colors.textDim, paddingTop: spacing.xs },
  footerText: { ...type.caption, fontSize: 12, lineHeight: 17, color: colors.textFaint },
});
