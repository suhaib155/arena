import { run } from "hardhat";

const addresses = {
  MoveToken:       process.env.ADDR_MOVE_TOKEN       ?? "",
  ZoneNFT:         process.env.ADDR_ZONE_NFT         ?? "",
  GearNFT:         process.env.ADDR_GEAR_NFT         ?? "",
  ZoneChallenge:   process.env.ADDR_ZONE_CHALLENGE   ?? "",
  MoveVault:       process.env.ADDR_MOVE_VAULT       ?? "",
  MovenDAO:        process.env.ADDR_MOVEN_DAO        ?? "",
  SeasonController:process.env.ADDR_SEASON_CTRL      ?? "",
};

const oracle   = process.env.ORACLE_ADDRESS   ?? "";
const admin    = process.env.ADMIN_ADDRESS    ?? "";
const treasury = process.env.TREASURY_ADDRESS ?? "";

const constructorArgs: Record<string, unknown[]> = {
  MoveToken:        [oracle, admin],
  ZoneNFT:          [addresses.MoveToken, oracle, admin],
  GearNFT:          [addresses.MoveToken, admin],
  ZoneChallenge:    [addresses.MoveToken, addresses.ZoneNFT, oracle, admin],
  MoveVault:        [addresses.MoveToken, admin],
  MovenDAO:         [addresses.MoveToken, addresses.MoveVault, admin],
  SeasonController: [addresses.MoveToken, addresses.ZoneNFT, oracle, treasury, admin],
};

async function main() {
  for (const [name, address] of Object.entries(addresses)) {
    if (!address) { console.log(`Skipping ${name} — address not set`); continue; }
    console.log(`Verifying ${name} at ${address}...`);
    try {
      await run("verify:verify", { address, constructorArguments: constructorArgs[name] });
      console.log(`  ${name} verified.`);
    } catch (e: any) {
      console.log(`  ${name} error: ${e.message}`);
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
