// Contract address registry.
//
// baseSepolia addresses are the authoritative deployed addresses, sourced from
// contracts/deployments/baseSepolia.json (deployed 2026-05-27, chainId 84532).
// Do NOT hand-edit these to anything other than what the deployment file records.
// base (mainnet) is intentionally empty until a Phase 3 mainnet deployment.
export const CONTRACT_ADDRESSES = {
  baseSepolia: {
    MoveToken: "0x86fD3984D0c4D1A8912Fc168cb6eD2a35B94C1aC" as `0x${string}`,
    GPSOracle: "0x7E3972Cff8fF3Ed352DD649Da2E949Bb80A4aF90" as `0x${string}`,
    ZoneNFT: "0xF9694dA0897916A4c01a2c59f2B8E850AA4FEfD8" as `0x${string}`,
    GearNFT: "0xfE46bcC610761D82A646bdDA2D27fD1d044C09Cc" as `0x${string}`,
    MoveVault: "0x87250370311b8D48C19cA7725c1bdb8B3f7CF556" as `0x${string}`,
    ZoneChallenge: "0x3CC6b92B3051D2C4FbAf92423e427761982685D7" as `0x${string}`,
    SeasonController: "0x687b77f2B047313Bba2eC2C69D9D0618bbA15BdA" as `0x${string}`,
    MovenDAO: "0x5Ed4Ee303fB55CEFBB7460e8FDb5C33424A6fC15" as `0x${string}`,
  },
  base: {
    MoveToken: "" as `0x${string}`,
    GPSOracle: "" as `0x${string}`,
    ZoneNFT: "" as `0x${string}`,
    GearNFT: "" as `0x${string}`,
    MoveVault: "" as `0x${string}`,
    ZoneChallenge: "" as `0x${string}`,
    SeasonController: "" as `0x${string}`,
    MovenDAO: "" as `0x${string}`,
  },
} as const;

export type SupportedChain = keyof typeof CONTRACT_ADDRESSES;
