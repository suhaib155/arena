/**
 * The device side of "Continue with Google" and "Continue with Wallet".
 *
 * Rules live in `lib/signInMethods.ts`; this module only does the parts that
 * need the phone: the system browser, random bytes and SHA-256, the keystore,
 * and opening a wallet app. It never sees a password, a seed phrase or a
 * private key, and it never asks a wallet for a transaction.
 *
 * The Supabase session from Google is used once, to prove the sign-in to the
 * MovenRun API, and is then signed out. The app runs on its MovenRun session.
 */
import * as WebBrowser from "expo-web-browser";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as Linking from "expo-linking";
import {
  base64ToBase64Url,
  buildGoogleAuthorizeUrl,
  buildWalletSignInPageUrl,
  GOOGLE_REDIRECT_URL,
  parseGoogleCallback,
  pkceVerifierFrom,
  readPendingWalletSignIn,
  readSupabaseClientConfig,
  readWebUrl,
  walletAppLink,
  type SupabaseClientConfig,
  type WalletAppId,
} from "../lib/signInMethods";
import { IdentityApiError, type IdentityApiClient, type LoginResult } from "./identityApi";

const PENDING_WALLET_KEY = "movenrun.walletSignIn.v1";

/* Expo inlines EXPO_PUBLIC_* only where each is written out in full. */
function supabaseConfig(): SupabaseClientConfig | null {
  return readSupabaseClientConfig({
    EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}

function webUrl(): string {
  return readWebUrl({ EXPO_PUBLIC_WEB_URL: process.env.EXPO_PUBLIC_WEB_URL });
}

/** Google needs the public Supabase settings in the build; without them the button is not shown. */
export function isGoogleSignInConfigured(): boolean {
  return supabaseConfig() !== null;
}

async function newPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = pkceVerifierFrom(Crypto.getRandomBytes(32));
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  return { verifier, challenge: base64ToBase64Url(digest) };
}

function supabaseHeaders(config: SupabaseClientConfig, bearer = config.publishableKey): Record<string, string> {
  return { apikey: config.publishableKey, authorization: `Bearer ${bearer}`, "content-type": "application/json" };
}

/** Sign the short-lived Supabase session out once MovenRun has its own. Best effort. */
async function endSupabaseSession(config: SupabaseClientConfig, accessToken: string): Promise<void> {
  try {
    await fetch(`${config.url}/auth/v1/logout?scope=local`, { method: "POST", headers: supabaseHeaders(config, accessToken) });
  } catch {
    // It expires on its own within the hour, and the app never stores it.
  }
}

/**
 * "Continue with Google". Resolves with the MovenRun login, or null when the
 * person closed the browser. Errors carry stable public codes.
 */
export async function signInWithGoogle(client: IdentityApiClient, deviceLabel?: string): Promise<LoginResult | null> {
  const config = supabaseConfig();
  if (!config) throw new IdentityApiError(0, "provider_not_configured");
  const { verifier, challenge } = await newPkcePair();
  const session = await WebBrowser.openAuthSessionAsync(buildGoogleAuthorizeUrl(config.url, challenge), GOOGLE_REDIRECT_URL);
  if (session.type !== "success") return null;
  const callback = parseGoogleCallback(session.url);
  if (callback.kind === "cancelled") return null;
  if (callback.kind === "error") throw new IdentityApiError(0, "sign_in_failed");

  let res: Response;
  try {
    res = await fetch(`${config.url}/auth/v1/token?grant_type=pkce`, {
      method: "POST",
      headers: supabaseHeaders(config),
      body: JSON.stringify({ auth_code: callback.code, code_verifier: verifier }),
    });
  } catch {
    throw new IdentityApiError(0, "service_unavailable");
  }
  if (res.status >= 500) throw new IdentityApiError(res.status, "service_unavailable");
  if (!res.ok) throw new IdentityApiError(res.status, "sign_in_failed");
  const body = (await res.json().catch(() => null)) as { access_token?: unknown } | null;
  if (!body || typeof body.access_token !== "string") throw new IdentityApiError(0, "sign_in_failed");
  try {
    return await client.completeGoogleSignIn(body.access_token, deviceLabel);
  } finally {
    void endSupabaseSession(config, body.access_token);
  }
}

/**
 * "Continue with Wallet", first half: remember a fresh verifier on this
 * device and open MovenRun's sign-in page inside the chosen wallet's browser.
 */
export async function startWalletSignIn(app: WalletAppId): Promise<void> {
  const { verifier, challenge } = await newPkcePair();
  try {
    await SecureStore.setItemAsync(PENDING_WALLET_KEY, JSON.stringify({ verifier, startedAt: Date.now() }));
  } catch {
    throw new IdentityApiError(0, "secure_storage_unavailable");
  }
  const link = walletAppLink(app, buildWalletSignInPageUrl(webUrl(), challenge));
  try {
    await Linking.openURL(link);
  } catch {
    throw new IdentityApiError(0, "wallet_app_unavailable");
  }
}

/** Whether a wallet sign-in started on this device is still waiting for its code. */
export async function hasPendingWalletSignIn(): Promise<boolean> {
  try {
    return readPendingWalletSignIn(await SecureStore.getItemAsync(PENDING_WALLET_KEY), Date.now()) !== null;
  } catch {
    return false;
  }
}

async function clearPendingWalletSignIn(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(PENDING_WALLET_KEY);
  } catch {
    // The verifier is useless after its code is spent or expired.
  }
}

/**
 * "Continue with Wallet", second half: spend the code the sign-in page
 * returned (by link or typed in) with the verifier kept on this device.
 */
export async function finishWalletSignIn(client: IdentityApiClient, code: string, deviceLabel?: string): Promise<LoginResult> {
  let raw: string | null;
  try {
    raw = await SecureStore.getItemAsync(PENDING_WALLET_KEY);
  } catch {
    throw new IdentityApiError(0, "secure_storage_unavailable");
  }
  const pending = readPendingWalletSignIn(raw, Date.now());
  if (!pending) {
    await clearPendingWalletSignIn();
    throw new IdentityApiError(0, "wallet_sign_in_expired");
  }
  // Kept on failure: a mistyped code can be corrected, and the server spends a
  // code only together with the right verifier.
  const result = await client.exchangeWalletSignIn(code, pending.verifier, deviceLabel);
  await clearPendingWalletSignIn();
  return result;
}
