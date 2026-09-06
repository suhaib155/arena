import type { EmailOtpDeliveryProvider } from "./types.js";

const ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;
// Deliberately accept a bare mailbox only, not display names or header syntax.
const MAILBOX = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

function validMailbox(value: string): boolean {
  return value.length <= 254 && value.split("@")[0].length <= 64 && MAILBOX.test(value);
}

/** No provider payload, recipient, OTP, or credential is attached to failures. */
export class EmailOtpDeliveryError extends Error {
  constructor() {
    super("Email OTP delivery failed");
    this.name = "EmailOtpDeliveryError";
  }
}

/** Missing configuration remains fail-closed in EmailOtpService. Partial or
 * invalid configuration is a startup error; never fall back to a demo sender. */
export function createResendEmailDelivery(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): EmailOtpDeliveryProvider | null {
  const apiKey = env.RESEND_API_KEY;
  const from = env.IDENTITY_EMAIL_FROM;
  if (apiKey === undefined && from === undefined) return null;
  if (!apiKey || !/^re_[A-Za-z0-9_-]+$/.test(apiKey) || !from || !validMailbox(from)) {
    throw new Error("Invalid email delivery configuration: RESEND_API_KEY and IDENTITY_EMAIL_FROM are required together");
  }

  return {
    providerName: "resend",
    async sendOtp({ email, code, ttlSeconds }): Promise<void> {
      if (!validMailbox(email) || !/^\d{6}$/.test(code) || !Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
        throw new EmailOtpDeliveryError();
      }
      try {
        const response = await fetchImpl(ENDPOINT, {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from,
            to: [email],
            subject: "Your MovenRun sign-in code",
            text: `Your MovenRun sign-in code is ${code}. It expires in ${ttlSeconds} seconds. If you did not request this code, ignore this email.`,
          }),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new EmailOtpDeliveryError();
        }
        const result: unknown = await response.json();
        if (!result || typeof result !== "object" || !("id" in result) || typeof result.id !== "string" || !result.id.trim()) {
          throw new EmailOtpDeliveryError();
        }
      } catch {
        // Do not propagate causes: transport errors can contain request secrets.
        throw new EmailOtpDeliveryError();
      }
    },
  };
}
