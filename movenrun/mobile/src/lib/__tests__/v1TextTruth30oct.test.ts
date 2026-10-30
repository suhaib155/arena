/**
 * Text-truth guard for the Play v1 candidate (T2, T4 to T12 of the Android
 * release-candidate audit). Pins that rendered v1 surfaces do not present an
 * estimate as verified, a local preview as ownership or banking, or a hidden
 * feature as available.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { movementXpLabel, movementXpStatus, type MovementXpEntry } from "../movementXp";
import { serverSealLabel, verificationLabel } from "../verifiedMovement";
import { sealPreviewLabel } from "../sealPreview";
import { deferredFeatureFor } from "../releaseScope";

const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const entry = (over: Partial<MovementXpEntry> = {}): MovementXpEntry => ({
  clientSessionId: "s", estimatedXp: 40, submitted: false, settled: null,
  verifiedXp: null, reversedXp: 0, savedAt: "2026-10-30T08:00:00Z", ...over,
});

test("T2: the four XP states read as estimate, estimate, verified, not eligible", () => {
  assert.equal(movementXpLabel(movementXpStatus(entry())), "Estimated on this phone");
  assert.equal(movementXpLabel(movementXpStatus(entry({ submitted: true }))), "Estimated, waiting for the server check");
  assert.equal(movementXpLabel(movementXpStatus(entry({ settled: "verified", verifiedXp: 40 }))), "Verified");
  assert.equal(movementXpLabel(movementXpStatus(entry({ settled: "not_eligible", reversedXp: 40 }))), "Not eligible");
});

test("T2: the summary shows the XP status and no longer says Earn on save", () => {
  const src = read("app/move/summary.tsx");
  assert.ok(!/Earn on save/.test(src));
  assert.match(src, /movementXpLabel\(movementXpStatus\(/);
});

test("T4 and T6: rejection and seal labels do not promise review or claimable land", () => {
  assert.equal(verificationLabel({ kind: "rejected" } as never), "Not eligible");
  const sealed = serverSealLabel({ kind: "verified", sealed: true } as never);
  assert.ok(!/\bsealed\b/i.test(sealed) && /preview rules/.test(sealed), sealed);
  assert.ok(!/Needs review/.test(read("src/lib/verifiedMovement.ts")));
});

test("T5: the live seal preview says loop closed, never banked or sealed", () => {
  const labels = [0, 1, 3].map((n) => sealPreviewLabel({ sealedLoops: n, nearStart: true })).join(" ");
  assert.ok(!/seal/i.test(labels), labels);
  const session = read("app/move/session.tsx");
  assert.ok(!/banked/i.test(session.replace(/\/\*[\s\S]*?\*\//g, "")));
  assert.match(session, /This is a preview and nothing is claimed/);
  assert.ok(!/Make your mark/.test(session));
});

test("T7: no capture wording on the save button, the traversal hint or the stamp", () => {
  const summary = read("app/move/summary.tsx");
  assert.ok(!/Save \+ preview capture|"Capture preview"/.test(summary));
  assert.ok(!/Zone Captured/.test(read("app/move/captured.tsx")));
});

test("T8: permission copy does not offer a demo route that release builds do not have", () => {
  const src = read("src/lib/moveReadiness.ts");
  assert.ok(!/try a demo route/i.test(src));
});

test("T10: Base Sepolia technical screen is a deferred wallets route and has no entry row", () => {
  assert.equal(deferredFeatureFor("/settings/technical"), "wallets");
  assert.match(read("app/(tabs)/profile.tsx"), /isFeatureInRelease\("wallets"\) \? <NavRow\s+icon="cube-outline"/);
});

test("T12: legal text says the ground is a personal preview, not ownership, and names no Deeds", () => {
  const src = read("app/legal.tsx");
  assert.match(src, /personal preview on this device\. It is not ownership of any place/);
  assert.ok(!/Deed previews/.test(src));
});

test("T3: Home reads XP today from the settled ledger and labels unsettled estimates", () => {
  const home = read("app/(tabs)/index.tsx");
  assert.match(home, /xpEarnedToday\(history, undefined, movementXp\)/);
  assert.match(home, /XP today \(est\.\)/);
});
