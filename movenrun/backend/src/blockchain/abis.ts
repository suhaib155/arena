/**
 * Minimal, read-only ABI fragments for the deployed Base Sepolia contracts.
 *
 * Why hand-written fragments instead of full compiled artifacts: the contracts
 * package keeps `artifacts/` git-ignored, so they aren't present in the repo
 * tree the backend ships with. Rather than commit large generated blobs, this
 * exposes only the **view** functions that actually exist in the audited
 * contract sources (`contracts/src/*.sol`). No write/mutating functions are
 * included by design — this is read-only infrastructure.
 *
 * Every fragment below was verified against the on-`main` post-audit source.
 */
import type { ContractName } from "./deployments.js";

/** ERC-20 + AccessControl reads (MoveToken). */
export const MOVE_TOKEN_READ_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function MAX_SUPPLY() view returns (uint256)",
  "function ZONE_TAX_BPS() view returns (uint256)",
  "function baseRate() view returns (uint256)",
  "function currentRate() view returns (uint256)",
  "function currentDailyCap() view returns (uint256)",
  "function zoneNFT() view returns (address)",
] as const;

/** ERC-721 + AccessControl reads (ZoneNFT). */
export const ZONE_NFT_READ_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function zoneOwner(uint64 hexId) view returns (address)",
  "function getLoyaltyMultiplier(uint64 hexId) view returns (uint256)",
] as const;

/** GPSOracle reads. */
export const GPS_ORACLE_READ_ABI = [
  "function oracleOperator() view returns (address)",
  "function moveToken() view returns (address)",
] as const;

/** SeasonController reads. */
export const SEASON_CONTROLLER_READ_ABI = [
  "function seasonNumber() view returns (uint256)",
  "function seasonStart() view returns (uint256)",
  "function seasonEnd() view returns (uint256)",
  "function isMintingAllowed() view returns (bool)",
  "function SEASON_DURATION() view returns (uint256)",
] as const;

/** GearNFT (ERC-1155) reads. */
export const GEAR_NFT_READ_ABI = [
  "function nextGearId() view returns (uint256)",
  "function getUserMultiplier(address user) view returns (uint256)",
] as const;

/** ZoneChallenge reads (public constants/state). */
export const ZONE_CHALLENGE_READ_ABI = [
  "function CHALLENGE_DURATION() view returns (uint256)",
  "function DECLARATION_COST() view returns (uint256)",
  "function STRONGHOLD_COST() view returns (uint256)",
] as const;

/**
 * Universal AccessControl reads. Every deployed contract extends OpenZeppelin
 * AccessControl, so these are always safe to call. Used for contracts without a
 * dedicated read fragment (MoveVault, MovenDAO).
 */
export const ACCESS_CONTROL_READ_ABI = [
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function getRoleAdmin(bytes32 role) view returns (bytes32)",
] as const;

/** Read-only ABI for each deployed contract. */
export const CONTRACT_READ_ABIS: Record<ContractName, readonly string[]> = {
  MoveToken: MOVE_TOKEN_READ_ABI,
  GPSOracle: GPS_ORACLE_READ_ABI,
  ZoneNFT: ZONE_NFT_READ_ABI,
  GearNFT: GEAR_NFT_READ_ABI,
  MoveVault: ACCESS_CONTROL_READ_ABI,
  ZoneChallenge: ZONE_CHALLENGE_READ_ABI,
  SeasonController: SEASON_CONTROLLER_READ_ABI,
  MovenDAO: ACCESS_CONTROL_READ_ABI,
};
