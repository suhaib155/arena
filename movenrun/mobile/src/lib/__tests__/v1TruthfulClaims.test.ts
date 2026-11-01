/**
 * v1 truthful-claims copy guard. Play v1 has no token, no owned zones, no
 * on-chain play, and account deletion can finish in the background. These
 * tests pin that the strings that used to say otherwise are gone from the
 * rendered surfaces (component and screen sources, plus the data modules they
 * render from).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BASE_SEPOLIA_STATUS } from "../../data/contractStatus";
import { INTRO_STEPS } from "../introFlow";
import { buildQuestline } from "../onboardingQuestline";

const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

test("share card no longer claims ownership", () => {
  const src = read("src/components/ShareCard.tsx");
  assert.ok(!/Move → Capture → Own/.test(src));
  assert.match(src, /Move → Explore → Progress/);
});

test("season objectives hero no longer claims ownership", () => {
  const src = read("app/season-objectives.tsx");
  assert.ok(!/Own your season/.test(src));
  assert.match(src, /Shape your season\./);
});

test("contract reference rows claim no token, oracle verification, or owned-zone battles", () => {
  const text = BASE_SEPOLIA_STATUS.contracts.map((c) => c.purpose).join("\n");
  assert.ok(!/\$MOVE token contract|oracle-gated|capped supply/i.test(text));
  assert.ok(!/Verifies signed GPS|before any on-chain action/i.test(text));
  assert.ok(!/land-defence|owned zones/i.test(text));
  for (const key of ["MoveToken", "GPSOracle", "ZoneChallenge"]) {
    const c = BASE_SEPOLIA_STATUS.contracts.find((x) => x.key === key);
    assert.ok(c && /^Testnet reference only\./.test(c.purpose), key);
  }
});

test("intro and questline do not assert live capture, defence or owned zones", () => {
  const intro = INTRO_STEPS.map((s) => `${s.title} ${s.body}`).join("\n");
  assert.ok(!/capture|defend|strengthen|control fades/i.test(intro));
  const src = read("src/lib/onboardingQuestline.ts");
  assert.ok(!/zone you own/i.test(src));
  assert.ok(typeof buildQuestline === "function");
});

test("deletion copy does not claim a finished sign-in record removal", () => {
  for (const rel of ["app/account/security.tsx", "app/legal.tsx"]) {
    const src = read(rel);
    assert.ok(!/permanently (deleted|deletes|removes)/i.test(src), rel);
  }
  const sec = read("app/account/security.tsx");
  assert.match(sec, /deletionAlertCopy/);
  assert.ok(!/Account deleted|have been deleted/.test(sec), "completion copy lives behind the confirmed-outcome helper");
  assert.match(sec, /requests removal of its Google or wallet sign-in record/);
  assert.match(read("app/legal.tsx"), /can take longer to finish/);
  assert.match(read("app/legal.tsx"), /Deletion requested/);
});
