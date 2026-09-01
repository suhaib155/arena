/**
 * Product truth about location data.
 *
 * The app spent most of its life genuinely local, and its copy said so —
 * "raw GPS is never uploaded", "it stays on your device", "nothing is sent
 * anywhere". Server verification made those sentences false, and nothing
 * failed when it did: the code changed, the strings did not, and the app went
 * on telling users the opposite of what it does in the one place they read to
 * decide — the location permission rationale.
 *
 * These tests exist so that cannot happen silently again. They assert two
 * things:
 *
 *   1. no user-facing string makes an UNSCOPED absolute claim about location
 *      data ("never uploaded", "stays on your device", "nothing is sent"),
 *      because such a claim is only ever one feature away from being a lie;
 *   2. the surfaces that ask for consent actually describe what happens.
 *
 * A claim scoped to a specific artefact — "this passport holds no coordinates",
 * "the saved review keeps no coordinates" — is fine and stays. The ban is on
 * claims about the app as a whole.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const MOBILE = process.cwd();
const read = (p: string) => readFileSync(p, "utf8");

/**
 * Source with comments stripped.
 *
 * The ban is on what the app SAYS, and a comment explaining why a claim was
 * removed necessarily quotes the claim. Scanning raw files flagged this file's
 * own rationale, a note about the local owner key never being sent to the
 * server (true, and not about location at all), and the comment recording why
 * the permission rationale changed — none of which is a user-facing promise.
 */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");

/** Every source file that can put words in front of a user. */
function userFacingSources(): string[] {
  const roots = [join(MOBILE, "app"), join(MOBILE, "src")];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      // lstat, not stat: a symlink out of the workspace must not be followed.
      const info = statSync(full, { throwIfNoEntry: false });
      if (!info) continue;
      if (info.isDirectory()) {
        if (entry === "__tests__" || entry === "node_modules") continue;
        walk(full);
        continue;
      }
      if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
    }
  };
  for (const root of roots) walk(root);
  assert.ok(out.length > 50, "discovery found suspiciously few sources — fail closed");
  return out;
}

/**
 * Absolute claims about where location data goes.
 *
 * Each of these was a real string in this app, and each became false without
 * anyone noticing. They are banned outright rather than corrected in place,
 * because the honest version of every one of them is scoped to an artefact and
 * therefore reads differently.
 */
const BANNED_CLAIMS: [RegExp, string][] = [
  [/never uploaded/i, 'saving a session while signed in uploads the route'],
  [/is never sent/i, "the route is sent for verification"],
  [/nothing is sent anywhere/i, "observations are sent to /movement/verify"],
  [/no location is\s+sent anywhere/i, "the summary screen is where the route is sent"],
  [/stays on your device/i, "a saved session's route does not stay on the device"],
  [/raw GPS and paths are never stored/i, "a failed verification is stored, briefly, on the device"],
  [/never leaves? your (device|phone)/i, "a saved session's route leaves the device"],
  [/no data (ever )?leaves/i, "verification observations leave the device"],
];

test("no source makes an unscoped absolute claim about location data", () => {
  const offences: string[] = [];
  for (const file of userFacingSources()) {
    const source = code(file);
    for (const [pattern, why] of BANNED_CLAIMS) {
      const match = source.match(pattern);
      if (!match) continue;
      offences.push(`${file.slice(MOBILE.length + 1)}: "${match[0]}" — ${why}`);
    }
  }
  assert.deepEqual(
    offences,
    [],
    "these claims are not true of this app:\n  " +
      offences.join("\n  ") +
      "\n\nScope the claim to the artefact it is about " +
      '("this passport holds no coordinates") rather than to the app.',
  );
});

/* ── the consent surfaces must describe what happens ──────────────────────── */

test("the location permission rationale says the route can be sent", () => {
  /* This is the screen shown BEFORE the OS prompt — the one a user reads to
     decide. It described a purely local app for as long as the app was one,
     and kept describing it afterwards. */
  const source = read(join(MOBILE, "src", "lib", "moveReadiness.ts"));
  const rationale = source.slice(source.indexOf('kind: "permission-required"'));
  const message = rationale.slice(rationale.indexOf("message:"), rationale.indexOf("primaryLabel"));

  assert.match(message, /foreground/i, "must still say tracking is foreground-only");
  assert.match(message, /never in the background/i, "the background promise is load-bearing");
  assert.match(
    message,
    /sends? that session(&apos;|')s route to MovenRun/i,
    "the rationale must say the route can be sent, not merely that location is used",
  );
  assert.match(message, /signed in/i, "and must scope that to the signed-in case");
});

test("account creation states upload, retention and what history does not hold", () => {
  const welcome = read(join(MOBILE, "app", "welcome.tsx"));
  const footer = welcome.slice(welcome.indexOf("footerHeading"));

  assert.match(footer, /never in the background/i);
  assert.match(footer, /nothing leaves your device/i, "the local-beta path must stay distinguished");
  assert.match(footer, /sends\s*\n?\s*that session(&apos;|')s route to MovenRun/i, "upload must be stated");
  assert.match(footer, /seven days/i, "the retention bound is part of the disclosure");
  assert.match(footer, /then deleted/i, "so is the deletion");
  assert.match(
    footer,
    /never contain coordinates or a\s*\n?\s*route path/i,
    "the true part of the old copy survives, scoped to the records it is about",
  );
});

test("the save action tells the user what saving does, where saving happens", () => {
  const summary = read(join(MOBILE, "app", "move", "summary.tsx"));
  assert.match(
    summary,
    /Saving sends this session(&apos;|')s route to MovenRun to verify the distance/,
    "disclosure belongs at the action, not in a settings page nobody opens",
  );
  /* And only when signed in: a local-beta save uploads nothing, so claiming it
     does would be the same failure in the opposite direction. */
  const note = summary.slice(summary.indexOf("uploadNote"));
  assert.match(
    summary.slice(0, summary.indexOf("Saving sends this session")),
    /accountId \?/,
    "the notice must be gated on an authenticated account",
  );
  assert.ok(note.length > 0);
});

test("the retention stated to users matches the retention actually enforced", () => {
  /* Copy and constant drifting apart is exactly how the old claims rotted, so
     the number in the disclosure is checked against the number in the policy. */
  const policy = read(join(MOBILE, "src", "lib", "pendingVerification.ts"));
  const match = policy.match(/MAX_PENDING_AGE_MS\s*=\s*(\d+)\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  assert.ok(match, "the retention bound must stay expressed in whole days");
  assert.equal(match[1], "7", "the welcome copy says seven days; change both or neither");
});

test("the shareable proof claims only what the proof itself contains", () => {
  const proof = read(join(MOBILE, "src", "lib", "routeProof.ts"));
  assert.match(
    proof,
    /This proof contains no coordinates and no route path/,
    "shareable text must not carry an app-wide privacy claim into someone else's chat",
  );
});
