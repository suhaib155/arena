/**
 * "Continue with Google" and "Continue with Wallet": the pure parts.
 *
 * Both methods run through Supabase Auth in MovenRun's own project, and both
 * end in the same place: the MovenRun API checks the result and hands back the
 * usual MovenRun session. Nothing here touches the network, the keystore or
 * React Native, so every rule is tested on plain Node.
 *
 * Google: the app runs Supabase's PKCE flow in the system browser. The
 * verifier never leaves the device; the browser only sees its SHA-256.
 *
 * Wallet: the app holds no wallet. The person picks their wallet app, which
 * opens MovenRun's sign-in page in its own browser; the page has the wallet
 * sign one plain-text message (no transaction, no fee) and is handed a short
 * one-time code bound to this app's PKCE challenge. The page sends the code
 * back to `movenrun://auth/wallet`, or the person types it in. Without the
 * verifier, which stayed on this device, the code is worthless.
 */

/** Where Supabase sends the Google result. Must be on the project's redirect allow list. */
export const GOOGLE_REDIRECT_URL = "movenrun://auth/callback";
/** Where the wallet sign-in page sends the one-time code. Fixed: the page accepts no other target. */
export const WALLET_RETURN_URL = "movenrun://auth/wallet";
export const DEFAULT_WEB_URL = "https://movenrun.xyz";
/** A wallet sign-in started on this device is abandoned after this long. */
export const WALLET_HANDOFF_MAX_AGE_MS = 10 * 60 * 1000;

export interface SupabaseClientConfig {
  url: string;
  publishableKey: string;
}

/**
 * The public Supabase settings baked into the build, or null when either is
 * missing or malformed. "Continue with Google" is not offered without them.
 * Only the publishable key may ever appear here; a secret key is refused.
 */
export function readSupabaseClientConfig(env: Record<string, string | undefined>): SupabaseClientConfig | null {
  const url = env.EXPO_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "");
  const publishableKey = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) return null;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) return null;
  if (publishableKey.startsWith("sb_secret_")) return null;
  return { url, publishableKey };
}

/** The MovenRun website that hosts the wallet sign-in page. */
export function readWebUrl(env: Record<string, string | undefined>): string {
  const raw = env.EXPO_PUBLIC_WEB_URL?.trim().replace(/\/+$/, "");
  return raw && /^https:\/\/[a-z0-9.-]+$/.test(raw) ? raw : DEFAULT_WEB_URL;
}

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Unpadded base64url (RFC 4648 §5). */
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64URL[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64URL[n & 63];
  }
  return out;
}

/** Standard base64 (as expo-crypto returns a digest) to unpadded base64url. */
export function base64ToBase64Url(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RFC 7636 verifier from 32 random bytes: 43 base64url characters. */
export function pkceVerifierFrom(randomBytes: Uint8Array): string {
  if (randomBytes.length < 32) throw new Error("PKCE verifier needs 32 random bytes");
  return base64UrlEncode(randomBytes.slice(0, 32));
}

export const PKCE_VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
export const PKCE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

/** Supabase's authorize URL for Google, PKCE (S256). Only the basic scopes are requested. */
export function buildGoogleAuthorizeUrl(supabaseUrl: string, codeChallenge: string): string {
  if (!PKCE_CHALLENGE_RE.test(codeChallenge)) throw new Error("invalid code challenge");
  const params = [
    ["provider", "google"],
    ["redirect_to", GOOGLE_REDIRECT_URL],
    ["scopes", "openid email profile"],
    ["code_challenge", codeChallenge],
    ["code_challenge_method", "s256"],
  ];
  return `${supabaseUrl}/auth/v1/authorize?` + params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}

export type CallbackResult =
  | { kind: "code"; code: string }
  | { kind: "cancelled" }
  | { kind: "error"; reason: "provider_error" | "unexpected_redirect" | "missing_code" };

function queryOf(url: string): Map<string, string> {
  const out = new Map<string, string>();
  const at = url.indexOf("?");
  if (at < 0) return out;
  const hash = url.indexOf("#", at);
  const query = url.slice(at + 1, hash < 0 ? undefined : hash);
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const key = decodeURIComponent((eq < 0 ? pair : pair.slice(0, eq)).replace(/\+/g, " "));
    const value = eq < 0 ? "" : decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, " "));
    if (!out.has(key)) out.set(key, value);
  }
  return out;
}

