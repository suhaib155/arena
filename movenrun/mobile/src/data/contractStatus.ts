/**
 * Base Sepolia contract status — mobile-safe, read-only display data.
 *
 * Mirrors the shared Base Sepolia deployment registry
 * (`shared/src/constants/contracts.ts`, sourced from
 * `contracts/deployments/baseSepolia.json`). Read-only display only:
 *
 * The mobile app does not depend on `@movenrun/shared`, `ethers`, or any RPC,
 * so the deployed addresses are mirrored here as plain constants rather than
 * imported (which would pull backend/Node-only code into the Expo bundle).
 * These are public testnet addresses shown for information only — no wallet,
 * no signing, no chain calls. If the registry changes, update this mirror.
 */
import type { IoniconName } from "@/types";

export type ContractCategory =
  | "token"
  | "oracle"
  | "nft"
  | "vault"
  | "challenge"
  | "season"
  | "governance";

export interface ContractStatus {
  key: string;
  displayName: string;
  purpose: string;
  /** Public Base Sepolia address (testnet). */
  address: string;
  category: ContractCategory;
  /** Always "deployed" — this screen is a read-only preview. */
  status: "deployed";
}

export interface NetworkStatus {
  networkName: string;
  chainId: number;
  mode: string;
  /** App's relationship to the chain right now. */
  appAccess: string;
  /** Deployment timestamp from baseSepolia.json. */
  deployedAt: string;
  contracts: ContractStatus[];
}

/** Icon + accent role per category (resolved against the theme in the screen). */
export const CATEGORY_META: Record<
  ContractCategory,
  { label: string; icon: IoniconName }
> = {
  token: { label: "Token", icon: "ellipse-outline" },
  oracle: { label: "Oracle", icon: "navigate-outline" },
  nft: { label: "NFT", icon: "grid-outline" },
  vault: { label: "Vault", icon: "lock-closed-outline" },
  challenge: { label: "Challenge", icon: "shield-outline" },
  season: { label: "Season", icon: "calendar-outline" },
  governance: { label: "Governance", icon: "people-circle-outline" },
};

/**
 * The deployed Base Sepolia suite (chainId 84532), mirrored from the shared
 * registry. Order matches the deployment record.
 */
export const BASE_SEPOLIA_STATUS: NetworkStatus = {
  networkName: "Base Sepolia",
  chainId: 84532,
  mode: "Testnet",
  appAccess: "Preview only",
  deployedAt: "2026-05-27",
  contracts: [
    {
      key: "MoveToken",
      displayName: "MoveToken",
      purpose: "The $MOVE token contract (oracle-gated, capped supply).",
      address: "0x86fD3984D0c4D1A8912Fc168cb6eD2a35B94C1aC",
      category: "token",
      status: "deployed",
    },
    {
      key: "GPSOracle",
      displayName: "GPS Oracle",
      purpose: "Verifies signed GPS routes before any on-chain action.",
      address: "0x7E3972Cff8fF3Ed352DD649Da2E949Bb80A4aF90",
      category: "oracle",
      status: "deployed",
    },
    {
      key: "ZoneNFT",
      displayName: "Zone Deed",
      purpose: "Zone Deed NFTs — one per H3 hex tile. Arrive later.",
      address: "0xF9694dA0897916A4c01a2c59f2B8E850AA4FEfD8",
      category: "nft",
      status: "deployed",
    },
    {
      key: "GearNFT",
      displayName: "Gear",
      purpose: "Gear items with movement stat multipliers.",
      address: "0xfE46bcC610761D82A646bdDA2D27fD1d044C09Cc",
      category: "nft",
      status: "deployed",
    },
    {
      key: "MoveVault",
      displayName: "Move Vault",
      purpose: "Treasury and protocol-owned liquidity (future).",
      address: "0x87250370311b8D48C19cA7725c1bdb8B3f7CF556",
      category: "vault",
      status: "deployed",
    },
    {
      key: "ZoneChallenge",
      displayName: "Zone Challenge",
      purpose: "On-chain land-defence battles for owned zones.",
      address: "0x3CC6b92B3051D2C4FbAf92423e427761982685D7",
      category: "challenge",
      status: "deployed",
    },
    {
      key: "SeasonController",
      displayName: "Season Controller",
      purpose: "Runs 90-day seasons and the season burn.",
      address: "0x687b77f2B047313Bba2eC2C69D9D0618bbA15BdA",
      category: "season",
      status: "deployed",
    },
    {
      key: "MovenDAO",
      displayName: "Moven DAO",
      purpose: "Tiered governance for the territory economy.",
      address: "0x5Ed4Ee303fB55CEFBB7460e8FDb5C33424A6fC15",
      category: "governance",
      status: "deployed",
    },
  ],
};

/** "0x86fD…C1aC" — compact address for display. */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
