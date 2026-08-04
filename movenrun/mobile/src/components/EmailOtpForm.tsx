/**
 * The ONE email + one-time-code form.
 *
 * Both first run (`app/welcome.tsx`) and the account hub (`app/account/index.tsx`)
 * render this component — the form is never copied into two screens, so the
 * two entry points cannot drift apart.
 *
 * Responsibility boundary: this owns *presentation and form state only* (the
 * two text fields, which step is showing, and in-flight de-duplication). It
 * holds no auth state, no tokens, no user record, and no server truth — the
 * caller passes async actions that go through the auth store/identity client,
 * and passes back a stable public error code. Nothing here can render a token,
 * a user id, or a wallet address, because it never receives one.
 */
import { useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "@/components/Button";
import { colors, radius, spacing, type } from "@/theme";
import {
  authErrorMessage,
  canSubmitEmail,
  canSubmitOtp,
  normalizeEmail,
  normalizeOtpCode,
  OTP_LENGTH,
} from "@/lib/emailAuth";

interface EmailOtpFormProps {
  /** An auth request is in flight in the store. */
  busy: boolean;
  /** Stable public error code from the store — never a raw message. */
  errorCode: string | null;
  /** Ask the server to send a code. Resolve true only when it accepted. */
  onSendCode: (email: string) => Promise<boolean>;
  /** Verify the code. The server confirms identity; the caller updates state. */
  onVerifyCode: (email: string, code: string) => Promise<void>;
  /** Optional line above the primary action (e.g. the new/returning note). */
  helperText?: string;
}

export function EmailOtpForm({
  busy,
  errorCode,
  onSendCode,
  onVerifyCode,
  helperText,
}: EmailOtpFormProps) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  /* Double-submit protection lives here, at the action layer — not in the
     button's press animation. A second tap while a request is in flight is
     dropped outright. */
  const inFlight = useRef(false);

  const errorText = authErrorMessage(errorCode);
  const disabled = busy || inFlight.current;

  const send = async () => {
    const normalized = normalizeEmail(email);
    if (!normalized || inFlight.current || busy) return;
    inFlight.current = true;
    try {
      // The screen never learns whether this address already has an account —
      // the same call creates or restores, and the same UI follows either way.
      const sent = await onSendCode(normalized);
      if (sent) setCodeSent(true);
    } finally {
      inFlight.current = false;
    }
  };

  const verify = async () => {
    const normalized = normalizeEmail(email);
    if (!normalized || !canSubmitOtp(code) || inFlight.current || busy) return;
    inFlight.current = true;
    try {
      await onVerifyCode(normalized, normalizeOtpCode(code));
    } finally {
      inFlight.current = false;
    }
  };

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
            editable={!disabled}
          />
          <Button
            label="Verify code"
            onPress={() => {
              void verify();
            }}
            loading={busy}
            disabled={disabled || !canSubmitOtp(code)}
          />
          <Button
            label="Use a different email"
            variant="ghost"
            onPress={editEmail}
            disabled={busy}
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
            editable={!disabled}
          />
          {helperText ? <Text style={styles.helper}>{helperText}</Text> : null}
          <Button
            label="Continue with email"
            icon="mail-outline"
            onPress={() => {
              void send();
            }}
            loading={busy}
            disabled={disabled || !canSubmitEmail(email)}
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
    backgroundColor: `${colors.danger}14`,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  errorText: { ...type.caption, color: colors.danger },
});
