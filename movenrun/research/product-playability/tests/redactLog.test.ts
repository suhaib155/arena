/**
 * The device-log redaction utility. All inputs are synthetic.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { redact } from "../tools/redactLog";

const SAMPLE = [
  'I/ReactNativeJS: fix {"latitude":0.5012345,"longitude":-25.4987654,"accuracy":8}',
  "D/Location: 0.50123, -25.49876 acc=8",
  "lat=0.5012345 lng=-25.4987654",
  "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789",
  "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c2lnbmF0dXJlc2lnbmF0dXJl",
  "movenrun://auth/callback?code=SYNTHETICCODE123&state=xyz",
  "user 3f6c1a2e-1111-4222-8333-944455556666 tester@example.invalid",
  "cell 8828308281fffff wallet 0x0000000000000000000000000000000000000001",
  "client 203.0.113.7",
].join("\n");

test("coordinates, tokens, auth parameters, emails, ids, cells, wallets and IPs are removed", () => {
  const { text, counts } = redact(SAMPLE);
  for (const leak of ["0.5012345", "-25.4987654", "0.50123", "abcdefghijklmnop", "eyJhbGci", "SYNTHETICCODE123",
    "3f6c1a2e", "tester@example.invalid", "8828308281fffff", "0x0000000000000000000000000000000000000001", "203.0.113.7"]) {
    assert.ok(!text.includes(leak), `leaked ${leak}`);
  }
  assert.ok(counts.coordinate_field! >= 4 && counts.coordinate_pair === 1);
});

test("useful structure survives: accuracy, log tags and the callback path", () => {
  const { text } = redact(SAMPLE);
  assert.ok(text.includes('"accuracy":8'));
  assert.ok(text.includes("I/ReactNativeJS"));
  assert.ok(text.includes("movenrun://auth/callback?code=[REDACTED]"));
});

test("version numbers and durations are not mistaken for coordinates", () => {
  const { text } = redact("expo 54.0.36 took 12.5 s; minSdk 24 targetSdk 36");
  assert.equal(text, "expo 54.0.36 took 12.5 s; minSdk 24 targetSdk 36");
});
