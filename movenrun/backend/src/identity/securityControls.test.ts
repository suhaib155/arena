/**
 * Cross-cutting security controls that don't belong to a single service:
 *  - production modules cannot import test doubles;
 *  - the audit log redacts auth/wallet-sensitive fields;
 *  - no executable schema carries a private-key/mnemonic/recovery-secret column;
 *  - API-facing errors don't reveal whether a user/email/wallet exists;
 *  - every sensitive transition writes an immutable audit event;
 *  - the replay/rate-limit authority is the shared store (replica-safe), not a
 *    process-local Map — a second service instance sharing the store still
 *    rejects a replay.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getTableColumns } from "drizzle-orm";
import { redactMetadata } from "./services/audit.service.js";
import { createHarness } from "./testDoubles/harness.js";
import * as identitySchema from "../db/identity.schema.js";
import { ERROR_HTTP_STATUS } from "./domain/errors.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

test("no production module under src/identity imports a test double", () => {
  const files = walk(HERE).filter(
    (f) => !f.endsWith(".test.ts") && !f.includes(`${join("identity", "testDoubles")}`) && !f.includes("/testDoubles/")
  );
  const offenders: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    if (/from\s+["'][^"']*testDoubles/.test(src) || /import\s*\(\s*["'][^"']*testDoubles/.test(src)) {
      offenders.push(f);
    }
  }
  assert.deepEqual(offenders, [], `production files must not import test doubles: ${offenders.join(", ")}`);
});

test("redactMetadata strips secret-shaped fields and non-scalars", () => {
  const out = redactMetadata({
    provider: "google",
    accessToken: "ya29.secret",
    refreshToken: "r-secret",
    signature: "0xdeadbeef",
    otp: "123456",
    seedPhrase: "word ".repeat(12),
    privateKey: "0xabc",
    email: "user@example.com",
    nested: { anything: true },
    count: 3,
    ok: true,
  });
  assert.equal(out!.provider, "google");
  assert.equal(out!.count, 3);
  assert.equal(out!.ok, true);
  for (const k of ["accessToken", "refreshToken", "signature", "otp", "seedPhrase", "privateKey", "email", "nested"]) {
    assert.equal(out![k], "[redacted]", `${k} must be redacted`);
  }
});

test("no identity table has a private-key / mnemonic / recovery-secret column", () => {
  const forbidden = /(privatekey|private_key|mnemonic|seed|secret|recovery|passphrase)/i;
  const offenders: string[] = [];
  for (const [tableName, table] of Object.entries(identitySchema)) {
    // Only inspect drizzle table objects.
    let columns: Record<string, unknown>;
    try {
      columns = getTableColumns(table as never);
    } catch {
      continue;
    }
    for (const col of Object.keys(columns)) {
      // `securityVersion` and `requestSourceHash` are safe; match on the
      // sensitive roots only.
      if (forbidden.test(col) && !/security/i.test(col)) offenders.push(`${tableName}.${col}`);
    }
  }
  assert.deepEqual(offenders, [], `schema must not carry secret columns: ${offenders.join(", ")}`);
});

test("auth error codes never encode user existence (uniform failure codes)", () => {
  // The failure a client sees for bad OTP, unknown challenge, and unknown
  // session all map to generic 401s — none is a "user exists" oracle.
  assert.equal(ERROR_HTTP_STATUS.verification_failed, 401);
  assert.equal(ERROR_HTTP_STATUS.session_invalid, 401);
  // There is deliberately no "user_not_found" / "email_not_registered" code.
  const codes = Object.keys(ERROR_HTTP_STATUS);
  assert.ok(!codes.some((c) => /not_registered|no_such_user|user_exists|email_taken/.test(c)));
});

test("sensitive transitions write immutable audit events, with redacted metadata", async () => {
  const h = createHarness({ otpGen: () => "424242" });
  const auth = await h.orchestrator.signupOrLogin({ providerIdentity: { provider: "google", providerSubject: "audit-user" } });
  const events = await h.audit.listByUser(auth.user.id);
  const types = events.map((e) => e.eventType);
  assert.ok(types.includes("signup"));
  assert.ok(types.includes("session_issued"));
  assert.ok(types.includes("wallet_provisioning_requested"));
  // Metadata never contains raw secrets even if a caller passed one.
  await h.audit.record("login", { userId: auth.user.id, metadata: { accessToken: "leak-me" } });
  const after = await h.audit.listByUser(auth.user.id);
  const withToken = after.find((e) => e.metadata && "accessToken" in e.metadata);
  assert.equal(withToken!.metadata!.accessToken, "[redacted]");
});

test("replay authority is the shared store — a fresh service instance still rejects a used OTP", async () => {
  const h = createHarness({ otpGen: () => "606060" });
  await h.emailOtp.begin({ email: "shared@example.com" });
  await h.emailOtp.complete({ email: "shared@example.com", code: "606060" });
  // A second EmailOtpService over the SAME store must not accept the used code.
  const { EmailOtpService } = await import("./services/emailOtp.service.js");
  const other = new EmailOtpService({
    otpChallenges: h.stores.otpChallenges,
    audit: h.audit,
    config: { otpPepper: "test-otp-pepper-abcdef0123456789", otpTtlSeconds: 300, otpMaxAttempts: 5, otpResendCooldownSeconds: 30 },
    delivery: h.delivery,
    now: h.now,
  });
  await assert.rejects(other.complete({ email: "shared@example.com", code: "606060" }));
});
