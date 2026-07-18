/**
 * Presentation helpers for the account/wallet screens — pure, no side effects.
 *
 * These make the UI DISTINGUISH the different concepts the security model keeps
 * separate (MovenRun identity vs embedded wallet vs Base Account vs external
 * wallet vs the single active wallet), and keep testnet wording explicit
 * wherever a chain is shown. They never imply that switching wallets moves
 * rewards or ownership.
 */
import type { PublicWallet } from "@/services/identityApi";
import { palette } from "@/theme";

export function walletTypeLabel(walletType: string): string {
  switch (walletType) {
    case "embedded_eoa":
      return "Embedded wallet";
    case "base_smart_account":
      return "Base Account";
    case "external_smart_account":
      return "External smart account";
    case "external_eoa":
      return "External wallet";
    default:
      return "Wallet";
  }
}

export function walletTypeColor(walletType: string): string {
  switch (walletType) {
    case "embedded_eoa":
      return palette.pulseGreen;
    case "base_smart_account":
      return palette.baseBlue;
    default:
      return palette.deedViolet;
  }
}

export function provisioningLabel(state: string | null): string | null {
  switch (state) {
    case "requested":
      return "Provisioning requested";
    case "provisioning":
      return "Provisioning…";
    case "active":
      return null; // ready — no banner
    case "failed_transient":
      return "Provisioning failed — you can retry";
    case "failed_terminal":
      return "Provisioning failed — contact support";
    default:
      return null;
  }
}

export function shortAddress(address: string | null): string {
  if (!address) return "Not yet provisioned";
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Human, non-misleading label for chain family + testnet context. */
export function chainLabel(chainFamily: string): string {
  // MovenRun operates on Base Sepolia (a TESTNET) today — always say so.
  return chainFamily === "evm" ? "Base Sepolia · testnet" : chainFamily;
}

export function ownershipLabel(status: string): string {
  switch (status) {
    case "verified":
      return "Verified";
    case "unverified":
      return "Unverified";
    case "revoked":
      return "Revoked";
    default:
      return status;
  }
}

/** Sort so the active wallet is first, then verified, then the rest. */
export function sortWalletsForDisplay(wallets: PublicWallet[]): PublicWallet[] {
  return [...wallets].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    const rank = (w: PublicWallet) => (w.ownershipStatus === "verified" ? 0 : w.ownershipStatus === "unverified" ? 1 : 2);
    return rank(a) - rank(b);
  });
}
