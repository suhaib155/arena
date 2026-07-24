/**
 * Network presentation view — pure, platform-free, testable.
 *
 * Maps existing non-secret auth/wallet state into plain-language connectivity
 * labels for the Network screen. It returns ONLY labels/booleans — never a
 * wallet address, user id, token, session id, provider secret, or api key — and
 * it creates no network/provider/ownership authority. It distinguishes app
 * connectivity from blockchain state, signed-in from wallet ownership, wallet
 * presence from linkage, and local preview from remote service state. It never
 * claims "verified", "synced", "live", "finalized", or "secure".
 */
import type { AuthStatus } from "@/store/useAuthStore";

export type NetTone = "primary" | "success" | "neutral" | "warning";

export interface NetworkViewInput {
  authStatus: AuthStatus;
  hasUser: boolean;
  walletCount: number;
  hasEmbeddedWallet: boolean;
}

export interface NetworkRowVM {
  key: string;
  label: string;
  value: string;
  tone: NetTone;
}

export interface NetworkView {
  signedIn: boolean;
  /** One dominant, honest network line. */
  dominantLabel: string;
  dominantDetail: string;
  dominantTone: NetTone;
  rows: NetworkRowVM[];
  primaryActionLabel: string;
}

export function buildNetworkView(input: NetworkViewInput): NetworkView {
  const signedIn = input.authStatus === "signedIn" && input.hasUser;

  const account: NetworkRowVM = {
    key: "account",
    label: "Account",
    value: signedIn ? "Signed in" : "Local profile",
    tone: signedIn ? "primary" : "neutral",
  };

  let walletValue: string;
  let walletTone: NetTone;
  if (input.walletCount <= 0) {
    walletValue = "No wallet";
    walletTone = "neutral";
  } else if (input.hasEmbeddedWallet) {
    walletValue = "Embedded wallet";
    walletTone = "success";
  } else {
    walletValue = "Wallet linked";
    walletTone = "success";
  }
  const wallet: NetworkRowVM = { key: "wallet", label: "Wallet", value: walletValue, tone: walletTone };

  const chain: NetworkRowVM = {
    key: "chain",
    label: "Chain foundation",
    value: "Base Sepolia · deployed",
    tone: "primary",
  };
  const gameplay: NetworkRowVM = {
    key: "gameplay",
    label: "Local gameplay",
    value: "On-device · off-chain",
    tone: "neutral",
  };

  return {
    signedIn,
    dominantLabel: "Base Sepolia testnet · read-only",
    dominantDetail:
      "The contract foundation is deployed on Base Sepolia. App gameplay runs on-device and off-chain during beta — no wallet, signing, or chain calls happen here.",
    dominantTone: "primary",
    rows: [account, wallet, chain, gameplay],
    primaryActionLabel: signedIn ? "Account & Security" : "Sign in",
  };
}
