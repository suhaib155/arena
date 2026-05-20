export const CONTRACT_ADDRESSES = {
  baseSepolia: {
    MoveToken: "" as `0x${string}`,
    ZoneNFT: "" as `0x${string}`,
    GearNFT: "" as `0x${string}`,
    ZoneChallenge: "" as `0x${string}`,
    SeasonController: "" as `0x${string}`,
    MoveVault: "" as `0x${string}`,
    MovenDAO: "" as `0x${string}`,
  },
  base: {
    MoveToken: "" as `0x${string}`,
    ZoneNFT: "" as `0x${string}`,
    GearNFT: "" as `0x${string}`,
    ZoneChallenge: "" as `0x${string}`,
    SeasonController: "" as `0x${string}`,
    MoveVault: "" as `0x${string}`,
    MovenDAO: "" as `0x${string}`,
  },
} as const;

export type SupportedChain = keyof typeof CONTRACT_ADDRESSES;
