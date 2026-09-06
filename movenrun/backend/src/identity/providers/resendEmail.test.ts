import { test } from "node:test";
import assert from "node:assert/strict";
import { createResendEmailDelivery, EmailOtpDeliveryError } from "./resendEmail.js";

const config = { RESEND_API_KEY: "re_test_credential", IDENTITY_EMAIL_FROM: "signin@preview.example.com" };
const input = { email: "runner@example.com", code: "849201", ttlSeconds: 300 };

test("missing email configuration leaves the delivery provider absent", () => {
  assert.equal(createResendEmailDelivery({}), null);
});

test("partial or invalid email configuration fails without leaking values", () => {
  for (const env of [
    { RESEND_API_KEY: config.RESEND_API_KEY },
    { IDENTITY_EMAIL_FROM: config.IDENTITY_EMAIL_FROM },
    { ...config, RESEND_API_KEY: "" },
    { ...config, RESEND_API_KEY: "re_key\r\nInjected: secret" },
    { ...config, IDENTITY_EMAIL_FROM: "MovenRun <signin@example.com>" },
    { ...config, IDENTITY_EMAIL_FROM: "signin@example.com\r\nBcc: victim@example.com" },
    { ...config, IDENTITY_EMAIL_FROM: "signin@localhost" },
    { ...config, IDENTITY_EMAIL_FROM: "signin@-invalid.example.com" },
    { ...config, IDENTITY_EMAIL_FROM: ".signin@example.com" },
  ]) {
    assert.throws(() => createResendEmailDelivery(env), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "Invalid email delivery configuration: RESEND_API_KEY and IDENTITY_EMAIL_FROM are required together");
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test("delivery sends the real code only to the fixed HTTPS provider with bounded redirect-free transport", async (t) => {
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  let timeoutRequests = 0;
  t.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    timeoutRequests++;
    assert.equal(milliseconds, 10_000);
    return timeout(milliseconds);
  });
  let requests = 0;
  const provider = createResendEmailDelivery(config, async (url, init) => {
    requests++;
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal instanceof AbortSignal);
    assert.equal(init.signal.aborted, false);
    assert.deepEqual(init.headers, { Authorization: `Bearer ${config.RESEND_API_KEY}`, "Content-Type": "application/json" });
    assert.deepEqual(JSON.parse(String(init.body)), {
      from: config.IDENTITY_EMAIL_FROM,
      to: [input.email],
      subject: "Your MovenRun sign-in code",
      text: "Your MovenRun sign-in code is 849201. It expires in 300 seconds. If you did not request this code, ignore this email.",
    });
    return new Response(JSON.stringify({ id: "message-id" }), { status: 200 });
  });
  assert.equal(provider?.providerName, "resend");
  assert.equal(await provider!.sendOtp(input), undefined);
  assert.equal(requests, 1);
  assert.equal(timeoutRequests, 1);
});

test("provider rejection, redirects, transport/timeout failure and malformed success all fail closed", async () => {
  const failures: Array<typeof fetch> = [
    ...[301, 400, 401, 403, 429, 500].map(status => async () => new Response("provider detail with recipient and secret", { status })),
    async () => { throw new Error(`transport leaked ${config.RESEND_API_KEY} ${input.email} ${input.code}`); },
    async () => { throw new DOMException("sensitive timeout details", "TimeoutError"); },
    async () => new Response("not-json", { status: 200 }),
    ...[null, {}, { id: "" }, { id: " " }, { id: 123 }].map(body => async () => new Response(JSON.stringify(body), { status: 200 })),
  ];
  for (const fetchImpl of failures) {
    const provider = createResendEmailDelivery(config, fetchImpl)!;
    await assert.rejects(provider.sendOtp(input), (error: unknown) => {
      assert.ok(error instanceof EmailOtpDeliveryError);
      assert.equal(error.message, "Email OTP delivery failed");
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test("invalid delivery input never reaches the email provider", async () => {
  let requests = 0;
  const provider = createResendEmailDelivery(config, async () => {
    requests++;
    return new Response(JSON.stringify({ id: "unexpected" }));
  })!;
  for (const invalid of [
    { ...input, email: "runner@example.com\r\nBcc: victim@example.com" },
    { ...input, code: "<script>" },
    { ...input, code: "12345" },
    { ...input, ttlSeconds: 0 },
    { ...input, ttlSeconds: 1.5 },
    { ...input, ttlSeconds: Number.POSITIVE_INFINITY },
  ]) await assert.rejects(provider.sendOtp(invalid), EmailOtpDeliveryError);
  assert.equal(requests, 0);
});