/**
 * Read the URL the browser came back with. Anything but exactly our redirect
 * (same scheme, host and path) is refused, and an error from the provider is
 * reported without its text.
 */
export function parseGoogleCallback(url: string | null | undefined): CallbackResult {
  if (!url) return { kind: "cancelled" };
  const base = url.split(/[?#]/)[0];
  if (base !== GOOGLE_REDIRECT_URL) return { kind: "error", reason: "unexpected_redirect" };
  const q = queryOf(url);
  if (q.has("error") || q.has("error_code")) return { kind: "error", reason: "provider_error" };
  const code = q.get("code");
  if (!code || !/^[A-Za-z0-9._~-]{8,512}$/.test(code)) return { kind: "error", reason: "missing_code" };
  return { kind: "code", code };
}

/** One-time codes from the wallet sign-in page: 12 characters from an unambiguous alphabet. */
const HANDOFF_ALPHABET_RE = /^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{12}$/;

/** Accepts the code as typed: any case, with spaces or dashes. Null if it cannot be one. */
export function normalizeHandoffCode(input: string): string | null {
  const code = input.trim().toUpperCase().replace(/[\s-]+/g, "");
  return HANDOFF_ALPHABET_RE.test(code) ? code : null;
}

/** Read the code from `movenrun://auth/wallet?code=…`. Nothing else is accepted. */
export function parseWalletReturn(url: string | null | undefined): string | null {
  if (!url || url.split(/[?#]/)[0] !== WALLET_RETURN_URL) return null;
  return normalizeHandoffCode(queryOf(url).get("code") ?? "");
}

/** The sign-in page, told which challenge to bind its code to. */
export function buildWalletSignInPageUrl(webUrl: string, codeChallenge: string): string {
  if (!PKCE_CHALLENGE_RE.test(codeChallenge)) throw new Error("invalid code challenge");
  return `${webUrl}/sign-in/?app=android&challenge=${codeChallenge}`;
}

export type WalletAppId = "metamask" | "coinbase" | "trust";

export interface WalletApp {
  id: WalletAppId;
  label: string;
}

/** Wallet apps whose own browsers can open a page by link. Order is display order. */
export const WALLET_APPS: readonly WalletApp[] = [
  { id: "metamask", label: "MetaMask" },
  { id: "coinbase", label: "Coinbase Wallet" },
  { id: "trust", label: "Trust Wallet" },
];

/**
 * A link that opens `pageUrl` inside the chosen wallet's browser. These are
 * each wallet's published universal links; if the wallet is not installed the
 * link falls through to its store page.
 */
export function walletAppLink(app: WalletAppId, pageUrl: string): string {
  switch (app) {
    case "metamask":
      return `https://metamask.app.link/dapp/${pageUrl.replace(/^https:\/\//, "")}`;
    case "coinbase":
      return `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(pageUrl)}`;
    case "trust":
      return `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(pageUrl)}`;
  }
}

export interface PendingWalletSignIn {
  verifier: string;
  startedAt: number;
}

/** A stored wallet sign-in, if it is well formed and still fresh. */
export function readPendingWalletSignIn(raw: string | null, now: number): PendingWalletSignIn | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingWalletSignIn>;
    if (typeof value.verifier !== "string" || !PKCE_VERIFIER_RE.test(value.verifier)) return null;
    if (typeof value.startedAt !== "number" || !Number.isFinite(value.startedAt)) return null;
    const age = now - value.startedAt;
    if (age < 0 || age > WALLET_HANDOFF_MAX_AGE_MS) return null;
    return { verifier: value.verifier, startedAt: value.startedAt };
  } catch {
    return null;
  }
}
