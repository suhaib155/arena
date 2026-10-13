/**
 * "Continue with Google" and "Continue with Wallet" — the rules the device
 * relies on: PKCE encoding, exact redirect matching, the one-time code format
 * shared with the server, and that only public settings reach the build.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  base64ToBase64Url,
  base64UrlEncode,
  buildGoogleAuthorizeUrl,
  buildWalletSignInPageUrl,
  GOOGLE_REDIRECT_URL,
  normalizeHandoffCode,
  parseGoogleCallback,
  parseWalletReturn,
  pkceVerifierFrom,
  readPendingWalletSignIn,
  readSupabaseClientConfig,
  readWebUrl,
  WALLET_APPS,
  WALLET_HANDOFF_MAX_AGE_MS,
  WALLET_RETURN_URL,
  walletAppLink,
} from "../signInMethods";

const ROOT = join(__dirname, "..", "..", "..");

test("PKCE matches RFC 7636 appendix B", () => {
  const bytes = Uint8Array.from([116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121]);
  const verifier = pkceVerifierFrom(bytes);
  assert.equal(verifier, "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
  // expo-crypto hands back standard base64; the conversion must yield the RFC's challenge.
  assert.equal(base64ToBase64Url(createHash("sha256").update(verifier).digest("base64")), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  assert.throws(() => pkceVerifierFrom(new Uint8Array(16)));
  for (let n = 0; n < 7; n++) {
    const b = Uint8Array.from({ length: n }, (_, i) => (i * 97 + 13) & 255);
    assert.equal(base64UrlEncode(b), Buffer.from(b).toString("base64url"));
  }
});

test("the Google authorize URL asks Supabase for Google with S256 and only basic scopes", () => {
  const url = new URL(buildGoogleAuthorizeUrl("https://abc.supabase.co", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"));
  assert.equal(url.origin + url.pathname, "https://abc.supabase.co/auth/v1/authorize");
  assert.equal(url.searchParams.get("provider"), "google");
  assert.equal(url.searchParams.get("redirect_to"), GOOGLE_REDIRECT_URL);
  assert.equal(url.searchParams.get("scopes"), "openid email profile");
  assert.equal(url.searchParams.get("code_challenge_method"), "s256");
  assert.throws(() => buildGoogleAuthorizeUrl("https://abc.supabase.co", "short"));
});

test("only the exact redirect with a code is accepted back from the browser", () => {
  assert.deepEqual(parseGoogleCallback("movenrun://auth/callback?code=abc123def456"), { kind: "code", code: "abc123def456" });
  assert.deepEqual(parseGoogleCallback(null), { kind: "cancelled" });
  assert.deepEqual(parseGoogleCallback("movenrun://auth/callbackx?code=abc123def456"), { kind: "error", reason: "unexpected_redirect" });
  assert.deepEqual(parseGoogleCallback("evil://auth/callback?code=abc123def456"), { kind: "error", reason: "unexpected_redirect" });
  assert.deepEqual(parseGoogleCallback("movenrun://auth/callback?error=access_denied&error_description=nope"), { kind: "error", reason: "provider_error" });
  assert.deepEqual(parseGoogleCallback("movenrun://auth/callback"), { kind: "error", reason: "missing_code" });
  assert.deepEqual(parseGoogleCallback("movenrun://auth/callback?code=<script>"), { kind: "error", reason: "missing_code" });
});

test("wallet one-time codes: typed loosely, accepted only in the server's alphabet", () => {
  assert.equal(normalizeHandoffCode("abcd efgh jkmn"), "ABCDEFGHJKMN");
  assert.equal(normalizeHandoffCode(" ABCD-EFGH-JKMN "), "ABCDEFGHJKMN");
  assert.equal(normalizeHandoffCode("ABCDEFGHJKM"), null); // too short
  assert.equal(normalizeHandoffCode("ABCDEFGHJKM0"), null); // 0 is not in the alphabet
  assert.equal(normalizeHandoffCode("ABCDEFGHJKMI"), null); // nor is I
  // The server issues codes from the same alphabet, at the same length.
  const server = readFileSync(join(ROOT, "..", "backend", "src", "identity", "services", "supabaseSignIn.service.ts"), "utf8");
  assert.match(server, /HANDOFF_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"/);
  assert.match(server, /HANDOFF_CODE_LENGTH = 12;/);
});

test("the wallet return link is read only from MovenRun's own path", () => {
  assert.equal(parseWalletReturn(`${WALLET_RETURN_URL}?code=abcdefghjkmn`), "ABCDEFGHJKMN");
  assert.equal(parseWalletReturn("movenrun://auth/walletx?code=ABCDEFGHJKMN"), null);
  assert.equal(parseWalletReturn("https://movenrun.xyz/auth/wallet?code=ABCDEFGHJKMN"), null);
  assert.equal(parseWalletReturn(`${WALLET_RETURN_URL}?code=nope`), null);
  assert.equal(parseWalletReturn(undefined), null);
});

test("each wallet app link opens MovenRun's sign-in page with this device's challenge", () => {
  const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
  const page = buildWalletSignInPageUrl("https://movenrun.xyz", challenge);
  assert.equal(page, `https://movenrun.xyz/sign-in/?app=android&challenge=${challenge}`);
  assert.deepEqual(WALLET_APPS.map((a) => a.id), ["metamask", "coinbase", "trust"]);
  assert.equal(walletAppLink("metamask", page), `https://metamask.app.link/dapp/movenrun.xyz/sign-in/?app=android&challenge=${challenge}`);
  assert.equal(new URL(walletAppLink("coinbase", page)).searchParams.get("cb_url"), page);
  assert.equal(new URL(walletAppLink("trust", page)).searchParams.get("url"), page);
  assert.throws(() => buildWalletSignInPageUrl("https://movenrun.xyz", "x"));
});

test("only public Supabase settings reach the build, and a secret key is refused", () => {
  assert.deepEqual(
    readSupabaseClientConfig({ EXPO_PUBLIC_SUPABASE_URL: "https://tavxmwuwkeynbnzfwove.supabase.co/", EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x" }),
    { url: "https://tavxmwuwkeynbnzfwove.supabase.co", publishableKey: "sb_publishable_x" },
  );
  assert.equal(readSupabaseClientConfig({ EXPO_PUBLIC_SUPABASE_URL: "https://tavxmwuwkeynbnzfwove.supabase.co", EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_x" }), null);
  assert.equal(readSupabaseClientConfig({ EXPO_PUBLIC_SUPABASE_URL: "http://tavxmwuwkeynbnzfwove.supabase.co", EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "k" }), null);
  assert.equal(readSupabaseClientConfig({ EXPO_PUBLIC_SUPABASE_URL: "https://evil.example.com", EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "k" }), null);
  assert.equal(readSupabaseClientConfig({}), null);
  assert.equal(readWebUrl({}), "https://movenrun.xyz");
  assert.equal(readWebUrl({ EXPO_PUBLIC_WEB_URL: "http://movenrun.xyz" }), "https://movenrun.xyz");
  assert.equal(readWebUrl({ EXPO_PUBLIC_WEB_URL: "https://staging.movenrun.xyz/" }), "https://staging.movenrun.xyz");
});

test("a waiting wallet sign-in is honoured only while fresh and well formed", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const raw = JSON.stringify({ verifier, startedAt: 1_000 });
  assert.deepEqual(readPendingWalletSignIn(raw, 1_000 + 60_000), { verifier, startedAt: 1_000 });
  assert.equal(readPendingWalletSignIn(raw, 1_000 + WALLET_HANDOFF_MAX_AGE_MS + 1), null);
  assert.equal(readPendingWalletSignIn(raw, 0), null); // clock went backwards
  assert.equal(readPendingWalletSignIn(JSON.stringify({ verifier: "short", startedAt: 1_000 }), 2_000), null);
  assert.equal(readPendingWalletSignIn("{", 2_000), null);
  assert.equal(readPendingWalletSignIn(null, 2_000), null);
});

test("no sign-in path asks for a recovery phrase, a private key or a transaction", () => {
  for (const file of ["src/services/signInProviders.ts", "src/components/SignInOptions.tsx", "src/lib/signInMethods.ts"]) {
    // Code only: the doc comments say what is never asked for.
    const src = readFileSync(join(ROOT, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    assert.ok(!/eth_sendTransaction|eth_signTransaction|sendTransaction|mnemonic|privateKey|seed phrase/i.test(src), file);
  }
});
