/**
 * The ONE email + one-time-code form.
 *
 * Both first run (`app/welcome.tsx`) and the account hub (`app/account/index.tsx`)
 * render this component — the form is never copied into two screens, so the two
 * entry points cannot drift apart.
 *
 * Responsibility boundary: this owns *presentation and form state only* (the
 * two text fields, which step is showing, and in-flight de-duplication). It
 * holds no auth state, no tokens, no user record, and no server truth — the
 * caller passes async actions that go through the auth store/identity client
 * and a stable public error code. Nothing here can render a token, a user id,
 * or a wallet address, because it never receives one.
 *
 * Error ownership: every failure shown here belongs to the FORM (a bad address,
 * a wrong or expired code, a rate limit). The user recovers by editing a field
 * and pressing the same button again — there is deliberately no
 * "retry session restore" affordance in this component, because a failed code
 * has nothing to do with restoring a stored session.
 */
import { useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "@/components/Button";
import { colors, radius, softTint, spacing, type } from "@/theme";
import {
  authErrorMessage,
  canSubmitEmail,
  canSubmitOtp,
  normalizeEmail,
  normalizeOtpCode,
  OTP_LENGTH,
} from "@/lib/emailAuth";

interface EmailOtpFormProps {
  /** True only while THIS form's request is running (sending or verifying).
   *  It is derived from the store's auth *operation*, never from session
   *  status — a successful send leaves the user signed out but must leave the
   *  code field editable. */
  busy: boolean;
  /** Stable public error code for the last sign-in attempt — never a raw
   *  message, and never a session-restore error. */
  errorCode: string | null;
  /** Ask the server to send a code. Resolve true only when it accepted. */
  onSendCode: (email: string) => Promise<boolean>;
  /** Verify the code. Resolve true only after the server confirmed sign-in. */
  onVerifyCode: (email: string, code: string) => Promise<boolean>;
  /** Optional line above the primary action (e.g. the new/returning note). */
  helperText?: string;
  /** Called whenever a request starts/ends, so the screen can gate conflicting
   *  actions (see app/welcome.tsx) for the brief moment one is in flight. */
  onBusyChange?: (busy: boolean) => void;
}

export function EmailOtpForm({
  busy,
  errorCode,
  onSendCode,
  onVerifyCode,
  helperText,
  onBusyChange,
}: EmailOtpFormProps) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  /* Double-submit protection lives here, at the action layer — not in the
     button's press animation. A second tap while a request is in flight is
     dropped outright (the store refuses a second concurrent operation too). */
  const inFlight = useRef(false);

  const errorText = authErrorMessage(errorCode);
  const locked = busy || inFlight.current;

  const runExclusive = async (action: () => Promise<void>) => {
    if (inFlight.current || busy) return;
    inFlight.current = true;
    onBusyChange?.(true);
    try {
      await action();
    } finally {
      inFlight.current = false;
      onBusyChange?.(false);
    }
  };

  const send = () =>
    runExclusive(async () => {
      const normalized = normalizeEmail(email);
      if (!normalized) return;
      // The screen never learns whether this address already has an account —
      // the same call creates or restores, and the same UI follows either way.
      const sent = await onSendCode(normalized);
      // Only a server-accepted request moves the form on. A failure leaves the
      // email step visible with the email intact so it can be corrected.
      if (sent) setCodeSent(true);
    });

  const verify = () =>
    runExclusive(async () => {
      const normalized = normalizeEmail(email);
      if (!normalized || !canSubmitOtp(code)) return;
      await onVerifyCode(normalized, normalizeOtpCode(code));
      /* Whatever the outcome, the code step stays on screen: an invalid code
         must remain correctable, so the field is never hidden and the email is
         never cleared out from under the user. */
    });

  const editEmail = () => {
    setCodeSent(false);
    setCode("");
  };

  return (
    <View style={styles.wrap}>
      {codeSent ? (
        <>
          <Text style={styles.sentTo}>
            We sent a {OTP_LENGTH}-digit code to <Text style={styles.sentEmail}>{email.trim()}</Text>.
          </Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={(v) => setCode(normalizeOtpCode(v))}
            placeholder={`${OTP_LENGTH}-digit code`}
            placeholderTextColor={colors.textFaint}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            accessibilityLabel="One-time code"
            // Editable except while THIS form is mid-request.
            editable={!locked}
          />
          <Button
            label="Verify code"
            onPress={() => {
              void verify();
            }}
            loading={busy}
            disabled={locked || !canSubmitOtp(code)}
          />
          <Button
            label="Use a different email"
            variant="ghost"
            onPress={editEmail}
            disabled={locked}
          />
        </>
      ) : (
        <>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            accessibilityLabel="Email address"
            editable={!locked}
          />
          {helperText ? <Text style={styles.helper}>{helperText}</Text> : null}
          <Button
            label="Continue with email"
            icon="mail-outline"
            onPress={() => {
              void send();
            }}
            loading={busy}
            disabled={locked || !canSubmitEmail(email)}
          />
        </>
      )}

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
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    // A comfortable target that still grows with the OS font size.
    minHeight: 48,
    ...type.body,
    color: colors.text,
  },
  helper: { ...type.caption, fontSize: 12.5, color: colors.textDim },
  sentTo: { ...type.body, fontSize: 14, lineHeight: 20, color: colors.textDim },
  sentEmail: { color: colors.text, fontWeight: "700" },
  errorBox: {
    backgroundColor: softTint(colors.danger),
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  errorText: { ...type.caption, color: colors.danger },
});
