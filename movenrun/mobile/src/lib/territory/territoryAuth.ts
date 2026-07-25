/**
 * Authorization headers for territory reads (D2).
 *
 * ## Why this is its own module
 * `services/territoryApi.ts` imports `@/config/map`, which imports
 * `expo-constants` and therefore react-native — it cannot be loaded under
 * `node --test`. This module imports only `@/lib/secureSession` (which is
 * deliberately free of any platform import), so the rule that actually matters
 * here is verifiable offline.
 *
 * ## The rule
 * The backend labels each cell `mine` / `club` / `rival` from the caller's
 * **verified session**, so the app must send the session it already holds. A
 * runner who does not is anonymous, and their own territory comes back
 * `claimed` rather than `mine` — which is exactly the defect this fixes.
 *
 * The token is the *only* thing sent. No wallet address, no user id, no club
 * id: the server derives all of that from the token, and a client-asserted
 * identity would be spoofable by anyone with a HTTP client.
 *
 * ## Failure posture: open, to an anonymous read
 * The territory map is public. A missing session, an unreadable keystore, or a
 * session store that has not been installed yet must all degrade the *labels*,
 * never blank the map — so every failure here yields "no header" rather than an
 * exception. Token refresh remains the identity client's job (`identityApi`);
 * an access token that expired since the last refresh simply reads as anonymous
 * for this request, and the backend answers with `claimed`.
 */
import { getSecureSessionStore } from "@/lib/secureSession";

/** Build the Authorization header, or `{}` when the caller is anonymous. */
export async function territoryAuthHeaders(): Promise<Record<string, string>> {
  try {
    const tokens = await getSecureSessionStore().load();
    if (!tokens?.accessToken) return {};
    return { Authorization: `Bearer ${tokens.accessToken}` };
  } catch {
    // No adapter installed (e.g. a bare harness) or a keystore read failure.
    // Anonymous is a defined, safe answer — see the backend's
    // territory/http/viewer.ts.
    return {};
  }
}
