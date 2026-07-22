/**
 * Profile identity/status view — pure, platform-free, testable.
 *
 * Derives ONLY non-secret display labels from existing auth/wallet/club state.
 * It never returns user ids, wallet addresses, tokens, session identifiers, or
 * any secret — only truthful labels and booleans the Profile header can render.
 * It adds no wallet-linking or identity-provider behaviour.
 */
import type { AuthStatus } from "@/store/useAuthStore";

export interface ProfileIdentityInput {
  authStatus: AuthStatus;
  /** Whether a server-derived user object is present. */
  hasUser: boolean;
  /** Number of wallets on the account. */
  walletCount: number;
  /** Whether an embedded (provisioned) wallet exists. */
  hasEmbeddedWallet: boolean;
}

export interface ProfileIdentity {
  signedIn: boolean;
  /** "Signed in" vs "Local profile". */
  statusLabel: string;
  statusTone: "primary" | "neutral";
  /** Honest wallet presence label — never an address. */
  walletLabel: string;
  walletAvailable: boolean;
  /** The single primary account action for this state. */
  primaryActionLabel: string;
}

/**
 * Resolve the truthful identity header state. "Signed in" requires an actual
 * signed-in status AND a user object; anything else is a local profile.
 */
export function buildProfileIdentity(input: ProfileIdentityInput): ProfileIdentity {
  const signedIn = input.authStatus === "signedIn" && input.hasUser;

  let walletLabel: string;
  if (input.walletCount <= 0) walletLabel = "No wallet yet";
  else if (input.hasEmbeddedWallet) walletLabel = "Embedded wallet";
  else walletLabel = "Wallet linked";

  return {
    signedIn,
    statusLabel: signedIn ? "Signed in" : "Local profile",
    statusTone: signedIn ? "primary" : "neutral",
    walletLabel,
    walletAvailable: input.walletCount > 0,
    primaryActionLabel: signedIn ? "Account & Security" : "Sign in",
  };
}
