/**
 * The ONE sign-in block: "Continue with Google" and "Continue with Wallet".
 *
 * First run (`app/welcome.tsx`) and the account hub (`app/account/index.tsx`)
 * both render this, so the two entry points cannot drift apart. Guest play is
 * offered by each screen beside it, never hidden behind it.
 *
 * Holds presentation state only. Every sign-in goes through the auth store's
 * `signInWith`, so the store alone decides when someone is signed in, and an
 * error is shown only as fixed copy for a stable public code.
 *
 * Wallet sign-in never asks for a recovery phrase or a private key and never
 * requests a transaction: the wallet signs one plain-text message.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "@/components/Button";
import { colors, radius, softTint, spacing, type } from "@/theme";
import { useAuthStore } from "@/store/useAuthStore";
import { authErrorMessage } from "@/lib/emailAuth";
import { buildDeviceLabel } from "@/lib/deviceLabel";
import { normalizeHandoffCode, WALLET_APPS, type WalletAppId } from "@/lib/signInMethods";
import {
  finishWalletSignIn,
  hasPendingWalletSignIn,
  isGoogleSignInConfigured,
  signInWithGoogle,
  startWalletSignIn,
} from "@/services/signInProviders";
import { IdentityApiError } from "@/services/identityApi";

interface SignInOptionsProps {
  /** Locks every control (for example until the terms are accepted). */
  disabled?: boolean;
  /** Called while a request runs, so the screen can lock conflicting actions. */
  onBusyChange?: (busy: boolean) => void;
}

export function SignInOptions({ disabled = false, onBusyChange }: SignInOptionsProps) {
  const operation = useAuthStore((s) => s.operation);
  const authErrorCode = useAuthStore((s) => s.authErrorCode);
  const signInWith = useAuthStore((s) => s.signInWith);
  const [choosingWallet, setChoosingWallet] = useState(false);
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [code, setCode] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const busy = operation !== "idle";
  const locked = disabled || busy || inFlight.current;
  const googleAvailable = isGoogleSignInConfigured();
  const errorText = authErrorMessage(localError ?? authErrorCode);

  /* A wallet sign-in started earlier (the app may have been closed while the
     wallet was open) brings the code field back when the app returns. */
  const checkPending = useCallback(() => {
    void hasPendingWalletSignIn().then(setAwaitingCode);
  }, []);
  useEffect(() => {
    checkPending();
    const sub = AppState.addEventListener("change", (state) => { if (state === "active") checkPending(); });
    return () => sub.remove();
  }, [checkPending]);

  const runExclusive = async (action: () => Promise<void>) => {
    if (inFlight.current || busy || disabled) return;
    inFlight.current = true;
    setLocalError(null);
    onBusyChange?.(true);
    try {
      await action();
    } finally {
      inFlight.current = false;
      onBusyChange?.(false);
    }
  };

  const deviceLabel = buildDeviceLabel(Platform.OS);

  const google = () =>
    runExclusive(async () => {
      await signInWith((client) => signInWithGoogle(client, deviceLabel));
    });

  const openWallet = (app: WalletAppId) =>
    runExclusive(async () => {
      try {
        await startWalletSignIn(app);
        setAwaitingCode(true);
        setChoosingWallet(false);
      } catch (err) {
        setLocalError(err instanceof IdentityApiError ? err.code : "request_failed");
      }
    });

  const finish = () =>
    runExclusive(async () => {
      const normalized = normalizeHandoffCode(code);
      if (!normalized) return;
      const ok = await signInWith((client) => finishWalletSignIn(client, normalized, deviceLabel));
      if (ok) {
        setAwaitingCode(false);
        setCode("");
      } else if (useAuthStore.getState().authErrorCode === "wallet_sign_in_expired") {
        setAwaitingCode(false);
      }
    });

  return (
    <View style={styles.wrap}>
      {googleAvailable ? (
        <Button
          label="Continue with Google"
          icon="logo-google"
          onPress={() => { void google(); }}
          loading={operation === "signingIn" && !awaitingCode}
          disabled={locked}
        />
      ) : null}

      <Button
        label="Continue with Wallet"
        icon="wallet-outline"
        variant={googleAvailable ? "secondary" : "primary"}
        onPress={() => setChoosingWallet((v) => !v)}
        disabled={locked}
        accessibilityHint="Sign in by signing a message in your wallet app. No transaction, no fee."
      />

      {choosingWallet ? (
        <View style={styles.panel}>
          <Text style={styles.body}>
            Choose your wallet. It opens MovenRun&apos;s sign-in page and asks you to sign one message. That
            is not a transaction and costs nothing. MovenRun never asks for your recovery phrase.
          </Text>
          {WALLET_APPS.map((app) => (
            <Button key={app.id} label={app.label} variant="secondary" onPress={() => { void openWallet(app.id); }} disabled={locked} />
          ))}
        </View>
      ) : null}

      {awaitingCode ? (
        <View style={styles.panel}>
          <Text style={styles.body}>
            After signing, your wallet brings you back here. If it doesn&apos;t, enter the code shown on the
            sign-in page.
          </Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={(v) => setCode(v.toUpperCase().slice(0, 16))}
            placeholder="Sign-in code"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel="Wallet sign-in code"
            editable={!locked}
          />
          <Button
            label="Finish signing in"
            onPress={() => { void finish(); }}
            loading={operation === "signingIn" && awaitingCode}
            disabled={locked || normalizeHandoffCode(code) === null}
          />
        </View>
      ) : null}

      <Text style={styles.helper}>
        New here? Your account is created the first time you sign in. Google and wallet sign-ins are
        separate accounts, so use the same one each time.
      </Text>

      {errorText ? (
        <View style={styles.errorBox} accessibilityLiveRegion="polite">
          <Text style={styles.errorText}>{errorText}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  panel: { gap: spacing.sm },
  body: { ...type.body, fontSize: 14, lineHeight: 20, color: colors.textDim },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: 48,
    ...type.body,
    color: colors.text,
    letterSpacing: 2,
  },
  helper: { ...type.caption, fontSize: 12.5, color: colors.textDim },
  errorBox: {
    backgroundColor: softTint(colors.danger),
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  errorText: { ...type.caption, color: colors.danger },
});
